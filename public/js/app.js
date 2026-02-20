(function () {
  'use strict';

  const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  const MESSAGE = {
    CREATE: 'create',
    JOIN: 'join',
    STATE: 'state',
    MOVE: 'move',
    RESTART: 'restart',
    ERROR: 'error',
    OPPONENT_LEFT: 'opponent_left'
  };

  let socket = null;
  let roomId = null;
  let myRole = null; // 'X' | 'O' | null
  let board = Array(9).fill(null);
  let currentTurn = 'X';
  let winner = null;
  let gameStarted = false;
  let isMyTurn = false;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const lobby = $('#lobby');
  const gameSection = $('#gameSection');
  const btnCreate = $('#btnCreate');
  const btnJoin = $('#btnJoin');
  const inputRoomId = $('#inputRoomId');
  const lobbyError = $('#lobbyError');
  const gameStatus = $('#gameStatus');
  const shareBlock = $('#shareBlock');
  const shareUrl = $('#shareUrl');
  const btnCopyLink = $('#btnCopyLink');
  const boardEl = $('#board');
  const btnRestart = $('#btnRestart');
  const btnLeave = $('#btnLeave');

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function showLobby(err) {
    lobby.classList.remove('hidden');
    gameSection.classList.add('hidden');
    lobbyError.textContent = err || '';
  }

  function showGame() {
    lobby.classList.add('hidden');
    gameSection.classList.remove('hidden');
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
    return location.origin + location.pathname + '?room=' + encodeURIComponent(roomId);
  }

  function checkWinner(cells) {
    for (const [a, b, c] of WIN_LINES) {
      const v = cells[a];
      if (v && cells[a] === cells[b] && cells[b] === cells[c]) return { winner: v, line: [a, b, c] };
    }
    if (cells.every(Boolean)) return { winner: 'draw', line: [] };
    return null;
  }

  function renderBoard(state) {
    board = state.board || board;
    currentTurn = state.currentTurn ?? currentTurn;
    winner = state.winner ?? winner;
    const result = checkWinner(board);
    const winLine = result && result.line ? result.line : [];
    const resolvedWinner = result ? result.winner : null;

    $$('.cell', boardEl).forEach((cell, i) => {
      const val = board[i];
      const content = cell.querySelector('.cell__content');
      if (content) content.textContent = val || '';
      cell.className = 'cell' + (val ? ' ' + val.toLowerCase() : '');
      if (winLine.includes(i)) cell.classList.add('win');
      else cell.classList.remove('win');
      cell.disabled = !!resolvedWinner || val !== null || !gameStarted || (myRole !== currentTurn);
    });

    if (resolvedWinner === 'draw') {
      gameStatus.textContent = 'Ничья!';
      btnRestart.classList.remove('hidden');
    } else if (resolvedWinner) {
      gameStatus.textContent = resolvedWinner === myRole ? 'Вы победили!' : 'Победил противник';
      btnRestart.classList.remove('hidden');
    } else if (!gameStarted) {
      gameStatus.textContent = myRole ? 'Ожидание второго игрока…' : 'Подключение…';
      btnRestart.classList.add('hidden');
    } else {
      isMyTurn = myRole === currentTurn;
      gameStatus.textContent = isMyTurn ? 'Ваш ход' : 'Ход противника';
      btnRestart.classList.add('hidden');
    }
  }

  function send(msg) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  function connect(callback) {
    const wsUrl = getWsUrl();
    const s = new WebSocket(wsUrl);
    socket = s;

    s.onopen = () => {
      lobbyError.textContent = '';
      if (callback) callback();
    };

    s.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case MESSAGE.STATE:
            if (data.roomId) {
              roomId = data.roomId;
              setUrlRoom(roomId);
            }
            myRole = data.role || myRole;
            gameStarted = data.gameStarted !== undefined ? data.gameStarted : gameStarted;
            renderBoard({
              board: data.board,
              currentTurn: data.currentTurn,
              winner: data.winner
            });
            if (myRole === 'X' && roomId) {
              shareBlock.classList.remove('hidden');
              shareUrl.value = getShareLink();
            }
            break;
          case MESSAGE.ERROR:
            lobbyError.textContent = data.message || 'Ошибка';
            break;
          case MESSAGE.OPPONENT_LEFT:
            gameStarted = false;
            gameStatus.textContent = 'Противник вышел. Ожидание нового игрока…';
            renderBoard({ board: Array(9).fill(null), currentTurn: 'X', winner: null });
            break;
          default:
            break;
        }
      } catch (_) {}
    };

    s.onclose = () => {
      socket = null;
      showLobby('Соединение потеряно. Перезагрузите страницу.');
    };

    s.onerror = () => {
      showLobby('Ошибка подключения. Запущен ли сервер?');
    };
  }

  function createGame() {
    lobbyError.textContent = '';
    connect(() => {
      send({ type: MESSAGE.CREATE });
    });
  }

  function joinGame(id) {
    const rid = (id || inputRoomId.value || '').trim().toLowerCase();
    if (!rid) {
      lobbyError.textContent = 'Введите код комнаты';
      return;
    }
    lobbyError.textContent = '';
    connect(() => {
      send({ type: MESSAGE.JOIN, roomId: rid });
      setUrlRoom(rid);
    });
  }

  function leaveRoom() {
    roomId = null;
    myRole = null;
    gameStarted = false;
    board = Array(9).fill(null);
    currentTurn = 'X';
    winner = null;
    if (socket) {
      socket.close();
      socket = null;
    }
    shareBlock.classList.add('hidden');
    showLobby();
    history.replaceState({}, '', location.pathname);
  }

  function initFromUrl() {
    const room = getUrlRoom();
    if (room) {
      roomId = room;
      showGame();
      joinGame(room);
      return;
    }
    showLobby();
  }

  btnCreate.addEventListener('click', () => {
    showGame();
    createGame();
  });

  btnJoin.addEventListener('click', () => {
    showGame();
    joinGame();
  });

  inputRoomId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      showGame();
      joinGame();
    }
  });

  btnCopyLink.addEventListener('click', () => {
    shareUrl.select();
    shareUrl.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(shareUrl.value).then(() => {
      const t = btnCopyLink.textContent;
      btnCopyLink.textContent = 'Скопировано!';
      setTimeout(() => { btnCopyLink.textContent = t; }, 2000);
    });
  });

  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || cell.disabled) return;
    const index = parseInt(cell.dataset.index, 10);
    if (isNaN(index) || board[index] !== null || !isMyTurn) return;
    send({ type: MESSAGE.MOVE, roomId, cellIndex: index });
  });

  btnRestart.addEventListener('click', () => {
    send({ type: MESSAGE.RESTART, roomId });
  });

  btnLeave.addEventListener('click', leaveRoom);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFromUrl);
  } else {
    initFromUrl();
  }
})();
