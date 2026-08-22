const MAX_TRIES = 10;

// 'solo' | 'challenge' | 'online-dual' | 'online-ai-dual'
let mode = '';

// Game state
let secret = '';
let guesses = [];
let inputBuf = '';
let gameOver = false;

// Setup state
let setupCallback = null;

// Notes
let notesCells = [];
let digitNotes = [];

// Online state
let socket = null;
let pendingOnlineMode = '';  // 'dual' | 'ai-dual'
let onlineSubMode = '';
let myPlayerIdx = -1;
let pendingGuessDigits = '';
// opponents: Map<playerIdx, { count, a, b, won, offline }>
let opponents = new Map();

// Timer
let guessTimerInterval = null;
let timerSecondsLeft   = 0;
const GUESS_TIME_LIMIT = 300; // 5 minutes

function startGuessTimer() {
  stopGuessTimer();
  timerSecondsLeft = GUESS_TIME_LIMIT;
  updateTimerDisplay();
  const el = document.getElementById('timerDisplay');
  el.classList.remove('hidden');
  guessTimerInterval = setInterval(() => {
    if (gameOver) { stopGuessTimer(); return; }
    timerSecondsLeft--;
    updateTimerDisplay();
    if (timerSecondsLeft <= 0) {
      stopGuessTimer();
      onTimerExpired();
    }
  }, 1000);
}

function stopGuessTimer() {
  clearInterval(guessTimerInterval);
  guessTimerInterval = null;
  const el = document.getElementById('timerDisplay');
  if (el) el.classList.add('hidden');
}

function updateTimerDisplay() {
  const el = document.getElementById('timerDisplay');
  if (!el) return;
  const m = Math.floor(timerSecondsLeft / 60);
  const s = timerSecondsLeft % 60;
  el.textContent = `⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.classList.toggle('timer-warning', timerSecondsLeft <= 60);
}

function onTimerExpired() {
  gameOver = true;
  if (mode === 'online-dual' || mode === 'online-ai-dual') {
    socket.emit('out-of-tries');
    showDualWaiting('時間到！等待其他人完成...');
  } else {
    showResult({ emoji: '⏰', title: '時間到！', secret: `答案是 ${secret}`, detail: '超過 5 分鐘限制' });
  }
}

// DOM
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
// SETUP / HANDOFF
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
// GAME SCREEN
// ══════════════════════════════
function launchGame(secretVal, showOppBar) {
  secret = secretVal;
  guesses = [];
  inputBuf = '';
  gameOver = false;

  buildGrid();
  initNotes();
  startGuessTimer();
  document.getElementById('triesLabel').textContent = '0 / 10';
  document.getElementById('triesBar').style.width = '0%';
  document.getElementById('inputError').classList.add('hidden');
  document.getElementById('waitingBanner').classList.add('hidden');
  document.getElementById('inputArea').style.opacity = '';
  document.getElementById('inputArea').style.pointerEvents = '';

  const bar = document.getElementById('opponentBar');
  if (showOppBar) {
    bar.classList.remove('hidden');
    renderOpponentBar();
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

  if (mode === 'online-dual' || mode === 'online-ai-dual') {
    pendingGuessDigits = inputBuf;
    socket.emit('make-guess', { guess: inputBuf });
    inputBuf = '';
    updateGrid();
    return;
  }

  const { a, b } = calcResult(secret, inputBuf);
  const entry = { digits: inputBuf, a, b };
  guesses.push(entry);
  startGuessTimer();
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
// RESULT
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
  digitNotes = Array(10).fill('');
  renderNotes();
  renderDigitNotes();
  document.getElementById('freeNote').value = '';
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

function renderDigitNotes() {
  const el = document.getElementById('digitNotes');
  el.innerHTML = '';
  for (let d = 0; d <= 9; d++) {
    const btn = document.createElement('button');
    btn.className = 'dn-cell';
    const state = digitNotes[d];
    if (state === 'in')  btn.classList.add('dn-in');
    if (state === 'out') btn.classList.add('dn-out');
    btn.textContent = d;
    btn.onclick = () => cycleDigitNote(d);
    el.appendChild(btn);
  }
}

function cycleDigitNote(d) {
  const cycle = ['', 'in', 'out'];
  digitNotes[d] = cycle[(cycle.indexOf(digitNotes[d]) + 1) % 3];
  renderDigitNotes();
}

document.getElementById('clearNotes').onclick = initNotes;

document.getElementById('dnSelectAll').onclick = () => {
  digitNotes = digitNotes.map(() => 'in');
  renderDigitNotes();
};
document.getElementById('dnClearAll').onclick = () => {
  digitNotes = digitNotes.map(() => '');
  renderDigitNotes();
};

document.getElementById('nmSelectAll').onclick = () => {
  notesCells = notesCells.map(() => ['yes', 'yes', 'yes', 'yes']);
  renderNotes();
};
document.getElementById('nmClearAll').onclick = () => {
  notesCells = notesCells.map(() => ['', '', '', '']);
  renderNotes();
};

// ══════════════════════════════
// OPPONENT BAR
// ══════════════════════════════
function renderOpponentBar() {
  const list = document.getElementById('oppList');
  list.innerHTML = '';
  opponents.forEach((opp, pIdx) => {
    const item = document.createElement('div');
    item.className = 'opp-item' + (opp.won ? ' opp-won' : '') + (opp.offline ? ' opp-offline' : '');
    let abHtml = '';
    if (opp.won) {
      abHtml = '<span class="opp-count" style="color:#ffd700">✦ 猜中</span>';
    } else if (opp.offline) {
      abHtml = '<span class="opp-count" style="color:#555">離線</span>';
    } else {
      let countHtml = `<span class="opp-count">${opp.count}次</span>`;
      let abDetail = '';
      if (opp.a !== null) {
        abDetail = `<span class="opp-ab"><span class="ha">${opp.a}A</span><span class="hb">${opp.b}B</span></span>`;
      }
      abHtml = countHtml + abDetail;
    }
    item.innerHTML = `<span class="opp-name">玩家${pIdx + 1}</span>${abHtml}`;
    list.appendChild(item);
  });
}

function initOpponents(playerCount) {
  opponents.clear();
  for (let i = 0; i < playerCount; i++) {
    if (i !== myPlayerIdx) {
      opponents.set(i, { count: 0, a: null, b: null, won: false, offline: false });
    }
  }
}

// ══════════════════════════════
// ONLINE MODE
// ══════════════════════════════
function connectSocket() {
  if (socket && socket.connected) return;
  socket = io();

  // --- Wait screen events ---

  socket.on('room-created', ({ code, mode: m }) => {
    myPlayerIdx = 0;
    document.getElementById('waitCode').textContent = code;
    showWaitCreator(m, 1);
  });

  socket.on('player-joined', ({ playerCount }) => {
    // Update wait screen player count (creator sees this)
    updateWaitCreatorCount(playerCount);
  });

  socket.on('room-joined', ({ playerIdx: idx, mode: m, playerCount }) => {
    myPlayerIdx = idx;
    onlineSubMode = m;
    // Joiner: show "waiting for host to start" (ai-dual) or brief wait (dual)
    if (m === 'ai-dual') {
      showWaitJoiner(playerCount);
    }
  });

  // --- Game start ---

  socket.on('game-start', ({ mode: m, playerCount }) => {
    onlineSubMode = m;
    initOpponents(playerCount);
    if (m === 'dual') {
      showSetup('設定你的密碼', (val) => {
        socket.emit('set-secret', { secret: val });
        showWaitSecret();
      });
    } else {
      startOnlineGame(playerCount);
    }
  });

  socket.on('secret-ok', () => { showWaitSecret(); });
  socket.on('both-secrets-set', () => { startOnlineGame(2); });

  // --- In-game events ---

  socket.on('guess-result', ({ a, b, won, secret: revealedSecret }) => {
    const entry = { digits: pendingGuessDigits, a, b };
    guesses.push(entry);
    startGuessTimer();
    revealRow(guesses.length - 1, entry);
    pendingGuessDigits = '';
    document.getElementById('inputError').classList.add('hidden');
    setTimeout(() => {
      updateGrid();
      if (won) {
        gameOver = true;
        // 兩種線上模式都等所有人完成才結算
        setTimeout(() => showDualWaiting('你猜到了！等待其他人完成...'), 400);
      } else if (guesses.length >= MAX_TRIES) {
        gameOver = true;
        socket.emit('out-of-tries');
        setTimeout(() => showDualWaiting('次數用完了，等待其他人完成...'), 400);
      }
    }, 4 * 100 + 180);
  });

  socket.on('opponent-update', ({ playerIdx: pIdx, count, a, b }) => {
    const opp = opponents.get(pIdx);
    if (!opp) return;
    opp.count = count;
    if (a !== null) { opp.a = a; opp.b = b; }
    renderOpponentBar();
  });

  // 有人猜中了但遊戲繼續（兩種模式都用）
  socket.on('opponent-guessed', ({ playerIdx: pIdx, count }) => {
    const opp = opponents.get(pIdx);
    if (opp) { opp.won = true; opp.count = count; renderOpponentBar(); }
    showInGameNotice(`玩家 ${pIdx + 1} 猜中了（${count} 次），繼續！`);
  });

  // 所有人都完成，伺服器送最終結果
  socket.on('game-over', ({ winners, counts, won, targets, aiSecret, mode: m }) => {
    gameOver = true;
    const myCount = counts[myPlayerIdx];
    const iWon    = won[myPlayerIdx];
    const iAmWinner = winners.includes(myPlayerIdx);
    const isTie     = winners.length > 1 && iAmWinner;

    let emoji, title, detail;
    if (winners.length === 0) {
      emoji = '😅'; title = '沒人猜出來'; detail = '';
    } else if (isTie) {
      emoji = '🤝'; title = '平手！';
      detail = `大家都猜了 ${myCount} 次`;
    } else if (iAmWinner) {
      emoji = '🏆'; title = '你贏了！';
      detail = `你用了 ${myCount} 次`;
    } else {
      const winIdx = winners[0];
      emoji = '😔'; title = '這次輸了';
      detail = iWon
        ? `你 ${myCount} 次，但玩家 ${winIdx + 1} 只用了 ${counts[winIdx]} 次`
        : `你沒猜出來`;
    }

    // 列出所有人成績
    const rows = counts.map((c, i) => {
      const isMe = i === myPlayerIdx;
      const w = won[i];
      const isWinnerPlayer = winners.includes(i);
      return `<div style="${isMe ? 'color:#c8c8ff' : ''}">${isWinnerPlayer ? '🏆 ' : ''}玩家 ${i + 1}${isMe ? '（你）' : ''}：${w ? c + ' 次猜中' : '未猜出'}</div>`;
    }).join('');

    const secretText = m === 'ai-dual'
      ? `答案是 ${aiSecret}`
      : `你猜的密碼：${targets[myPlayerIdx]}`;

    document.getElementById('resultEmoji').textContent = emoji;
    document.getElementById('resultTitle').textContent = title;
    document.getElementById('resultSecret').textContent = secretText;
    document.getElementById('resultDetail').textContent = detail;
    const extra = document.getElementById('resultExtra');
    extra.innerHTML = rows;
    extra.classList.remove('hidden');
    showScreen('result');
  });

  socket.on('opponent-disconnected', ({ playerIdx: pIdx }) => {
    const opp = opponents.get(pIdx);
    if (opp) { opp.offline = true; renderOpponentBar(); }
  });

  socket.on('join-error', ({ msg }) => {
    const el = document.getElementById('lobbyError');
    el.textContent = msg;
    el.classList.remove('hidden');
  });
}

// Wait screen helpers
function showWaitCreator(m, count) {
  document.getElementById('waitEmoji').textContent = '⏳';
  document.getElementById('waitTitle').textContent = '等待朋友加入';
  document.getElementById('waitCodeBox').classList.remove('hidden');
  document.getElementById('waitMsg').classList.add('hidden');

  if (m === 'ai-dual') {
    // Show player count + start button
    document.getElementById('waitPlayerInfo').classList.remove('hidden');
    document.getElementById('waitPlayerText').textContent = `已有 ${count} 人加入`;
    const btn = document.getElementById('btnStartGame');
    btn.classList.remove('hidden');
    btn.disabled = count < 2;
    btn.textContent = count >= 2 ? `開始遊戲（${count} 人）` : '等待更多玩家...';
  } else {
    document.getElementById('waitPlayerInfo').classList.add('hidden');
    document.getElementById('btnStartGame').classList.add('hidden');
  }
  showScreen('wait');
}

function updateWaitCreatorCount(count) {
  document.getElementById('waitPlayerText').textContent = `已有 ${count} 人加入`;
  const btn = document.getElementById('btnStartGame');
  btn.disabled = count < 2;
  btn.textContent = count >= 2 ? `開始遊戲（${count} 人）` : '等待更多玩家...';
}

function showWaitJoiner(count) {
  document.getElementById('waitEmoji').textContent = '⏳';
  document.getElementById('waitTitle').textContent = '等待房主開始';
  document.getElementById('waitCodeBox').classList.add('hidden');
  document.getElementById('btnStartGame').classList.add('hidden');
  document.getElementById('waitPlayerInfo').classList.remove('hidden');
  document.getElementById('waitPlayerText').textContent = `已有 ${count} 人在房間`;
  document.getElementById('waitMsg').textContent = '等待房主按下「開始遊戲」...';
  document.getElementById('waitMsg').classList.remove('hidden');
  showScreen('wait');
}

function showWaitSecret() {
  document.getElementById('waitEmoji').textContent = '🔐';
  document.getElementById('waitTitle').textContent = '等待對方設定';
  document.getElementById('waitCodeBox').classList.add('hidden');
  document.getElementById('waitPlayerInfo').classList.add('hidden');
  document.getElementById('btnStartGame').classList.add('hidden');
  document.getElementById('waitMsg').textContent = '等待對方設定密碼...';
  document.getElementById('waitMsg').classList.remove('hidden');
  showScreen('wait');
}

function startOnlineGame(playerCount) {
  mode = onlineSubMode === 'ai-dual' ? 'online-ai-dual' : 'online-dual';
  pendingGuessDigits = '';
  launchGame('', true);
}

// 雙人對拆：你完成了，等對手
function showDualWaiting(msg) {
  const banner = document.getElementById('waitingBanner');
  document.getElementById('waitingBannerMsg').textContent = msg;
  banner.classList.remove('hidden');
  // 隱藏輸入區
  document.getElementById('inputArea').style.opacity = '0.3';
  document.getElementById('inputArea').style.pointerEvents = 'none';
}

// 對拆模式內的小通知（不中斷遊戲）
function showInGameNotice(msg) {
  const banner = document.getElementById('waitingBanner');
  document.getElementById('waitingBannerMsg').textContent = msg;
  banner.classList.remove('hidden');
  // 3 秒後自動消失
  setTimeout(() => banner.classList.add('hidden'), 3000);
}

function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
  myPlayerIdx = -1;
  onlineSubMode = '';
  pendingOnlineMode = '';
  opponents.clear();
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

document.getElementById('btnStartGame').onclick = () => {
  if (socket) socket.emit('start-game');
};

document.getElementById('numpad').addEventListener('click', e => {
  const btn = e.target.closest('.nk');
  if (btn) handleDigit(btn.dataset.v);
});

document.addEventListener('keydown', e => {
  if (screens.game.classList.contains('hidden')) return;
  if (document.activeElement.tagName === 'TEXTAREA') return;
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
  disconnectSocket(); showScreen('mode');
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
