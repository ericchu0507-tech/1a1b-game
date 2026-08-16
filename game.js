const MAX_TRIES = 10;

// ── Current mode ──
let mode = ''; // 'solo' | 'dual' | 'ai-dual'

// ── Solo state ──
let secret = '';
let guesses = [];
let inputBuf = '';
let gameOver = false;

// ── Dual state ──
// dualTargets[i] = the number that player i is trying to guess
let dualTargets = ['', ''];
// dualPlayers[i] = { guesses:[], inputBuf:'', done:false, won:false }
let dualPlayers = [];
let dualCurrentPlayer = 0; // whose turn: 0=P1, 1=P2
let dualGameOver = false;

// ── Setup state (reused by dual modes) ──
let setupCallback = null;

// ── Notes matrix ──
let notesCells = [];

// ── DOM ──
const screens = {
  mode:    document.getElementById('modeScreen'),
  setup:   document.getElementById('setupScreen'),
  handoff: document.getElementById('handoffScreen'),
  game:    document.getElementById('gameScreen'),
  dual:    document.getElementById('dualGameScreen'),
  result:  document.getElementById('resultScreen'),
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
// SETUP SCREEN (reused by all modes needing password input)
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
// SOLO GAME
// ══════════════════════════════
function startSolo() {
  mode = 'solo';
  secret = randomSecret();
  guesses = [];
  inputBuf = '';
  gameOver = false;
  buildSoloGrid();
  initNotes();
  document.getElementById('triesLabel').textContent = '0 / 10';
  document.getElementById('triesBar').style.width = '0%';
  document.getElementById('inputError').classList.add('hidden');
  showScreen('game');
}

function buildSoloGrid() {
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
  updateSoloGrid();
}

function revealSoloRow(rowIdx, entry) {
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

function updateSoloGrid() {
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
  // Sync dbox
  document.querySelectorAll('#digitBoxes .dbox').forEach((box, c) => {
    box.textContent = c < inputBuf.length ? inputBuf[c] : '';
    box.classList.toggle('filled', c < inputBuf.length);
    box.classList.toggle('active', c === inputBuf.length && c >= inputBuf.length);
  });
  const pct = (guesses.length / MAX_TRIES) * 100;
  document.getElementById('triesBar').style.width = pct + '%';
  document.getElementById('triesLabel').textContent = `${guesses.length} / ${MAX_TRIES}`;
}

function handleSoloDigit(v) {
  if (gameOver) return;
  if (v === 'del') { inputBuf = inputBuf.slice(0, -1); document.getElementById('inputError').classList.add('hidden'); updateSoloGrid(); return; }
  if (v === 'enter') { submitSoloGuess(); return; }
  if (inputBuf.length >= 4 || inputBuf.includes(v)) return;
  inputBuf += v;
  updateSoloGrid();
}

function submitSoloGuess() {
  if (inputBuf.length !== 4) { showSoloError('請輸入 4 位數字'); return; }
  const { a, b } = calcResult(secret, inputBuf);
  const entry = { digits: inputBuf, a, b };
  guesses.push(entry);
  revealSoloRow(guesses.length - 1, entry);
  inputBuf = '';
  document.getElementById('inputError').classList.add('hidden');
  setTimeout(() => {
    updateSoloGrid();
    if (a === 4) { gameOver = true; setTimeout(() => showResult({ emoji:'🎉', title:'猜對了！', secret:`答案是 ${secret}`, detail:`第 ${guesses.length} 次猜中` }), 400); }
    else if (guesses.length >= MAX_TRIES) { gameOver = true; setTimeout(() => showResult({ emoji:'😅', title:'沒猜出來', secret:`答案是 ${secret}`, detail:'' }), 400); }
  }, 4 * 100 + 180);
}

function showSoloError(msg) {
  const el = document.getElementById('inputError');
  el.textContent = msg; el.classList.remove('hidden');
}

// ══════════════════════════════
// DUAL GAME (shared by 'dual' and 'ai-dual')
// ══════════════════════════════
function startDual() {
  mode = 'dual';
  // P1 sets their number first (P2 will guess it), then P2 sets theirs (P1 will guess it)
  showSetup('玩家 1', (val1) => {
    dualTargets[1] = val1; // P2 will guess this
    showHandoff('請傳給玩家 2', '設定完成！把裝置交給玩家 2，不要讓他看到你的數字', () => {
      showSetup('玩家 2', (val2) => {
        dualTargets[0] = val2; // P1 will guess this
        showHandoff('遊戲開始！', '兩人都設定完畢，放在兩人都能看到的地方，開始競賽！', () => {
          launchDualGame();
        });
      });
    });
  });
}

function startAiDual() {
  mode = 'ai-dual';
  const aiNum = randomSecret();
  dualTargets[0] = aiNum; // P1 guesses this
  dualTargets[1] = aiNum; // P2 guesses the same number
  launchDualGame();
}

function launchDualGame() {
  dualPlayers = [
    { guesses: [], inputBuf: '', done: false, won: false },
    { guesses: [], inputBuf: '', done: false, won: false },
  ];
  dualCurrentPlayer = 0;
  dualGameOver = false;

  document.getElementById('dualModeLabel').textContent = mode === 'dual' ? '雙人對拆' : '雙人競速';
  buildDualGrid(0);
  buildDualGrid(1);
  updateDualTurnUI();
  document.getElementById('dualInputError').classList.add('hidden');
  showScreen('dual');
}

function buildDualGrid(pIdx) {
  const wrap = document.getElementById(`dualGrid${pIdx}`);
  wrap.innerHTML = '';
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = document.createElement('div');
    row.className = 'dual-row';
    for (let c = 0; c < 4; c++) {
      const t = document.createElement('div');
      t.className = 'dtile';
      t.dataset.p = pIdx; t.dataset.row = r; t.dataset.col = c;
      row.appendChild(t);
    }
    const h = document.createElement('div');
    h.className = 'dual-hint';
    h.dataset.p = pIdx; h.dataset.row = r;
    h.innerHTML = '<span class="hd">·</span>';
    row.appendChild(h);
    wrap.appendChild(row);
  }
  updateDualGrid(pIdx);
}

function revealDualRow(pIdx, rowIdx, entry) {
  const tiles = document.querySelectorAll(`.dtile[data-p="${pIdx}"][data-row="${rowIdx}"]`);
  const isWin = entry.a === 4;
  tiles.forEach((tile, c) => {
    setTimeout(() => {
      tile.classList.remove('filled', 'active');
      tile.classList.add(isWin ? 'submitted-win' : 'submitted', 'revealed');
      tile.textContent = entry.digits[c];
    }, c * 80);
  });
  const hint = document.querySelector(`.dual-hint[data-p="${pIdx}"][data-row="${rowIdx}"]`);
  setTimeout(() => {
    hint.innerHTML = isWin
      ? '<span class="hw">✦</span>'
      : `<span class="ha">${entry.a}A</span><span class="hb">${entry.b}B</span>`;
  }, 4 * 80 + 60);
}

function updateDualGrid(pIdx) {
  const p = dualPlayers[pIdx];
  const activeRow = p.guesses.length;
  if (activeRow < MAX_TRIES && !p.done) {
    document.querySelectorAll(`.dtile[data-p="${pIdx}"][data-row="${activeRow}"]`).forEach((tile, c) => {
      const buf = pIdx === dualCurrentPlayer ? p.inputBuf : '';
      if (c < buf.length) {
        tile.textContent = buf[c];
        tile.classList.add('filled'); tile.classList.remove('active');
      } else {
        tile.textContent = '';
        tile.classList.remove('filled', 'submitted', 'submitted-win');
        tile.classList.toggle('active', pIdx === dualCurrentPlayer && c === buf.length);
      }
    });
  }
  document.getElementById(`dualTries${pIdx}`).textContent = `${p.guesses.length} / ${MAX_TRIES}`;
}

function updateDualTurnUI() {
  const p = dualCurrentPlayer;
  const pName = `玩家 ${p + 1}`;
  document.getElementById('dualTurnBadge').textContent = `${pName} 的回合`;
  document.getElementById('dualInputHint').textContent = `${pName}，輸入你的猜測`;

  // highlight active side
  document.getElementById('dualSide0').classList.toggle('is-active', p === 0);
  document.getElementById('dualSide1').classList.toggle('is-active', p === 1);

  // sync dbox
  const buf = dualPlayers[p].inputBuf;
  document.querySelectorAll('#dualDigitBoxes .dbox').forEach((box, c) => {
    box.textContent = c < buf.length ? buf[c] : '';
    box.classList.toggle('filled', c < buf.length);
    box.classList.toggle('active', c === buf.length);
  });
}

function handleDualDigit(v) {
  if (dualGameOver) return;
  const p = dualPlayers[dualCurrentPlayer];
  if (p.done) return;
  if (v === 'del') {
    p.inputBuf = p.inputBuf.slice(0, -1);
    document.getElementById('dualInputError').classList.add('hidden');
    updateDualGrid(dualCurrentPlayer);
    updateDualTurnUI();
    return;
  }
  if (v === 'enter') { submitDualGuess(); return; }
  if (p.inputBuf.length >= 4 || p.inputBuf.includes(v)) return;
  p.inputBuf += v;
  updateDualGrid(dualCurrentPlayer);
  updateDualTurnUI();
}

function submitDualGuess() {
  const pIdx = dualCurrentPlayer;
  const p = dualPlayers[pIdx];
  if (p.inputBuf.length !== 4) { showDualError('請輸入 4 位數字'); return; }

  const { a, b } = calcResult(dualTargets[pIdx], p.inputBuf);
  const entry = { digits: p.inputBuf, a, b };
  p.guesses.push(entry);
  revealDualRow(pIdx, p.guesses.length - 1, entry);
  p.inputBuf = '';
  document.getElementById('dualInputError').classList.add('hidden');

  setTimeout(() => {
    if (a === 4) {
      p.done = true; p.won = true;
      dualGameOver = true;
      const side = document.getElementById(`dualSide${pIdx}`);
      const badge = document.createElement('div');
      badge.className = 'dual-won-badge';
      badge.textContent = `✦ 玩家 ${pIdx + 1} 猜中！`;
      side.appendChild(badge);
      setTimeout(() => endDualGame(), 800);
    } else if (p.guesses.length >= MAX_TRIES) {
      p.done = true;
      const side = document.getElementById(`dualSide${pIdx}`);
      const badge = document.createElement('div');
      badge.className = 'dual-lost-badge';
      badge.textContent = `玩家 ${pIdx + 1} 用完次數`;
      side.appendChild(badge);
      // check if the other player is also done
      const otherIdx = 1 - pIdx;
      if (dualPlayers[otherIdx].done) {
        dualGameOver = true;
        setTimeout(() => endDualGame(), 600);
      } else {
        // switch to the other player
        switchDualTurn();
      }
    } else {
      switchDualTurn();
    }
  }, 4 * 80 + 150);
}

function switchDualTurn() {
  // find next player who isn't done
  const next = 1 - dualCurrentPlayer;
  if (!dualPlayers[next].done) {
    dualCurrentPlayer = next;
  }
  // (if both done the game should have ended already)
  updateDualGrid(0);
  updateDualGrid(1);
  updateDualTurnUI();
}

function endDualGame() {
  const p0 = dualPlayers[0], p1 = dualPlayers[1];
  const target0 = dualTargets[0], target1 = dualTargets[1];
  const aiNum = mode === 'ai-dual' ? dualTargets[0] : null;

  let emoji = '🏆', title = '遊戲結束';
  let secretText = '';
  let extraHTML = '';

  if (mode === 'ai-dual') {
    secretText = `電腦的數字是 ${aiNum}`;
  } else {
    secretText = `玩家 1 的密碼：${target1}　|　玩家 2 的密碼：${target0}`;
  }

  const score0 = p0.won ? `${p0.guesses.length} 次猜中` : (p0.done ? '未猜出' : '遊戲中斷');
  const score1 = p1.won ? `${p1.guesses.length} 次猜中` : (p1.done ? '未猜出' : '遊戲中斷');

  let winnerLine = '';
  if (p0.won && !p1.won) winnerLine = '🎉 玩家 1 勝！';
  else if (p1.won && !p0.won) winnerLine = '🎉 玩家 2 勝！';
  else if (p0.won && p1.won) {
    if (p0.guesses.length < p1.guesses.length) winnerLine = '🎉 玩家 1 勝！（更少次）';
    else if (p1.guesses.length < p0.guesses.length) winnerLine = '🎉 玩家 2 勝！（更少次）';
    else winnerLine = '🤝 平手！';
  } else {
    winnerLine = '兩人都沒猜到';
  }

  extraHTML = `
    <div>玩家 1：${score0}</div>
    <div>玩家 2：${score1}</div>
    <div class="winner-line" style="margin-top:8px">${winnerLine}</div>
  `;

  document.getElementById('resultEmoji').textContent = emoji;
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSecret').textContent = secretText;
  document.getElementById('resultDetail').textContent = '';
  const extra = document.getElementById('resultExtra');
  extra.innerHTML = extraHTML;
  extra.classList.remove('hidden');
  showScreen('result');
}

function showDualError(msg) {
  const el = document.getElementById('dualInputError');
  el.textContent = msg; el.classList.remove('hidden');
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
// NOTES MATRIX (solo only)
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
// EVENT HANDLERS
// ══════════════════════════════
document.getElementById('btnSolo').onclick = startSolo;
document.getElementById('btnDual').onclick = startDual;
document.getElementById('btnAiDual').onclick = startAiDual;

// Solo numpad
document.getElementById('numpad').addEventListener('click', e => {
  const btn = e.target.closest('.nk');
  if (btn) handleSoloDigit(btn.dataset.v);
});

// Dual numpad
document.getElementById('dualNumpad').addEventListener('click', e => {
  const btn = e.target.closest('.nk');
  if (btn) handleDualDigit(btn.dataset.v);
});

// Keyboard
document.addEventListener('keydown', e => {
  const isSolo = !screens.game.classList.contains('hidden');
  const isDual = !screens.dual.classList.contains('hidden');
  if (!isSolo && !isDual) return;
  const handler = isSolo ? handleSoloDigit : handleDualDigit;
  if (e.key >= '0' && e.key <= '9') handler(e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete') handler('del');
  else if (e.key === 'Enter') handler('enter');
});

// Back to menu buttons
document.getElementById('backFromGame').onclick    = () => showScreen('mode');
document.getElementById('backFromDual').onclick    = () => showScreen('mode');
document.getElementById('backFromSetup').onclick   = () => showScreen('mode');
document.getElementById('backFromHandoff').onclick = () => showScreen('mode');

// Result buttons
document.getElementById('playAgain').onclick = () => {
  document.getElementById('resultExtra').classList.add('hidden');
  if (mode === 'solo') startSolo();
  else if (mode === 'dual') startDual();
  else startAiDual();
};

document.getElementById('backMenu').onclick = () => {
  document.getElementById('resultExtra').classList.add('hidden');
  showScreen('mode');
};
