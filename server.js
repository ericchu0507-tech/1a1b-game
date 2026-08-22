const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function genCode() {
  let code;
  do { code = String(1000 + Math.floor(Math.random() * 9000)); }
  while (rooms.has(code));
  return code;
}

function calcAB(secret, guess) {
  let a = 0, b = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) a++;
    else if (secret.includes(guess[i])) b++;
  }
  return { a, b };
}

function randomSecret() {
  const d = '0123456789'.split('');
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 4).join('');
}

function isValidCode(s) {
  return /^\d{4}$/.test(s) && new Set(s).size === 4;
}

io.on('connection', (socket) => {
  let roomCode = null;
  let playerIdx = -1;

  function getRoom() { return rooms.get(roomCode); }

  socket.on('create-room', ({ mode }) => {
    const code = genCode();
    rooms.set(code, {
      mode,
      maxPlayers: mode === 'ai-dual' ? 4 : 2,
      sockets: [socket],
      started: false,
      aiSecret: null,
      targets: ['', ''],
      secretReady: [false, false],
      guessCount: [0],
      playerDone: [false],
      playerWon:  [false],
    });
    roomCode = code;
    playerIdx = 0;
    socket.join(code);
    socket.emit('room-created', { code, mode });
  });

  socket.on('join-room', ({ code }) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('join-error', { msg: '找不到房間，請確認號碼' }); return; }
    if (room.started) { socket.emit('join-error', { msg: '遊戲已經開始了' }); return; }
    if (room.sockets.length >= room.maxPlayers) { socket.emit('join-error', { msg: '房間已滿' }); return; }

    playerIdx = room.sockets.length;
    room.sockets.push(socket);
    room.guessCount.push(0);
    room.playerDone.push(false);
    room.playerWon.push(false);
    roomCode = code;
    socket.join(code);

    const count = room.sockets.length;
    socket.emit('room-joined', { playerIdx, mode: room.mode, playerCount: count });
    room.sockets.slice(0, -1).forEach(s => {
      if (s && s.connected) s.emit('player-joined', { playerCount: count });
    });

    // 對拆固定 2 人，第 2 人加入就自動開始
    if (room.mode === 'dual' && count === 2) {
      room.started = true;
      io.to(code).emit('game-start', { mode: 'dual', playerCount: 2 });
    }
  });

  // 競速房主按開始
  socket.on('start-game', () => {
    const room = getRoom();
    if (!room || playerIdx !== 0 || room.started || room.sockets.length < 2) return;
    room.started = true;
    room.aiSecret = randomSecret();
    io.to(roomCode).emit('game-start', { mode: 'ai-dual', playerCount: room.sockets.length });
  });

  socket.on('set-secret', ({ secret }) => {
    const room = getRoom();
    if (!room || room.mode !== 'dual' || !isValidCode(secret)) return;
    room.targets[1 - playerIdx] = secret;
    room.secretReady[playerIdx] = true;
    socket.emit('secret-ok');
    if (room.secretReady[0] && room.secretReady[1]) {
      io.to(roomCode).emit('both-secrets-set');
    }
  });

  socket.on('make-guess', ({ guess }) => {
    const room = getRoom();
    if (!room || !room.started || room.playerDone[playerIdx]) return;
    const secret = room.mode === 'ai-dual' ? room.aiSecret : room.targets[playerIdx];
    if (!secret) return;
    const { a, b } = calcAB(secret, guess);
    room.guessCount[playerIdx]++;

    socket.emit('guess-result', { a, b, won: a === 4, secret: a === 4 ? secret : null });

    // 通知所有其他玩家進度
    room.sockets.forEach((s, idx) => {
      if (idx !== playerIdx && s && s.connected) {
        s.emit('opponent-update', {
          playerIdx,
          count: room.guessCount[playerIdx],
          // 競速同一題可以顯示 A/B；對拆各自的題目就不顯示
          a: room.mode === 'ai-dual' ? a : null,
          b: room.mode === 'ai-dual' ? b : null,
        });
      }
    });

    if (a === 4) {
      room.playerDone[playerIdx] = true;
      room.playerWon[playerIdx]  = true;
      // 通知其他人：這個玩家猜中了，可以繼續
      room.sockets.forEach((s, idx) => {
        if (idx !== playerIdx && s && s.connected) {
          s.emit('opponent-guessed', { playerIdx, count: room.guessCount[playerIdx] });
        }
      });
      checkAllDone(room);
    }
  });

  // 次數用完，通知伺服器
  socket.on('out-of-tries', () => {
    const room = getRoom();
    if (!room || !room.started) return;
    room.playerDone[playerIdx] = true;
    room.playerWon[playerIdx]  = false;
    checkAllDone(room);
  });

  function checkAllDone(room) {
    for (let i = 0; i < room.sockets.length; i++) {
      const s = room.sockets[i];
      if (!room.playerDone[i] && s && s.connected) return; // 還有人在猜
    }
    // 所有人都完成，找出贏家（次數最少的猜中者）
    let minCount = Infinity;
    const winners = [];
    room.playerWon.forEach((w, i) => {
      if (w) {
        if (room.guessCount[i] < minCount) {
          minCount = room.guessCount[i];
          winners.length = 0;
          winners.push(i);
        } else if (room.guessCount[i] === minCount) {
          winners.push(i);
        }
      }
    });
    io.to(roomCode).emit('game-over', {
      winners,
      counts:   room.guessCount,
      won:      room.playerWon,
      targets:  room.targets,
      aiSecret: room.aiSecret,
      mode:     room.mode,
    });
    rooms.delete(roomCode);
  }

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    room.sockets[playerIdx] = null;
    room.sockets.forEach((s, idx) => {
      if (idx !== playerIdx && s && s.connected) {
        s.emit('opponent-disconnected', { playerIdx });
      }
    });
    // 若遊戲進行中，把離線玩家標為完成（沒猜中）並重新檢查
    if (room.started && !room.playerDone[playerIdx]) {
      room.playerDone[playerIdx] = true;
      room.playerWon[playerIdx]  = false;
      checkAllDone(room);
    }
    if (room.sockets.every(s => !s || !s.connected)) rooms.delete(roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`1A1B server running on port ${PORT}`));
