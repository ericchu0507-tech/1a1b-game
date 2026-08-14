// ── Constants ──
const MAX_TRIES = 10;

// ── State ──
let mode = '';        // 'ai' | 'human'
let secret = '';
let guesses = [];     // [{ digits:'1234', a:1, b:2 }]
let inputBuf = '';
let gameOver = false;

// Human vs Human
let hvhPhase = 0;
let hvhScores = [null, null];
let hvhSecrets = ['', ''];

// Notes matrix: notesCells[digit 0-9][position 0-3] = '' | 'yes' | 'no'
let notesCells = [];

// ── DOM ──
const screens = {
  mode:    document.getElementById('modeScreen'),
  setup:   document.getElementById('setupScreen'),
  handoff: document.getElementById('handoffScreen'),
  game:    document.getElementById('gameScreen'),
  result:  document.getElementById('resultScreen'),
};

// ── Utilities ──
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
  if (!/^\d{4}$/.test(s)) return false;
  return new Set(s).size === 4;
}

function randomSecret() {
  const d = ['0','1','2','3','4','5','6','7','8','9'];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 4).join('');
}

// ── Grid ──
function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    row.dataset.row = r;
    for (let c = 0; c < 4; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.row = r;
      tile.dataset.col = c;
      row.appendChild(tile);
    }
    const hint = document.createElement('div');
    hint.className = 'hint-label';
    hint.dataset.row = r;
    hint.innerHTML = '<span class="hd">——</span>';
    row.appendChild(hint);
    grid.appendChild(row);
  }
  updateGrid();
}

function revealRow(rowIdx, entry) {
  const tiles = document.querySelectorAll(`.tile[data-row="${rowIdx}"]`);
  const isWin = entry.a === 4;
  tiles.forEach((tile, c) => {
    setTimeout(() => {
      tile.classList.remove('filled', 'active');
      tile.classList.add(isWin ? 'submitted-win' : 'submitted', 'revealed');
      tile.textContent = entry.digits[c];
    }, c * 100);
  });
  const hint = document.querySelector(`.hint-label[data-row="${rowIdx}"]`);
  setTimeout(() => {
    if (isWin) {
      hint.innerHTML = '<span class="hw">✦</span>';
    } else {
      hint.innerHTML =
        `<span class="ha">${entry.a}A</span> <span class="hb">${entry.b}B</span>`;
    }
  }, 4 * 100 + 80);
}

function updateGrid() {
  const activeRow = guesses.length;
  if (activeRow >= MAX_TRIES) return;

  // Clear the active row's tile styles from previous input
  const allActive = document.querySelectorAll(`.tile[data-row="${activeRow}"]`);
  allActive.forEach((tile, c) => {
    if (c < inputBuf.length) {
      tile.textContent = inputBuf[c];
      tile.classList.add('filled');
      tile.classList.remove('active');
    } else {
      tile.textContent = '';
      tile.classList.remove('filled', 'submitted', 'submitted-win');
      tile.classList.toggle('active', c === inputBuf.length);
    }
  });

  // Sync digit input boxes below numpad
  document.querySelectorAll('.dbox').forEach((box, c) => {
    if (c < inputBuf.length) {
      box.textContent = inputBuf[c];
      box.classList.add('filled');
    } else {
      box.textContent = '';
      box.classList.remove('filled');
      box.classList.toggle('active', c === inputBuf.length);
    }
  });

  // Update tries bar
  const pct = (guesses.length / MAX_TRIES) * 100;
  document.getElementById('triesBar').style.width = pct + '%';
  document.getElementById('triesLabel').textContent = `${guesses.length} / ${MAX_TRIES}`;
}

// ── Input ──
function handleDigit(v) {
  if (gameOver) return;
  if (v === 'del') {
    inputBuf = inputBuf.slice(0, -1);
    document.getElementById('inputError').classList.add('hidden');
    updateGrid();
    return;
  }
  if (v === 'enter') { submitGuess(); return; }
  if (inputBuf.length >= 4) return;
  if (inputBuf.includes(v)) return;
  inputBuf += v;
  updateGrid();
}

function submitGuess() {
  if (inputBuf.length !== 4) {
    showInputError('請輸入 4 位數字');
    return;
  }
  if (!isValidCode(inputBuf)) {
    showInputError('數字不可重複');
    return;
  }
  const result = calcResult(secret, inputBuf);
  const entry = { digits: inputBuf, ...result };
  guesses.push(entry);
  revealRow(guesses.length - 1, entry);
  inputBuf = '';
  document.getElementById('inputError').classList.add('hidden');
  setTimeout(() => {
    updateGrid();
    checkWinLose(entry);
  }, 4 * 100 + 180);
}

function showInputError(msg) {
  const el = document.getElementById('inputError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function checkWinLose(entry) {
  if (entry.a === 4) {
    gameOver = true;
    setTimeout(() => endRound(true), 400);
  } else if (guesses.length >= MAX_TRIES) {
    gameOver = true;
    setTimeout(() => endRound(false), 400);
  }
}

// ── End round ──
function endRound(won) {
  if (mode === 'ai') {
    showResult({
      emoji: won ? '🎉' : '😅',
      title: won ? '猜對了！' : '沒猜出來',
      secretText: `答案是 ${secret}`,
      detail: won ? `第 ${guesses.length} 次猜中` : '',
    });
  } else {
    if (hvhPhase === 1) {
      hvhScores[0] = won ? guesses.length : null;
      hvhPhase = 2;
      showHandoff(2, () => startHvHSetup(2));
    } else if (hvhPhase === 3) {
      hvhScores[1] = won ? guesses.length : null;
      hvhPhase = 4;
      showHvHResult();
    }
  }
}

// ── Human vs Human ──
function startHvHSetup(playerNum) {
  document.getElementById('setupTitle').textContent = `玩家 ${playerNum}`;
  document.getElementById('secretInput').value = '';
  document.getElementById('setupError').classList.add('hidden');
  showScreen('setup');
}

function showHandoff(nextPlayer, callback) {
  document.getElementById('handoffTitle').textContent = `請傳給玩家 ${nextPlayer}`;
  document.getElementById('handoffMsg').textContent =
    `設定完成！請把裝置交給玩家 ${nextPlayer}，不要讓對方看到你的數字`;
  document.getElementById('handoffReady').onclick = callback;
  showScreen('handoff');
}

function startGuessing(label, secretNum) {
  secret = secretNum;
  guesses = [];
  inputBuf = '';
  gameOver = false;
  buildGrid();
  initNotes();
  document.getElementById('modeLabel').textContent = label;
  document.getElementById('triesLabel').textContent = `0 / ${MAX_TRIES}`;
  document.getElementById('triesBar').style.width = '0%';
  document.getElementById('inputError').classList.add('hidden');
  showScreen('game');
}

function showHvHResult() {
  const s0 = hvhScores[0];
  const s1 = hvhScores[1];
  let winnerLine = '';
  if (!s0 && !s1)   winnerLine = '兩位都沒猜到！平手';
  else if (!s0)      winnerLine = '玩家 1 勝！';
  else if (!s1)      winnerLine = '玩家 2 勝！';
  else if (s0 < s1)  winnerLine = '玩家 2 勝！猜得更少次';
  else if (s1 < s0)  winnerLine = '玩家 1 勝！猜得更少次';
  else               winnerLine = '平手！';

  const el = document.getElementById('resultVsDetail');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div>玩家 1 的數字：<b>${hvhSecrets[0]}</b></div>
    <div>玩家 2 的數字：<b>${hvhSecrets[1]}</b></div>
    <div style="margin-top:8px">
      玩家 2 猜了 ${s0 ? s0 + ' 次' : '未猜出'}　|　玩家 1 猜了 ${s1 ? s1 + ' 次' : '未猜出'}
    </div>
    <div class="winner-line">${winnerLine}</div>
  `;
  showResult({ emoji: '🏆', title: '對戰結束', secretText: '', detail: '' });
}

function showResult({ emoji, title, secretText, detail }) {
  document.getElementById('resultEmoji').textContent = emoji;
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSecret').textContent = secretText;
  document.getElementById('resultDetail').textContent = detail;
  showScreen('result');
}

// ── Notes matrix ──
function initNotes() {
  notesCells = Array.from({ length: 10 }, () => ['', '', '', '']);
  renderNotes();
}

function renderNotes() {
  const el = document.getElementById('notesMatrix');
  el.innerHTML = '';

  // Top-left corner (empty)
  el.appendChild(Object.assign(document.createElement('div'), { className: 'nm-corner' }));

  // Position headers: 1 2 3 4
  for (let p = 0; p < 4; p++) {
    const h = document.createElement('div');
    h.className = 'nm-pos-header';
    h.textContent = p + 1;
    el.appendChild(h);
  }

  // 10 digit rows
  for (let d = 0; d <= 9; d++) {
    const label = document.createElement('div');
    label.className = 'nm-digit-label';
    label.textContent = d;
    el.appendChild(label);

    for (let p = 0; p < 4; p++) {
      const cell = document.createElement('button');
      cell.className = 'nm-cell';
      const state = notesCells[d][p];
      if (state === 'yes') cell.classList.add('nm-yes');
      else if (state === 'no')  cell.classList.add('nm-no');
      cell.textContent = d;
      cell.onclick = () => cycleNote(d, p);
      el.appendChild(cell);
    }
  }
}

function cycleNote(d, p) {
  const cycle = ['', 'yes', 'no'];
  const cur = notesCells[d][p];
  notesCells[d][p] = cycle[(cycle.indexOf(cur) + 1) % 3];
  renderNotes();
}

document.getElementById('clearNotes').onclick = initNotes;

// ── Start modes ──
function startVsAI() {
  mode = 'ai';
  startGuessing('挑戰電腦', randomSecret());
}

function startVsHuman() {
  mode = 'human';
  hvhPhase = 0;
  hvhScores = [null, null];
  hvhSecrets = ['', ''];
  startHvHSetup(1);
}

// ── Event bindings ──
document.getElementById('btnVsAI').onclick = startVsAI;
document.getElementById('btnVsHuman').onclick = startVsHuman;

document.getElementById('confirmSecret').onclick = () => {
  const val = document.getElementById('secretInput').value.trim();
  if (!isValidCode(val)) {
    document.getElementById('setupError').classList.remove('hidden');
    return;
  }
  document.getElementById('setupError').classList.add('hidden');
  if (hvhPhase === 0) {
    hvhSecrets[0] = val;
    hvhPhase = 1;
    showHandoff(2, () => startGuessing('玩家 2 猜', hvhSecrets[0]));
  } else if (hvhPhase === 2) {
    hvhSecrets[1] = val;
    hvhPhase = 3;
    showHandoff(1, () => startGuessing('玩家 1 猜', hvhSecrets[1]));
  }
};

document.getElementById('numpad').addEventListener('click', e => {
  const btn = e.target.closest('.nk');
  if (btn) handleDigit(btn.dataset.v);
});

document.addEventListener('keydown', e => {
  if (screens.game.classList.contains('hidden')) return;
  if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete') handleDigit('del');
  else if (e.key === 'Enter') handleDigit('enter');
});

document.getElementById('playAgain').onclick = () => {
  document.getElementById('resultVsDetail').classList.add('hidden');
  mode === 'ai' ? startVsAI() : startVsHuman();
};

document.getElementById('backMenu').onclick = () => {
  document.getElementById('resultVsDetail').classList.add('hidden');
  showScreen('mode');
};

// Prevent repeated digits in secret input
document.getElementById('secretInput').addEventListener('input', function () {
  const seen = new Set();
  let clean = '';
  for (const ch of this.value) {
    if (/\d/.test(ch) && !seen.has(ch)) { seen.add(ch); clean += ch; }
  }
  if (clean !== this.value) this.value = clean;
});
