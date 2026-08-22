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
      // dual-mode only
      targets: ['', ''],
      secretReady: [false, false],
      guessCount: [0],
      // dual end-game tracking
      playerDone: [false, false],
      playerWon:  [false, false],
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
    roomCode = code;
    socket.join(code);

    const count = room.sockets.length;

    // Tell the new joiner their index and mode
    socket.emit('room-joined', { playerIdx, mode: room.mode, playerCount: count });

    // Tell everyone else that a new player joined
    room.sockets.slice(0, -1).forEach(s => {
      if (s && s.connected) s.emit('player-joined', { playerCount: count });
    });

    // dual (2-player only): auto-start immediately when 2nd player joins
    if (room.mode === 'dual' && count === 2) {
      room.started = true;
      io.to(code).emit('game-start', { mode: 'dual', playerCount: 2 });
    }
  });

  // Only creator of ai-dual calls this
  socket.on('start-game', () => {
    const room = getRoom();
    if (!room || playerIdx !== 0) return;
    if (room.started) return;
    if (room.sockets.length < 2) return;
    room.started = true;
    room.aiSecret = randomSecret();
    io.to(roomCode).emit('game-start', { mode: 'ai-dual', playerCount: room.sockets.length });
  });

  socket.on('set-secret', ({ secret }) => {
    const room = getRoom();
    if (!room || room.mode !== 'dual') return;
    if (!isValidCode(secret)) return;
    room.targets[1 - playerIdx] = secret;
    room.secretReady[playerIdx] = true;
    socket.emit('secret-ok');
    if (room.secretReady[0] && room.secretReady[1]) {
      io.to(roomCode).emit('both-secrets-set');
    }
  });

  socket.on('make-guess', ({ guess }) => {
    const room = getRoom();
    if (!room || !room.started) return;
    const secret = room.mode === 'ai-dual' ? room.aiSecret : room.targets[playerIdx];
    if (!secret) return;
    const { a, b } = calcAB(secret, guess);
    room.guessCount[playerIdx]++;

    socket.emit('guess-result', { a, b, won: a === 4, secret: a === 4 ? secret : null });

    if (room.mode === 'ai-dual') {
      // 競速：通知所有對手進度，第一個猜中就結束
      room.sockets.forEach((s, idx) => {
        if (idx !== playerIdx && s && s.connected) {
          s.emit('opponent-update', { playerIdx, count: room.guessCount[playerIdx], a, b });
        }
      });
      if (a === 4) {
        room.sockets.forEach((s, idx) => {
          if (idx !== playerIdx && s && s.connected) {
            s.emit('opponent-won', { winnerIdx: playerIdx, opponentSecret: room.aiSecret });
          }
        });
        rooms.delete(roomCode);
      }
    } else {
      // 對拆：對手只看到次數（不看 A/B），兩邊都完成才結算
      const other = room.sockets[1 - playerIdx];
      if (other && other.connected) {
        other.emit('opponent-update', { playerIdx, count: room.guessCount[playerIdx], a: null, b: null });
      }
      if (a === 4) {
        room.playerDone[playerIdx] = true;
        room.playerWon[playerIdx]  = true;
        // 通知對手：你猜到了，他可以繼續
        if (other && other.connected) {
          other.emit('opponent-guessed', { opponentCount: room.guessCount[playerIdx] });
        }
        checkDualDone(room);
      }
    }
  });

  // 客戶端次數用完時通知伺服器
  socket.on('out-of-tries', () => {
    const room = getRoom();
    if (!room || room.mode !== 'dual') return;
    room.playerDone[playerIdx] = true;
    room.playerWon[playerIdx]  = false;
    checkDualDone(room);
  });

  function checkDualDone(room) {
    if (!room.playerDone[0] || !room.playerDone[1]) return;
    const [w0, w1] = room.playerWon;
    const [c0, c1] = room.guessCount;
    let winner;
    if (w0 && w1)       winner = c0 < c1 ? 'p0' : c1 < c0 ? 'p1' : 'tie';
    else if (w0)        winner = 'p0';
    else if (w1)        winner = 'p1';
    else                winner = 'nobody';
    io.to(roomCode).emit('game-over', {
      winner,
      counts:  [c0, c1],
      won:     [w0, w1],
      targets: room.targets,
    });
    rooms.delete(roomCode);
  }

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    room.sockets[playerIdx] = null;
    // Notify remaining connected players
    room.sockets.forEach((s, idx) => {
      if (idx !== playerIdx && s && s.connected) {
        s.emit('opponent-disconnected', { playerIdx });
      }
    });
    // Clean up room if everyone is gone
    if (room.sockets.every(s => !s || !s.connected)) {
      rooms.delete(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`1A1B server running on port ${PORT}`));
