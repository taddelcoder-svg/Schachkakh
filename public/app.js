import { Chess } from '/vendor/chess.js';
import { pieceSvg } from '/pieces.js';
import {
  BOARD_SKINS, PIECE_SKINS, BATTLEPASS, SEASON, XP_PER_TIER, MAX_TIER, AI_LEVELS,
  tierFromXp, rankName,
} from '/shared/catalog.js';

// ================= Hilfsfunktionen =================
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let token = store.get('token');
let me = null;

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  if (data.user) setMe(data.user);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function modal(content, { dismissable = true } = {}) {
  const m = $('#modal');
  const card = $('#modal-card');
  card.replaceChildren(...[].concat(content));
  m.classList.remove('hidden');
  m.onclick = (e) => { if (dismissable && e.target === m) closeModal(); };
}
function closeModal() { $('#modal').classList.add('hidden'); }

// ================= Sound =================
let audio;
function beep(freq = 520, dur = 0.07, type = 'triangle', vol = 0.15) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  } catch {}
}
const sfx = {
  move: () => beep(440, 0.06),
  capture: () => { beep(260, 0.1, 'square', 0.1); },
  check: () => { beep(700, 0.08); setTimeout(() => beep(900, 0.08), 90); },
  end: () => { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 150); setTimeout(() => beep(784, 0.25), 300); },
};

// ================= Benutzer / Kopfzeile =================
function setMe(user) {
  me = user;
  $('#me-name').textContent = me.name;
  $('#me-elo').textContent = me.elo;
  $('#me-rank').textContent = rankName(me.elo);
  $('#me-coins').textContent = me.coins;
  $('#me-tier').textContent = tierFromXp(me.pass.xp);
  applySkins(me.equipped.board, me.equipped.pieces);
}

function applySkins(boardId, piecesId) {
  const b = BOARD_SKINS[boardId] || BOARD_SKINS.classic;
  const p = PIECE_SKINS[piecesId] || PIECE_SKINS.standard;
  const r = document.documentElement.style;
  r.setProperty('--sq-light', b.light);
  r.setProperty('--sq-dark', b.dark);
  r.setProperty('--sq-accent', b.accent);
  r.setProperty('--pw-fill', p.w[0]); r.setProperty('--pw-stroke', p.w[1]);
  r.setProperty('--pb-fill', p.b[0]); r.setProperty('--pb-stroke', p.b[1]);
  r.setProperty('--glow-w', p.glow ? `drop-shadow(0 0 5px ${p.w[0]})` : 'drop-shadow(0 0 0 transparent)');
  r.setProperty('--glow-b', p.glow ? `drop-shadow(0 0 5px ${p.b[0]})` : 'drop-shadow(0 0 0 transparent)');
}

// ================= Anmeldung =================
let authMode = 'login';
$$('[data-auth]').forEach((b) => b.addEventListener('click', () => {
  authMode = b.dataset.auth;
  $$('[data-auth]').forEach((x) => x.classList.toggle('active', x === b));
  $('#auth-form [name=password]').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#auth-error').textContent = '';
  try {
    const data = await api(`/api/${authMode}`, { name: f.get('name'), password: f.get('password') });
    token = data.token;
    store.set('token', token);
    enterApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

function enterApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  connectWs();
  show('play');
}

async function boot() {
  if (token) {
    try {
      const data = await api('/api/me');
      $('#online-count').textContent = `${data.online} Spieler online`;
      return enterApp();
    } catch { token = null; store.set('token', null); }
  }
  $('#auth').classList.remove('hidden');
}

// ================= Navigation =================
let currentView = 'play';
$$('#nav [data-view]').forEach((b) => b.addEventListener('click', () => {
  if (game && !game.over && game.mode !== 'local') return toast('Beende zuerst deine Partie', true);
  show(b.dataset.view);
}));

function show(view) {
  currentView = view;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  $$('#nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ({ pass: renderPass, shop: renderShop, leaderboard: renderLeaderboard, profile: renderProfile })[view]?.();
}

// ================= Lobby =================
let selectedTc = '3+2';
let selectedLevel = 2;
let selectedColor = 'w';

$$('#tc-select button').forEach((b) => b.addEventListener('click', () => {
  selectedTc = b.dataset.tc;
  $$('#tc-select button').forEach((x) => x.classList.toggle('active', x === b));
}));
$('#ai-level').append(...AI_LEVELS.map((l) => h('button', {
  'data-level': l.id, class: l.id === selectedLevel ? 'active' : '', title: l.name,
  onclick: (e) => { selectedLevel = l.id; $$('#ai-level button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); },
}, l.name)));
$$('#ai-color button').forEach((b) => b.addEventListener('click', () => {
  selectedColor = b.dataset.color;
  $$('#ai-color button').forEach((x) => x.classList.toggle('active', x === b));
}));

let queueTimer = null;
$('#btn-queue').addEventListener('click', () => wsSend({ type: 'queue', tc: selectedTc }));
$('#btn-unqueue').addEventListener('click', () => wsSend({ type: 'unqueue' }));
$('#btn-room').addEventListener('click', () => wsSend({ type: 'create_room', tc: selectedTc }));
$('#btn-join').addEventListener('click', () => wsSend({ type: 'join_room', code: $('#join-code').value }));
$('#btn-ai').addEventListener('click', () => {
  const color = selectedColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : selectedColor;
  startGame({ mode: 'ai', color, level: selectedLevel });
});
$('#btn-local').addEventListener('click', () => startGame({ mode: 'local' }));

function setQueued(on) {
  $('#queue-info').classList.toggle('hidden', !on);
  $('#btn-queue').classList.toggle('hidden', on);
  clearInterval(queueTimer);
  if (on) {
    const start = Date.now();
    $('#queue-time').textContent = '0';
    queueTimer = setInterval(() => { $('#queue-time').textContent = Math.floor((Date.now() - start) / 1000); }, 500);
  }
}

// ================= WebSocket =================
let ws = null;
let wsRetry = 0;
function connectWs() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { wsRetry = 0; ws.send(JSON.stringify({ type: 'auth', token })); };
  ws.onmessage = (e) => onWsMessage(JSON.parse(e.data));
  ws.onclose = () => {
    setQueued(false);
    if (!token) return;
    setTimeout(connectWs, Math.min(10_000, 500 * 2 ** wsRetry++));
  };
}
function wsSend(msg) {
  if (!ws || ws.readyState !== 1) return toast('Keine Verbindung zum Server', true);
  ws.send(JSON.stringify(msg));
}

function onWsMessage(msg) {
  switch (msg.type) {
    case 'auth_ok': $('#online-count').textContent = `${msg.online} Spieler online`; break;
    case 'auth_failed': logout(); break;
    case 'queued': setQueued(true); break;
    case 'unqueued': setQueued(false); break;
    case 'queue_status': $('#online-count').textContent = `${msg.online} Spieler online · ${msg.counts[selectedTc] || 0} suchen ${selectedTc}`; break;
    case 'room_created':
      $('#room-code').textContent = msg.code;
      $('#room-code').classList.remove('hidden');
      toast(`Raum ${msg.code} erstellt – schick deinem Freund den Code!`);
      break;
    case 'game_start':
      setQueued(false);
      $('#room-code').classList.add('hidden');
      startGame({ mode: 'online', ...msg });
      break;
    case 'move': if (game?.mode === 'online' && game.id === msg.gameId) onlineMove(msg); break;
    case 'game_over': if (game?.mode === 'online' && game.id === msg.gameId) onlineGameOver(msg); break;
    case 'draw_offered': $('#draw-offer').classList.remove('hidden'); toast('Dein Gegner bietet Remis an'); break;
    case 'draw_declined': toast('Remis abgelehnt'); break;
    case 'opponent_disconnected': toast(`Gegner getrennt – ${msg.seconds}s bis zur Wertung`, true); break;
    case 'opponent_reconnected': toast('Gegner ist wieder da'); break;
    case 'chat': {
      const log = $('#chat-log');
      log.append(h('div', {}, h('b', {}, msg.from + ': '), msg.text));
      log.scrollTop = log.scrollHeight;
      break;
    }
    case 'error':
      toast(msg.message, true);
      if (msg.fen && game?.mode === 'online') { game.chess.undo(); renderBoard(); }
      break;
  }
}

// ================= Partie =================
// Figur als Element; skinVars überschreibt optional die Skin-Farben (für Vorschauen)
function pieceEl(type, color, cls = 'piece', skinVars = '') {
  const el = h('span', { class: `${cls} ${color}`, style: skinVars || null });
  el.innerHTML = pieceSvg(type, color);
  return el;
}
const skinStyle = (p) => `--pw-fill:${p.w[0]};--pw-stroke:${p.w[1]};--pb-fill:${p.b[0]};--pb-stroke:${p.b[1]};` +
  `--glow-w:${p.glow ? `drop-shadow(0 0 4px ${p.w[0]})` : 'drop-shadow(0 0 0 transparent)'};--glow-b:${p.glow ? `drop-shadow(0 0 4px ${p.b[0]})` : 'drop-shadow(0 0 0 transparent)'}`;
let game = null;
let worker = null;

function startGame(opts) {
  const chess = new Chess();
  if (opts.pgn) chess.loadPgn(opts.pgn);
  game = {
    mode: opts.mode,
    chess,
    color: opts.color || 'w',               // eigene Farbe (lokal: beide)
    orientation: opts.color || 'w',
    level: opts.level,
    id: opts.gameId,
    ranked: opts.ranked,
    tc: opts.tc,
    white: opts.white, black: opts.black,
    clocks: opts.clocks || null,
    clockRunning: opts.clockRunning,
    clockStamp: performance.now(),
    selected: null,
    lastMove: null,
    over: false,
    thinking: false,
  };
  if (game.mode === 'ai') {
    const lvl = AI_LEVELS.find((l) => l.id === game.level);
    const meP = { name: me.name, elo: me.elo };
    const ai = { name: `🤖 KI · ${lvl.name}` };
    game.white = game.color === 'w' ? meP : ai;
    game.black = game.color === 'w' ? ai : meP;
    worker?.terminate();
    worker = new Worker('/ai-worker.js', { type: 'module' });
    worker.onmessage = onAiMove;
  } else if (game.mode === 'local') {
    game.white = { name: 'Weiß' }; game.black = { name: 'Schwarz' };
  }
  const hist = chess.history({ verbose: true });
  if (hist.length) game.lastMove = hist[hist.length - 1];

  $('#chat').classList.toggle('hidden', game.mode !== 'online');
  $('#chat-log').replaceChildren();
  $('#draw-offer').classList.add('hidden');
  $('#btn-back').classList.add('hidden');
  $('#btn-resign').classList.remove('hidden');
  $('#btn-draw').classList.toggle('hidden', game.mode !== 'online');
  $('#btn-resign').classList.toggle('hidden', game.mode === 'local');
  $$('#nav button').forEach((b) => b.classList.remove('active'));
  show('game');
  renderAll();
  maybeAiMove();
}

function myTurn() {
  if (!game || game.over) return false;
  if (game.mode === 'local') return true;
  return game.chess.turn() === game.color && !game.thinking;
}

function renderAll() { renderBoard(); renderPlayers(); renderMoves(); renderStatus(); }

function renderBoard() {
  const board = $('#board');
  const chess = game.chess;
  const squares = [];
  const legal = game.selected ? chess.moves({ square: game.selected, verbose: true }) : [];
  const targets = new Map(legal.map((m) => [m.to, m]));
  let checkSq = null;
  if (chess.inCheck()) {
    for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) checkSq = p.square;
  }
  const files = 'abcdefgh';
  for (let i = 0; i < 64; i++) {
    const r = game.orientation === 'w' ? Math.floor(i / 8) : 7 - Math.floor(i / 8);
    const f = game.orientation === 'w' ? i % 8 : 7 - (i % 8);
    const sq = files[f] + (8 - r);
    const p = chess.get(sq);
    const cls = ['sq'];
    if ((r + f) % 2 === 1) cls.push('dark');
    if (game.lastMove && (game.lastMove.from === sq || game.lastMove.to === sq)) cls.push('last');
    if (game.selected === sq) cls.push('sel');
    if (targets.has(sq)) cls.push('target', p || targets.get(sq).flags.includes('e') ? 'capture' : '');
    if (checkSq === sq) cls.push('check');
    const el = h('div', { class: cls.join(' '), 'data-sq': sq });
    if (i % 8 === 0) el.append(h('span', { class: 'coord rank' }, String(8 - r)));
    if (i >= 56) el.append(h('span', { class: 'coord file' }, files[f]));
    if (p) el.append(pieceEl(p.type, p.color));
    squares.push(el);
  }
  board.replaceChildren(...squares);
}

function playerLabel(p) {
  if (!p) return '';
  return `${esc(p.name)}${p.elo ? ` <small>(${p.elo})</small>` : ''}`;
}

function renderPlayers() {
  const bottom = game.orientation;
  const top = bottom === 'w' ? 'b' : 'w';
  for (const [bar, color] of [['#bar-top', top], ['#bar-bottom', bottom]]) {
    const el = $(bar);
    $('.pname', el).innerHTML = (color === 'w' ? '♔ ' : '♚ ') + playerLabel(color === 'w' ? game.white : game.black);
    $('.clock', el).classList.toggle('hidden', !game.clocks);
  }
  renderClocks();
}

function fmtTime(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderClocks() {
  if (!game?.clocks) return;
  const c = { ...game.clocks };
  const turn = game.chess.turn();
  if (game.clockRunning && !game.over) c[turn] -= performance.now() - game.clockStamp;
  const bottom = game.orientation;
  for (const [bar, color] of [['#bar-top', bottom === 'w' ? 'b' : 'w'], ['#bar-bottom', bottom]]) {
    const el = $('.clock', $(bar));
    el.textContent = fmtTime(c[color]);
    el.classList.toggle('active', !game.over && turn === color);
    el.classList.toggle('low', c[color] < 20_000 && !game.over && turn === color);
  }
}
(function tick() { renderClocks(); requestAnimationFrame(tick); })();

function renderMoves() {
  const list = game.chess.history();
  const el = $('#moves');
  const cells = [];
  for (let i = 0; i < list.length; i += 2) {
    cells.push(h('span', { class: 'num' }, `${i / 2 + 1}.`), h('span', {}, list[i]), h('span', {}, list[i + 1] || ''));
  }
  el.replaceChildren(...cells);
  el.scrollTop = el.scrollHeight;
}

function renderStatus(text) {
  if (text) return ($('#game-status').textContent = text);
  const c = game.chess;
  const side = c.turn() === 'w' ? 'Weiß' : 'Schwarz';
  let s;
  if (game.over) s = game.overText || 'Partie beendet';
  else if (game.thinking) s = '🤖 KI denkt nach…';
  else if (game.mode === 'local') s = `${side} ist am Zug${c.inCheck() ? ' – Schach!' : ''}`;
  else s = (c.turn() === game.color ? 'Du bist am Zug' : 'Gegner ist am Zug') + (c.inCheck() ? ' – Schach!' : '');
  if (game.mode === 'online') s = `${game.ranked ? '🏆 Gewertet' : '👥 Privat'} · ${game.tc} — ${s}`;
  $('#game-status').textContent = s;
}

// ---------- Eingabe (Klicken & Ziehen) ----------
let drag = null;
$('#board').addEventListener('pointerdown', (e) => {
  if (!game) return;
  const sqEl = e.target.closest('.sq');
  if (!sqEl) return;
  const sq = sqEl.dataset.sq;
  const p = game.chess.get(sq);

  if (game.selected && game.selected !== sq) {
    const legal = game.chess.moves({ square: game.selected, verbose: true }).find((m) => m.to === sq);
    if (legal) { tryMove(game.selected, sq); return; }
  }
  if (p && myTurn() && p.color === game.chess.turn()) {
    const wasSelected = game.selected === sq;
    game.selected = sq;
    renderBoard();
    const pieceEl = $(`[data-sq="${sq}"] .piece`);
    const ghost = pieceEl.cloneNode(true);
    ghost.classList.add('dragging');
    ghost.style.width = pieceEl.getBoundingClientRect().width + 'px';
    pieceEl.style.opacity = '0.35';
    drag = { from: sq, ghost, wasSelected, startX: e.clientX, startY: e.clientY, moved: false };
    moveGhost(e);
    document.body.append(ghost);
  } else {
    game.selected = null;
    renderBoard();
  }
});

function moveGhost(e) {
  if (!drag) return;
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) drag.moved = true;
}
window.addEventListener('pointermove', moveGhost);
window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.ghost.remove();
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sq');
  const to = target?.dataset.sq;
  if (to && to !== d.from) {
    const legal = game.chess.moves({ square: d.from, verbose: true }).find((m) => m.to === to);
    if (legal) return tryMove(d.from, to);
  }
  // Klick auf bereits gewählte Figur ohne Ziehen = Auswahl aufheben
  if (!d.moved && d.wasSelected) game.selected = null;
  renderBoard();
});

async function tryMove(from, to) {
  const moves = game.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!moves.length) return;
  let promotion;
  if (moves[0].promotion) {
    promotion = await askPromotion(game.chess.turn());
    if (!promotion) { game.selected = null; return renderBoard(); }
  }
  const move = applyMove({ from, to, promotion });
  if (!move) return;
  if (game.mode === 'online') wsSend({ type: 'move', gameId: game.id, from, to, promotion });
  afterMove();
}

function askPromotion(color) {
  return new Promise((resolve) => {
    modal([
      h('h2', {}, 'Umwandlung'),
      h('div', { class: 'promo' }, ...['q', 'r', 'b', 'n'].map((t) =>
        h('button', { onclick: () => { closeModal(); resolve(t); } }, pieceEl(t, color, 'promo-piece')))),
    ], { dismissable: false });
  });
}

function applyMove(m) {
  let move;
  try { move = game.chess.move(m); } catch { return null; }
  game.lastMove = move;
  game.selected = null;
  if (game.chess.inCheck()) sfx.check();
  else if (move.captured) sfx.capture();
  else sfx.move();
  return move;
}

function afterMove() {
  renderAll();
  if (game.mode === 'online') return; // Ende meldet der Server
  const c = game.chess;
  if (c.isGameOver()) {
    let result, reason;
    if (c.isCheckmate()) { result = c.turn() === 'w' ? 'b' : 'w'; reason = 'Schachmatt'; }
    else { result = 'draw'; reason = c.isStalemate() ? 'Patt' : c.isThreefoldRepetition() ? 'Stellungswiederholung' : c.isInsufficientMaterial() ? 'Ungenügendes Material' : '50-Züge-Regel'; }
    finishLocal(result, reason);
    return;
  }
  maybeAiMove();
}

function maybeAiMove() {
  if (game.mode !== 'ai' || game.over || game.chess.turn() === game.color) return;
  const lvl = AI_LEVELS.find((l) => l.id === game.level);
  game.thinking = true;
  renderStatus();
  const started = performance.now();
  worker.postMessage({ pgn: game.chess.pgn(), depth: lvl.depth, randomness: lvl.randomness, timeMs: 3500, started });
}

function onAiMove({ data }) {
  if (!game || game.mode !== 'ai' || game.over) return;
  // Mindestens kurz "nachdenken", damit es natürlich wirkt
  setTimeout(() => {
    if (!game || game.over) return;
    game.thinking = false;
    if (data.move) applyMove(data.move);
    afterMove();
  }, 250);
}

// ---------- Online ----------
function onlineMove(msg) {
  game.clocks = msg.clocks;
  game.clockRunning = msg.clockRunning;
  game.clockStamp = performance.now();
  if (game.chess.fen() !== msg.fen) {
    const mv = applyMove(msg.san);
    if (!mv || game.chess.fen() !== msg.fen) {
      // Desync: Stellung vom Server übernehmen
      game.chess.load(msg.fen);
    }
  }
  $('#draw-offer').classList.add('hidden');
  renderAll();
}

function onlineGameOver(msg) {
  game.over = true;
  if (msg.user) setMe(msg.user);
  const mine = msg.result === game.color ? 'win' : msg.result === 'draw' ? 'draw' : msg.result === 'aborted' ? 'aborted' : 'loss';
  showResult(mine, msg.reason, msg.rewards, msg.eloChange);
}

function finishLocal(result, reason, resigned = false) {
  game.over = true;
  worker?.terminate(); worker = null;
  if (game.mode === 'local') {
    const t = result === 'draw' ? 'Remis' : result === 'w' ? 'Weiß gewinnt' : 'Schwarz gewinnt';
    return showResult(null, reason, null, null, t);
  }
  const mine = result === 'draw' ? 'draw' : result === game.color ? 'win' : 'loss';
  api('/api/ai-result', { pgn: game.chess.pgn(), level: game.level, color: game.color, resigned })
    .then((d) => showResult(mine, reason, d.rewards))
    .catch((e) => showResult(mine, reason, null, null, null, e.message));
}

function showResult(mine, reason, rewards, eloChange, titleOverride, note) {
  sfx.end();
  const titles = { win: '🏆 Sieg!', loss: '💀 Niederlage', draw: '🤝 Remis', aborted: '⏹ Abgebrochen' };
  const title = titleOverride || titles[mine];
  game.overText = `${title} – ${reason}`;
  renderStatus();
  renderClocks();
  $('#btn-back').classList.remove('hidden');
  $('#btn-resign').classList.add('hidden');
  $('#btn-draw').classList.add('hidden');
  $('#draw-offer').classList.add('hidden');

  const lines = [];
  if (eloChange != null) {
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Elo'),
      h('b', { class: eloChange >= 0 ? 'pos' : 'neg' }, `${eloChange >= 0 ? '+' : ''}${eloChange} → ${me.elo}`)));
  }
  if (rewards) {
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Battlepass-XP'), h('b', {}, `+${rewards.xp}`)));
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Münzen'), h('b', {}, `🪙 +${rewards.coins}`)));
    if (rewards.tierAfter > rewards.tierBefore) {
      lines.push(h('div', { class: 'reward-line' }, h('span', {}, '🎉 Neue Stufe!'), h('b', {}, `Stufe ${rewards.tierAfter}`)));
    }
  }
  if (note) lines.push(h('p', { class: 'muted' }, note));
  const actions = h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: closeModal }, 'Brett ansehen'),
    h('button', { class: 'btn primary', onclick: () => { closeModal(); backToLobby(); } }, 'Lobby'));
  if (game.mode === 'ai') {
    actions.append(h('button', { class: 'btn primary', onclick: () => { closeModal(); startGame({ mode: 'ai', color: game.color, level: game.level }); } }, 'Nochmal'));
  }
  modal([h('h2', {}, title), h('p', { class: 'muted' }, reason), ...lines, actions]);
}

function backToLobby() {
  worker?.terminate(); worker = null;
  game = null;
  show('play');
}

$('#btn-back').addEventListener('click', backToLobby);
$('#btn-flip').addEventListener('click', () => {
  game.orientation = game.orientation === 'w' ? 'b' : 'w';
  renderAll();
});
$('#btn-resign').addEventListener('click', () => {
  if (!game || game.over) return;
  modal([
    h('h2', {}, 'Wirklich aufgeben?'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: closeModal }, 'Nein'),
      h('button', { class: 'btn danger', onclick: () => {
        closeModal();
        if (game.mode === 'online') wsSend({ type: 'resign' });
        else finishLocal(game.color === 'w' ? 'b' : 'w', 'Aufgabe', true);
      } }, 'Aufgeben')),
  ]);
});
$('#btn-draw').addEventListener('click', () => { wsSend({ type: 'offer_draw' }); toast('Remis angeboten'); });
$('#btn-accept-draw').addEventListener('click', () => { wsSend({ type: 'offer_draw' }); $('#draw-offer').classList.add('hidden'); });
$('#btn-decline-draw').addEventListener('click', () => { wsSend({ type: 'decline_draw' }); $('#draw-offer').classList.add('hidden'); });
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#chat-input').value.trim();
  if (text) wsSend({ type: 'chat', text });
  $('#chat-input').value = '';
});

// ================= Battlepass =================
function rewardView(reward) {
  if (!reward) return [h('span', { class: 'muted' }, '—')];
  if (reward.coins) return [h('span', { class: 'icon' }, '🪙'), h('b', {}, `${reward.coins} Münzen`)];
  if (reward.board) {
    const s = BOARD_SKINS[reward.board];
    return [h('div', { class: 'mini-board' }, ...[s.light, s.dark, s.dark, s.light].map((c) => h('div', { style: `background:${c};width:22px;height:22px` }))),
      h('b', {}, s.name), h('small', { class: 'muted' }, 'Brett')];
  }
  if (reward.pieces) {
    const s = PIECE_SKINS[reward.pieces];
    return [pieceEl('q', 'w', 'icon-piece', skinStyle(s)),
      h('b', {}, s.name), h('small', { class: 'muted' }, 'Figuren')];
  }
}

function renderPass() {
  const xp = me.pass.xp;
  const tier = tierFromXp(xp);
  $('#season-name').textContent = SEASON.name;
  $('#pass-tier').textContent = tier;
  $('#pass-max').textContent = MAX_TIER;
  const into = tier >= MAX_TIER ? XP_PER_TIER : xp % XP_PER_TIER;
  $('#pass-fill').style.width = `${(into / XP_PER_TIER) * 100}%`;
  $('#pass-xp').textContent = tier >= MAX_TIER ? `Max. Stufe erreicht · ${xp} XP` : `${into} / ${XP_PER_TIER} XP bis Stufe ${tier + 1}`;
  const prem = $('#btn-premium');
  prem.textContent = me.pass.premium ? '👑 Premium aktiv' : `👑 Premium freischalten · 🪙 ${SEASON.premiumPrice}`;
  prem.disabled = me.pass.premium;
  prem.onclick = async () => {
    try { await api('/api/battlepass/premium', {}); toast('Premium-Pass aktiviert! 👑'); renderPass(); } catch (e) { toast(e.message, true); }
  };

  const track = $('#pass-track');
  track.replaceChildren(...BATTLEPASS.map((t) => {
    const reached = tier >= t.tier;
    const mk = (track, reward, claimedList, locked) => {
      const claimed = claimedList.includes(t.tier);
      const claimable = reward && reached && !claimed && !locked;
      const el = h('div', {
        class: `reward ${track === 'premium' ? 'premium' : ''} ${!reward ? 'empty' : ''} ${claimable ? 'claimable' : ''} ${claimed ? 'claimed' : ''}`,
      }, ...rewardView(reward));
      if (claimed) el.append(h('small', {}, '✔ Abgeholt'));
      else if (claimable) el.append(h('button', { class: 'btn small gold', onclick: () => claim(track, t.tier) }, 'Abholen'));
      else if (reward && locked) el.append(h('small', { class: 'muted' }, '🔒 Premium'));
      else if (reward && !reached) el.append(h('small', { class: 'muted' }, '🔒'));
      return el;
    };
    return h('div', { class: `tier ${reached ? 'reached' : ''}` },
      h('div', { class: 'tier-num' }, t.tier),
      mk('free', t.free, me.pass.claimedFree, false),
      mk('premium', t.premium, me.pass.claimedPremium, !me.pass.premium));
  }));
  // Zur aktuellen Stufe scrollen
  const cur = track.children[Math.max(0, tier - 2)];
  if (cur) track.scrollLeft = cur.offsetLeft - track.offsetLeft;
}

async function claim(track, tier) {
  try {
    const d = await api('/api/battlepass/claim', { track, tier });
    const r = d.reward;
    toast(r.coins ? `+${r.coins} Münzen!` : `Neuer Skin: ${(BOARD_SKINS[r.board] || PIECE_SKINS[r.pieces]).name}!`);
    renderPass();
  } catch (e) { toast(e.message, true); }
}

// ================= Shop =================
function renderShop() {
  const make = (type, table, previewFn) => Object.entries(table).map(([id, s]) => {
    const owned = me.owned[type].includes(id);
    const equipped = me.equipped[type] === id;
    let action;
    if (equipped) action = h('button', { class: 'btn', disabled: '' }, '✔ Ausgerüstet');
    else if (owned) action = h('button', { class: 'btn primary', onclick: () => equip(type, id) }, 'Ausrüsten');
    else if (s.bp) action = h('button', { class: 'btn', disabled: '' }, s.premium ? '👑 Premium-Pass' : '🎖️ Battlepass');
    else action = h('button', { class: 'btn gold', disabled: me.coins < s.price ? '' : null, onclick: () => buy(type, id, s) }, `🪙 ${s.price}`);
    return h('div', { class: `skin ${equipped ? 'equipped' : ''}` }, previewFn(s), h('b', {}, s.name),
      h('span', { class: 'tag' }, owned ? 'Im Besitz' : s.bp ? 'Battlepass-Belohnung' : 'Shop'), action);
  });
  const curBoard = BOARD_SKINS[me.equipped.board];
  const curPieces = PIECE_SKINS[me.equipped.pieces];
  const piecePreview = (b, p) => h('div', { class: 'preview' }, ...['r', 'q', 'k', 'n'].map((t, i) => {
    const color = i % 2 ? 'b' : 'w';
    return h('div', { style: `background:${i % 2 ? b.dark : b.light}` }, pieceEl(t, color, 'icon-piece', skinStyle(p)));
  }));
  $('#shop-board').replaceChildren(...make('board', BOARD_SKINS, (s) => piecePreview(s, curPieces)));
  $('#shop-pieces').replaceChildren(...make('pieces', PIECE_SKINS, (s) => piecePreview(curBoard, s)));
}

async function buy(type, id, s) {
  try { await api('/api/shop/buy', { type, id }); toast(`${s.name} gekauft!`); await equip(type, id); } catch (e) { toast(e.message, true); }
}
async function equip(type, id) {
  try { await api('/api/equip', { type, id }); renderShop(); } catch (e) { toast(e.message, true); }
}

// ================= Rangliste & Profil =================
async function renderLeaderboard() {
  const tbody = $('#lb-table tbody');
  tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Lädt…')));
  try {
    const { top } = await api('/api/leaderboard');
    if (!top.length) return tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Noch keine gewerteten Partien – sei der Erste!')));
    tbody.replaceChildren(...top.map((u, i) => h('tr', { class: u.name === me.name ? 'me' : '' },
      h('td', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1), h('td', {}, u.name), h('td', {}, h('b', {}, u.elo)),
      h('td', {}, rankName(u.elo)), h('td', {}, `${u.wins}/${u.draws}/${u.losses}`))));
  } catch (e) { toast(e.message, true); }
}

async function renderProfile() {
  $('#profile-name').textContent = `${me.name} · ${rankName(me.elo)}`;
  const aiWins = Object.values(me.aiStats || {}).reduce((s, x) => s + x.win, 0);
  const stat = (label, value) => h('div', { class: 'card' }, h('span', { class: 'muted' }, label), h('span', { class: 'stat' }, value));
  $('#profile-stats').replaceChildren(
    stat('Elo', me.elo), stat('Höchste Elo', me.peakElo), stat('Gewertete Partien', me.games),
    stat('Siege / Remis / Niederl.', `${me.wins}/${me.draws}/${me.losses}`), stat('KI-Siege', aiWins),
    stat('Battlepass-Stufe', tierFromXp(me.pass.xp)));
  const tbody = $('#history-table tbody');
  try {
    const { games } = await api('/api/history');
    if (!games.length) return tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Noch keine Online-Partien')));
    tbody.replaceChildren(...games.map((g) => {
      const color = g.white.id === me.id ? 'w' : 'b';
      const opp = color === 'w' ? g.black.name : g.white.name;
      const res = g.result === 'draw' ? '½' : g.result === color ? 'Sieg' : 'Niederlage';
      const d = g.elo ? g.elo[color === 'w' ? 'white' : 'black'] : null;
      return h('tr', {}, h('td', {}, opp), h('td', {}, res), h('td', {}, g.reason),
        h('td', { class: d == null ? 'muted' : d >= 0 ? 'pos' : 'neg' }, d == null ? 'privat' : `${d >= 0 ? '+' : ''}${d}`),
        h('td', {}, g.tc));
    }));
  } catch (e) { toast(e.message, true); }
}

async function logout() {
  try { await api('/api/logout', {}); } catch {}
  token = null; store.set('token', null);
  ws?.close();
  location.reload();
}
$('#btn-logout').addEventListener('click', logout);

boot();
