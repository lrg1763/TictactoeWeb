const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ROOM_ID_LEN = 6;

function generateRoomId() {
  let id = '';
  for (let i = 0; i < ROOM_ID_LEN; i++) {
    id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return id;
}

const rooms = new Map();

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
    if (client === excludeClient) return;
    if (client.readyState !== 1) return;
    client.send(JSON.stringify({
      type: 'state',
      ...state,
      role
    }));
  });
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    const v = board[a];
    if (v && board[a] === board[b] && board[b] === board[c]) return v;
  }
  if (board.every(Boolean)) return 'draw';
  return null;
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let myRole = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'create') {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();
        currentRoomId = roomId;
        myRole = 'X';
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
        return;
      }

      if (msg.type === 'join') {
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
        currentRoomId = roomId;
        myRole = 'O';
        room.players.push({ client: ws, role: 'O' });
        room.board = Array(9).fill(null);
        room.currentTurn = 'X';
        room.winner = null;
        broadcastState(roomId);
        return;
      }

      if (msg.type === 'move' && currentRoomId) {
        const room = rooms.get(currentRoomId);
        if (!room || room.players.length !== 2 || room.winner) return;
        const { cellIndex } = msg;
        if (typeof cellIndex !== 'number' || cellIndex < 0 || cellIndex > 8) return;
        if (room.board[cellIndex] !== null) return;
        const role = room.players.find(p => p.client === ws)?.role;
        if (role !== room.currentTurn) return;
        room.board[cellIndex] = role;
        room.winner = checkWinner(room.board);
        room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
        broadcastState(currentRoomId);
        return;
      }

      if (msg.type === 'restart' && currentRoomId) {
        const room = rooms.get(currentRoomId);
        if (!room || room.players.length !== 2) return;
        room.board = Array(9).fill(null);
        room.currentTurn = 'X';
        room.winner = null;
        broadcastState(currentRoomId);
        return;
      }
    } catch (_) {}
  });

  ws.on('close', () => {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Сервер: http://localhost:' + PORT);
});
