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
      sockets: [socket, null],
      // targets[i] = the secret that player i needs to guess
      targets: ['', ''],
      secretReady: [false, false],
      aiSecret: mode === 'ai-dual' ? randomSecret() : null,
      guessCount: [0, 0],
    });
    roomCode = code;
    playerIdx = 0;
    socket.join(code);
    socket.emit('room-created', { code });
  });

  socket.on('join-room', ({ code }) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('join-error', { msg: '找不到房間，請確認號碼' }); return; }
    if (room.sockets[1]) { socket.emit('join-error', { msg: '房間已滿' }); return; }

    room.sockets[1] = socket;
    roomCode = code;
    playerIdx = 1;
    socket.join(code);

    room.sockets[0].emit('opponent-joined');
    socket.emit('room-joined', { playerIdx: 1, mode: room.mode });

    if (room.mode === 'ai-dual') {
      io.to(code).emit('game-start', { mode: 'ai-dual' });
    } else {
      io.to(code).emit('game-start', { mode: 'dual' });
    }
  });

  socket.on('set-secret', ({ secret }) => {
    const room = getRoom();
    if (!room || room.mode !== 'dual') return;
    if (!isValidCode(secret)) return;
    // My secret becomes the OTHER player's target
    room.targets[1 - playerIdx] = secret;
    room.secretReady[playerIdx] = true;
    socket.emit('secret-ok');
    if (room.secretReady[0] && room.secretReady[1]) {
      io.to(roomCode).emit('both-secrets-set');
    }
  });

  socket.on('make-guess', ({ guess }) => {
    const room = getRoom();
    if (!room) return;
    const secret = room.mode === 'ai-dual' ? room.aiSecret : room.targets[playerIdx];
    if (!secret) return;
    const { a, b } = calcAB(secret, guess);
    room.guessCount[playerIdx]++;

    // Result back to the guesser (include secret on win)
    socket.emit('guess-result', { a, b, won: a === 4, secret: a === 4 ? secret : null });

    // Notify opponent
    const other = room.sockets[1 - playerIdx];
    if (other && other.connected) {
      other.emit('opponent-update', {
        count: room.guessCount[playerIdx],
        // In AI-dual (same secret) show A/B to opponent too; in dual keep it private
        a: room.mode === 'ai-dual' ? a : null,
        b: room.mode === 'ai-dual' ? b : null,
      });
    }

    if (a === 4) {
      if (other && other.connected) {
        other.emit('opponent-won', {
          opponentSecret: room.mode === 'ai-dual' ? room.aiSecret : room.targets[1 - playerIdx],
        });
      }
      rooms.delete(roomCode);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    const other = room.sockets[1 - playerIdx];
    if (other && other.connected) other.emit('opponent-disconnected');
    rooms.delete(roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`1A1B server running on port ${PORT}`));
