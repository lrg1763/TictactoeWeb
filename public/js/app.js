(function () {
  'use strict';

  // ——— Константы ———
  const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  const MSG = {
    CREATE: 'create',
    JOIN: 'join',
    STATE: 'state',
    MOVE: 'move',
    RESTART: 'restart',
    ERROR: 'error',
    OPPONENT_LEFT: 'opponent_left'
  };

  // ——— Состояние ———
  const state = {
    socket: null,
    roomId: null,
    myRole: null,
    board: Array(9).fill(null),
    currentTurn: 'X',
    winner: null,
    gameStarted: false,
    isMyTurn: false
  };

  // ——— DOM ———
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const el = {
    lobby: $('#lobby'),
    gameSection: $('#gameSection'),
    btnCreate: $('#btnCreate'),
    btnJoin: $('#btnJoin'),
    inputRoomId: $('#inputRoomId'),
    lobbyError: $('#lobbyError'),
    gameStatus: $('#gameStatus'),
    shareBlock: $('#shareBlock'),
    shareUrl: $('#shareUrl'),
    btnCopyLink: $('#btnCopyLink'),
    board: $('#board'),
    btnRestart: $('#btnRestart'),
    btnLeave: $('#btnLeave')
  };

  // ——— Утилиты ———
  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function setUrlRoom(id) {
    const url = new URL(location.href);
    url.searchParams.set('room', id);
    history.replaceState({}, '', url.toString());
  }

  function getUrlRoom() {
    return new URLSearchParams(location.search).get('room') || '';
  }

  function getShareLink() {
    return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
  }

  function checkWinner(cells) {
    for (const [a, b, c] of WIN_LINES) {
      const v = cells[a];
      if (v && cells[a] === cells[b] && cells[b] === cells[c]) {
        return { winner: v, line: [a, b, c] };
      }
    }
    if (cells.every(Boolean)) return { winner: 'draw', line: [] };
    return null;
  }

  async function copyToClipboard(text) {
    await navigator.clipboard.writeText(text);
  }

  // ——— UI ———
  function showLobby(err = '') {
    el.lobby.classList.remove('hidden');
    el.gameSection.classList.add('hidden');
    el.lobbyError.textContent = err;
  }

  function showGame() {
    el.lobby.classList.add('hidden');
    el.gameSection.classList.remove('hidden');
  }

  function getStatusText(result, winLine) {
    const { winner: resolvedWinner } = result || {};
    if (resolvedWinner === 'draw') return 'Ничья!';
    if (resolvedWinner) {
      return resolvedWinner === state.myRole ? 'Вы победили!' : 'Победил противник';
    }
    if (!state.gameStarted) {
      return state.myRole ? 'Ожидание второго игрока…' : 'Подключение…';
    }
    state.isMyTurn = state.myRole === state.currentTurn;
    return state.isMyTurn ? 'Ваш ход' : 'Ход противника';
  }

  function renderBoard(payload) {
    if (payload.board != null) state.board = payload.board;
    if (payload.currentTurn != null) state.currentTurn = payload.currentTurn;
    if (payload.winner != null) state.winner = payload.winner;

    const result = checkWinner(state.board);
    const winLine = result?.line ?? [];

    $$('.cell', el.board).forEach((cell, i) => {
      const val = state.board[i];
      const content = cell.querySelector('.cell__content');
      if (content) content.textContent = val || '';
      cell.className = 'cell' + (val ? ` ${val.toLowerCase()}` : '');
      cell.classList.toggle('win', winLine.includes(i));
      const disabled = !!result?.winner || val !== null || !state.gameStarted ||
        (state.myRole !== state.currentTurn);
      cell.disabled = disabled;
    });

    el.gameStatus.textContent = getStatusText(result, winLine);
    el.btnRestart.classList.toggle('hidden', !result?.winner);

    if (state.myRole === 'X' && state.roomId) {
      el.shareBlock.classList.remove('hidden');
      el.shareUrl.value = getShareLink();
    }
  }

  // ——— WebSocket ———
  function send(msg) {
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(msg));
    }
  }

  const messageHandlers = {
    [MSG.STATE](data) {
      if (data.roomId) {
        state.roomId = data.roomId;
        setUrlRoom(data.roomId);
      }
      if (data.role != null) state.myRole = data.role;
      if (data.gameStarted !== undefined) state.gameStarted = data.gameStarted;
      renderBoard({
        board: data.board,
        currentTurn: data.currentTurn,
        winner: data.winner
      });
    },
    [MSG.ERROR](data) {
      el.lobbyError.textContent = data.message || 'Ошибка';
    },
    [MSG.OPPONENT_LEFT]() {
      state.gameStarted = false;
      el.gameStatus.textContent = 'Противник вышел. Ожидание нового игрока…';
      renderBoard({ board: Array(9).fill(null), currentTurn: 'X', winner: null });
    }
  };

  function connect(onOpen) {
    const ws = new WebSocket(getWsUrl());
    state.socket = ws;

    ws.onopen = () => {
      el.lobbyError.textContent = '';
      onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const handler = messageHandlers[data.type];
        if (handler) handler(data);
      } catch (_) {}
    };

    ws.onclose = () => {
      state.socket = null;
      showLobby('Соединение потеряно. Перезагрузите страницу.');
    };

    ws.onerror = () => {
      showLobby('Ошибка подключения. Запущен ли сервер?');
    };
  }

  // ——— Действия ———
  function createGame() {
    el.lobbyError.textContent = '';
    showGame();
    connect(() => send({ type: MSG.CREATE }));
  }

  function joinGame(id) {
    const roomId = (id ?? el.inputRoomId.value ?? '').trim().toLowerCase();
    if (!roomId) {
      el.lobbyError.textContent = 'Введите код комнаты';
      return;
    }
    el.lobbyError.textContent = '';
    showGame();
    connect(() => {
      send({ type: MSG.JOIN, roomId });
      setUrlRoom(roomId);
    });
  }

  function leaveRoom() {
    state.roomId = null;
    state.myRole = null;
    state.gameStarted = false;
    state.board = Array(9).fill(null);
    state.currentTurn = 'X';
    state.winner = null;
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
    el.shareBlock.classList.add('hidden');
    showLobby();
    history.replaceState({}, '', location.pathname);
  }

  function initFromUrl() {
    const room = getUrlRoom();
    if (room) {
      state.roomId = room;
      showGame();
      joinGame(room);
      return;
    }
    showLobby();
  }

  // ——— События ———
  el.btnCreate.addEventListener('click', createGame);

  el.btnJoin.addEventListener('click', () => joinGame());

  el.inputRoomId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinGame();
  });

  el.btnCopyLink.addEventListener('click', async () => {
    el.shareUrl.select();
    el.shareUrl.setSelectionRange(0, 99_999);
    await copyToClipboard(el.shareUrl.value);
    const prev = el.btnCopyLink.textContent;
    el.btnCopyLink.textContent = 'Скопировано!';
    setTimeout(() => { el.btnCopyLink.textContent = prev; }, 2000);
  });

  el.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell?.dataset.index || cell.disabled) return;
    const index = parseInt(cell.dataset.index, 10);
    if (state.board[index] !== null || !state.isMyTurn) return;
    send({ type: MSG.MOVE, roomId: state.roomId, cellIndex: index });
  });

  el.btnRestart.addEventListener('click', () => send({ type: MSG.RESTART, roomId: state.roomId }));
  el.btnLeave.addEventListener('click', leaveRoom);

  // ——— Инициализация ———
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFromUrl);
  } else {
    initFromUrl();
  }
})();
