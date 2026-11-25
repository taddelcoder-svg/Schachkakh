// Darstellung & Eingabe für 4-Spieler-Schach (14×14)
import { FourChess, SIZE, COLORS, COLOR_NAMES, onBoard, idx } from '/shared/fourchess.js';
import { pieceEl } from '/board.js';

export const FP_COLORS = {
  r: { fill: '#e04848', stroke: '#4a0d0d', css: '#e04848' },
  b: { fill: '#3f86e8', stroke: '#0b2850', css: '#3f86e8' },
  y: { fill: '#f2c230', stroke: '#5a4300', css: '#e8b923' },
  g: { fill: '#3fb35c', stroke: '#0c3d18', css: '#3fb35c' },
  dead: { fill: '#a3a3a3', stroke: '#444', css: '#999' },
};

const vars = (c) => `--pw-fill:${c.fill};--pw-stroke:${c.stroke};--glow-w:drop-shadow(0 0 0 transparent)`;

// Brett so drehen, dass die eigene Farbe unten sitzt
function toDisplay(x, y, me) {
  switch (me) {
    case 'b': return [13 - y, x];
    case 'y': return [13 - x, 13 - y];
    case 'g': return [y, 13 - x];
    default: return [x, y];
  }
}

export class FourView {
  constructor(el, { onMove } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.game = null;
    this.me = 'r';
    this.selected = null;
    this.interactive = false;
    this.lastMove = null;
    el.classList.add('fp-board');
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setState(state, { me, interactive }) {
    this.game = FourChess.fromJSON(state);
    if (me) this.me = me;
    this.interactive = interactive;
    this.lastMove = state.lastMove && state.lastMove.from != null ? state.lastMove : null;
    if (this.selected != null && (!interactive || this.game.board[this.selected]?.c !== this.me)) this.selected = null;
    this.render();
  }

  render() {
    const g = this.game;
    if (!g) return;
    const targets = new Set(this.selected != null ? g.movesFrom(this.selected).map((m) => m.to) : []);
    const checked = new Set(COLORS.filter((c) => g.active[c] && g.inCheck(c)).map((c) => g.kingSquare(c)));
    const cells = new Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [dx, dy] = toDisplay(x, y, this.me);
        const pos = (13 - dy) * SIZE + dx;
        const cell = document.createElement('div');
        if (!onBoard(x, y)) { cell.className = 'fp-void'; cells[pos] = cell; continue; }
        const i = idx(x, y);
        const cls = ['fp-sq', (x + y) % 2 ? 'light' : 'dark'];
        if (this.lastMove && (this.lastMove.from === i || this.lastMove.to === i)) cls.push('last');
        if (this.selected === i) cls.push('sel');
        if (targets.has(i)) cls.push(g.board[i] ? 'target capture' : 'target');
        if (checked.has(i)) cls.push('check');
        cell.className = cls.join(' ');
        cell.dataset.i = i;
        const p = g.board[i];
        if (p) {
          const col = g.active[p.c] ? FP_COLORS[p.c] : FP_COLORS.dead;
          const el = pieceEl(p.t, 'w', 'piece', vars(col));
          if (p.promoted) el.classList.add('promoted');
          cell.append(el);
        }
        cells[pos] = cell;
      }
    }
    this.el.replaceChildren(...cells);
    this.el.classList.toggle('my-turn', this.interactive && g.turn === this.me && g.active[this.me]);
  }

  onClick(e) {
    if (!this.game || !this.interactive) return;
    const cell = e.target.closest('.fp-sq');
    if (!cell) return;
    const i = Number(cell.dataset.i);
    const g = this.game;
    if (g.turn !== this.me) return;
    if (this.selected != null && this.selected !== i && g.movesFrom(this.selected).some((m) => m.to === i)) {
      const from = this.selected;
      this.selected = null;
      this.onMove?.(from, i);
      return;
    }
    const p = g.board[i];
    this.selected = p && p.c === this.me && this.selected !== i ? i : null;
    this.render();
  }
}

export { COLOR_NAMES };
