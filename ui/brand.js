import { XELU_ROWS, XELU_PALETTE, LOGO_PATHS, LOGO_VIEWBOX } from '../assets/xelu-art.js';

const NS = 'http://www.w3.org/2000/svg';
function svgNode(doc, tag, attrs = {}) {
  const node = doc.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
export function createXelu(doc, className = '') {
  const svg = svgNode(doc, 'svg', { viewBox: '0 0 40 40', 'aria-hidden': 'true', focusable: 'false', 'shape-rendering': 'crispEdges', class: 'xelu-mascot ' + className });
  for (let y = 0; y < XELU_ROWS.length; y++) {
    const row = XELU_ROWS[y];
    for (let x = 0; x < row.length;) {
      const color = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === color) end++;
      if (XELU_PALETTE[color]) svg.append(svgNode(doc, 'rect', { x, y, width: end - x, height: 1, fill: XELU_PALETTE[color] }));
      x = end;
    }
  }
  return svg;
}
export function createMark(doc) {
  const svg = svgNode(doc, 'svg', { viewBox: LOGO_VIEWBOX, 'aria-hidden': 'true', focusable: 'false', class: 'xelu-mark' });
  for (const [stroke, offset] of [['#8a2d45', -40], ['#2d7f86', 40], ['#f2f2ef', 0]]) {
    const g = svgNode(doc, 'g', { fill: 'none', stroke, 'stroke-width': 110, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: 'translate(' + offset + ' 0)' });
    for (const d of LOGO_PATHS) g.append(svgNode(doc, 'path', { d }));
    svg.append(g);
  }
  return svg;
}
export function mountBrand(doc) {
  for (const slot of doc.querySelectorAll('[data-xelu-mascot]')) slot.replaceChildren(createXelu(doc));
  for (const slot of doc.querySelectorAll('[data-xelu-mark]')) slot.replaceChildren(createMark(doc));
}
export function xeluMessage(state, level) {
  if (state === 'trusted') return "you've trusted this site.";
  if (state === 'unsupported') return "can't scan this page.";
  if (state === 'failed') return "scan failed. let's try again.";
  if (state === 'scanning') return 'one moment. checking...';
  if (level === 'HIGH') return "hold up. don't take the bait.";
  if (level === 'MEDIUM') return 'something feels off here.';
  return 'no strong signals. stay sharp.';
}
