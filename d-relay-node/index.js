"use strict";

const http = require("http");
const WebSocket = require("ws");
const Database = require("better-sqlite3");
const sodium = require("libsodium-wrappers");
const webpush = require("web-push");
const fs = require("fs");
const path = require("path");

// Конфигурация

const PORT = parseInt(process.env.PORT || "8081", 10);
const TTL_DAYS = parseInt(process.env.TTL_DAYS || "14", 10);
const POW_DIFFICULTY = parseInt(process.env.POW_DIFFICULTY || "16", 10);
const RELAY_PUBLIC_IP = process.env.RELAY_PUBLIC_IP || "127.0.0.1";
const PEER_RELAYS = process.env.PEER_RELAYS
  ? process.env.PEER_RELAYS.split(",")
      .map((r) => r.trim())
      .filter(Boolean)
  : [];

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// VAPID

function loadVapidKeys() {
  const vapidFile = path.join(__dirname, "vapid.json");
  try {
    if (fs.existsSync(vapidFile)) {
      const raw = fs.readFileSync(vapidFile, "utf-8");
      const { publicKey, privateKey } = JSON.parse(raw);
      if (publicKey && privateKey) {
        console.log("[Push] VAPID keys loaded from vapid.json");
        return { publicKey, privateKey };
      }
    }
  } catch (e) {
    console.warn("[Push] failed to read vapid.json, regenerating:", e.message);
  }

  const keys = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(
      vapidFile,
      JSON.stringify(
        { publicKey: keys.publicKey, privateKey: keys.privateKey },
        null,
        2,
      ),
      "utf-8",
    );
    console.log("[Push] VAPID keys generated and saved to vapid.json");
  } catch (e) {
    console.error(
      "[Push] could not write vapid.json, keys will be ephemeral:",
      e.message,
    );
  }
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

const vapidKeys = loadVapidKeys();
const VAPID_PUBLIC_KEY = vapidKeys.publicKey;
const VAPID_PRIVATE_KEY = vapidKeys.privateKey;

webpush.setVapidDetails("mailto:dev@null", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// SQLite

const db = new Database("./relay.sqlite");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS capsules (
    id         TEXT PRIMARY KEY,
    pubkey     TEXT NOT NULL,
    kind       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    tags       TEXT NOT NULL,
    pow_nonce  INTEGER NOT NULL,
    content    TEXT NOT NULL,
    sig        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_capsules_pubkey     ON capsules(pubkey);
  CREATE INDEX IF NOT EXISTS idx_capsules_expires_at ON capsules(expires_at);
  CREATE INDEX IF NOT EXISTS idx_capsules_created_at ON capsules(created_at);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    pubkey     TEXT PRIMARY KEY,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO capsules
    (id, pubkey, kind, created_at, expires_at, tags, pow_nonce, content, sig)
  VALUES (@id,@pubkey,@kind,@created_at,@expires_at,@tags,@pow_nonce,@content,@sig)
`);
const stmtQueryByPubkey = db.prepare(`
  SELECT * FROM capsules
  WHERE tags LIKE @pattern AND (@since IS NULL OR created_at >= @since)
  ORDER BY created_at ASC LIMIT 200
`);
const stmtQueryById = db.prepare(`SELECT * FROM capsules WHERE id = ?`);
const stmtDeleteExpired = db.prepare(
  `DELETE FROM capsules WHERE expires_at IS NOT NULL AND expires_at <= ?`,
);

const stmtUpsertPushSub = db.prepare(`
  INSERT INTO push_subscriptions (pubkey, endpoint, p256dh, auth, updated_at)
  VALUES (@pubkey, @endpoint, @p256dh, @auth, @updated_at)
  ON CONFLICT(pubkey) DO UPDATE SET endpoint=excluded.endpoint,
    p256dh=excluded.p256dh, auth=excluded.auth, updated_at=excluded.updated_at
`);
const stmtGetPushSub = db.prepare(
  `SELECT * FROM push_subscriptions WHERE pubkey = ?`,
);
const stmtDeletePushSub = db.prepare(
  `DELETE FROM push_subscriptions WHERE pubkey = ?`,
);

// Utils

function calcExpiresAt(kind, tags) {
  if (kind === 3) return null;
  const defaultExpiry = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
  const expirationTag = tags.find((t) => t[0] === "expiration" && t[1]);
  if (expirationTag) {
    const tagTs = parseInt(expirationTag[1], 10);
    if (!isNaN(tagTs)) return Math.min(tagTs, defaultExpiry);
  }
  return defaultExpiry;
}

function checkPoW(idHex, difficultyBits) {
  const fullBytes = Math.floor(difficultyBits / 8);
  const remainder = difficultyBits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (parseInt(idHex.slice(i * 2, i * 2 + 2), 16) !== 0) return false;
  }
  if (remainder > 0) {
    const byte = parseInt(idHex.slice(fullBytes * 2, fullBytes * 2 + 2), 16);
    const mask = (0xff << (8 - remainder)) & 0xff;
    if ((byte & mask) !== 0) return false;
  }
  return true;
}

function verifyCapsule(event) {
  try {
    if (!checkPoW(event.id, POW_DIFFICULTY)) {
      console.warn(`[PoW] failed for ${event.id}`);
      return false;
    }
    const serializedBase = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
    const baseHashHex = sodium.to_hex(
      sodium.crypto_generichash(32, sodium.from_string(serializedBase)),
    );
    const finalIdHex = sodium.to_hex(
      sodium.crypto_generichash(
        32,
        sodium.from_string(baseHashHex + event.pow_nonce),
      ),
    );
    if (finalIdHex !== event.id) {
      console.warn(`[Hash] mismatch: expected ${finalIdHex}, got ${event.id}`);
      return false;
    }
    return sodium.crypto_sign_verify_detached(
      sodium.from_hex(event.sig),
      sodium.from_hex(event.id),
      sodium.from_hex(event.pubkey),
    );
  } catch (e) {
    console.error("[verify] error:", e.message);
    return false;
  }
}

function rowToCapsule(row) {
  return {
    id: row.id,
    pubkey: row.pubkey,
    kind: row.kind,
    created_at: row.created_at,
    tags: JSON.parse(row.tags),
    pow_nonce: row.pow_nonce,
    content: row.content,
    sig: row.sig,
  };
}

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

// Push - отправка wake-сигнала получателям

async function sendPushToRecipients(capsule) {
  const recipients = capsule.tags
    .filter((t) => t[0] === "p" && typeof t[1] === "string")
    .map((t) => t[1]);

  for (const pubkey of recipients) {
    const row = stmtGetPushSub.get(pubkey);
    if (!row) continue;
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      // payload пустой - реле не знает содержимого
      await webpush.sendNotification(subscription, "");
      console.log(`[Push] wake sent to ${pubkey.slice(0, 12)}…`);
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        // Подписка истекла
        stmtDeletePushSub.run(pubkey);
        console.log(
          `[Push] expired subscription removed: ${pubkey.slice(0, 12)}…`,
        );
      } else {
        console.warn(`[Push] failed for ${pubkey.slice(0, 12)}: ${e.message}`);
      }
    }
  }
}

// Subscriptions

const subscriptions = new Map();

function subscribe(pubkey, ws) {
  if (!subscriptions.has(pubkey)) subscriptions.set(pubkey, new Set());
  subscriptions.get(pubkey).add(ws);
}

function unsubscribeAll(ws) {
  for (const [pubkey, clients] of subscriptions) {
    clients.delete(ws);
    if (clients.size === 0) subscriptions.delete(pubkey);
  }
}

function routeCapsule(capsule) {
  const recipients = capsule.tags
    .filter((t) => t[0] === "p" && typeof t[1] === "string")
    .map((t) => t[1]);
  if (!recipients.includes(capsule.pubkey)) recipients.push(capsule.pubkey);

  const seen = new Set();
  for (const pubkey of recipients) {
    const clients = subscriptions.get(pubkey);
    if (!clients) continue;
    for (const ws of clients) {
      if (seen.has(ws)) continue;
      seen.add(ws);
      safeSend(ws, ["EVENT", "live", capsule]);
    }
  }
}

// HTTP handlers

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function handleHttpRequest(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // VAPID public key
  if (req.method === "GET" && req.url === "/push/vapid-public-key") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }));
    return;
  }

  // Push subscription registration
  if (req.method === "POST" && req.url === "/push/subscribe") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { pubkey, subscription } = JSON.parse(body);
        if (
          !pubkey ||
          !subscription?.endpoint ||
          !subscription?.keys?.p256dh ||
          !subscription?.keys?.auth
        ) {
          throw new Error("missing fields");
        }
        stmtUpsertPushSub.run({
          pubkey,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          updated_at: Math.floor(Date.now() / 1000),
        });
        console.log(`[Push] subscription registered: ${pubkey.slice(0, 12)}…`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: PORT }));
    return;
  }

  res.writeHead(404);
  res.end();
}

// WS handlers

function handleEvent(event, senderWs) {
  if (
    typeof event.id !== "string" ||
    typeof event.pubkey !== "string" ||
    typeof event.sig !== "string" ||
    typeof event.content !== "string" ||
    typeof event.created_at !== "number" ||
    typeof event.kind !== "number" ||
    !Array.isArray(event.tags)
  ) {
    safeSend(senderWs, [
      "OK",
      event.id ?? "",
      false,
      "invalid: malformed capsule",
    ]);
    return;
  }

  if (!verifyCapsule(event)) {
    safeSend(senderWs, [
      "OK",
      event.id,
      false,
      "invalid: signature or PoW failed",
    ]);
    return;
  }

  const expires_at = calcExpiresAt(event.kind, event.tags);
  const result = stmtInsert.run({
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    expires_at,
    tags: JSON.stringify(event.tags),
    pow_nonce: event.pow_nonce,
    content: event.content,
    sig: event.sig,
  });

  if (result.changes > 0) {
    console.log(`[+] capsule kind:${event.kind} id:${event.id.slice(0, 12)}…`);
    safeSend(senderWs, ["OK", event.id, true, ""]);
    routeCapsule(event);

    // асинхронный wake-пуш
    sendPushToRecipients(event).catch((e) => console.warn("[Push]", e.message));
  } else {
    safeSend(senderWs, ["OK", event.id, true, "duplicate"]);
  }
}

function handleReq(subId, filters, ws) {
  if (filters?.["#p"]?.length > 0) {
    for (const pubkey of filters["#p"]) subscribe(pubkey, ws);
  }

  if (subId === "give_me_peers") {
    sendPeerList(ws);
    safeSend(ws, ["EOSE", subId]);
    return;
  }

  if (filters?.id) {
    const row = stmtQueryById.get(filters.id);
    if (row) safeSend(ws, ["EVENT", subId, rowToCapsule(row)]);
    safeSend(ws, ["EOSE", subId]);
    return;
  }

  const pubkey = filters?.["#p"]?.[0];
  if (!pubkey) {
    safeSend(ws, ["EOSE", subId]);
    return;
  }

  const rows = stmtQueryByPubkey.all({
    pattern: `%"${pubkey}"%`,
    since: filters.since ?? null,
  });
  console.log(
    `[REQ] sub:${subId} pubkey:${pubkey.slice(0, 12)}… - ${rows.length} capsules`,
  );
  for (const row of rows) safeSend(ws, ["EVENT", subId, rowToCapsule(row)]);
  safeSend(ws, ["EOSE", subId]);
}

// TTL cleanup

function runCleanup() {
  const now = Math.floor(Date.now() / 1000);
  const result = stmtDeleteExpired.run(now);
  if (result.changes > 0)
    console.log(`[TTL] deleted ${result.changes} capsule(s)`);
}

// Heartbeat kind:101

let relayKeypair = null;

async function initRelayIdentity() {
  relayKeypair = sodium.crypto_sign_keypair();
  console.log(
    `[ID] relay pubkey: ${sodium.to_hex(relayKeypair.publicKey).slice(0, 16)}…`,
  );
}

function broadcastHeartbeat(wss) {
  if (!relayKeypair) return;
  const now = Math.floor(Date.now() / 1000);
  const pubkey = sodium.to_hex(relayKeypair.publicKey);
  const content = JSON.stringify({ ip: RELAY_PUBLIC_IP, ts: now });
  const msgBytes = sodium.from_string(pubkey + now.toString() + content);
  const heartbeat = {
    id: sodium.to_hex(sodium.crypto_generichash(32, msgBytes)),
    pubkey,
    kind: 101,
    created_at: now,
    tags: [],
    pow_nonce: 0,
    content,
    sig: sodium.to_hex(
      sodium.crypto_sign_detached(msgBytes, relayKeypair.privateKey),
    ),
  };
  let count = 0;
  wss.clients.forEach((ws) => {
    safeSend(ws, ["EVENT", "heartbeat", heartbeat]);
    count++;
  });
  if (count > 0) console.log(`[♥] heartbeat - ${count} client(s)`);
}

function sendPeerList(ws) {
  if (!relayKeypair || PEER_RELAYS.length === 0) return;
  const content = JSON.stringify(PEER_RELAYS);
  const msgBytes = sodium.from_string(content);
  const pex = {
    id: sodium.to_hex(sodium.crypto_generichash(32, msgBytes)),
    pubkey: sodium.to_hex(relayKeypair.publicKey),
    kind: 100,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    pow_nonce: 0,
    content,
    sig: sodium.to_hex(
      sodium.crypto_sign_detached(msgBytes, relayKeypair.privateKey),
    ),
  };
  safeSend(ws, ["EVENT", "pex", pex]);
}

// Точка входа

async function start() {
  await sodium.ready;
  await initRelayIdentity();

  runCleanup();
  setInterval(runCleanup, CLEANUP_INTERVAL_MS);

  // Shared HTTP + WebSocket server на одном порту
  const server = http.createServer(handleHttpRequest);
  const wss = new WebSocket.Server({ server });

  setInterval(() => broadcastHeartbeat(wss), HEARTBEAT_INTERVAL_MS);

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[+] client connected from ${ip}`);
    sendPeerList(ws);

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(data) || data.length < 2) return;
      const [type, ...rest] = data;
      switch (type) {
        case "EVENT":
          handleEvent(rest[0], ws);
          break;
        case "REQ":
          handleReq(rest[0], rest[1] ?? {}, ws);
          break;
        default:
          console.debug(`[ws] unknown type: ${type}`);
      }
    });

    ws.on("close", () => {
      unsubscribeAll(ws);
      console.log(`[-] client disconnected from ${ip}`);
    });
    ws.on("error", (err) => {
      console.error(`[ws] error from ${ip}:`, err.message);
      unsubscribeAll(ws);
    });
  });

  server.listen(PORT, () => {
    console.log(`[ws+http] relay listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
