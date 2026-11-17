// Rend freqmap_view.js en SVG avec une API mgraphics simulée et des données de démo.
// Usage : node tools/render_view.js <freqmap_view.js> <out.svg> [tracks|guide]
const fs = require('fs');
const [src, out, mode = 'tracks'] = process.argv.slice(2);
const W = 1200, H = 420;
let el = [], path = '', col = 'rgba(0,0,0,1)', fsz = 10;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const g = {
  size: [W, H], init: () => {},
  set_source_rgba: (r, gg, b, a) => { col = `rgba(${r*255|0},${gg*255|0},${b*255|0},${a})`; },
  rectangle: (x, y, w, h) => { path += `M${x},${y}h${w}v${h}h${-w}Z`; },
  rectangle_rounded: (x, y, w, h, r) => { r = Math.min(r, w/2, h/2); path += `M${x+r},${y}h${w-2*r}a${r},${r} 0 0 1 ${r},${r}v${h-2*r}a${r},${r} 0 0 1 ${-r},${r}h${-(w-2*r)}a${r},${r} 0 0 1 ${-r},${-r}v${-(h-2*r)}a${r},${r} 0 0 1 ${r},${-r}Z`; },
  move_to: (x, y) => { path += `M${x},${y}`; g._x = x; g._y = y; },
  line_to: (x, y) => { path += `L${x},${y}`; },
  fill: () => { el.push(`<path d="${path}" fill="${col}"/>`); path = ''; },
  stroke: () => { el.push(`<path d="${path}" fill="none" stroke="${col}" stroke-width="1"/>`); path = ''; },
  select_font_face: () => {}, set_font_size: s => { fsz = s; },
  text_measure: s => [String(s).length * fsz * 0.6, fsz],
  show_text: s => { el.push(`<text x="${g._x}" y="${g._y}" fill="${col}" font-family="Arial" font-weight="bold" font-size="${fsz}">${esc(s)}</text>`); path = ''; },
};
const ctx = { mgraphics: g, Task: function () { this.repeat = () => {}; this.cancel = () => {}; },
  LiveAPI: function () { this.id = 0; }, outlet: () => {}, post: () => {}, box: { rect: [0, 0, W, H] },
  arrayfromargs: a => Array.prototype.slice.call(a) };
const m = new Function(...Object.keys(ctx), fs.readFileSync(src, 'utf8') +
  ';return {probe,paint,onclick,onidle,set:(k)=>{mode=k}};')(...Object.values(ctx));
// Profils de démo : [nom, couleur, bande du pic, largeur (bandes), seconde bosse]
const demo = [['Kick', 0xff5a4e, 3, 2, [21, 30]], ['Basse', 0xffa53d, 5, 3], ['Clap', 0xf2d24a, 10, 4, [24, 22]],
  ['Accords', 0x6fd36f, 14, 5], ['Lead', 0x4ec3ff, 19, 4], ['Hats', 0xb98cff, 26, 2], ['Reverb (A)', 0x8a8a8a, 18, 7]];
const prof = (pk, w, b2) => Array.from({ length: 30 }, (_, i) => {
  let v = -18 - Math.pow(Math.abs(i - pk) / w, 2) * 12;
  if (b2) v = Math.max(v, -18 - b2[1] / 2 - Math.pow(Math.abs(i - b2[0]) / 1.5, 2) * 8);
  return Math.max(v, -110);
});
demo.forEach((d, k) => m.probe(k + 1, d[1], d[0], ...prof(d[2], d[3], d[4])));
if (mode === 'guide') m.set('guide');
m.onidle(mode === 'guide' ? -1 : 300, 60);
m.paint();
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${el.join('')}</svg>`);
