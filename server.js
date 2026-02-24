const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

// ——— Конфиг ———
const PORT = process.env.PORT || 3000;
const ROOM_ID_LEN = 6;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

// ——— Express ———
const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ——— Комнаты ———
const rooms = new Map();

function generateRoomId() {
  let id = '';
  for (let i = 0; i < ROOM_ID_LEN; i++) {
    id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return id;
}

function getRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    roomId,
    board: room.board,
    currentTurn: room.currentTurn,
    winner: room.winner,
    gameStarted: room.players.length === 2,
    players: room.players
  };
}

function broadcastState(roomId, excludeClient = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const state = getRoomState(roomId);
  room.players.forEach(({ client, role }) => {
    if (client === excludeClient || client.readyState !== 1) return;
    client.send(JSON.stringify({ type: 'state', ...state, role }));
  });
}

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    const v = board[a];
    if (v && board[a] === board[b] && board[b] === board[c]) return v;
  }
  if (board.every(Boolean)) return 'draw';
  return null;
}

// ——— WebSocket: обработчики сообщений ———
function handleCreate(ws, ctx) {
  let roomId = generateRoomId();
  while (rooms.has(roomId)) roomId = generateRoomId();

  ctx.currentRoomId = roomId;
  ctx.myRole = 'X';

  rooms.set(roomId, {
    board: Array(9).fill(null),
    currentTurn: 'X',
    winner: null,
    players: [{ client: ws, role: 'X' }]
  });

  ws.send(JSON.stringify({
    type: 'state',
    roomId,
    role: 'X',
    board: Array(9).fill(null),
    currentTurn: 'X',
    winner: null,
    gameStarted: false
  }));
}

function handleJoin(ws, msg, ctx) {
  const roomId = (msg.roomId || '').trim().toLowerCase();
  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Нет кода комнаты' }));
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
    return;
  }
  if (room.players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Комната занята' }));
    return;
  }

  ctx.currentRoomId = roomId;
  ctx.myRole = 'O';

  room.players.push({ client: ws, role: 'O' });
  room.board = Array(9).fill(null);
  room.currentTurn = 'X';
  room.winner = null;
  broadcastState(roomId);
}

function handleMove(ws, msg, ctx) {
  const room = rooms.get(ctx.currentRoomId);
  if (!room || room.players.length !== 2 || room.winner) return;

  const { cellIndex } = msg;
  if (typeof cellIndex !== 'number' || cellIndex < 0 || cellIndex > 8) return;
  if (room.board[cellIndex] !== null) return;

  const role = room.players.find(p => p.client === ws)?.role;
  if (role !== room.currentTurn) return;

  room.board[cellIndex] = role;
  room.winner = checkWinner(room.board);
  room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
  broadcastState(ctx.currentRoomId);
}

function handleRestart(ws, ctx) {
  const room = rooms.get(ctx.currentRoomId);
  if (!room || room.players.length !== 2) return;

  room.board = Array(9).fill(null);
  room.currentTurn = 'X';
  room.winner = null;
  broadcastState(ctx.currentRoomId);
}

// ——— WebSocket: сервер ———
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const ctx = { currentRoomId: null, myRole: null };

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'create':
          handleCreate(ws, ctx);
          break;
        case 'join':
          handleJoin(ws, msg, ctx);
          break;
        case 'move':
          handleMove(ws, msg, ctx);
          break;
        case 'restart':
          handleRestart(ws, ctx);
          break;
        default:
          break;
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    const { currentRoomId } = ctx;
    if (!currentRoomId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.players = room.players.filter(p => p.client !== ws);
    if (room.players.length === 0) {
      rooms.delete(currentRoomId);
      return;
    }

    room.players.forEach(({ client }) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'opponent_left' }));
      }
    });
  });
});

// ——— Запуск ———
server.listen(PORT, () => {
  console.log('Сервер: http://localhost:' + PORT);
});
