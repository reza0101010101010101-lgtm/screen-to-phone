import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const ROOM_MAX_LENGTH = 8;
const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const ROLE_RE = /^(host|viewer)$/;

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "screen-to-phone",
    rooms: rooms.size,
    uptime: Math.floor(process.uptime())
  });
});

function normalizeRoom(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_MAX_LENGTH);
}

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message, except = null) {
  for (const peer of room.peers) {
    if (peer !== except) send(peer.ws, message);
  }
}

function removePeer(ws, notify = true) {
  const roomId = ws.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  ws.roomId = null;

  if (!room) return;

  const peer = room.peers.find((item) => item.ws === ws);
  if (peer) {
    room.peers = room.peers.filter((item) => item.ws !== ws);
  }

  if (notify && peer) {
    broadcast(room, { type: "peer-left", role: peer.role });
  }

  if (room.peers.length === 0) {
    rooms.delete(roomId);
  }
}

function closePeer(ws, code = 1000, reason = "") {
  try {
    ws.close(code, reason);
  } catch {
    // Ignore already-closed sockets.
  }
}

function roomState(room) {
  return {
    host: room.peers.some((peer) => peer.role === "host"),
    viewer: room.peers.some((peer) => peer.role === "viewer"),
    count: room.peers.length
  };
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.roomId = null;
  ws.role = null;
  ws.sessionId = null;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", code: "BAD_MESSAGE", message: "پیام نامعتبر است." });
      return;
    }

    if (message.type === "join") {
      const roomId = normalizeRoom(message.room);
      const role = String(message.role || "");
      const sessionId = String(message.sessionId || "").slice(0, 128);

      if (!ROOM_RE.test(roomId) || !ROLE_RE.test(role) || !sessionId) {
        send(ws, {
          type: "error",
          code: "INVALID_JOIN",
          message: "کد اتاق یا نقش کاربر معتبر نیست."
        });
        return;
      }

      if (ws.roomId) {
        removePeer(ws, true);
      }

      let room = rooms.get(roomId);
      if (!room) {
        room = { peers: [] };
        rooms.set(roomId, room);
      }

      const existing = room.peers.find((peer) => peer.role === role);

      // Allow a network reconnect from the same browser session to reclaim
      // its previous role. This prevents a stale socket from blocking reconnect.
      if (existing) {
        if (existing.sessionId === sessionId) {
          const oldWs = existing.ws;
          existing.ws = ws;
          existing.sessionId = sessionId;
          ws.roomId = roomId;
          ws.role = role;
          ws.sessionId = sessionId;

          if (oldWs !== ws) {
            oldWs.roomId = null;
            send(oldWs, { type: "replaced" });
            closePeer(oldWs, 4001, "Session reconnected");
          }

          send(ws, {
            type: "joined",
            room: roomId,
            role,
            peerConnected: room.peers.length > 1,
            reconnected: true
          });
          broadcast(room, { type: "peer-rejoined", role }, ws);

          // If the viewer reconnects, ask the host to create a fresh offer.
          if (role === "viewer") {
            const host = room.peers.find((peer) => peer.role === "host");
            if (host) send(host.ws, { type: "viewer-ready", reconnect: true });
          }
          return;
        }

        send(ws, {
          type: "room-full-role",
          message:
            role === "host"
              ? "این اتاق در حال حاضر یک کامپیوتر فرستنده دارد."
              : "این اتاق در حال حاضر یک گیرنده دارد."
        });
        closePeer(ws, 4003, "Role already occupied");
        return;
      }

      if (room.peers.length >= 2) {
        send(ws, {
          type: "room-full",
          message: "این اتاق پر است. از کد اتاق دیگری استفاده کنید."
        });
        closePeer(ws, 4004, "Room full");
        return;
      }

      const peer = { ws, role, sessionId };
      room.peers.push(peer);
      ws.roomId = roomId;
      ws.role = role;
      ws.sessionId = sessionId;

      send(ws, {
        type: "joined",
        room: roomId,
        role,
        peerConnected: room.peers.length > 1,
        reconnected: false
      });

      for (const other of room.peers) {
        if (other !== peer) {
          send(other.ws, {
            type: "peer-joined",
            role,
            peerConnected: true
          });
        }
      }

      return;
    }

    if (!ws.roomId) {
      send(ws, {
        type: "error",
        code: "NOT_JOINED",
        message: "ابتدا باید وارد یک اتاق شوید."
      });
      return;
    }

    const allowedTypes = new Set([
      "offer",
      "answer",
      "ice",
      "request-offer",
      "media-state",
      "stop-sharing"
    ]);

    if (!allowedTypes.has(message.type)) return;

    const room = rooms.get(ws.roomId);
    if (!room) return;

    // Never trust a client-supplied room/role. Forward only inside the
    // server-side room to the other peer.
    broadcast(room, message, ws);
  });

  ws.on("close", () => {
    removePeer(ws, true);
  });

  ws.on("error", () => {
    // close() will trigger cleanup.
  });
});

// Render and other public WebSocket hosts can terminate idle/broken
// connections. Periodic ping/pong makes stale connections detectable.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try {
        ws.terminate();
      } catch {
        // Ignore.
      }
      continue;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // Ignore.
    }
  }
}, 25_000);

wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`Screen-to-phone listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  for (const ws of wss.clients) {
    closePeer(ws, 1001, "Server shutting down");
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
