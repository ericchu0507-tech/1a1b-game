const MAX_TRIES = 10;

// ── Current mode ──
// 'solo' | 'challenge' | 'online-dual' | 'online-ai-dual'
let mode = '';

// ── Game state ──
let secret = '';
let guesses = [];
let inputBuf = '';
let gameOver = false;

// ── Setup state ──
let setupCallback = null;

// ── Notes matrix ──
let notesCells = [];

// ── Online state ──
let socket = null;
let pendingOnlineMode = '';  // 'dual' | 'ai-dual'
let onlineSubMode = '';
let myPlayerIdx = -1;
let opponentGuessCount = 0;
let pendingGuessDigits = '';

// ── DOM ──
const screens = {
  mode:    document.getElementById('modeScreen'),
  setup:   document.getElementById('setupScreen'),
  handoff: document.getElementById('handoffScreen'),
  game:    document.getElementById('gameScreen'),
  result:  document.getElementById('resultScreen'),
  lobby:   document.getElementById('lobbyScreen'),
  wait:    document.getElementById('waitScreen'),
};

// ══════════════════════════════
// UTILITIES
// ══════════════════════════════
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function calcResult(sec, guess) {
  let a = 0, b = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === sec[i]) a++;
    else if (sec.includes(guess[i])) b++;
  }
  return { a, b };
}

function isValidCode(s) {
  return /^\d{4}$/.test(s) && new Set(s).size === 4;
}

function randomSecret() {
  const d = '0123456789'.split('');
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 4).join('');
}

// ══════════════════════════════
// SETUP / HANDOFF SCREENS
// ══════════════════════════════
function showSetup(playerLabel, cb) {
  setupCallback = cb;
  document.getElementById('setupTitle').textContent = playerLabel;
  document.getElementById('secretInput').value = '';
  document.getElementById('setupError').classList.add('hidden');
  showScreen('setup');
}

function showHandoff(title, msg, cb) {
  document.getElementById('handoffTitle').textContent = title;
  document.getElementById('handoffMsg').textContent = msg;
  document.getElementById('handoffReady').onclick = cb;
  showScreen('handoff');
}

document.getElementById('confirmSecret').onclick = () => {
  const val = document.getElementById('secretInput').value.trim();
  if (!isValidCode(val)) {
    document.getElementById('setupError').classList.remove('hidden');
    return;
  }
  document.getElementById('setupError').classList.add('hidden');
  if (setupCallback) setupCallback(val);
};

document.getElementById('secretInput').addEventListener('input', function () {
  const seen = new Set();
  let clean = '';
  for (const ch of this.value) {
    if (/\d/.test(ch) && !seen.has(ch)) { seen.add(ch); clean += ch; }
  }
  if (clean !== this.value) this.value = clean;
});

// ══════════════════════════════
// GAME SCREEN (shared by all modes)
// ══════════════════════════════
function launchGame(secretVal, showOppBar) {
  secret = secretVal;
  guesses = [];
  inputBuf = '';
  gameOver = false;

  buildGrid();
  initNotes();
  document.getElementById('triesLabel').textContent = '0 / 10';
  document.getElementById('triesBar').style.width = '0%';
  document.getElementById('inputError').classList.add('hidden');

  const bar = document.getElementById('opponentBar');
  if (showOppBar) {
    bar.classList.remove('hidden');
    document.getElementById('oppCount').textContent = '0 次';
    document.getElementById('oppResult').textContent = '';
    document.getElementById('oppLabel').textContent = '對手：';
  } else {
    bar.classList.add('hidden');
  }

  showScreen('game');
}

function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    for (let c = 0; c < 4; c++) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.dataset.row = r; t.dataset.col = c;
      row.appendChild(t);
    }
    const h = document.createElement('div');
    h.className = 'hint-label';
    h.dataset.row = r;
    h.innerHTML = '<span class="hd">——</span>';
    row.appendChild(h);
    grid.appendChild(row);
  }
  updateGrid();
}

function revealRow(rowIdx, entry) {
  const tiles = document.querySelectorAll(`#grid .tile[data-row="${rowIdx}"]`);
  const isWin = entry.a === 4;
  tiles.forEach((tile, c) => {
    setTimeout(() => {
      tile.classList.remove('filled', 'active');
      tile.classList.add(isWin ? 'submitted-win' : 'submitted', 'revealed');
      tile.textContent = entry.digits[c];
    }, c * 100);
  });
  const hint = document.querySelector(`#grid .hint-label[data-row="${rowIdx}"]`);
  setTimeout(() => {
    hint.innerHTML = isWin
      ? '<span class="hw">✦</span>'
      : `<span class="ha">${entry.a}A</span> <span class="hb">${entry.b}B</span>`;
  }, 4 * 100 + 80);
}

function updateGrid() {
  const activeRow = guesses.length;
  if (activeRow < MAX_TRIES) {
    document.querySelectorAll(`#grid .tile[data-row="${activeRow}"]`).forEach((tile, c) => {
      if (c < inputBuf.length) {
        tile.textContent = inputBuf[c];
        tile.classList.add('filled'); tile.classList.remove('active');
      } else {
        tile.textContent = '';
        tile.classList.remove('filled', 'submitted', 'submitted-win');
        tile.classList.toggle('active', c === inputBuf.length);
      }
    });
  }
  document.querySelectorAll('#digitBoxes .dbox').forEach((box, c) => {
    box.textContent = c < inputBuf.length ? inputBuf[c] : '';
    box.classList.toggle('filled', c < inputBuf.length);
    box.classList.toggle('active', c === inputBuf.length);
  });
  const pct = (guesses.length / MAX_TRIES) * 100;
  document.getElementById('triesBar').style.width = pct + '%';
  document.getElementById('triesLabel').textContent = `${guesses.length} / ${MAX_TRIES}`;
}

function handleDigit(v) {
  if (gameOver) return;
  if (v === 'del') {
    inputBuf = inputBuf.slice(0, -1);
    document.getElementById('inputError').classList.add('hidden');
    updateGrid();
    return;
  }
  if (v === 'enter') { submitGuess(); return; }
  if (inputBuf.length >= 4 || inputBuf.includes(v)) return;
  inputBuf += v;
  updateGrid();
}

function submitGuess() {
  if (gameOver) return;
  if (inputBuf.length !== 4) { showInputError('請輸入 4 位數字'); return; }

  // Online mode: send to server
  if (mode === 'online-dual' || mode === 'online-ai-dual') {
    pendingGuessDigits = inputBuf;
    socket.emit('make-guess', { guess: inputBuf });
    inputBuf = '';
    updateGrid();
    return;
  }

  // Local mode
  const { a, b } = calcResult(secret, inputBuf);
  const entry = { digits: inputBuf, a, b };
  guesses.push(entry);
  revealRow(guesses.length - 1, entry);
  inputBuf = '';
  document.getElementById('inputError').classList.add('hidden');
  setTimeout(() => {
    updateGrid();
    if (a === 4) {
      gameOver = true;
      setTimeout(() => showResult({ emoji:'🎉', title:'猜對了！', secret:`答案是 ${secret}`, detail:`第 ${guesses.length} 次猜中` }), 400);
    } else if (guesses.length >= MAX_TRIES) {
      gameOver = true;
      setTimeout(() => showResult({ emoji:'😅', title:'沒猜出來', secret:`答案是 ${secret}`, detail:'' }), 400);
    }
  }, 4 * 100 + 180);
}

function showInputError(msg) {
  const el = document.getElementById('inputError');
  el.textContent = msg; el.classList.remove('hidden');
}

// ══════════════════════════════
// MODES
// ══════════════════════════════
function startSolo() {
  mode = 'solo';
  launchGame(randomSecret(), false);
}

function startChallenge() {
  mode = 'challenge';
  showSetup('出題者', (val) => {
    showHandoff('請把手機交給猜題者', '設定完成！交給對方，不要讓他看到你的數字', () => {
      launchGame(val, false);
    });
  });
}

// ══════════════════════════════
// RESULT SCREEN
// ══════════════════════════════
function showResult({ emoji, title, secret: sec, detail }) {
  document.getElementById('resultEmoji').textContent = emoji;
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSecret').textContent = sec;
  document.getElementById('resultDetail').textContent = detail;
  document.getElementById('resultExtra').classList.add('hidden');
  showScreen('result');
}

// ══════════════════════════════
// NOTES MATRIX
// ══════════════════════════════
function initNotes() {
  notesCells = Array.from({ length: 10 }, () => ['', '', '', '']);
  renderNotes();
}

function renderNotes() {
  const el = document.getElementById('notesMatrix');
  el.innerHTML = '';
  el.appendChild(Object.assign(document.createElement('div'), { className: 'nm-corner' }));
  for (let p = 0; p < 4; p++) {
    const h = document.createElement('div');
    h.className = 'nm-pos-header'; h.textContent = p + 1;
    el.appendChild(h);
  }
  for (let d = 0; d <= 9; d++) {
    const label = document.createElement('div');
    label.className = 'nm-digit-label'; label.textContent = d;
    el.appendChild(label);
    for (let p = 0; p < 4; p++) {
      const cell = document.createElement('button');
      cell.className = 'nm-cell';
      const state = notesCells[d][p];
      if (state === 'yes') cell.classList.add('nm-yes');
      else if (state === 'no') cell.classList.add('nm-no');
      cell.textContent = d;
      cell.onclick = () => cycleNote(d, p);
      el.appendChild(cell);
    }
  }
}

function cycleNote(d, p) {
  const cycle = ['', 'yes', 'no'];
  notesCells[d][p] = cycle[(cycle.indexOf(notesCells[d][p]) + 1) % 3];
  renderNotes();
}

document.getElementById('clearNotes').onclick = initNotes;

// ══════════════════════════════
// ONLINE MODE
// ══════════════════════════════
function connectSocket() {
  if (socket && socket.connected) return;
  socket = io();

  socket.on('room-created', ({ code }) => {
    myPlayerIdx = 0;
    document.getElementById('waitCode').textContent = code;
    showWaitFor('opponent');
  });

  socket.on('opponent-joined', () => { /* game-start follows */ });

  socket.on('room-joined', ({ playerIdx: idx, mode: m }) => {
    myPlayerIdx = idx;
    onlineSubMode = m;
  });

  socket.on('game-start', ({ mode: m }) => {
    onlineSubMode = m;
    if (m === 'dual') {
      showSetup('設定你的密碼', (val) => {
        socket.emit('set-secret', { secret: val });
        showWaitFor('secret');
      });
    } else {
      startOnlineGame();
    }
  });

  socket.on('secret-ok', () => { showWaitFor('secret'); });

  socket.on('both-secrets-set', () => { startOnlineGame(); });

  socket.on('guess-result', ({ a, b, won, secret: revealedSecret }) => {
    const entry = { digits: pendingGuessDigits, a, b };
    guesses.push(entry);
    revealRow(guesses.length - 1, entry);
    pendingGuessDigits = '';
    document.getElementById('inputError').classList.add('hidden');
    setTimeout(() => {
      updateGrid();
      if (won) {
        gameOver = true;
        setTimeout(() => showResult({ emoji:'🎉', title:'你猜到了！', secret:`答案是 ${revealedSecret}`, detail:`第 ${guesses.length} 次猜中` }), 400);
      } else if (guesses.length >= MAX_TRIES) {
        gameOver = true;
        setTimeout(() => showResult({ emoji:'😅', title:'猜不出來', secret:'次數用完了', detail:'' }), 400);
      }
    }, 4 * 100 + 180);
  });

  socket.on('opponent-update', ({ count, a, b }) => {
    opponentGuessCount = count;
    document.getElementById('oppCount').textContent = `${count} 次`;
    const resultEl = document.getElementById('oppResult');
    if (a !== null && b !== null) {
      resultEl.innerHTML = `上次：<span class="ha">${a}A</span> <span class="hb">${b}B</span>`;
    }
  });

  socket.on('opponent-won', ({ opponentSecret }) => {
    gameOver = true;
    const txt = onlineSubMode === 'dual'
      ? `對手的密碼：${opponentSecret}`
      : `答案是 ${opponentSecret}`;
    showResult({ emoji:'😔', title:'對手贏了！', secret: txt, detail:'' });
  });

  socket.on('join-error', ({ msg }) => {
    const el = document.getElementById('lobbyError');
    el.textContent = msg;
    el.classList.remove('hidden');
  });

  socket.on('opponent-disconnected', () => {
    gameOver = true;
    showResult({ emoji:'📵', title:'對手離線了', secret:'', detail:'' });
  });
}

function showWaitFor(state) {
  if (state === 'opponent') {
    document.getElementById('waitEmoji').textContent = '⏳';
    document.getElementById('waitTitle').textContent = '等待對手加入';
    document.getElementById('waitCodeBox').classList.remove('hidden');
    document.getElementById('waitMsg').classList.add('hidden');
  } else {
    document.getElementById('waitEmoji').textContent = '🔐';
    document.getElementById('waitTitle').textContent = '等待對方設定';
    document.getElementById('waitCodeBox').classList.add('hidden');
    document.getElementById('waitMsg').textContent = '等待對方設定密碼...';
    document.getElementById('waitMsg').classList.remove('hidden');
  }
  showScreen('wait');
}

function startOnlineGame() {
  mode = onlineSubMode === 'ai-dual' ? 'online-ai-dual' : 'online-dual';
  opponentGuessCount = 0;
  pendingGuessDigits = '';
  launchGame('', true); // secret is on the server; local secret not used
}

function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
  myPlayerIdx = -1;
  onlineSubMode = '';
  pendingOnlineMode = '';
}

// ══════════════════════════════
// EVENT HANDLERS
// ══════════════════════════════
document.getElementById('btnSolo').onclick = startSolo;
document.getElementById('btnChallenge').onclick = startChallenge;

document.getElementById('btnOnlineDual').onclick = () => {
  pendingOnlineMode = 'dual';
  document.getElementById('lobbyModeLabel').textContent = '線上對拆';
  document.getElementById('lobbyError').classList.add('hidden');
  document.getElementById('roomCodeInput').value = '';
  showScreen('lobby');
};
document.getElementById('btnOnlineAiDual').onclick = () => {
  pendingOnlineMode = 'ai-dual';
  document.getElementById('lobbyModeLabel').textContent = '線上競速';
  document.getElementById('lobbyError').classList.add('hidden');
  document.getElementById('roomCodeInput').value = '';
  showScreen('lobby');
};

document.getElementById('btnCreateRoom').onclick = () => {
  connectSocket();
  socket.emit('create-room', { mode: pendingOnlineMode });
};

document.getElementById('btnJoinRoom').onclick = () => {
  const code = document.getElementById('roomCodeInput').value.trim();
  if (!/^\d{4}$/.test(code)) {
    const el = document.getElementById('lobbyError');
    el.textContent = '請輸入 4 位數字的房間號碼';
    el.classList.remove('hidden');
    return;
  }
  document.getElementById('lobbyError').classList.add('hidden');
  connectSocket();
  socket.emit('join-room', { code });
};

// Numpad
document.getElementById('numpad').addEventListener('click', e => {
  const btn = e.target.closest('.nk');
  if (btn) handleDigit(btn.dataset.v);
});

// Keyboard
document.addEventListener('keydown', e => {
  if (screens.game.classList.contains('hidden')) return;
  if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete') handleDigit('del');
  else if (e.key === 'Enter') handleDigit('enter');
});

// Back buttons
document.getElementById('backFromGame').onclick = () => {
  if (mode === 'online-dual' || mode === 'online-ai-dual') disconnectSocket();
  showScreen('mode');
};
document.getElementById('backFromSetup').onclick = () => {
  disconnectSocket();
  showScreen('mode');
};
document.getElementById('backFromHandoff').onclick = () => showScreen('mode');
document.getElementById('backFromLobby').onclick   = () => showScreen('mode');
document.getElementById('backFromWait').onclick    = () => { disconnectSocket(); showScreen('mode'); };

// Result buttons
document.getElementById('playAgain').onclick = () => {
  document.getElementById('resultExtra').classList.add('hidden');
  if (mode === 'solo') startSolo();
  else if (mode === 'challenge') startChallenge();
  else { disconnectSocket(); showScreen('mode'); }
};

document.getElementById('backMenu').onclick = () => {
  document.getElementById('resultExtra').classList.add('hidden');
  if (mode === 'online-dual' || mode === 'online-ai-dual') disconnectSocket();
  showScreen('mode');
};
