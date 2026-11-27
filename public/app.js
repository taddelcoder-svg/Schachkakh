import { Chess } from '/vendor/chess.js';
import { Board, pieceEl } from '/board.js';
import { FourView, FP_COLORS, COLOR_NAMES } from '/fourview.js';
import { COLORS as FP_ORDER } from '/shared/fourchess.js';
import { openingName } from '/shared/openings.js';
import {
  BOARD_SKINS, PIECE_SKINS, BATTLEPASS, SEASON, XP_PER_TIER, MAX_TIER, AI_LEVELS,
  RATING_TYPES, TIME_CONTROLS, tierFromXp, rankName, QUESTS, ACHIEVEMENTS, EMOTES, ARENA_PRIZES,
  CUSTOM_TOURNEY, RENAME_COOLDOWN_DAYS,
} from '/shared/catalog.js';

const VERSION = '1.4';
const WHATS_NEW = [
  ['🏆', 'Eigene Turniere', 'Erstelle dein eigenes Arena-Turnier: Name, Bedenkzeit, Dauer, öffentlich oder privat per Code – mit Preistopf aus deinen Münzen.'],
  ['✏️', 'Namen ändern', 'Im Profil kannst du jetzt deinen Spielernamen und dein Passwort ändern.'],
  ['🏟️', 'Arena-Turniere', 'Jede halbe Stunde: Blitz- und Bullet-Arena mit automatischen Paarungen, 🔥 Serienbonus und Münzpreisen für die Top 3.'],
  ['📋', 'Tagesaufgaben', 'Jeden Tag drei neue Aufgaben – alle geschafft gibt es einen Extra-Bonus.'],
  ['📆', 'Login-Bonus', 'Komm jeden Tag vorbei: bis zu 70 Münzen pro Tag für deine Serie.'],
  ['🏅', 'Erfolge', '25 Erfolge mit Münz-Belohnungen – zu sehen in deinem Profil.'],
  ['😂', 'Emotes', 'Reagiere in Online-Partien mit Emotes (abschaltbar in den Einstellungen).'],
];

// ======================================================================
// Hilfsfunktionen
// ======================================================================
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

let token = store.get('token');
let pendingTourneyCode = new URLSearchParams(location.search).get('turnier');
let me = null;

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Server nicht erreichbar', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
  if (data.user && data.user.id === me?.id) setMe(data.user);
  return data;
}

function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3600);
}

function modal(content, { dismissable = true, onClose } = {}) {
  const m = $('#modal');
  $('#modal-card').replaceChildren(...[].concat(content));
  m.classList.remove('hidden');
  m.onclick = (e) => { if (dismissable && e.target === m) { closeModal(); onClose?.(); } };
}
function closeModal() { $('#modal').classList.add('hidden'); }
function confirmBox(title, yes, onYes, danger = true) {
  modal([h('h2', {}, title), h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: closeModal }, 'Abbrechen'),
    h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { closeModal(); onYes(); } }, yes))]);
}

// ======================================================================
// Einstellungen & Sound
// ======================================================================
const DEFAULT_SETTINGS = { sound: true, coords: true, autoQueen: false, premoves: true, animation: true, highlight: true, confirmResign: true, emotes: true };
const settings = () => ({ ...DEFAULT_SETTINGS, ...(me?.settings || {}) });

let audio;
function beep(freq = 520, dur = 0.07, type = 'triangle', vol = 0.15) {
  if (!settings().sound) return;
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
  capture: () => beep(260, 0.1, 'square', 0.1),
  check: () => { beep(700, 0.08); setTimeout(() => beep(900, 0.08), 90); },
  start: () => { beep(392, 0.1); setTimeout(() => beep(523, 0.12), 110); },
  end: () => { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 150); setTimeout(() => beep(784, 0.25), 300); },
  good: () => { beep(660, 0.08); setTimeout(() => beep(990, 0.12), 90); },
  bad: () => beep(180, 0.2, 'sawtooth', 0.08),
  low: () => beep(880, 0.05, 'sine', 0.08),
};
function soundFor(move, chess) {
  if (chess.inCheck()) sfx.check(); else if (move?.captured) sfx.capture(); else sfx.move();
}

function applyBoardSettings(b) {
  const s = settings();
  b.showCoords = s.coords; b.animate = s.animation; b.highlightLast = s.highlight;
}

$('#btn-settings').addEventListener('click', () => {
  const s = settings();
  const items = [
    ['sound', '🔊 Sound'], ['coords', '🔤 Koordinaten anzeigen'], ['animation', '🎞 Zug-Animation'],
    ['highlight', '🟨 Letzten Zug hervorheben'], ['premoves', '⏩ Vorzüge (Premoves) online'],
    ['autoQueen', '♛ Automatisch zur Dame umwandeln'], ['confirmResign', '🏳 Aufgeben bestätigen'], ['emotes', '😂 Emotes anzeigen'],
  ];
  modal([
    h('h2', {}, '⚙️ Einstellungen'),
    h('div', { class: 'settings-list' }, ...items.map(([k, label]) => h('label', { class: 'toggle' },
      h('span', {}, label),
      h('input', { type: 'checkbox', checked: s[k], onchange: async (e) => {
        try { await api('/api/settings', { settings: { [k]: e.target.checked } }); for (const b of [mainBoard, puzzleBoard]) { applyBoardSettings(b); b.render(); } }
        catch (err) { toast(err.message, 'err'); }
      } })))),
    h('p', { class: 'muted small-note' }, 'Tipp: Rechtsklick + Ziehen zeichnet Pfeile (Umschalt = orange, Strg = blau), Rechtsklick markiert Felder. Pfeiltasten blättern durch die Züge, F dreht das Brett.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Fertig')),
  ]);
});

// ======================================================================
// Benutzer / Kopfzeile / Skins
// ======================================================================
function setMe(user) {
  me = user;
  $('#me-name').textContent = me.name;
  $('#me-elo').textContent = me.ratings.blitz.elo;
  $('#me-coins').textContent = me.coins;
  $('#me-tier').textContent = tierFromXp(me.pass.xp);
  applySkins(me.equipped.board, me.equipped.pieces);
}

function skinVars(p) {
  const t = 'drop-shadow(0 0 0 transparent)';
  return `--pw-fill:${p.w[0]};--pw-stroke:${p.w[1]};--pb-fill:${p.b[0]};--pb-stroke:${p.b[1]};` +
    `--glow-w:${p.glow ? `drop-shadow(0 0 4px ${p.w[0]})` : t};--glow-b:${p.glow ? `drop-shadow(0 0 4px ${p.b[0]})` : t}`;
}
function applySkins(boardId, piecesId) {
  const b = BOARD_SKINS[boardId] || BOARD_SKINS.classic;
  const p = PIECE_SKINS[piecesId] || PIECE_SKINS.standard;
  const r = document.documentElement.style;
  r.setProperty('--sq-light', b.light);
  r.setProperty('--sq-dark', b.dark);
  r.setProperty('--sq-accent', b.accent);
  for (const part of skinVars(p).split(';')) { const [k, v] = part.split(/:(.+)/); r.setProperty(k, v); }
}

// ======================================================================
// Start & Anmeldung – angemeldet bleiben
// ======================================================================
function showScreen(id) {
  for (const s of ['boot', 'auth', 'app']) $('#' + s).classList.toggle('hidden', s !== id);
}

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
  const btn = $('#auth-form button[type=submit]');
  btn.disabled = true;
  try {
    const data = await api(`/api/${authMode}`, { name: f.get('name'), password: f.get('password') });
    token = data.token;
    store.set('token', token);
    me = data.user;
    setMe(data.user);
    enterApp();
    // Login-Bonus gibt es beim ersten Laden des Profils
    api('/api/me').then((d) => afterLoginPopups(d.loginBonus)).catch(() => {});
  } catch (err) {
    $('#auth-error').textContent = err.status === 0 ? 'Server nicht erreichbar – versuch es gleich nochmal.' : err.message;
  } finally { btn.disabled = false; }
});

function enterApp() {
  showScreen('app');
  connectWs();
  show('play');
  loadDailyTeaser();
}

function afterLoginPopups(bonus) {
  const showNews = () => {
    if (store.get('seenVersion') === VERSION) return;
    store.set('seenVersion', VERSION);
    modal([h('h2', {}, `✨ Neu in Version ${VERSION}`),
      h('div', { class: 'news-list' }, ...WHATS_NEW.map(([icon, title, text]) => h('div', { class: 'news-item' }, h('span', { class: 'news-icon' }, icon), h('div', {}, h('b', {}, title), h('p', { class: 'muted' }, text))))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Los geht’s!'))]);
  };
  if (bonus) {
    sfx.good();
    modal([h('h2', {}, '📆 Tagesbonus'), h('p', { class: 'stat' }, `🪙 +${bonus.coins}`),
      h('p', { class: 'muted' }, `${bonus.streak} ${bonus.streak === 1 ? 'Tag' : 'Tage'} in Folge. Komm morgen wieder für mehr!`),
      h('div', { class: 'streak-row' }, ...[1, 2, 3, 4, 5, 6, 7].map((d) => h('span', { class: `streak-day ${d <= Math.min(bonus.streak, 7) ? 'on' : ''}` }, `${d * 10}`))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { closeModal(); showNews(); } }, 'Danke!'))], { onClose: showNews });
  } else showNews();
}

async function boot() {
  if (!token) return showScreen('auth');
  // Der Server (Render) braucht nach einer Pause manchmal bis zu einer Minute zum Aufwachen.
  // Solange er nicht antwortet, bleibt der Login erhalten – abgemeldet wird nur bei "401".
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await api('/api/me');
      me = data.user;
      setMe(data.user);
      enterApp();
      afterLoginPopups(data.loginBonus);
      return;
    } catch (err) {
      if (err.status === 401) { token = null; store.set('token', null); return showScreen('auth'); }
      $('#boot-text').innerHTML = attempt < 2 ? '<span class="spinner"></span> Verbinde…'
        : '<span class="spinner"></span> Server wacht auf… das kann bis zu einer Minute dauern.';
      await sleep(Math.min(5000, 1000 + attempt * 700));
    }
  }
}

async function logout() {
  try { await api('/api/logout', {}); } catch {}
  token = null; store.set('token', null);
  ws?.close();
  location.reload();
}
$('#btn-logout').addEventListener('click', () => confirmBox('Wirklich abmelden?', 'Abmelden', logout, false));

// ======================================================================
// Navigation
// ======================================================================
let currentView = 'play';
$$('#nav [data-view]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.view)));

function inActiveGame() {
  return (G && !G.over && (G.mode === 'online')) || (FP && !FP.over && FP.me && FP.alive);
}

function navigate(view, after) {
  if (inActiveGame()) return toast('Beende zuerst deine laufende Partie', 'err');
  const leave = () => {
    stopAi();
    if (G?.mode === 'spectate' || FP?.spectator) wsSend({ type: 'unwatch' });
    if (rush.active) endRush(true);
    show(view);
    after?.();
  };
  if (G && !G.over && G.mode === 'ai' && G.chess.history().length > 1 && currentView === 'game') {
    return confirmBox('Partie gegen den Computer verlassen?', 'Verlassen', () => { G = null; leave(); });
  }
  leave();
}

function show(view) {
  currentView = view;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  $$('#nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  clearInterval(liveTimer);
  ({
    pass: renderPass, shop: renderShop, leaderboard: renderLeaderboard, profile: () => renderProfile(me.name),
    watch: renderWatch, friends: renderFriends, puzzles: () => startPuzzleMode(puzzleMode),
    tournaments: renderTournaments, play: renderLobbyExtras,
  })[view]?.();
  window.scrollTo(0, 0);
}

// ======================================================================
// Lobby
// ======================================================================
let selectedTc = store.get('tc') || '3+2';
let selectedLevel = Number(store.get('aiLevel') || 3);
let selectedColor = 'w';
let selectedFpTc = '3+2';

const TC_LABEL = { '1+0': '1 min', '2+1': '2 | 1', '3+0': '3 min', '3+2': '3 | 2', '5+0': '5 min', '10+0': '10 min', '15+10': '15 | 10' };
const TYPE_INFO = Object.fromEntries(RATING_TYPES.map((t) => [t.id, t]));
$('#tc-select').append(...Object.entries(TIME_CONTROLS).map(([tc, t]) => h('button', {
  class: tc === selectedTc ? 'active' : '', 'data-tc': tc,
  onclick: (e) => { selectedTc = tc; store.set('tc', tc); $$('#tc-select button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); updateQueueButton(); },
}, h('span', { class: 'tc-icon' }, TYPE_INFO[t.type].icon), h('b', {}, TC_LABEL[tc]), h('small', {}, TYPE_INFO[t.type].name))));
function updateQueueButton() {
  const type = TIME_CONTROLS[selectedTc].type;
  $('#btn-queue').textContent = `Gegner suchen · ${TYPE_INFO[type].name} (${me ? me.ratings[type].elo : ''})`;
}

$('#ai-level').append(...AI_LEVELS.map((l) => h('button', {
  class: l.id === selectedLevel ? 'active' : '', 'data-level': l.id,
  onclick: (e) => { selectedLevel = l.id; store.set('aiLevel', l.id); $$('#ai-level button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); },
}, h('span', { class: 'bot-avatar' }, l.avatar), h('b', {}, l.name), h('small', {}, `${l.elo}`))));
$$('#ai-color button').forEach((b) => b.addEventListener('click', () => {
  selectedColor = b.dataset.color;
  $$('#ai-color button').forEach((x) => x.classList.toggle('active', x === b));
}));
$$('#fp-tc button').forEach((b) => b.addEventListener('click', () => {
  selectedFpTc = b.dataset.tc;
  $$('#fp-tc button').forEach((x) => x.classList.toggle('active', x === b));
}));

let queueTimer = null;
$('#btn-queue').addEventListener('click', () => wsSend({ type: 'queue', tc: selectedTc }));
$('#btn-fp-queue').addEventListener('click', () => wsSend({ type: 'queue_4p', tc: selectedFpTc }));
$('#btn-fp-bots').addEventListener('click', () => wsSend({ type: 'play_bots_4p', tc: selectedFpTc }));
$('#btn-fp-room').addEventListener('click', () => wsSend({ type: 'create_room', kind: '4p', tc: selectedFpTc }));
$('#btn-unqueue').addEventListener('click', () => wsSend({ type: 'unqueue' }));
$('#btn-room').addEventListener('click', () => wsSend({ type: 'create_room', kind: '2p', tc: selectedTc }));
$('#btn-join').addEventListener('click', () => wsSend({ type: 'join_room', code: $('#join-code').value }));
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
$('#btn-ai').addEventListener('click', () => {
  const color = selectedColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : selectedColor;
  startLocalGame({ mode: 'ai', color, level: selectedLevel });
});
$('#btn-local').addEventListener('click', () => startLocalGame({ mode: 'local' }));
$('#btn-daily-go').addEventListener('click', () => { puzzleMode = 'daily'; navigate('puzzles'); });

function setQueued(on, text) {
  $('#queue-info').classList.toggle('hidden', !on);
  $('#btn-queue').classList.toggle('hidden', on);
  $('#btn-fp-queue').disabled = on;
  clearInterval(queueTimer);
  if (on) {
    $('#queue-text').textContent = text || 'Suche läuft…';
    const start = Date.now();
    $('#queue-time').textContent = '0';
    queueTimer = setInterval(() => { $('#queue-time').textContent = Math.floor((Date.now() - start) / 1000); }, 500);
  }
}

function renderRoom(msg) {
  const box = $('#room-box');
  if (!msg) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const isHost = msg.hostId === me.id;
  const parts = [
    h('div', { class: 'room-code' }, msg.code),
    h('p', { class: 'muted' }, msg.kind === '4p' ? `4-Spieler-Raum · ${msg.tc} · ${msg.members.length}/4 – leere Plätze übernehmen Bots` : `Partie ${msg.tc} · warte auf deinen Freund…`),
  ];
  if (msg.kind === '4p') parts.push(h('div', { class: 'room-members' }, ...msg.members.map((m) => h('span', { class: 'chip' }, m.name))));
  const actions = h('div', { class: 'row' });
  if (isHost && msg.kind === '4p') actions.append(h('button', { class: 'btn primary', onclick: () => wsSend({ type: 'start_room' }) }, 'Starten'));
  actions.append(h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(msg.code); toast('Code kopiert'); } }, '📋 Kopieren'));
  actions.append(h('button', { class: 'btn', onclick: () => { wsSend({ type: 'cancel_room' }); renderRoom(null); } }, isHost ? 'Schließen' : 'Verlassen'));
  parts.push(actions);
  box.replaceChildren(...parts);
  if (currentView !== 'play' && !inActiveGame()) show('play');
}

async function loadDailyTeaser() {
  try {
    const d = await api('/api/puzzle/daily');
    $('#daily-teaser').classList.toggle('hidden', d.solved);
  } catch {}
}

// ======================================================================
// WebSocket
// ======================================================================
let ws = null;
let wsRetry = 0;
let wsTimer = null;
function connectWs() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { wsRetry = 0; ws.send(JSON.stringify({ type: 'auth', token })); $('#conn-banner').classList.add('hidden'); };
  ws.onmessage = (e) => { try { onWsMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    setQueued(false);
    if (!token) return;
    $('#conn-banner').classList.remove('hidden');
    clearTimeout(wsTimer);
    wsTimer = setTimeout(connectWs, Math.min(8000, 500 * 2 ** wsRetry++));
  };
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && token && (!ws || ws.readyState > 1)) connectWs(); });
function wsSend(msg) {
  if (!ws || ws.readyState !== 1) { toast('Keine Verbindung zum Server', 'err'); return false; }
  ws.send(JSON.stringify(msg));
  return true;
}

function onWsMessage(msg) {
  switch (msg.type) {
    case 'auth_ok': $('#online-count').textContent = `${msg.online} Spieler online`; updateQueueButton(); renderLobbyExtras(); if (currentView === 'tournaments' && TOUR.selected) wsSendQuiet({ type: 'tournament_watch', id: TOUR.selected });
      if (pendingTourneyCode) { wsSendQuiet({ type: 'tournament_code', code: pendingTourneyCode }); pendingTourneyCode = null; history.replaceState(null, '', location.pathname); }
      break;
    case 'auth_failed': token = null; store.set('token', null); location.reload(); break;
    case 'queued':
      setQueued(true, msg.kind === '4p' ? `Suche 4-Spieler-Partie (Bots ab ${msg.botFillSeconds}s)…` : `Suche Gegner (${msg.tc})…`);
      break;
    case 'unqueued': setQueued(false); break;
    case 'queue_status':
      $('#online-count').textContent = `${msg.online} Spieler online · ${msg.live} Partien live`;
      break;
    case 'room_created': toast(`Raum ${msg.code} erstellt – schick deinem Freund den Code!`); break;
    case 'room_update': renderRoom(msg); break;
    case 'room_closed': renderRoom(null); toast('Raum wurde geschlossen'); break;
    case 'game_start':
      setQueued(false); renderRoom(null); closeModal();
      startOnlineGame(msg);
      break;
    case 'resync': if (G && G.id === msg.gameId) resyncGame(msg); break;
    case 'move': if (G && G.id === msg.gameId) onlineMove(msg); break;
    case 'game_over': if (G && G.id === msg.gameId) onlineGameOver(msg); break;
    case 'draw_offered': showOffer('½ Dein Gegner bietet Remis an.', () => wsSend({ type: 'offer_draw' }), () => wsSend({ type: 'decline_draw' })); break;
    case 'draw_declined': toast('Remis abgelehnt'); break;
    case 'takeback_requested': showOffer('↩ Dein Gegner möchte einen Zug zurücknehmen.', () => wsSend({ type: 'takeback_accept' }), () => wsSend({ type: 'takeback_decline' })); break;
    case 'takeback_declined': toast('Zurücknahme abgelehnt'); break;
    case 'rematch_offered':
      if (G && G.id === msg.gameId) {
        const accept = () => wsSend({ type: 'rematch', gameId: G.id });
        showOffer(`🔁 ${msg.name} möchte eine Revanche.`, accept, () => {});
        // Falls das Ergebnis-Fenster offen ist, dort ebenfalls anbieten
        const card = $('#modal-card');
        if (!$('#modal').classList.contains('hidden') && !card.querySelector('.rematch-box')) {
          card.prepend(h('div', { class: 'reward-line glow rematch-box' }, h('span', {}, `🔁 ${msg.name} will Revanche!`),
            h('button', { class: 'btn small primary', onclick: () => { closeModal(); $('#offer').classList.add('hidden'); accept(); } }, 'Annehmen')));
        }
      }
      else toast(`${msg.name} möchte eine Revanche`);
      break;
    case 'rematch_sent': toast('Revanche angefragt…'); break;
    case 'opponent_disconnected': toast(`Gegner getrennt – ${msg.seconds}s bis zur Wertung`, 'err'); break;
    case 'opponent_reconnected': toast('Gegner ist wieder da'); break;
    case 'chat': addChat(msg); break;
    case 'challenge': showChallenge(msg); break;
    case 'challenge_sent': toast(`Herausforderung an ${msg.to} gesendet`); break;
    case 'challenge_declined': toast(`${msg.name} hat abgelehnt`, 'err'); break;
    case 'challenge_expired': if ($('#modal-card [data-challenge]')?.dataset.challenge === msg.id) closeModal(); break;
    case 'live_games': renderLiveList(msg.games); break;
    case 'fp_start': setQueued(false); renderRoom(null); closeModal(); startFour(msg); break;
    case 'fp_update': if (FP && FP.id === msg.gameId) updateFour(msg); break;
    case 'fp_over': if (FP && FP.id === msg.gameId) fourOver(msg); break;
    case 'fp_left': if (FP) { FP.alive = false; renderFourControls(); } break;
    case 'notify': for (const n of msg.notes) showNote(n); renderLobbyExtras(); break;
    case 'tournaments': renderTournamentList(msg); break;
    case 'tournament': onTournamentState(msg.t); break;
    case 'tournament_result': onTournamentResult(msg); break;
    case 'tournament_created':
      toast(`🏆 Turnier erstellt · Code ${msg.code}`);
      refreshMe();
      wsSendQuiet({ type: 'tournaments' });
      openTournament(msg.id);
      break;
    case 'tournament_found': openTournament(msg.id); break;
    case 'tournament_cancelled':
      if (TOUR.selected === msg.id) { toast('🏟️ Dieses Turnier wurde abgesagt'); TOUR.selected = null; TOUR.states.delete(msg.id); $('#tourney-detail').replaceChildren(h('p', { class: 'muted' }, 'Das Turnier wurde abgesagt.')); }
      wsSendQuiet({ type: 'tournaments' });
      refreshMe();
      break;
    case 'toast': toast(msg.message); break;
    case 'user_update': refreshMe(); break;
    case 'emote': showEmote(msg); break;
    case 'error':
      toast(msg.message, 'err');
      break;
  }
}

function addChat(msg) {
  for (const id of ['#chat-log', '#fp-chat-log']) {
    const log = $(id);
    log.append(h('div', {}, h('b', {}, msg.from + ': '), msg.text));
    log.scrollTop = log.scrollHeight;
  }
}
for (const [form, input] of [['#chat-form', '#chat-input'], ['#fp-chat-form', '#fp-chat-input']]) {
  $(form).addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $(input).value.trim();
    if (text) wsSend({ type: 'chat', text });
    $(input).value = '';
  });
}

function showOffer(text, onAccept, onDecline) {
  const box = $('#offer');
  box.classList.remove('hidden');
  box.replaceChildren(h('span', {}, text),
    h('div', { class: 'row' },
      h('button', { class: 'btn small primary', onclick: () => { box.classList.add('hidden'); onAccept(); } }, 'Annehmen'),
      h('button', { class: 'btn small', onclick: () => { box.classList.add('hidden'); onDecline(); } }, 'Ablehnen')));
}

function showChallenge(msg) {
  sfx.start();
  modal([
    h('div', { 'data-challenge': msg.id }),
    h('h2', {}, '⚔️ Herausforderung!'),
    h('p', {}, h('b', {}, msg.from.name), ` (${msg.from.elo}) fordert dich heraus: ${TC_LABEL[msg.tc]} · ${msg.rated ? 'gewertet' : 'ungewertet'}`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { closeModal(); wsSend({ type: 'challenge_decline', id: msg.id }); } }, 'Ablehnen'),
      h('button', { class: 'btn primary', onclick: () => { closeModal(); wsSend({ type: 'challenge_accept', id: msg.id }); } }, 'Annehmen')),
  ], { dismissable: false });
}

// ======================================================================
// 2-Spieler-Partie
// ======================================================================
let G = null;
let aiWorker = null;
let aiReqId = 0;
const pendingAi = new Map();

function aiRequest(payload) {
  if (!aiWorker) {
    aiWorker = new Worker('/ai-worker.js', { type: 'module' });
    aiWorker.onmessage = ({ data }) => { const cb = pendingAi.get(data.id); pendingAi.delete(data.id); cb?.(data); };
  }
  const id = ++aiReqId;
  return new Promise((resolve) => { pendingAi.set(id, resolve); aiWorker.postMessage({ ...payload, id }); });
}
function stopAi() { aiWorker?.terminate(); aiWorker = null; pendingAi.clear(); if (G) G.thinking = false; }

const mainBoard = new Board($('#board'), {
  canMove: (turn) => {
    if (!G || G.over || !atLatest() || G.thinking || G.analysis) return false;
    if (G.mode === 'local') return true;
    return (G.mode === 'ai' || G.mode === 'online') && turn === G.color;
  },
  canPremove: () => {
    if (!G || G.over || G.mode !== 'online' || !atLatest() || !settings().premoves) return null;
    return G.chess.turn() !== G.color ? G.color : null;
  },
  onMove: (from, to) => userMove(from, to),
  onPremove: (pm) => { if (pm) toast('Vorzug gespeichert'); },
});

function newGameState(opts) {
  return {
    mode: opts.mode, chess: new Chess(), color: opts.color || 'w', level: opts.level,
    id: opts.gameId || null, ranked: !!opts.ranked, tc: opts.tc || null, ratingType: opts.ratingType || null,
    white: opts.white, black: opts.black,
    clocks: opts.clocks || null, clockRunning: !!opts.clockRunning, clockStamp: performance.now(),
    view: 0, over: false, overText: '', thinking: false, evals: null, analysis: false, spectator: !!opts.spectator,
    hintsUsed: 0, takebacks: 0,
  };
}

function enterGameView() {
  $('#chat').classList.toggle('hidden', !(G.mode === 'online' || G.mode === 'spectate'));
  $('#chat-log').replaceChildren();
  $('#offer').classList.add('hidden');
  $('#review-summary').classList.add('hidden');
  $('#eval-wrap').classList.add('hidden');
  mainBoard.hint = null;
  mainBoard.extraClasses.clear();
  mainBoard.premove = null;
  applyBoardSettings(mainBoard);
  mainBoard.orientation = G.color || 'w';
  $('#emote-bar').classList.toggle('hidden', !(G.mode === 'online' || G.mode === 'spectate') || !settings().emotes);
  show('game');
  renderControls();
}

function startLocalGame(opts) {
  stopAi();
  G = newGameState(opts);
  if (G.mode === 'ai') {
    const lvl = AI_LEVELS.find((l) => l.id === G.level);
    const meP = { name: me.name, elo: me.ratings.blitz.elo };
    const ai = { name: `${lvl.avatar} ${lvl.name}`, elo: lvl.elo };
    G.white = G.color === 'w' ? meP : ai;
    G.black = G.color === 'w' ? ai : meP;
  } else {
    G.white = { name: 'Weiß' }; G.black = { name: 'Schwarz' };
    G.color = 'w';
  }
  enterGameView();
  sfx.start();
  refresh(false);
  maybeAiMove();
}

let resultTimer = null;
function startOnlineGame(msg) {
  clearInterval(resultTimer);
  stopAi();
  G = newGameState({ ...msg, mode: msg.spectator ? 'spectate' : 'online', color: msg.color || 'w' });
  if (msg.pgn) G.chess.loadPgn(msg.pgn);
  G.view = G.chess.history().length;
  G.over = !!msg.over;
  enterGameView();
  if (!msg.spectator && G.view === 0) sfx.start();
  refresh(false);
  G.tournamentId = msg.tournamentId || null;
  G.tournamentName = msg.tournamentName || null;
  if (G.mode === 'online') toast(`${G.tournamentId ? '🏟️ ' + G.tournamentName : msg.ranked ? 'Gewertete Partie' : 'Private Partie'} · ${TC_LABEL[msg.tc]} – du spielst ${G.color === 'w' ? 'Weiß' : 'Schwarz'}`);
}

function resyncGame(msg) {
  G.chess = new Chess();
  if (msg.pgn) G.chess.loadPgn(msg.pgn);
  G.view = G.chess.history().length;
  G.clocks = msg.clocks; G.clockRunning = msg.clockRunning; G.clockStamp = performance.now();
  mainBoard.premove = null;
  if (msg.message) toast(msg.message);
  refresh(false);
}

const atLatest = () => G && G.view === G.chess.history().length;

// Stellung nach "view" Halbzügen
function positionAt(ply) {
  if (ply === G.chess.history().length) return G.chess;
  const c = new Chess();
  const hist = G.chess.history({ verbose: true });
  for (let i = 0; i < ply; i++) c.move(hist[i].san);
  return c;
}

function refresh(animate = true) {
  if (!G) return;
  const hist = G.chess.history({ verbose: true });
  const pos = positionAt(G.view);
  mainBoard.hint = G.analysis && G.evals?.[G.view]?.best ? { from: G.evals[G.view].best.from, to: G.evals[G.view].best.to } : (G.hintMove && atLatest() ? G.hintMove : null);
  mainBoard.extraClasses.clear();
  if (G.analysis && G.evals && G.view > 0 && G.evals[G.view]?.cls) mainBoard.extraClasses.set(hist[G.view - 1].to, 'cls-' + G.evals[G.view].cls.key);
  mainBoard.setChess(pos, { lastMove: G.view ? hist[G.view - 1] : null, animate });
  renderPlayers(pos);
  renderMoves(hist);
  renderStatus();
  renderEval();
  $('#opening').textContent = openingName(G.chess.history().slice(0, Math.max(G.view, 1))) || '';
}

function renderPlayers(pos) {
  const bottom = mainBoard.orientation;
  const top = bottom === 'w' ? 'b' : 'w';
  const capt = capturedPieces(pos);
  for (const [bar, color] of [['#bar-top', top], ['#bar-bottom', bottom]]) {
    const el = $(bar);
    const p = color === 'w' ? G.white : G.black;
    $('.pname', el).replaceChildren(h('span', { class: `color-dot ${color}` }), ' ', p?.name || '', p?.elo ? h('small', {}, ` (${p.elo})`) : '');
    const box = $('.captured', el);
    box.replaceChildren(...capt[color].map((t) => pieceEl(t, color === 'w' ? 'b' : 'w', 'cap-piece')));
    if (capt.diff[color] > 0) box.append(h('small', { class: 'diff' }, `+${capt.diff[color]}`));
    $('.clock', el).classList.toggle('hidden', !G.clocks);
  }
  renderClocks();
}

const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function capturedPieces(pos) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of pos.board()) for (const p of row) if (p && p.type !== 'k') count[p.color][p.type]++;
  const out = { w: [], b: [], diff: { w: 0, b: 0 } };
  let mat = { w: 0, b: 0 };
  for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q']) mat[c] += count[c][t] * PVAL[t];
  // Was Weiß geschlagen hat = fehlende schwarze Figuren
  for (const t of ['p', 'n', 'b', 'r', 'q']) {
    for (let i = count.b[t]; i < START_COUNT[t]; i++) out.w.push(t);
    for (let i = count.w[t]; i < START_COUNT[t]; i++) out.b.push(t);
  }
  out.diff.w = mat.w - mat.b; out.diff.b = mat.b - mat.w;
  return out;
}

function fmtTime(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let lowWarned = false;
function renderClocks() {
  if (!G?.clocks) return;
  const c = { ...G.clocks };
  const turn = G.chess.turn();
  if (G.clockRunning && !G.over) c[turn] -= performance.now() - G.clockStamp;
  const bottom = mainBoard.orientation;
  for (const [bar, color] of [['#bar-top', bottom === 'w' ? 'b' : 'w'], ['#bar-bottom', bottom]]) {
    const el = $('.clock', $(bar));
    el.textContent = fmtTime(c[color]);
    el.classList.toggle('active', !G.over && turn === color);
    el.classList.toggle('low', c[color] < 20_000 && !G.over && turn === color);
  }
  if (G.mode === 'online' && !G.over && turn === G.color && c[turn] < 10_000 && !lowWarned) { lowWarned = true; sfx.low(); }
  if (turn !== G.color) lowWarned = false;
}

function renderMoves(hist) {
  const el = $('#moves');
  const cells = [];
  for (let i = 0; i < hist.length; i += 2) {
    cells.push(h('span', { class: 'num' }, `${i / 2 + 1}.`));
    for (const j of [i, i + 1]) {
      if (j >= hist.length) { cells.push(h('span', {})); continue; }
      const cls = G.evals?.[j + 1]?.cls;
      cells.push(h('span', {
        class: `mv ${G.view === j + 1 ? 'cur' : ''} ${cls ? 'cls-' + cls.key : ''}`, 'data-ply': j + 1,
        title: cls ? cls.name : null, onclick: () => goto(j + 1),
      }, hist[j].san, cls?.sym ? h('sup', {}, cls.sym) : null));
    }
  }
  el.replaceChildren(...cells);
  const cur = el.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' }); else el.scrollTop = el.scrollHeight;
}

function goto(ply) {
  if (!G) return;
  const n = G.chess.history().length;
  ply = Math.max(0, Math.min(n, ply));
  const forward = ply === G.view + 1;
  G.view = ply;
  refresh(forward);
  if (forward) { const pos = positionAt(ply); soundFor(G.chess.history({ verbose: true })[ply - 1], pos); }
}

$$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
  if (!G) return;
  const n = G.chess.history().length;
  goto({ first: 0, prev: G.view - 1, next: G.view + 1, last: n }[b.dataset.nav]);
}));
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (currentView === 'game' && G) {
    if (e.key === 'ArrowLeft') { goto(G.view - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goto(G.view + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { goto(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { goto(G.chess.history().length); e.preventDefault(); }
    else if (e.key === 'f' || e.key === 'F') $('#btn-flip').click();
  }
});

function renderStatus() {
  const c = G.chess;
  const side = c.turn() === 'w' ? 'Weiß' : 'Schwarz';
  let s;
  if (G.analysis) s = G.analysisProgress != null && G.analysisProgress < 1 ? `🔍 Analysiere… ${Math.round(G.analysisProgress * 100)}%` : '🔍 Partie-Analyse';
  else if (G.over) s = G.overText || 'Partie beendet';
  else if (G.thinking) s = '🤖 Computer denkt nach…';
  else if (G.mode === 'local') s = `${side} ist am Zug${c.inCheck() ? ' – Schach!' : ''}`;
  else if (G.mode === 'spectate') s = `📺 Zuschauen · ${side} ist am Zug`;
  else s = (c.turn() === G.color ? 'Du bist am Zug' : 'Gegner ist am Zug') + (c.inCheck() ? ' – Schach!' : '');
  if (G.mode === 'online' && !G.over) s = `${G.tournamentId ? '🏟️' : G.ranked ? '🏆' : '👥'} ${TC_LABEL[G.tc]} — ${s}`;
  $('#game-status').textContent = s;
}

function renderControls() {
  const live = G && !G.over && !G.analysis;
  const m = G?.mode;
  $('#game-controls').classList.toggle('hidden', !live || m === 'spectate');
  $('#post-controls').classList.toggle('hidden', live && m !== 'spectate');
  $('#btn-hint').classList.toggle('hidden', m !== 'ai');
  $('#btn-takeback').classList.toggle('hidden', !(m === 'ai' || m === 'local' || m === 'online'));
  $('#btn-draw').classList.toggle('hidden', m !== 'online');
  $('#btn-resign').classList.toggle('hidden', m === 'local');
  $('#btn-resign').textContent = m === 'online' && G.chess.history().length < 2 ? '✖ Abbrechen' : '🏳 Aufgeben';
  $('#btn-rematch').classList.toggle('hidden', !(m === 'online' || m === 'ai') || !!G?.tournamentId);
  $('#btn-rematch').textContent = m === 'ai' ? '🔁 Nochmal' : '🔁 Revanche';
  $('#btn-analyze').classList.toggle('hidden', !!G?.analysis || G?.chess.history().length < 2);
}

// ---------- Züge ----------
async function userMove(from, to) {
  const moves = G.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!moves.length) return;
  let promotion;
  if (moves[0].promotion) {
    promotion = settings().autoQueen ? 'q' : await askPromotion(G.chess.turn());
    if (!promotion) return refresh(false);
  }
  const move = playMove({ from, to, promotion });
  if (!move) return;
  if (G.mode === 'online') wsSend({ type: 'move', gameId: G.id, from, to, promotion });
  afterMove();
}

function playMove(m) {
  let move;
  try { move = G.chess.move(m); } catch { return null; }
  G.view = G.chess.history().length;
  G.hintMove = null;
  soundFor(move, G.chess);
  refresh(true);
  renderControls();
  return move;
}

function askPromotion(color) {
  return new Promise((resolve) => {
    modal([
      h('h2', {}, 'Umwandlung'),
      h('div', { class: 'promo' }, ...['q', 'r', 'b', 'n'].map((t) =>
        h('button', { onclick: () => { closeModal(); resolve(t); } }, pieceEl(t, color, 'promo-piece')))),
    ], { dismissable: true, onClose: () => resolve(null) });
  });
}

function afterMove() {
  if (G.mode === 'online' || G.mode === 'spectate') return;
  const c = G.chess;
  if (c.isGameOver()) {
    let result, reason;
    if (c.isCheckmate()) { result = c.turn() === 'w' ? 'b' : 'w'; reason = 'Schachmatt'; }
    else { result = 'draw'; reason = c.isStalemate() ? 'Patt' : c.isThreefoldRepetition() ? 'Stellungswiederholung' : c.isInsufficientMaterial() ? 'Ungenügendes Material' : '50-Züge-Regel'; }
    finishLocal(result, reason);
    return;
  }
  maybeAiMove();
}

async function maybeAiMove() {
  if (!G || G.mode !== 'ai' || G.over || G.chess.turn() === G.color) return;
  const lvl = AI_LEVELS.find((l) => l.id === G.level);
  const game = G;
  G.thinking = true;
  renderStatus();
  const started = performance.now();
  const res = await aiRequest({ pgn: G.chess.pgn(), depth: lvl.depth, randomness: lvl.randomness, timeMs: lvl.depth >= 5 ? 4000 : 2500 });
  const wait = 300 + Math.random() * 400 - (performance.now() - started);
  if (wait > 0) await sleep(wait);
  if (G !== game || G.over || !G.thinking) return;
  G.thinking = false;
  if (res.move) playMove(res.move);
  afterMove();
}

// ---------- Online ----------
function onlineMove(msg) {
  G.clocks = msg.clocks;
  G.clockRunning = msg.clockRunning;
  G.clockStamp = performance.now();
  const follow = atLatest();
  if (G.chess.fen() !== msg.fen) {
    let mv = null;
    try { mv = G.chess.move(msg.san); } catch {}
    if (!mv || G.chess.fen() !== msg.fen) { wsSend({ type: 'sync' }); return; }
    if (follow) G.view = G.chess.history().length;
    if (mv) soundFor(mv, G.chess);
    $('#offer').classList.add('hidden');
    refresh(follow);
    renderControls();
    // Vorzug ausführen
    const pm = mainBoard.premove;
    mainBoard.premove = null;
    if (pm && G.mode === 'online' && G.chess.turn() === G.color) {
      const legal = G.chess.moves({ square: pm.from, verbose: true }).find((m) => m.to === pm.to);
      if (legal) {
        const promotion = legal.promotion ? 'q' : undefined;
        if (playMove({ from: pm.from, to: pm.to, promotion })) wsSend({ type: 'move', gameId: G.id, from: pm.from, to: pm.to, promotion });
      } else refresh(false);
    }
  } else {
    renderClocks();
  }
}

function onlineGameOver(msg) {
  G.over = true;
  G.view = G.chess.history().length;
  mainBoard.premove = null;
  if (msg.user) setMe(msg.user);
  if (msg.spectator) {
    G.overText = msg.result === 'draw' ? `½–½ · ${msg.reason}` : `${msg.result === 'w' ? 'Weiß' : 'Schwarz'} gewinnt · ${msg.reason}`;
    refresh(false); renderControls(); sfx.end();
    return;
  }
  const mine = msg.result === G.color ? 'win' : msg.result === 'draw' ? 'draw' : msg.result === 'aborted' ? 'aborted' : 'loss';
  showResult(mine, msg.reason, msg.rewards, msg.eloChange, null, null, msg.newElo, msg.tournament);
}

function finishLocal(result, reason, resigned = false) {
  G.over = true;
  G.thinking = false;
  if (G.mode === 'local') {
    const t = result === 'draw' ? '🤝 Remis' : result === 'w' ? '♔ Weiß gewinnt' : '♚ Schwarz gewinnt';
    return showResult(null, reason, null, null, t);
  }
  const mine = result === 'draw' ? 'draw' : result === G.color ? 'win' : 'loss';
  const assisted = G.hintsUsed + G.takebacks > 0;
  api('/api/ai-result', { pgn: G.chess.pgn(), level: G.level, color: G.color, resigned })
    .then((d) => showResult(mine, reason, d.rewards, null, null, assisted ? `Mit ${G.hintsUsed} Tipps und ${G.takebacks} Zurücknahmen gespielt.` : null))
    .catch((e) => showResult(mine, reason, null, null, null, e.message));
}

function showResult(mine, reason, rewards, eloChange, titleOverride, note, newElo, tournament = null) {
  sfx.end();
  const titles = { win: '🏆 Sieg!', loss: '💀 Niederlage', draw: '🤝 Remis', aborted: '⏹ Abgebrochen' };
  const title = titleOverride || titles[mine];
  G.overText = `${title} – ${reason}`;
  refresh(false);
  renderControls();
  $('#offer').classList.add('hidden');

  const lines = [];
  if (eloChange != null) {
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, `${TYPE_INFO[G.ratingType]?.name || ''}-Elo`),
      h('b', { class: eloChange >= 0 ? 'pos' : 'neg' }, `${eloChange >= 0 ? '+' : ''}${eloChange} → ${newElo}`)));
  }
  if (rewards) {
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Battlepass-XP'), h('b', {}, `+${rewards.xp}`)));
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Münzen'), h('b', {}, `🪙 +${rewards.coins}`)));
    if (rewards.tierAfter > rewards.tierBefore) lines.push(h('div', { class: 'reward-line glow' }, h('span', {}, '🎉 Neue Stufe!'), h('b', {}, `Stufe ${rewards.tierAfter}`)));
  }
  if (note) lines.push(h('p', { class: 'muted' }, note));
  if (tournament) {
    lines.unshift(h('div', { class: 'reward-line glow' }, h('span', {}, `🏟️ ${tournament.name}`),
      h('b', {}, tournament.pts != null ? `+${tournament.pts}${tournament.fire ? ' 🔥' : ''} · Platz ${tournament.rank}` : 'gewertet')));
    const back = h('button', { class: 'btn primary big' }, '🏟️ Zurück zum Turnier');
    let left = 5;
    clearInterval(resultTimer);
    resultTimer = setInterval(() => { left--; back.textContent = `🏟️ Zurück zum Turnier (${left})`; if (left <= 0) back.click(); }, 1000);
    back.onclick = () => {
      clearInterval(resultTimer);
      closeModal();
      if (G && !G.over) return; // nächste Partie läuft schon
      G = null;
      openTournament(tournament.id);
    };
    modal([h('h2', {}, title), h('p', { class: 'muted' }, reason), ...lines, back,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { clearInterval(resultTimer); closeModal(); } }, 'Brett ansehen'))],
      { onClose: () => clearInterval(resultTimer) });
    return;
  }
  const actions = h('div', { class: 'actions wrap' },
    h('button', { class: 'btn', onclick: closeModal }, 'Brett ansehen'));
  if (G.chess.history().length >= 2) actions.append(h('button', { class: 'btn gold', onclick: () => { closeModal(); startAnalysis(); } }, '🔍 Analyse'));
  if (G.mode === 'ai') actions.append(h('button', { class: 'btn primary', onclick: () => { closeModal(); startLocalGame({ mode: 'ai', color: G.color, level: G.level }); } }, 'Nochmal'));
  else if (G.mode === 'online' && mine !== 'aborted') actions.append(h('button', { class: 'btn primary', onclick: () => { closeModal(); wsSend({ type: 'rematch', gameId: G.id }); } }, '🔁 Revanche'));
  actions.append(h('button', { class: 'btn', onclick: () => { closeModal(); backToLobby(); } }, 'Lobby'));
  modal([h('h2', {}, title), h('p', { class: 'muted' }, reason), ...lines, actions].filter(Boolean));
}

function backToLobby() {
  stopAi();
  if (G?.mode === 'spectate') wsSend({ type: 'unwatch' });
  G = null;
  show('play');
}

$('#btn-back').addEventListener('click', backToLobby);
$('#btn-flip').addEventListener('click', () => { mainBoard.flip(); if (G) refresh(false); });
$('#btn-resign').addEventListener('click', () => {
  if (!G || G.over) return;
  const doIt = () => {
    if (G.mode === 'online') wsSend({ type: 'resign' });
    else { stopAi(); finishLocal(G.color === 'w' ? 'b' : 'w', 'Aufgabe', true); }
  };
  const aborting = G.mode === 'online' && G.chess.history().length < 2;
  if (settings().confirmResign) confirmBox(aborting ? 'Partie abbrechen?' : 'Wirklich aufgeben?', aborting ? 'Abbrechen' : 'Aufgeben', doIt);
  else doIt();
});
$('#btn-draw').addEventListener('click', () => { wsSend({ type: 'offer_draw' }); toast('Remis angeboten'); });
$('#btn-takeback').addEventListener('click', () => {
  if (!G || G.over) return;
  if (G.mode === 'online') { wsSend({ type: 'takeback_request' }); toast('Zurücknahme angefragt'); return; }
  if (G.thinking) { stopAi(); }
  if (!G.chess.history().length) return;
  G.chess.undo();
  if (G.mode === 'ai' && G.chess.turn() !== G.color && G.chess.history().length) G.chess.undo();
  G.takebacks++;
  G.view = G.chess.history().length;
  refresh(false);
  renderControls();
});
$('#btn-hint').addEventListener('click', async () => {
  if (!G || G.mode !== 'ai' || G.over || G.thinking || G.chess.turn() !== G.color) return;
  $('#btn-hint').disabled = true;
  const res = await aiRequest({ pgn: G.chess.pgn(), depth: 3, randomness: 0, timeMs: 1500 });
  $('#btn-hint').disabled = false;
  if (!res.move || !G || G.chess.turn() !== G.color) return;
  G.hintsUsed++;
  G.hintMove = { from: res.move.from, to: res.move.to };
  refresh(false);
  toast(`💡 Tipp: ${res.move.san}`);
});
$('#btn-rematch').addEventListener('click', () => {
  if (!G) return;
  if (G.mode === 'ai') startLocalGame({ mode: 'ai', color: G.color, level: G.level });
  else if (G.mode === 'online') wsSend({ type: 'rematch', gameId: G.id });
});
$('#btn-analyze').addEventListener('click', () => startAnalysis());
$('#btn-pgn').addEventListener('click', () => {
  if (!G) return;
  const pgn = G.chess.pgn();
  const area = h('textarea', { class: 'pgn-box', readonly: true }, pgn);
  modal([h('h2', {}, '📋 PGN'), area, h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(pgn); toast('PGN kopiert'); } }, 'Kopieren'),
    h('button', { class: 'btn', onclick: () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' })), download: `schachkakh-${Date.now()}.pgn` });
      a.click();
    } }, 'Herunterladen'),
    h('button', { class: 'btn primary', onclick: closeModal }, 'Schließen'))]);
  area.select();
});

// ---------- Partie-Analyse (wie "Game Review") ----------
const CLASSES = [
  { key: 'best', name: 'Bester Zug', sym: '★', max: 10 },
  { key: 'great', name: 'Sehr gut', sym: '', max: 35 },
  { key: 'good', name: 'Gut', sym: '', max: 80 },
  { key: 'inacc', name: 'Ungenauigkeit', sym: '?!', max: 160 },
  { key: 'mistake', name: 'Fehler', sym: '?', max: 320 },
  { key: 'blunder', name: 'Patzer', sym: '??', max: Infinity },
];
const MATE_SCORE = 100000;
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const clampCp = (s) => (Math.abs(s) > MATE_SCORE - 1000 ? Math.sign(s) * 2000 : Math.max(-2000, Math.min(2000, s)));

async function startAnalysis() {
  if (!G || G.chess.history().length < 2) return;
  stopAi();
  G.analysis = true;
  G.over = true;
  G.evals = [];
  G.analysisProgress = 0;
  $('#eval-wrap').classList.remove('hidden');
  renderControls();
  refresh(false);
  const game = G;
  const hist = G.chess.history({ verbose: true });
  const c = new Chess();
  for (let i = 0; i <= hist.length; i++) {
    if (G !== game) return;
    let ev;
    if (c.isCheckmate()) ev = { white: c.turn() === 'w' ? -MATE_SCORE : MATE_SCORE, best: null, mate: true };
    else if (c.isDraw() || c.isStalemate()) ev = { white: 0, best: null };
    else {
      const res = await aiRequest({ fen: c.fen(), depth: 3, randomness: 0, timeMs: 700 });
      const sign = c.turn() === 'w' ? 1 : -1;
      ev = { white: (res.best ?? res.score) * sign, best: res.move };
    }
    G.evals[i] = ev;
    if (i > 0) G.evals[i].cls = classify(G.evals[i - 1], ev, hist[i - 1]);
    G.analysisProgress = i / hist.length;
    if (i < hist.length) c.move(hist[i].san);
    if (i % 3 === 0 || i === hist.length) refresh(false);
  }
  G.analysisProgress = 1;
  renderReviewSummary();
  refresh(false);
}

function classify(before, after, move) {
  const sign = move.color === 'w' ? 1 : -1;
  const b = clampCp(before.white * sign), a = clampCp(after.white * sign);
  const loss = Math.max(0, b - a);
  const playedBest = before.best && before.best.from === move.from && before.best.to === move.to;
  const cls = playedBest ? CLASSES[0] : CLASSES.find((x) => loss <= x.max);
  const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, winPct(b) - winPct(a))) - 3.1669));
  return { ...cls, loss, acc };
}

function renderReviewSummary() {
  const hist = G.chess.history({ verbose: true });
  const stats = { w: {}, b: {} };
  const accs = { w: [], b: [] };
  hist.forEach((m, i) => {
    const cls = G.evals[i + 1]?.cls;
    if (!cls) return;
    stats[m.color][cls.key] = (stats[m.color][cls.key] || 0) + 1;
    accs[m.color].push(cls.acc);
  });
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const box = $('#review-summary');
  box.classList.remove('hidden');
  box.replaceChildren(
    h('div', { class: 'acc-row' },
      h('div', {}, h('small', {}, G.white?.name || 'Weiß'), h('b', {}, avg(accs.w).toFixed(1) + '%')),
      h('span', { class: 'muted' }, 'Genauigkeit'),
      h('div', {}, h('small', {}, G.black?.name || 'Schwarz'), h('b', {}, avg(accs.b).toFixed(1) + '%'))),
    h('table', { class: 'cls-table' }, ...CLASSES.map((c) => h('tr', { class: 'cls-' + c.key },
      h('td', {}, stats.w[c.key] || 0), h('td', {}, `${c.sym ? c.sym + ' ' : ''}${c.name}`), h('td', {}, stats.b[c.key] || 0)))),
  );
}

function renderEval() {
  if (!G?.analysis) return;
  const ev = G.evals?.[G.view];
  if (!ev) return;
  const cp = ev.white;
  const pct = Math.abs(cp) > MATE_SCORE - 1000 ? (cp > 0 ? 100 : 0) : winPct(clampCp(cp));
  $('#eval-fill').style.setProperty('--pct', `${pct}%`);
  $('#eval-wrap').classList.toggle('flipped', mainBoard.orientation === 'b');
  let text;
  if (Math.abs(cp) > MATE_SCORE - 1000) text = ev.mate ? '#' : `M${Math.ceil((MATE_SCORE - Math.abs(cp)) / 2)}`;
  else text = (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
  $('#eval-text').textContent = text;
  if (G.view > 0 && ev.cls) {
    const hist = G.chess.history({ verbose: true });
    const prev = G.evals[G.view - 1];
    const better = prev?.best && ev.cls.key !== 'best' && ev.cls.loss > 35 ? ` · besser war ${prev.best.san}` : '';
    $('#game-status').textContent = `${hist[G.view - 1].san}: ${ev.cls.name}${better}`;
  }
}

// Gespeicherte Partie öffnen
async function openStoredGame(id) {
  try {
    const { game } = await api('/api/game/' + id);
    if (game.kind === '4p') return toast('4-Spieler-Partien können noch nicht nachgespielt werden');
    stopAi();
    const color = game.black.id === me.id ? 'b' : 'w';
    G = newGameState({ mode: 'review', color, white: { name: game.white.name, elo: game.white.elo }, black: { name: game.black.name, elo: game.black.elo }, ratingType: game.type });
    G.chess.loadPgn(game.pgn);
    G.over = true;
    G.overText = game.result === 'draw' ? `½–½ · ${game.reason}` : game.result === 'aborted' ? 'Abgebrochen' : `${game.result === 'w' ? 'Weiß' : 'Schwarz'} gewinnt · ${game.reason}`;
    G.view = 0;
    enterGameView();
    refresh(false);
  } catch (e) { toast(e.message, 'err'); }
}

// ======================================================================
// 4-Spieler-Schach
// ======================================================================
let FP = null;
const fourView = new FourView($('#fp-board'), {
  onMove: (from, to) => { if (FP) wsSend({ type: 'fp_move', gameId: FP.id, from, to }); },
});

function startFour(msg) {
  FP = { id: msg.gameId, me: msg.myColor, spectator: !!msg.spectator, seats: msg.seats, over: msg.over, alive: !!msg.myColor, ranked: msg.ranked, tc: msg.tc };
  $('#fp-chat-log').replaceChildren();
  show('fp');
  sfx.start();
  updateFour(msg, true);
  if (FP.me) toast(`Du spielst ${COLOR_NAMES[FP.me]} ${FP.ranked ? '· gewertet' : ''}`);
}

function updateFour(msg, first = false) {
  FP.state = msg.state;
  FP.clocks = msg.clocks;
  FP.clockStamp = performance.now();
  FP.seats = msg.seats;
  if (FP.me && !msg.state.active[FP.me]) FP.alive = false;
  fourView.setState(msg.state, { me: FP.me || 'r', interactive: !!FP.me && FP.alive && !msg.over });
  if (!first && msg.record) {
    const ev = msg.record.events || [];
    if (ev.some((e) => e.type === 'mate')) sfx.end();
    else if (ev.some((e) => e.type === 'check')) sfx.check();
    else if (msg.record.captured) sfx.capture();
    else sfx.move();
    for (const e of ev) if (e.type === 'mate') toast(`♚ ${COLOR_NAMES[e.color]} wurde von ${COLOR_NAMES[e.by]} mattgesetzt (+20)`);
    if (FP.me && msg.state.turn === undefined) {}
  }
  if (msg.event?.type === 'out') toast(`${COLOR_NAMES[msg.event.color]} scheidet aus: ${msg.event.reason}`);
  const turnColor = FP_ORDER[msg.state.turnIndex];
  if (FP.me && turnColor === FP.me && FP.alive && !first && !msg.over) beep(620, 0.05, 'sine', 0.1);
  renderFourPanel();
  renderFourControls();
}

function renderFourPanel() {
  const st = FP.state;
  const turn = FP_ORDER[st.turnIndex];
  const clocks = { ...FP.clocks };
  if (!st.over && st.active[turn]) clocks[turn] -= performance.now() - FP.clockStamp;
  const rows = FP_ORDER.map((c) => {
    const seat = FP.seats.find((s) => s.color === c);
    const out = !st.active[c];
    return h('div', { class: `fp-player ${turn === c && !st.over ? 'turn' : ''} ${out ? 'out' : ''} ${FP.me === c ? 'mine' : ''}`, style: `--pc:${FP_COLORS[c].css}` },
      h('span', { class: 'fp-dot' }),
      h('div', { class: 'fp-name' }, h('b', {}, seat.name), h('small', {}, seat.bot ? '🤖 Bot' : seat.elo ? `${seat.elo}` : '', out ? ` · ${st.eliminatedReason[c] || 'raus'}` : '')),
      h('span', { class: 'fp-points' }, String(st.points[c])),
      h('span', { class: 'clock' + (turn === c && !st.over ? ' active' : '') }, fmtTime(clocks[c])),
      FP.emotes?.[c]?.until > Date.now() ? h('span', { class: 'emote-bubble' }, FP.emotes[c].emoji) : null);
  });
  $('#fp-players').replaceChildren(...rows);
  let s;
  if (st.over || FP.over) s = `🏁 ${st.endReason || 'Partie beendet'}`;
  else if (FP.spectator) s = `📺 ${COLOR_NAMES[turn]} ist am Zug`;
  else if (!FP.alive) s = 'Du bist ausgeschieden – du kannst weiter zuschauen';
  else s = turn === FP.me ? '👉 Du bist am Zug!' : `${COLOR_NAMES[turn]} ist am Zug`;
  $('#fp-status').textContent = s;
}
setInterval(() => { if (FP && currentView === 'fp' && !FP.over) renderFourPanel(); }, 250);

function renderFourControls() {
  $('#btn-fp-resign').classList.toggle('hidden', !FP?.me || !FP.alive || FP.over);
  $('#btn-fp-back').classList.toggle('hidden', !!(FP?.me && FP.alive && !FP.over));
}

function fourOver(msg) {
  FP.over = true;
  updateFour(msg);
  if (msg.user) setMe(msg.user);
  sfx.end();
  const order = Object.entries(msg.places).sort((a, b) => a[1] - b[1]);
  const lines = order.map(([c, place]) => {
    const seat = msg.seats.find((s) => s.color === c);
    return h('div', { class: `reward-line ${c === msg.myColor ? 'glow' : ''}`, style: `border-left:5px solid ${FP_COLORS[c].css}` },
      h('span', {}, `${['🥇', '🥈', '🥉', '4.'][place - 1] || place + '.'} ${seat.name}`), h('b', {}, `${msg.points[c]} P.`));
  });
  if (msg.spectator || !msg.myColor) {
    modal([h('h2', {}, '🏁 Endstand'), h('p', { class: 'muted' }, msg.reason), ...lines, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'OK'))]);
    return;
  }
  const place = msg.places[msg.myColor];
  if (msg.eloChange != null) lines.push(h('div', { class: 'reward-line' }, h('span', {}, '4-Spieler-Elo'), h('b', { class: msg.eloChange >= 0 ? 'pos' : 'neg' }, `${msg.eloChange >= 0 ? '+' : ''}${msg.eloChange} → ${me.ratings.fourp.elo}`)));
  if (msg.rewards) {
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Battlepass-XP'), h('b', {}, `+${msg.rewards.xp}`)));
    lines.push(h('div', { class: 'reward-line' }, h('span', {}, 'Münzen'), h('b', {}, `🪙 +${msg.rewards.coins}`)));
  }
  modal([h('h2', {}, place === 1 ? '🏆 Gewonnen!' : `${place}. Platz`), h('p', { class: 'muted' }, msg.reason), ...lines,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: closeModal }, 'Brett ansehen'),
      h('button', { class: 'btn primary', onclick: () => { closeModal(); FP = null; show('play'); } }, 'Lobby'))]);
}

$('#btn-fp-resign').addEventListener('click', () => {
  const doIt = () => wsSend({ type: 'resign' });
  if (settings().confirmResign) confirmBox('Wirklich aufgeben?', 'Aufgeben', doIt); else doIt();
});
$('#btn-fp-back').addEventListener('click', () => {
  if (FP?.spectator) wsSend({ type: 'unwatch' });
  FP = null;
  show('play');
});

// ======================================================================
// Taktik: gewertet, tägliches Rätsel, Puzzle Rush
// ======================================================================
let puzzleMode = 'rated';
let PZ = null;
const rush = { active: false, puzzles: [], index: 0, score: 0, lives: 3, endAt: 0, timer: null };

const puzzleBoard = new Board($('#puzzle-board'), {
  canMove: (turn) => PZ && !PZ.done && !PZ.busy && turn === PZ.color,
  onMove: (from, to) => puzzleUserMove(from, to),
});

$$('#puzzle-tabs [data-pmode]').forEach((b) => b.addEventListener('click', () => {
  if (rush.active) endRush(true);
  startPuzzleMode(b.dataset.pmode);
}));

async function startPuzzleMode(mode) {
  puzzleMode = mode;
  $$('#puzzle-tabs [data-pmode]').forEach((b) => b.classList.toggle('active', b.dataset.pmode === mode));
  $('#btn-rush-start').classList.toggle('hidden', mode !== 'rush' || rush.active);
  $('#btn-puzzle-next').classList.toggle('hidden', mode === 'rush');
  applyBoardSettings(puzzleBoard);
  try {
    if (mode === 'rated') { const d = await api('/api/puzzle/next'); loadPuzzle(d.puzzle); }
    else if (mode === 'daily') { const d = await api('/api/puzzle/daily'); loadPuzzle(d.puzzle, d.solved); }
    else {
      const d = await api('/api/puzzle/rush');
      rush.best = d.best;
      rush.puzzles = d.puzzles;
      PZ = null;
      puzzleBoard.setChess(new Chess(), { lastMove: null });
      $('#puzzle-head').textContent = '⚡ Puzzle Rush';
      $('#puzzle-status').textContent = 'Löse so viele Aufgaben wie möglich in 3 Minuten. Drei Fehler und es ist vorbei.';
      $('#puzzle-info').replaceChildren(h('p', {}, `Dein Rekord: `, h('b', {}, String(d.best))));
    }
  } catch (e) { toast(e.message, 'err'); }
}

function loadPuzzle(p, alreadySolved = false) {
  const chess = new Chess(p.fen);
  PZ = { p, chess, color: chess.turn(), step: 0, done: alreadySolved, failed: false, reported: alreadySolved, busy: false };
  puzzleBoard.orientation = PZ.color;
  puzzleBoard.hint = null;
  puzzleBoard.marks.clear();
  puzzleBoard.setChess(chess, { lastMove: null });
  const who = PZ.color === 'w' ? 'Weiß' : 'Schwarz';
  $('#puzzle-head').replaceChildren(h('span', { class: `color-dot ${PZ.color}` }), ` ${who} am Zug · Matt in ${p.mateIn}`);
  $('#puzzle-status').textContent = alreadySolved ? '✅ Heute schon gelöst – morgen gibt es ein neues!' : `Finde das Matt in ${p.mateIn} ${p.mateIn === 1 ? 'Zug' : 'Zügen'}.`;
  renderPuzzleInfo();
}

function renderPuzzleInfo() {
  const info = $('#puzzle-info');
  if (puzzleMode === 'rated') {
    const r = me.ratings.puzzle;
    info.replaceChildren(
      h('div', { class: 'reward-line' }, h('span', {}, 'Deine Taktik-Wertung'), h('b', {}, String(r.elo))),
      h('div', { class: 'reward-line' }, h('span', {}, 'Aufgaben-Wertung'), h('b', {}, PZ?.p.rating ? String(PZ.p.rating) : '–')),
      h('div', { class: 'reward-line' }, h('span', {}, 'Serie'), h('b', {}, `${me.puzzles.streak || 0} 🔥 (Rekord ${me.puzzles.best || 0})`)),
      h('p', { class: 'muted small-note' }, 'Tipp oder Lösung zählen als nicht gelöst.'));
  } else if (puzzleMode === 'daily') {
    info.replaceChildren(h('div', { class: 'reward-line' }, h('span', {}, 'Serie'), h('b', {}, `${me.puzzles.dailyStreak || 0} Tage 🔥`)),
      h('p', { class: 'muted small-note' }, 'Lösen bringt einmal am Tag 25 Münzen und 25 XP.'));
  } else {
    const left = Math.max(0, rush.endAt - Date.now());
    info.replaceChildren(
      h('div', { class: 'rush-stats' },
        h('div', {}, h('small', {}, 'Punkte'), h('b', {}, String(rush.score))),
        h('div', {}, h('small', {}, 'Zeit'), h('b', {}, fmtTime(left))),
        h('div', {}, h('small', {}, 'Leben'), h('b', {}, '❤️'.repeat(rush.lives) + '🖤'.repeat(3 - rush.lives)))));
  }
}

function puzzleUserMove(from, to) {
  const c = PZ.chess;
  const legal = c.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!legal.length) return;
  const expected = PZ.p.moves[PZ.step];
  const promotion = legal[0].promotion ? (expected.length === 5 ? expected[4] : 'q') : undefined;
  const move = c.move({ from, to, promotion });
  const lan = from + to + (promotion || '');
  const correct = lan === expected || c.isCheckmate();
  puzzleBoard.setChess(c, { lastMove: move, animate: true });
  soundFor(move, c);
  if (!correct) {
    sfx.bad();
    puzzleBoard.extraClasses.set(to, 'cls-blunder');
    puzzleBoard.render();
    puzzleFail();
    setTimeout(() => { puzzleBoard.extraClasses.clear(); c.undo(); puzzleBoard.setChess(c, { lastMove: null }); }, 700);
    return;
  }
  puzzleBoard.hint = null;
  PZ.step++;
  if (c.isCheckmate() || PZ.step >= PZ.p.moves.length) return puzzleSolved();
  sfx.good();
  PZ.busy = true;
  setTimeout(() => {
    const r = PZ.p.moves[PZ.step];
    const reply = c.move({ from: r.slice(0, 2), to: r.slice(2, 4), promotion: r[4] });
    PZ.step++;
    PZ.busy = false;
    puzzleBoard.setChess(c, { lastMove: reply, animate: true });
    soundFor(reply, c);
    $('#puzzle-status').textContent = '👍 Richtig! Weiter so…';
  }, 450);
}

async function reportPuzzle(solved) {
  if (PZ.reported) return;
  PZ.reported = true;
  if (puzzleMode === 'rush') return;
  try {
    const d = await api('/api/puzzle/result', { id: PZ.p.id, solved, mode: puzzleMode });
    if (puzzleMode === 'rated') toast(`Taktik-Wertung ${d.delta >= 0 ? '+' : ''}${d.delta} → ${d.rating}`);
    if (puzzleMode === 'daily' && solved) { toast(`📅 Tägliches Rätsel gelöst! +${d.coins} Münzen`); $('#daily-teaser').classList.add('hidden'); }
    renderPuzzleInfo();
  } catch (e) { toast(e.message, 'err'); }
}

function puzzleSolved() {
  PZ.done = true;
  sfx.good();
  $('#puzzle-status').textContent = PZ.failed ? '✔ Gelöst (zählt nicht für die Wertung)' : '✅ Gelöst!';
  reportPuzzle(!PZ.failed);
  if (puzzleMode === 'rush') { rush.score++; renderPuzzleInfo(); setTimeout(nextRushPuzzle, 500); }
}

function puzzleFail() {
  $('#puzzle-status').textContent = '❌ Das war nicht der beste Zug. Versuch es nochmal!';
  if (!PZ.failed) { PZ.failed = true; reportPuzzle(false); }
  if (puzzleMode === 'rush') {
    rush.lives--;
    renderPuzzleInfo();
    PZ.done = true;
    if (rush.lives <= 0) setTimeout(() => endRush(), 700);
    else setTimeout(nextRushPuzzle, 800);
  }
}

$('#btn-puzzle-hint').addEventListener('click', () => {
  if (!PZ || PZ.done || PZ.busy) return;
  const m = PZ.p.moves[PZ.step];
  PZ.failed = true;
  if (puzzleMode === 'rush') { rush.lives = Math.max(0, rush.lives - 1); renderPuzzleInfo(); if (rush.lives <= 0) return endRush(); }
  else reportPuzzle(false);
  puzzleBoard.hint = { from: m.slice(0, 2), to: m.slice(2, 4) };
  puzzleBoard.render();
});
$('#btn-puzzle-solution').addEventListener('click', async () => {
  if (!PZ || PZ.done || PZ.busy || puzzleMode === 'rush') return;
  PZ.failed = true;
  reportPuzzle(false);
  PZ.busy = true;
  const c = PZ.chess;
  for (let i = PZ.step; i < PZ.p.moves.length; i++) {
    const r = PZ.p.moves[i];
    const mv = c.move({ from: r.slice(0, 2), to: r.slice(2, 4), promotion: r[4] });
    puzzleBoard.setChess(c, { lastMove: mv, animate: true });
    soundFor(mv, c);
    await sleep(700);
  }
  PZ.busy = false;
  PZ.done = true;
  $('#puzzle-status').textContent = '👁 Lösung angezeigt';
});
$('#btn-puzzle-next').addEventListener('click', () => startPuzzleMode(puzzleMode === 'daily' ? 'rated' : puzzleMode));
$('#btn-rush-start').addEventListener('click', () => {
  Object.assign(rush, { active: true, index: 0, score: 0, lives: 3, endAt: Date.now() + 180_000 });
  $('#btn-rush-start').classList.add('hidden');
  clearInterval(rush.timer);
  rush.timer = setInterval(() => { if (Date.now() >= rush.endAt) endRush(); else renderPuzzleInfo(); }, 250);
  nextRushPuzzle();
});

function nextRushPuzzle() {
  if (!rush.active) return;
  const p = rush.puzzles[rush.index++];
  if (!p) return endRush();
  loadPuzzle(p);
  renderPuzzleInfo();
}

async function endRush(silent = false) {
  if (!rush.active) return;
  rush.active = false;
  clearInterval(rush.timer);
  if (PZ) PZ.done = true;
  if (silent) return;
  $('#btn-rush-start').classList.remove('hidden');
  try {
    const d = await api('/api/puzzle/rush-result', { score: rush.score });
    sfx.end();
    modal([h('h2', {}, d.record ? '🏆 Neuer Rekord!' : '⚡ Rush vorbei'), h('p', { class: 'stat' }, `${rush.score} gelöst`),
      h('div', { class: 'reward-line' }, h('span', {}, 'Rekord'), h('b', {}, String(d.best))),
      h('div', { class: 'reward-line' }, h('span', {}, 'Münzen'), h('b', {}, `🪙 +${d.coins}`)),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { closeModal(); $('#btn-rush-start').click(); } }, 'Nochmal'),
        h('button', { class: 'btn', onclick: closeModal }, 'Schließen'))]);
  } catch (e) { toast(e.message, 'err'); }
}

// ======================================================================
// Zuschauen
// ======================================================================
let liveTimer = null;
function renderWatch() {
  $('#live-list').replaceChildren(h('p', { class: 'muted' }, 'Lädt…'));
  wsSend({ type: 'live_games' });
  liveTimer = setInterval(() => wsSend({ type: 'live_games' }), 5000);
}
function renderLiveList(games) {
  if (currentView !== 'watch') return;
  const list = $('#live-list');
  if (!games.length) return list.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Gerade läuft keine Partie. Starte doch selbst eine!')));
  list.replaceChildren(...games.map((g) => h('div', { class: 'live-card' },
    h('div', { class: 'live-kind' }, g.kind === '4p' ? '🎲 4 Spieler' : `${TYPE_INFO[TIME_CONTROLS[g.tc]?.type]?.icon || ''} ${TC_LABEL[g.tc] || g.tc}`, g.ranked ? ' · gewertet' : ''),
    h('div', { class: 'live-players' }, ...g.players.map((p, i) => h('span', {}, g.kind === '4p' ? h('span', { class: 'fp-dot', style: `--pc:${FP_COLORS[p.color].css}` }) : h('span', { class: `color-dot ${i ? 'b' : 'w'}` }), ` ${p.name}`, p.elo ? h('small', {}, ` ${p.elo}`) : ''))),
    h('div', { class: 'muted' }, `${g.moves} Züge · 👁 ${g.spectators}`),
    h('button', { class: 'btn primary', onclick: () => wsSend({ type: 'watch', gameId: g.id }) }, 'Zuschauen'))));
}

// ======================================================================
// Freunde
// ======================================================================
async function renderFriends() {
  const list = $('#friend-list');
  try {
    const { friends } = await api('/api/friends');
    if (!friends.length) return list.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Noch keine Freunde. Füge jemanden über den Spielernamen hinzu!')));
    const order = { playing: 0, online: 1, offline: 2 };
    friends.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    list.replaceChildren(...friends.map((f) => h('div', { class: 'friend' },
      h('span', { class: `status-dot ${f.status}`, title: f.status }),
      h('div', { class: 'friend-name' }, h('b', { class: 'link', onclick: () => navigate('profile', () => renderProfile(f.name)) }, f.name),
        h('small', { class: 'muted' }, { playing: 'spielt gerade', online: 'online', offline: 'offline' }[f.status] + ` · 🔥 ${f.ratings.blitz} · ⚡ ${f.ratings.bullet} · 🎲 ${f.ratings.fourp}`)),
      h('div', { class: 'row' },
        f.status === 'online' ? h('button', { class: 'btn small primary', onclick: () => challengeDialog(f) }, '⚔️ Herausfordern') : null,
        f.status === 'playing' && f.gameId ? h('button', { class: 'btn small', onclick: () => wsSend({ type: 'watch', gameId: f.gameId }) }, '📺 Zuschauen') : null,
        h('button', { class: 'btn small', title: 'Entfernen', onclick: () => confirmBox(`${f.name} entfernen?`, 'Entfernen', async () => { await api('/api/friends/remove', { id: f.id }); renderFriends(); }) }, '✖')))));
  } catch (e) { toast(e.message, 'err'); }
}
$('#friend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#friend-name').value.trim();
  if (!name) return;
  try { await api('/api/friends/add', { name }); $('#friend-name').value = ''; toast(`${name} hinzugefügt`); renderFriends(); }
  catch (err) { toast(err.message, 'err'); }
});

function challengeDialog(f) {
  let tc = selectedTc, rated = false;
  const tcBox = h('div', { class: 'tc-grid small' }, ...Object.keys(TIME_CONTROLS).map((k) => h('button', {
    class: k === tc ? 'active' : '', onclick: (e) => { tc = k; $$('button', tcBox).forEach((x) => x.classList.toggle('active', x === e.currentTarget)); },
  }, TC_LABEL[k])));
  modal([
    h('h2', {}, `⚔️ ${f.name} herausfordern`), tcBox,
    h('label', { class: 'toggle' }, h('span', {}, 'Gewertet'), h('input', { type: 'checkbox', onchange: (e) => { rated = e.target.checked; } })),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: () => { closeModal(); wsSend({ type: 'challenge', to: f.id, tc, rated }); } }, 'Senden')),
  ]);
}

// ======================================================================
// Battlepass
// ======================================================================
function rewardView(reward) {
  if (!reward) return [h('span', { class: 'muted' }, '—')];
  if (reward.coins) return [h('span', { class: 'icon' }, '🪙'), h('b', {}, `${reward.coins} Münzen`)];
  if (reward.board) {
    const s = BOARD_SKINS[reward.board];
    return [h('div', { class: 'mini-board' }, ...[s.light, s.dark, s.dark, s.light].map((c) => h('div', { style: `background:${c};width:22px;height:22px` }))),
      h('b', {}, s.name), h('small', { class: 'muted' }, 'Brett')];
  }
  const s = PIECE_SKINS[reward.pieces];
  return [pieceEl('q', 'w', 'icon-piece', skinVars(s)), h('b', {}, s.name), h('small', { class: 'muted' }, 'Figuren')];
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
    try { await api('/api/battlepass/premium', {}); toast('Premium-Pass aktiviert! 👑'); renderPass(); } catch (e) { toast(e.message, 'err'); }
  };
  const track = $('#pass-track');
  track.replaceChildren(...BATTLEPASS.map((t) => {
    const reached = tier >= t.tier;
    const mk = (kind, reward, claimedList, locked) => {
      const claimed = claimedList.includes(t.tier);
      const claimable = reward && reached && !claimed && !locked;
      const el = h('div', { class: `reward ${kind === 'premium' ? 'premium' : ''} ${!reward ? 'empty' : ''} ${claimable ? 'claimable' : ''} ${claimed ? 'claimed' : ''}` }, ...rewardView(reward));
      if (claimed) el.append(h('small', {}, '✔ Abgeholt'));
      else if (claimable) el.append(h('button', { class: 'btn small gold', onclick: () => claim(kind, t.tier) }, 'Abholen'));
      else if (reward && locked) el.append(h('small', { class: 'muted' }, '🔒 Premium'));
      else if (reward && !reached) el.append(h('small', { class: 'muted' }, '🔒'));
      return el;
    };
    return h('div', { class: `tier ${reached ? 'reached' : ''}` }, h('div', { class: 'tier-num' }, t.tier),
      mk('free', t.free, me.pass.claimedFree, false), mk('premium', t.premium, me.pass.claimedPremium, !me.pass.premium));
  }));
  const cur = track.children[Math.max(0, tier - 2)];
  if (cur) track.scrollLeft = cur.offsetLeft - track.offsetLeft;
}

async function claim(track, tier) {
  try {
    const d = await api('/api/battlepass/claim', { track, tier });
    const r = d.reward;
    toast(r.coins ? `+${r.coins} Münzen!` : `Neuer Skin: ${(BOARD_SKINS[r.board] || PIECE_SKINS[r.pieces]).name}!`);
    renderPass();
  } catch (e) { toast(e.message, 'err'); }
}

// ======================================================================
// Shop
// ======================================================================
function renderShop() {
  const make = (type, table, previewFn) => Object.entries(table).map(([id, s]) => {
    const owned = me.owned[type].includes(id);
    const equipped = me.equipped[type] === id;
    let action;
    if (equipped) action = h('button', { class: 'btn', disabled: true }, '✔ Ausgerüstet');
    else if (owned) action = h('button', { class: 'btn primary', onclick: () => equip(type, id) }, 'Ausrüsten');
    else if (s.bp) action = h('button', { class: 'btn', disabled: true }, s.premium ? '👑 Premium-Pass' : '🎖️ Battlepass');
    else action = h('button', { class: 'btn gold', disabled: me.coins < s.price, onclick: () => buy(type, id, s) }, `🪙 ${s.price}`);
    return h('div', { class: `skin ${equipped ? 'equipped' : ''}` }, previewFn(s), h('b', {}, s.name),
      h('span', { class: 'tag' }, owned ? 'Im Besitz' : s.bp ? 'Battlepass-Belohnung' : 'Shop'), action);
  });
  const curBoard = BOARD_SKINS[me.equipped.board];
  const curPieces = PIECE_SKINS[me.equipped.pieces];
  const preview = (b, p) => h('div', { class: 'preview' }, ...['r', 'q', 'k', 'n'].map((t, i) =>
    h('div', { style: `background:${i % 2 ? b.dark : b.light}` }, pieceEl(t, i % 2 ? 'b' : 'w', 'icon-piece', skinVars(p)))));
  $('#shop-board').replaceChildren(...make('board', BOARD_SKINS, (s) => preview(s, curPieces)));
  $('#shop-pieces').replaceChildren(...make('pieces', PIECE_SKINS, (s) => preview(curBoard, s)));
}
async function buy(type, id, s) {
  try { await api('/api/shop/buy', { type, id }); toast(`${s.name} gekauft!`); await equip(type, id); } catch (e) { toast(e.message, 'err'); }
}
async function equip(type, id) {
  try { await api('/api/equip', { type, id }); renderShop(); } catch (e) { toast(e.message, 'err'); }
}

// ======================================================================
// Rangliste & Profil
// ======================================================================
let lbType = 'blitz';
$('#lb-tabs').append(...RATING_TYPES.map((t) => h('button', {
  'data-type': t.id, class: t.id === lbType ? 'active' : '',
  onclick: () => { lbType = t.id; renderLeaderboard(); },
}, `${t.icon} ${t.name}`)));

async function renderLeaderboard() {
  $$('#lb-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.type === lbType));
  const tbody = $('#lb-table tbody');
  tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Lädt…')));
  try {
    const { top } = await api('/api/leaderboard?type=' + lbType);
    if (!top.length) return tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Noch keine gewerteten Partien – sei der Erste!')));
    tbody.replaceChildren(...top.map((u, i) => h('tr', { class: u.id === me.id ? 'me' : '' },
      h('td', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1),
      h('td', {}, h('span', { class: 'link', onclick: () => navigate('profile', () => renderProfile(u.name)) }, u.name)),
      h('td', {}, h('b', {}, u.elo)), h('td', {}, rankName(u.elo)), h('td', {}, `${u.wins}/${u.draws}/${u.losses}`))));
  } catch (e) { toast(e.message, 'err'); }
}

async function renderProfile(name) {
  const own = name === me.name;
  $('#profile-name').textContent = name;
  $('#profile-actions').replaceChildren();
  try {
    let ratings, games, profile, status = 'online', isFriend = false;
    if (own) { ratings = me.ratings; games = (await api('/api/history')).games; profile = me; }
    else { const d = await api('/api/user/' + encodeURIComponent(name)); profile = d.profile; ratings = profile.ratings; games = d.games; status = d.status; isFriend = d.isFriend; }
    const best = Math.max(...['bullet', 'blitz', 'rapid'].map((t) => ratings[t].elo));
    $('#profile-name').replaceChildren(h('span', { class: `status-dot ${status}` }), ` ${profile.name} `, h('small', { class: 'muted' }, `· ${rankName(best)} · dabei seit ${fmtDate(profile.createdAt)}`));
    if (own) {
      $('#profile-actions').append(
        h('button', { class: 'btn', onclick: renameDialog }, '✏️ Namen ändern'),
        h('button', { class: 'btn', onclick: passwordDialog }, '🔑 Passwort ändern'));
    }
    if (!own) {
      const acts = $('#profile-actions');
      if (!isFriend) acts.append(h('button', { class: 'btn primary', onclick: async () => { try { await api('/api/friends/add', { name: profile.name }); toast('Freund hinzugefügt'); renderProfile(name); } catch (e) { toast(e.message, 'err'); } } }, '➕ Freund'));
      if (status === 'online') acts.append(h('button', { class: 'btn', onclick: () => challengeDialog(profile) }, '⚔️ Herausfordern'));
    }
    $('#profile-ratings').replaceChildren(...RATING_TYPES.map((t) => {
      const r = ratings[t.id];
      return h('div', { class: 'rating-card' }, h('span', { class: 'rc-icon' }, t.icon), h('div', {}, h('small', { class: 'muted' }, t.name), h('b', {}, r.elo)),
        h('small', { class: 'muted' }, t.id === 'puzzle' ? `${r.games} Aufgaben` : `${r.games} Partien · Höchstwert ${r.peak}`));
    }));
    const stat = (label, value) => h('div', { class: 'card mini' }, h('span', { class: 'muted' }, label), h('span', { class: 'stat' }, value));
    if (own) {
      const aiWins = Object.values(me.aiStats || {}).reduce((s, x) => s + x.win, 0);
      $('#profile-stats').replaceChildren(stat('KI-Siege', aiWins), stat('Puzzle-Rush-Rekord', me.puzzles.rushBest || 0),
        stat('Rätsel-Serie', me.puzzles.best || 0), stat('Battlepass-Stufe', tierFromXp(me.pass.xp)), stat('Münzen', me.coins));
    } else $('#profile-stats').replaceChildren();
    const achs = (own ? me.achievements : profile.achievements) || {};
    $('#ach-title').textContent = `🏅 Erfolge (${Object.keys(achs).length}/${ACHIEVEMENTS.length})`;
    $('#profile-achievements').replaceChildren(...ACHIEVEMENTS.map((a) => h('div', { class: `ach ${achs[a.id] ? 'got' : ''}`, title: achs[a.id] ? `Erreicht am ${fmtDate(achs[a.id])}` : 'Noch nicht erreicht' },
      h('span', { class: 'ach-icon' }, a.icon), h('b', {}, a.name), h('small', {}, a.desc), h('small', { class: 'ach-coins' }, achs[a.id] ? '✔' : `🪙 ${a.coins}`))));
    const tbody = $('#history-table tbody');
    if (!games.length) return tbody.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Noch keine Online-Partien')));
    tbody.replaceChildren(...games.map((g) => {
      if (g.kind === '4p') {
        const mine = g.players.find((p) => p.id === profile.id);
        return h('tr', {}, h('td', {}, '🎲'), h('td', {}, g.players.filter((p) => p.id !== profile.id).map((p) => p.name).join(', ')),
          h('td', {}, mine ? `${mine.place}. Platz (${mine.points} P.)` : ''), h('td', {}, g.reason || ''), h('td', { class: 'muted' }, g.ranked ? 'gewertet' : 'privat'), h('td', {}, fmtDate(g.endedAt)));
      }
      const color = g.white.id === profile.id ? 'w' : 'b';
      const opp = color === 'w' ? g.black : g.white;
      const res = g.result === 'draw' ? '½' : g.result === 'aborted' ? 'abgebr.' : g.result === color ? '✅ Sieg' : '❌ Niederlage';
      const d = g.elo ? g.elo[color === 'w' ? 'white' : 'black'] : null;
      return h('tr', { onclick: () => openStoredGame(g.id), title: 'Nachspielen & analysieren' },
        h('td', {}, `${TYPE_INFO[g.type]?.icon || ''} ${TC_LABEL[g.tc] || g.tc}`), h('td', {}, opp.name), h('td', {}, res), h('td', {}, g.reason),
        h('td', { class: d == null ? 'muted' : d >= 0 ? 'pos' : 'neg' }, d == null ? 'privat' : `${d >= 0 ? '+' : ''}${d}`), h('td', {}, fmtDate(g.endedAt)));
    }));
  } catch (e) { toast(e.message, 'err'); }
}

// ======================================================================
// Benachrichtigungen (Aufgaben & Erfolge)
// ======================================================================
function showNote(n) {
  if (n.kind === 'achievement') {
    sfx.good();
    const t = h('div', { class: 'toast ach-toast' }, h('span', { class: 'ach-icon' }, n.icon),
      h('div', {}, h('small', {}, '🏅 Erfolg freigeschaltet'), h('b', {}, n.text), h('small', { class: 'muted' }, `${n.desc} · 🪙 +${n.coins}`)));
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), 5000);
    setTimeout(() => t.remove(), 5400);
  } else {
    toast(`${n.icon} Aufgabe erledigt: ${n.text} · 🪙 +${n.coins}${n.xp ? ` · +${n.xp} XP` : ''}`, 'quest');
  }
}

function wsSendQuiet(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

// ======================================================================
// Lobby: Tagesaufgaben & Turnier-Hinweis
// ======================================================================
async function renderLobbyExtras() {
  if (currentView !== 'play') return;
  wsSendQuiet({ type: 'tournaments' });
  try {
    const { quests } = await api('/api/quests');
    const list = $('#quest-list');
    list.replaceChildren(...quests.list.map((q) => {
      const def = QUESTS.find((x) => x.id === q.id);
      if (!def) return null;
      return h('div', { class: `quest ${q.done ? 'done' : ''}` },
        h('span', { class: 'quest-icon' }, q.done ? '✅' : def.icon),
        h('div', { class: 'quest-body' }, h('span', {}, def.text),
          h('div', { class: 'bar small' }, h('div', { class: 'fill', style: `width:${(q.progress / def.target) * 100}%` }))),
        h('small', { class: 'quest-reward' }, q.done ? 'erledigt' : `${q.progress}/${def.target} · 🪙${def.coins}`));
    }), h('small', { class: 'muted' }, quests.bonus ? '🎁 Tagesbonus abgeholt!' : '🎁 Alle drei geschafft: +50 Münzen extra'));
    const end = new Date(); end.setUTCHours(24, 0, 0, 0);
    const hrs = Math.max(0, Math.floor((end - Date.now()) / 3600000));
    $('#quests-reset').textContent = `neu in ${hrs} h`;
  } catch {}
}

// ======================================================================
// Arena-Turniere
// ======================================================================
const TOUR = { selected: null, states: new Map(), list: null, offset: 0 };
const nowServer = () => Date.now() + TOUR.offset;
function fmtCountdown(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function tourStatus(t) {
  const n = nowServer();
  if (t.status === 'upcoming') return { cls: 'upcoming', text: `Startet in ${fmtCountdown(t.startsAt - n)}` };
  if (t.status === 'running') return { cls: 'running', text: `Läuft · noch ${fmtCountdown(t.endsAt - n)}` };
  if (t.status === 'ending') return { cls: 'ending', text: 'Letzte Partien laufen…' };
  return { cls: 'finished', text: 'Beendet' };
}

function renderTournaments() {
  wsSend({ type: 'tournaments' });
  liveTimer = setInterval(() => {
    wsSendQuiet({ type: 'tournaments' });
  }, 10_000);
  if (TOUR.selected) wsSendQuiet({ type: 'tournament_watch', id: TOUR.selected });
}
setInterval(() => {
  if (currentView === 'tournaments') { if (TOUR.list) renderTournamentList(TOUR.list, true); renderTournamentDetail(); }
}, 1000);

function openTournament(id) {
  TOUR.selected = id;
  if (currentView !== 'tournaments') navigate('tournaments');
  wsSendQuiet({ type: 'tournament_watch', id });
}

function renderTournamentList(msg, fromTimer = false) {
  if (!fromTimer) { TOUR.list = msg; TOUR.offset = msg.now - Date.now(); }
  // Lobby-Hinweis
  const next = msg.current.find((t) => t.status === 'running') || msg.current[0];
  const teaser = $('#tourney-teaser-body');
  if (next) {
    const st = tourStatus(next);
    teaser.replaceChildren(h('div', { class: 'teaser-row' },
      h('div', {}, h('b', {}, `${next.name} · ${TC_LABEL[next.tc]}`), h('div', { class: `t-status ${st.cls}` }, st.text), h('small', { class: 'muted' }, `${next.players} Teilnehmer · Preis 🪙 ${ARENA_PRIZES[0]}`)),
      h('button', { class: `btn ${next.joined ? '' : 'gold'}`, onclick: () => { if (!next.joined) wsSend({ type: 'tournament_join', id: next.id }); openTournament(next.id); } }, next.joined ? 'Ansehen' : 'Mitmachen')));
  }
  if (currentView !== 'tournaments') return;
  const list = $('#tourney-list');
  const card = (t, finished) => {
    const st = finished ? { cls: 'finished', text: `Beendet · ${fmtDate(t.endsAt)}` } : tourStatus(t);
    return h('div', { class: `t-card ${TOUR.selected === t.id ? 'active' : ''}`, onclick: () => openTournament(t.id) },
      h('div', { class: 't-name' }, h('b', {}, t.name), h('span', { class: 'chip' }, TC_LABEL[t.tc] || t.tc)),
      h('div', { class: `t-status ${st.cls}` }, st.text),
      h('small', { class: 'muted' }, `👥 ${t.players}`, t.joined ? ' · ✅ angemeldet' : '', finished && t.podium?.[0] ? ` · 🥇 ${t.podium[0].name}` : ''),
      t.custom ? h('div', { class: 't-badges' },
        h('span', {}, t.mine ? '👑 von dir' : `👤 ${t.creatorName || ''}`),
        t.private ? h('span', {}, '🔒 privat') : null,
        t.rated === false ? h('span', {}, 'ungewertet') : null,
        t.prizePool ? h('span', { class: 'gold-text' }, `🪙 ${t.prizePool}`) : null) : null);
  };
  list.replaceChildren(...[
    h('h2', {}, 'Aktuell & demnächst'), ...TOUR.list.current.map((t) => card(t, false)),
    TOUR.list.finished.length ? h('h2', {}, 'Zuletzt beendet') : null, ...TOUR.list.finished.map((t) => card(t, true))].filter(Boolean));
  if (!TOUR.selected && TOUR.list.current[0]) openTournament(TOUR.list.current[0].id);
}

function onTournamentState(t) {
  TOUR.states.set(t.id, t);
  TOUR.offset = t.now - Date.now();
  if (currentView === 'tournaments' && TOUR.selected === t.id) renderTournamentDetail();
}

function renderTournamentDetail() {
  const t = TOUR.states.get(TOUR.selected);
  const box = $('#tourney-detail');
  if (!t) return;
  const st = tourStatus(t);
  const mine = t.me;
  const actions = h('div', { class: 'row' });
  if (t.status === 'running' || t.status === 'upcoming') {
    if (!mine.joined || mine.paused) actions.append(h('button', { class: 'btn gold', onclick: () => wsSend({ type: 'tournament_join', id: t.id }) }, mine.joined ? '▶ Weiterspielen' : '✋ Mitmachen'));
    else actions.append(h('button', { class: 'btn', onclick: () => wsSend({ type: 'tournament_pause', id: t.id }) }, '⏸ Pausieren'));
  }
  let info = '';
  if (mine.joined && !mine.paused) {
    if (t.status === 'upcoming') info = '✅ Du bist dabei. Bleib online – die erste Partie startet automatisch.';
    else if (t.status === 'running') info = mine.playing ? '♟ Du spielst gerade.' : '⏳ Suche den nächsten Gegner…';
  } else if (mine.paused) info = '⏸ Pausiert – deine Punkte bleiben erhalten.';
  const meBox = mine.joined ? h('div', { class: 'tour-me' },
    h('div', {}, h('small', {}, 'Platz'), h('b', {}, mine.rank ? `#${mine.rank}` : '–')),
    h('div', {}, h('small', {}, 'Punkte'), h('b', {}, `${mine.score}${mine.fire ? ' 🔥' : ''}`)),
    h('div', {}, h('small', {}, 'Teilnehmer'), h('b', {}, String(t.playerCount)))) : null;
  const rows = t.standings.map((p) => h('tr', { class: p.id === me.id ? 'me' : '' },
    h('td', {}, p.rank <= 3 && t.status === 'finished' ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank),
    h('td', {}, h('span', { class: 'link', onclick: () => navigate('profile', () => renderProfile(p.name)) }, p.name), p.fire ? ' 🔥' : '', p.playing ? h('small', { class: 'muted' }, ' ♟') : '', p.paused ? h('small', { class: 'muted' }, ' ⏸') : ''),
    h('td', { class: 'muted' }, p.elo),
    h('td', { class: 'results' }, ...p.results.map((r) => h('span', { class: `res r${r.replace('🔥', '')} ${r.includes('🔥') ? 'fire' : ''}` }, r.replace('🔥', '')))),
    h('td', {}, h('b', {}, p.score))));
  const podium = t.status === 'finished' && t.podium?.length ? h('div', { class: 'podium' }, ...t.podium.map((p, i) => h('div', { class: `pod p${i + 1}` }, h('span', {}, ['🥇', '🥈', '🥉'][i]), h('b', {}, p.name), h('small', {}, `${p.score} P. · 🪙 ${ARENA_PRIZES[i]}`)))) : null;
  let customBox = null;
  if (t.custom) {
    const link = t.code ? `${location.origin}/?turnier=${t.code}` : null;
    const pool = t.prizePool ? CUSTOM_TOURNEY.shares.map((x, i) => `${['🥇', '🥈', '🥉'][i]} ${Math.floor(t.prizePool * x)}`).join(' · ') : 'kein Preistopf';
    customBox = h('div', { class: 'custom-box' },
      h('div', { class: 'custom-meta' },
        h('span', {}, `👤 Veranstalter: `, h('b', {}, t.creatorName)),
        h('span', {}, t.rated ? '🏆 gewertet' : '🎈 ungewertet'),
        h('span', {}, t.private ? '🔒 privat' : '🌍 öffentlich'),
        h('span', { class: 'gold-text' }, `🪙 Preise: ${pool}`)),
      t.description ? h('p', { class: 'muted' }, t.description) : null,
      t.code ? h('div', { class: 'share-row' },
        h('span', {}, 'Code: ', h('b', { class: 'code' }, t.code)),
        h('button', { class: 'btn small', onclick: () => { navigator.clipboard?.writeText(t.code); toast('Code kopiert'); } }, '📋 Code'),
        h('button', { class: 'btn small primary', onclick: () => shareLink(link, t.name) }, '🔗 Einladungslink')) : null,
      t.creatorId === me.id && t.status === 'upcoming' ? h('button', { class: 'btn small danger', onclick: () => confirmBox('Turnier absagen? Der Preistopf geht an dich zurück.', 'Absagen', () => wsSend({ type: 'tournament_cancel', id: t.id })) }, '✖ Turnier absagen') : null);
  }
  box.replaceChildren(...[
    h('div', { class: 'tour-head' }, h('div', {}, h('h2', {}, `${t.name} · ${TC_LABEL[t.tc]}`), h('div', { class: `t-status ${st.cls}` }, st.text)), actions),
    customBox, info ? h('p', { class: 'tour-info' }, info) : null, meBox, podium,
    t.standings.length ? h('table', { class: 'table tour-table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Spieler'), h('th', {}, 'Elo'), h('th', {}, 'Ergebnisse'), h('th', {}, 'Punkte'))), h('tbody', {}, ...rows))
      : h('p', { class: 'muted' }, 'Noch niemand angemeldet – sei der Erste!')].filter(Boolean));
}

function onTournamentResult(msg) {
  sfx.end();
  if (msg.user) setMe(msg.user);
  api('/api/me').catch(() => {});
  const medal = ['🥇', '🥈', '🥉'][msg.place - 1] || `${msg.place}.`;
  modal([h('h2', {}, `🏟️ ${msg.name} beendet`), h('p', { class: 'stat' }, `${medal} Platz ${msg.place}`),
    h('p', { class: 'muted' }, `von ${msg.players} Spielern · ${msg.score} Punkte`),
    ...(msg.coins ? [h('div', { class: 'reward-line glow' }, h('span', {}, 'Preisgeld'), h('b', {}, `🪙 +${msg.coins}`))] : []),
    h('div', { class: 'reward-line' }, h('span', {}, 'Battlepass-XP'), h('b', {}, `+${msg.xp}`)),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Super'))]);
}

// ======================================================================
// Emotes
// ======================================================================
for (const id of ['#emote-bar', '#fp-emote-bar']) {
  $(id).append(...EMOTES.map((e, i) => h('button', { class: 'emote-btn', title: 'Emote senden', onclick: () => wsSend({ type: 'emote', e: i }) }, e)));
}
function showEmote(msg) {
  if (!settings().emotes) return;
  const emoji = EMOTES[msg.e];
  let host = null;
  if (currentView === 'game' && G && G.id === msg.gameId && msg.color) {
    host = $(mainBoard.orientation === msg.color ? '#bar-bottom' : '#bar-top');
  } else if (currentView === 'fp' && FP && FP.id === msg.gameId && msg.color) {
    (FP.emotes ||= {})[msg.color] = { emoji, until: Date.now() + 2500 };
    renderFourPanel();
    return;
  }
  if (!host) { addChat({ from: msg.from, text: emoji }); return; }
  host.querySelector('.emote-bubble')?.remove();
  const b = h('span', { class: 'emote-bubble' }, emoji);
  host.append(b);
  setTimeout(() => b.classList.add('out'), 2200);
  setTimeout(() => b.remove(), 2600);
}

// ======================================================================
// Eigene Turniere erstellen
// ======================================================================
async function refreshMe() {
  try { const d = await api('/api/me'); if (d.user) setMe(d.user); } catch {}
}

function shareLink(link, name) {
  if (navigator.share) navigator.share({ title: name, text: `Spiel mit im Turnier „${name}“ auf Schachkakh!`, url: link }).catch(() => {});
  else { navigator.clipboard?.writeText(link); toast('Einladungslink kopiert'); }
}

$('#tourney-code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#tourney-code').value.trim();
  if (code) wsSend({ type: 'tournament_code', code });
});

$('#btn-tourney-create').addEventListener('click', () => {
  const o = { name: `${me.name}s Turnier`, tc: '5+0', duration: 30, startIn: 5, rated: true, private: false, prizePool: 0, description: '' };
  const seg = (key, values, label) => h('div', { class: 'seg wrap' }, ...values.map((v) => h('button', {
    type: 'button', class: o[key] === v ? 'active' : '',
    onclick: (e) => { o[key] = v; $$('button', e.currentTarget.parentNode).forEach((x) => x.classList.toggle('active', x === e.currentTarget)); update(); },
  }, label(v))));
  const startLabel = (m) => (m < 60 ? `${m} min` : `${m / 60} h`);
  const summary = h('p', { class: 'muted small-note' });
  const poolInput = h('input', { type: 'number', min: 0, max: Math.min(CUSTOM_TOURNEY.maxPool, me.coins), step: 10, value: 0, oninput: (e) => { o.prizePool = Math.max(0, Math.floor(Number(e.target.value) || 0)); update(); } });
  const err = h('p', { class: 'error' });
  function update() {
    const start = new Date(Date.now() + o.startIn * 60_000);
    const end = new Date(start.getTime() + o.duration * 60_000);
    const f = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    summary.textContent = `Start ${f(start)} Uhr · Ende ${f(end)} Uhr · ${o.prizePool ? `Preise ${CUSTOM_TOURNEY.shares.map((x) => Math.floor(o.prizePool * x)).join(' / ')} Münzen (nicht vergebene gehen an dich zurück)` : 'ohne Preistopf'}`;
  }
  update();
  const field = (label, ...el) => h('label', { class: 'field' }, h('span', {}, label), ...el);
  modal([
    h('h2', {}, '🏆 Eigenes Turnier'),
    h('form', { class: 'create-form', onsubmit: (e) => {
      e.preventDefault();
      err.textContent = '';
      if (o.prizePool > me.coins) { err.textContent = 'Nicht genug Münzen'; return; }
      closeModal();
      wsSend({ type: 'tournament_create', ...o });
    } },
      field('Name', h('input', { value: o.name, maxlength: 40, required: true, oninput: (e) => { o.name = e.target.value; } })),
      field('Beschreibung (optional)', h('input', { maxlength: 140, placeholder: 'z. B. Klassen-Turnier, nur für 7b', oninput: (e) => { o.description = e.target.value; } })),
      field('Bedenkzeit', seg('tc', Object.keys(TIME_CONTROLS), (v) => TC_LABEL[v])),
      field('Dauer', seg('duration', CUSTOM_TOURNEY.durations, (v) => `${v} min`)),
      field('Start in', seg('startIn', CUSTOM_TOURNEY.startIns, startLabel)),
      h('label', { class: 'toggle' }, h('span', {}, '🏆 Gewertet (Elo zählt)'), h('input', { type: 'checkbox', checked: true, onchange: (e) => { o.rated = e.target.checked; } })),
      h('label', { class: 'toggle' }, h('span', {}, '🔒 Privat (nur mit Code oder Link)'), h('input', { type: 'checkbox', onchange: (e) => { o.private = e.target.checked; } })),
      field(`🪙 Preistopf aus deinen Münzen (du hast ${me.coins})`, poolInput),
      summary, err,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Abbrechen'),
        h('button', { type: 'submit', class: 'btn gold' }, 'Erstellen'))),
  ]);
});

// ======================================================================
// Konto: Name & Passwort ändern
// ======================================================================
function renameDialog() {
  const left = (me.nameChangedAt || 0) + RENAME_COOLDOWN_DAYS * 86400000 - Date.now();
  if (left > 0) return toast(`Namen ändern geht erst wieder in ${Math.ceil(left / 86400000)} Tag(en)`, 'err');
  const err = h('p', { class: 'error' });
  const nameIn = h('input', { value: me.name, maxlength: 16, minlength: 3, required: true, autocomplete: 'username' });
  const pwIn = h('input', { type: 'password', placeholder: 'Passwort zur Bestätigung', required: true, autocomplete: 'current-password' });
  modal([
    h('h2', {}, '✏️ Namen ändern'),
    h('p', { class: 'muted small-note' }, `3–16 Zeichen: Buchstaben, Zahlen, _ und -. Danach kannst du ihn ${RENAME_COOLDOWN_DAYS} Tage nicht mehr ändern. Freunde, Wertungen und alte Partien bleiben erhalten.`),
    h('form', { class: 'create-form', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const d = await api('/api/account/rename', { name: nameIn.value.trim(), password: pwIn.value });
        closeModal();
        toast(`Du heißt jetzt ${d.user.name} ✨`);
        renderProfile(d.user.name);
      } catch (ex) { err.textContent = ex.message; }
    } }, nameIn, pwIn, err,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Abbrechen'), h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'))),
  ]);
  nameIn.select();
}

function passwordDialog() {
  const err = h('p', { class: 'error' });
  const oldIn = h('input', { type: 'password', placeholder: 'Aktuelles Passwort', required: true, autocomplete: 'current-password' });
  const newIn = h('input', { type: 'password', placeholder: 'Neues Passwort (mind. 6 Zeichen)', required: true, minlength: 6, autocomplete: 'new-password' });
  const repIn = h('input', { type: 'password', placeholder: 'Neues Passwort wiederholen', required: true, minlength: 6, autocomplete: 'new-password' });
  modal([
    h('h2', {}, '🔑 Passwort ändern'),
    h('p', { class: 'muted small-note' }, 'Andere Geräte werden danach abgemeldet – dieses bleibt angemeldet.'),
    h('form', { class: 'create-form', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (newIn.value !== repIn.value) { err.textContent = 'Die neuen Passwörter stimmen nicht überein'; return; }
      try {
        await api('/api/account/password', { oldPassword: oldIn.value, newPassword: newIn.value });
        closeModal();
        toast('🔑 Passwort geändert');
      } catch (ex) { err.textContent = ex.message; }
    } }, oldIn, newIn, repIn, err,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Abbrechen'), h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'))),
  ]);
}

boot();
