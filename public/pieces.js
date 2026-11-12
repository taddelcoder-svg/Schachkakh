// Eigene SVG-Figuren (viewBox 0 0 45 45). Füllung/Kontur kommen aus den Skin-Farben.
const BASE = '<path d="M10 39h25v3H10z"/><path d="M12.5 36h20l1.5 3H11z"/>';

const SHAPES = {
  p: `<circle cx="22.5" cy="13" r="5.5"/>
      <path d="M17.5 19.5h10l-1 2.5c3.5 2.5 5 7 5.5 14h-19c.5-7 2-11.5 5.5-14z"/>${BASE}`,
  r: `<path d="M12 9h4v3h3V9h7v3h3V9h4v6l-3 3H15l-3-3z"/>
      <path d="M15 18h15l1 15H14z"/><path d="M13 33h19l1 3H12z"/>${BASE}`,
  n: `<path d="M13 36c0-7 3-10 6-13-2 0-4 1-6 3-1.5 1.5-4 1-4.5-1-.5-2 3-6 6-9 1.5-1.5 2-4 3-6l1.5 2 1.5-3 2 3c7 1 12 7 12 15v9z"/>
      <circle cx="17.5" cy="15.5" r="1.3" class="eye"/>${BASE}`,
  b: `<circle cx="22.5" cy="7.5" r="2.5"/>
      <path d="M22.5 10c5 3.5 7.5 8 7.5 12 0 4-2.5 6-4 7h-7c-1.5-1-4-3-4-7 0-4 2.5-8.5 7.5-12z"/>
      <path d="M24.5 14l-4 6" class="cut"/>
      <path d="M17 29h11l2 7H15z"/>${BASE}`,
  q: `<circle cx="9" cy="12" r="2.5"/><circle cx="16" cy="8.5" r="2.5"/><circle cx="22.5" cy="7" r="2.5"/>
      <circle cx="29" cy="8.5" r="2.5"/><circle cx="36" cy="12" r="2.5"/>
      <path d="M9 14l5 13 2-15 4 13 2.5-15 2.5 15 4-13 2 15 5-13-3 16H12z"/>
      <path d="M12 30h21l-1.5 6h-18z"/>${BASE}`,
  k: `<path d="M21 3h3v3h3v3h-3v4h-3V9h-3V6h3z"/>
      <path d="M22.5 13c3 0 4.5 2.5 4.5 5 0 2-1 4-1 4h-7s-1-2-1-4c0-2.5 1.5-5 4.5-5z"/>
      <path d="M11 20c3-3 7-1 11.5 3 4.5-4 8.5-6 11.5-3 3 3 1 8-3 11H14c-4-3-6-8-3-11z"/>
      <path d="M13 31h19l-1 5H14z"/>${BASE}`,
};

export function pieceSvg(type, color) {
  return `<svg viewBox="0 0 45 45" class="piece-svg ${color}" aria-hidden="true"><g>${SHAPES[type]}</g></svg>`;
}
