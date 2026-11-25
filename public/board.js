// Wiederverwendbares Schachbrett: Klicken & Ziehen, Zielfelder, Vorzüge, Pfeile (Rechtsklick),
// Zug-Animation. Arbeitet mit einer chess.js-Instanz als Stellung.
import { pieceSvg } from '/pieces.js';

const FILES = 'abcdefgh';
const SVGNS = 'http://www.w3.org/2000/svg';

export function pieceEl(type, color, cls = 'piece', skinVars = '') {
  const el = document.createElement('span');
  el.className = `${cls} ${color}`;
  if (skinVars) el.style.cssText = skinVars;
  el.innerHTML = pieceSvg(type, color);
  return el;
}

export class Board {
  /**
   * opts.onMove(from, to) → wird nur für legale Züge aufgerufen
   * opts.canMove(color) → darf der Nutzer gerade diese Farbe ziehen?
   * opts.canPremove(color) → darf ein Vorzug eingegeben werden?
   * opts.onPremove(premove|null)
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.orientation = 'w';
    this.chess = null;
    this.selected = null;
    this.lastMove = null;
    this.premove = null;
    this.arrows = [];
    this.marks = new Set();
    this.hint = null;
    this.showCoords = true;
    this.highlightLast = true;
    this.animate = true;
    this.drag = null;
    this.rightStart = null;
    this.extraClasses = new Map(); // Feld -> Klasse (z. B. Analyse)
    this.squares = [];
    this.build();
    this.bind();
  }

  build() {
    this.el.classList.add('board');
    this.el.replaceChildren();
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.arrowLayer = document.createElementNS(SVGNS, 'svg');
    this.arrowLayer.setAttribute('viewBox', '0 0 800 800');
    this.arrowLayer.classList.add('arrow-layer');
    this.arrowLayer.innerHTML = `<defs>
      <marker id="ah-g" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#15781B"/></marker>
      <marker id="ah-o" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#e68f00"/></marker>
      <marker id="ah-b" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#2f6fdb"/></marker>
    </defs><g class="arrows"></g>`;
    this.el.append(this.grid, this.arrowLayer);
  }

  sqAt(i) {
    const r = this.orientation === 'w' ? Math.floor(i / 8) : 7 - Math.floor(i / 8);
    const f = this.orientation === 'w' ? i % 8 : 7 - (i % 8);
    return { sq: FILES[f] + (8 - r), r, f };
  }

  // Bildschirmposition (0..7) eines Feldes
  posOf(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    return this.orientation === 'w' ? { col: f, row: r } : { col: 7 - f, row: 7 - r };
  }

  setChess(chess, { lastMove = undefined, animate = false } = {}) {
    const prevMove = this.lastMove;
    this.chess = chess;
    if (lastMove !== undefined) this.lastMove = lastMove;
    this.selected = null;
    this.render();
    if (animate && this.animate && this.lastMove && this.lastMove !== prevMove) this.animateMove(this.lastMove);
  }

  setOrientation(o) { this.orientation = o; this.render(); }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  clearAnnotations() { this.arrows = []; this.marks.clear(); this.drawArrows(); this.render(); }

  render() {
    if (!this.chess) return;
    const chess = this.chess;
    const legal = this.selected ? this.legalFrom(this.selected) : [];
    const targets = new Map(legal.map((m) => [m.to, m]));
    let checkSq = null;
    if (chess.inCheck()) {
      for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) checkSq = p.square;
    }
    const cells = [];
    for (let i = 0; i < 64; i++) {
      const { sq, r, f } = this.sqAt(i);
      const p = chess.get(sq);
      const cls = ['sq'];
      if ((r + f) % 2 === 1) cls.push('dark');
      if (this.highlightLast && this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)) cls.push('last');
      if (this.selected === sq) cls.push('sel');
      if (this.premove && (this.premove.from === sq || this.premove.to === sq)) cls.push('premove');
      if (this.marks.has(sq)) cls.push('marked');
      if (this.hint && this.hint.from === sq) cls.push('hint');
      if (targets.has(sq)) cls.push('target', p || targets.get(sq).flags?.includes('e') ? 'capture' : 'empty');
      if (checkSq === sq) cls.push('check');
      const extra = this.extraClasses.get(sq);
      if (extra) cls.push(extra);
      const el = document.createElement('div');
      el.className = cls.join(' ');
      el.dataset.sq = sq;
      if (this.showCoords) {
        if (i % 8 === 0) el.insertAdjacentHTML('beforeend', `<span class="coord rank">${8 - r}</span>`);
        if (i >= 56) el.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[f]}</span>`);
      }
      if (p) el.append(pieceEl(p.type, p.color));
      cells.push(el);
    }
    this.grid.replaceChildren(...cells);
    this.drawArrows();
  }

  animateMove(m) {
    const toEl = this.grid.querySelector(`[data-sq="${m.to}"] .piece`);
    if (!toEl) return;
    const a = this.posOf(m.from), b = this.posOf(m.to);
    const dx = (a.col - b.col) * 100, dy = (a.row - b.row) * 100;
    toEl.style.transition = 'none';
    toEl.style.transform = `translate(${dx}%, ${dy}%)`;
    toEl.getBoundingClientRect();
    toEl.style.transition = 'transform .16s ease-out';
    toEl.style.transform = '';
  }

  legalFrom(sq) {
    if (!this.chess) return [];
    try { return this.chess.moves({ square: sq, verbose: true }); } catch { return []; }
  }

  // ---------- Pfeile ----------
  drawArrows() {
    const g = this.arrowLayer.querySelector('.arrows');
    const all = [...this.arrows];
    if (this.hint) all.push({ ...this.hint, color: 'b' });
    g.innerHTML = all.map(({ from, to, color = 'g' }) => {
      const a = this.posOf(from), b = this.posOf(to);
      const x1 = a.col * 100 + 50, y1 = a.row * 100 + 50, x2 = b.col * 100 + 50, y2 = b.row * 100 + 50;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ex = x2 - ((x2 - x1) / len) * 30, ey = y2 - ((y2 - y1) / len) * 30;
      const stroke = color === 'o' ? '#e68f00' : color === 'b' ? '#2f6fdb' : '#15781B';
      return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="18" stroke-linecap="round" opacity=".8" marker-end="url(#ah-${color})"/>`;
    }).join('');
  }

  // ---------- Eingabe ----------
  squareFromPoint(x, y) {
    const rect = this.grid.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return null;
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    return this.sqAt(row * 8 + col).sq;
  }

  bind() {
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMoveDrag(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
  }

  myColorTurn() { return this.chess.turn(); }

  onDown(e) {
    if (!this.chess) return;
    const sq = this.squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) { this.rightStart = sq; return; }
    if (e.button !== 0) return;
    // Linksklick löscht Pfeile
    if (this.arrows.length || this.marks.size) { this.arrows = []; this.marks.clear(); this.drawArrows(); }
    const p = this.chess.get(sq);
    const turn = this.chess.turn();
    const canMove = this.opts.canMove?.(turn);
    const premoveColor = this.opts.canPremove?.();

    if (this.selected && this.selected !== sq) {
      if (canMove && this.legalFrom(this.selected).some((m) => m.to === sq)) { this.commit(this.selected, sq); return; }
      if (premoveColor && this.chess.get(this.selected)?.color === premoveColor) { this.setPremove({ from: this.selected, to: sq }); return; }
    }
    const pickable = p && ((canMove && p.color === turn) || (premoveColor && p.color === premoveColor));
    if (pickable) {
      const wasSelected = this.selected === sq;
      this.selected = sq;
      if (this.premove && premoveColor) this.setPremove(null, false);
      this.render();
      const pieceElm = this.grid.querySelector(`[data-sq="${sq}"] .piece`);
      const ghost = pieceElm.cloneNode(true);
      ghost.classList.add('dragging');
      ghost.style.width = pieceElm.getBoundingClientRect().width + 'px';
      pieceElm.style.opacity = '0.3';
      this.drag = { from: sq, ghost, wasSelected, x: e.clientX, y: e.clientY, moved: false };
      this.positionGhost(e);
      document.body.append(ghost);
    } else {
      this.selected = null;
      if (this.premove) this.setPremove(null, false);
      this.render();
    }
  }

  positionGhost(e) {
    if (!this.drag) return;
    this.drag.ghost.style.left = e.clientX + 'px';
    this.drag.ghost.style.top = e.clientY + 'px';
    if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.moved = true;
  }

  onMoveDrag(e) { this.positionGhost(e); }

  onUp(e) {
    if (e.button === 2 && this.rightStart) {
      const to = this.squareFromPoint(e.clientX, e.clientY);
      const from = this.rightStart;
      this.rightStart = null;
      if (!to) return;
      if (to === from) { this.marks.has(to) ? this.marks.delete(to) : this.marks.add(to); this.render(); return; }
      const color = e.shiftKey ? 'o' : e.altKey || e.ctrlKey ? 'b' : 'g';
      const i = this.arrows.findIndex((a) => a.from === from && a.to === to);
      if (i >= 0) this.arrows.splice(i, 1); else this.arrows.push({ from, to, color });
      this.drawArrows();
      return;
    }
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    d.ghost.remove();
    const to = this.squareFromPoint(e.clientX, e.clientY);
    if (to && to !== d.from) {
      const turn = this.chess.turn();
      if (this.opts.canMove?.(turn) && this.legalFrom(d.from).some((m) => m.to === to)) return this.commit(d.from, to);
      const pc = this.opts.canPremove?.();
      if (pc && this.chess.get(d.from)?.color === pc) return this.setPremove({ from: d.from, to });
    }
    if (!d.moved && d.wasSelected) this.selected = null;
    this.render();
  }

  setPremove(pm, notify = true) {
    this.premove = pm;
    this.selected = null;
    if (notify) this.opts.onPremove?.(pm);
    this.render();
  }

  commit(from, to) {
    this.selected = null;
    this.opts.onMove?.(from, to);
  }
}
