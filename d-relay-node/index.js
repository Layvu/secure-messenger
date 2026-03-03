const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const sodium = require("libsodium-wrappers");

const db = new sqlite3.Database("./relay.sqlite", (err) => {
  if (err) console.error("Database error:", err);
  else console.log("SQLite database connected (relay.sqlite)");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT,
        created_at INTEGER,
        kind INTEGER,
        tags TEXT,
        pow_nonce INTEGER,
        content TEXT,
        sig TEXT
    )`);
});

async function startRelay() {
  await sodium.ready;
  console.log("Libsodium ready");

  const wss = new WebSocket.Server({ port: 8080 });
  console.log("Relay running on ws://localhost:8080");

  wss.on("connection", (ws) => {
    console.log("New client connected");

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (!Array.isArray(data)) return;

        const messageType = data[0];

        if (messageType === "EVENT") {
          handleIncomingEvent(data[1], ws, wss);
        } else if (messageType === "REQ") {
          handleSubscription(data[1], data[2], ws);
        }
      } catch (e) {
        console.log("Error parsing message");
      }
    });
  });
}

function verifyCapsuleOnServer(event) {
  try {
    if (!event.id.startsWith("0000")) return false;

    const serialized = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.pow_nonce,
      event.content,
    ]);
    const expectedIdBytes = sodium.crypto_generichash(
      32,
      sodium.from_string(serialized),
    );
    const expectedIdHex = sodium.to_hex(expectedIdBytes);

    if (expectedIdHex !== event.id) return false;

    const idBytes = sodium.from_hex(event.id);
    const sigBytes = sodium.from_hex(event.sig);
    const pubkeyBytes = sodium.from_hex(event.pubkey);

    return sodium.crypto_sign_verify_detached(sigBytes, idBytes, pubkeyBytes);
  } catch (e) {
    return false;
  }
}

function handleIncomingEvent(event, senderWs, wss) {
  if (!verifyCapsuleOnServer(event)) {
    senderWs.send(
      JSON.stringify([
        "OK",
        event.id,
        false,
        "invalid: signature or PoW failed",
      ]),
    );
    console.warn(`Rejected fake/spam capsule from ${event.pubkey}`);
    return;
  }

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (id, pubkey, created_at, kind, tags, pow_nonce, content, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  stmt.run(
    event.id,
    event.pubkey,
    event.created_at,
    event.kind,
    JSON.stringify(event.tags),
    event.pow_nonce,
    event.content,
    event.sig,
    function (err) {
      if (err) {
        console.error("Error saving:", err);
        return;
      }

      if (this.changes > 0) {
        console.log(`Saved and forwarded new capsule: ${event.id}`);
        senderWs.send(JSON.stringify(["OK", event.id, true, ""]));

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(["EVENT", "global", event]));
          }
        });
      }
    },
  );
  stmt.finalize();
}

function handleSubscription(subId, filters, ws) {
  db.all(
    `SELECT * FROM events ORDER BY created_at DESC LIMIT 50`,
    [],
    (err, rows) => {
      if (err) return;

      rows.forEach((row) => {
        const event = {
          id: row.id,
          pubkey: row.pubkey,
          created_at: row.created_at,
          kind: row.kind,
          tags: JSON.parse(row.tags),
          pow_nonce: row.pow_nonce,
          content: row.content,
          sig: row.sig,
        };
        ws.send(JSON.stringify(["EVENT", subId, event]));
      });

      ws.send(JSON.stringify(["EOSE", subId]));
    },
  );
}

startRelay();
