"use strict";

const WebSocket = require("ws");
const Database = require("better-sqlite3");
const sodium = require("libsodium-wrappers");

// Конфигурация
const PORT = process.env.PORT || 8081;
const TTL_DAYS = process.env.TTL_DAYS || 14;
const POW_DIFFICULTY = process.env.POW_DIFFICULTY || 16; // бит
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 час
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60 сек
const RELAY_PUBLIC_IP = process.env.RELAY_PUBLIC_IP || "127.0.0.1";

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
`);

// Prepared statements
const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO capsules
    (id, pubkey, kind, created_at, expires_at, tags, pow_nonce, content, sig)
  VALUES
    (@id, @pubkey, @kind, @created_at, @expires_at, @tags, @pow_nonce, @content, @sig)
`);

const stmtQueryByPubkey = db.prepare(`
  SELECT * FROM capsules
  WHERE tags LIKE @pattern
    AND (@since IS NULL OR created_at >= @since)
  ORDER BY created_at ASC
  LIMIT 200
`);

const stmtQueryById = db.prepare(`
  SELECT * FROM capsules WHERE id = ?
`);

const stmtDeleteExpired = db.prepare(`
  DELETE FROM capsules
  WHERE expires_at IS NOT NULL AND expires_at <= ?
`);

// Utils

/** Вычисляет expires_at по TTL-политике.
 *  kind:3 (Backup Pointer): бессрочно (NULL).
 *  Остальные: сейчас + TTL_DAYS.
 *  Если в тегах есть ["expiration", "ts"] - берём минимум.
 */
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

/**
 * Проверяет PoW: первые POW_DIFFICULTY бит id должны быть нулями.
 */
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

/**
 * Верификация Капсулы:
 * 1. PoW - побитовая проверка
 * 2. Two-step hash
 * 3. Ed25519(id, sig, pubkey)
 */
function verifyCapsule(event) {
  try {
    // PoW
    if (!checkPoW(event.id, POW_DIFFICULTY)) {
      console.warn(`[PoW] failed for ${event.id}`);
      return false;
    }

    // Hash
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

    // Ed25519
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

/**
 * Строит объект Capsule из строки БД
 */
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

/** Безопасная отправка по WebSocket
 */
function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// Менеджер подписок

/**
 * Type: Map<pubkeyHex, Set<WebSocket>>
 */
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

/**
 * Адресная доставка капсул по pubkey в тегах "p"
 */
function routeCapsule(capsule, senderWs) {
  const recipients = capsule.tags
    .filter((t) => t[0] === "p" && typeof t[1] === "string")
    .map((t) => t[1]);

  if (!recipients.includes(capsule.pubkey)) {
    recipients.push(capsule.pubkey);
  }

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

// Обработчики сообщений

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
    routeCapsule(event, senderWs);
  } else {
    safeSend(senderWs, ["OK", event.id, true, "duplicate"]);
  }
}

function handleReq(subId, filters, ws) {
  if (filters?.["#p"]?.length > 0) {
    for (const pubkey of filters["#p"]) {
      subscribe(pubkey, ws);
    }
  }

  // DAG
  if (filters?.id) {
    const row = stmtQueryById.get(filters.id);
    if (row) safeSend(ws, ["EVENT", subId, rowToCapsule(row)]);
    safeSend(ws, ["EOSE", subId]);
    return;
  }

  // Запрос истории
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

  for (const row of rows) {
    safeSend(ws, ["EVENT", subId, rowToCapsule(row)]);
  }
  safeSend(ws, ["EOSE", subId]);
}

// TTL-очистка

function runCleanup() {
  const now = Math.floor(Date.now() / 1000);
  const result = stmtDeleteExpired.run(now);
  if (result.changes > 0) {
    console.log(
      `[TTL] deleted ${result.changes} expired capsule(s) at ${new Date().toISOString()}`,
    );
  } else {
    console.debug(`[TTL] cleanup run, nothing to delete`);
  }
}

// Heartbeat kind:101
// Для MVP используется ephemeral ключ

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
  const sig = sodium.to_hex(
    sodium.crypto_sign_detached(msgBytes, relayKeypair.privateKey),
  );

  const heartbeat = {
    id: sodium.to_hex(sodium.crypto_generichash(32, msgBytes)),
    pubkey,
    kind: 101,
    created_at: now,
    tags: [],
    pow_nonce: 0,
    content,
    sig,
  };

  let count = 0;
  wss.clients.forEach((ws) => {
    safeSend(ws, ["EVENT", "heartbeat", heartbeat]);
    count++;
  });

  if (count > 0) console.log(`[♥] heartbeat - ${count} client(s)`);
}

// Точка входа

async function start() {
  await sodium.ready;
  await initRelayIdentity();

  runCleanup();
  setInterval(runCleanup, CLEANUP_INTERVAL_MS);

  const wss = new WebSocket.Server({ port: PORT });
  console.log(`[ws] relay listening on ws://localhost:${PORT}`);

  setInterval(() => broadcastHeartbeat(wss), HEARTBEAT_INTERVAL_MS);

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[+] client connected from ${ip}`);

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
          // ["REQ", subId, filters]
          handleReq(rest[0], rest[1] ?? {}, ws);
          break;
        default:
          console.debug(`[ws] unknown message type: ${type}`);
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
}

start().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
