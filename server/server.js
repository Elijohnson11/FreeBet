// ═══════════════════════════════════════════
//   FreeBet — Multiplayer Server
//   Node.js + Socket.io
// ═══════════════════════════════════════════

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── In-memory room store ──
// code → { state, sockets: Set<socketId>, createdAt }
const rooms = new Map();

// ── Health check ──
app.get('/', (_, res) => res.json({ status: 'FreeBet server running', rooms: rooms.size }));
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));

// ── Generate a readable 6-char code ──
function makeCode() {
  // No O, 0, I, 1 — avoids confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Clean up empty / stale rooms every 15 min ──
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000; // 4 hours
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff || room.sockets.size === 0) {
      rooms.delete(code);
      console.log(`Cleaned up room ${code}`);
    }
  }
}, 15 * 60 * 1000);

// ── Socket connections ──
io.on('connection', (socket) => {
  let roomCode = null;

  // ── Create a new room ──
  socket.on('create-room', (cb) => {
    let code, attempts = 0;
    do { code = makeCode(); attempts++; }
    while (rooms.has(code) && attempts < 100);

    rooms.set(code, {
      state:     null,
      sockets:   new Set([socket.id]),
      createdAt: Date.now(),
    });

    socket.join(code);
    roomCode = code;
    cb({ code });
    console.log(`[${code}] Created by ${socket.id}`);
  });

  // ── Join an existing room ──
  socket.on('join-room', ({ code }, cb) => {
    const key  = (code || '').toUpperCase().trim();
    const room = rooms.get(key);

    if (!room) {
      return cb({ error: 'Room not found — check the code and try again.' });
    }

    room.sockets.add(socket.id);
    socket.join(key);
    roomCode = key;

    // Send current game state so they're immediately in sync
    cb({ ok: true, state: room.state });

    // Tell everyone else someone joined
    socket.to(key).emit('peer-joined', { count: room.sockets.size });
    console.log(`[${key}] ${socket.id} joined (${room.sockets.size} in room)`);
  });

  // ── Host pushes new state — broadcast to everyone else in room ──
  socket.on('push-state', ({ state }) => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.state = state;                              // persist for late joiners
    socket.to(roomCode).emit('state-update', { state }); // broadcast
  });

  // ── Reaction — relay emoji to room peers without storing in state ──
  socket.on('reaction', ({ emoji, playerId }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit('reaction', { emoji, playerId });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.sockets.delete(socket.id);
    socket.to(roomCode).emit('peer-left', { count: room.sockets.size });
    console.log(`[${roomCode}] ${socket.id} left (${room.sockets.size} remaining)`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`FreeBet server listening on :${PORT}`);
});
