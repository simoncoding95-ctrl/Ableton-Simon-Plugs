// Rend freqmap_view.js en SVG avec une API mgraphics simulée et des données de démo.
// Usage : node tools/render_view.js <freqmap_view.js> <out.svg> [tracks|guide|grid]
const fs = require('fs');
const [src, out, mode = 'tracks'] = process.argv.slice(2);
const W = 1200, H = 420;
let el = [], path = '', col = 'rgba(0,0,0,1)', fsz = 10;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const g = {
  size: [W, H], init: () => {}, redraw: () => {},
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
let tick = null, clock = 1e6;
Date.now = () => clock;
const song = { is_playing: 0, current_song_time: 0, signature_numerator: 4, signature_denominator: 4, tempo: 125 };
const ctx = { mgraphics: g, Task: function (f) { tick = f; this.repeat = () => {}; this.cancel = () => {}; },
  LiveAPI: function () { this.id = mode === 'grid' ? 1 : 0; this.get = k => [song[k]]; }, outlet: () => {}, post: () => {}, box: { rect: [0, 0, W, H] },
  arrayfromargs: a => Array.prototype.slice.call(a) };
const m = new Function(...Object.keys(ctx), fs.readFileSync(src, 'utf8') +
  ';return {probe,paint,onclick,onidle,set:(k)=>{mode=k},tracks:()=>tracks};')(...Object.values(ctx));
// Profils de démo : [nom, couleur, bande du pic, largeur (bandes), seconde bosse]
const demo = [['Kick', 0xff5a4e, 3, 2, [21, 30]], ['Basse', 0xffa53d, 5, 3], ['Clap', 0xf2d24a, 10, 4, [24, 22]],
  ['Accords', 0x6fd36f, 14, 5], ['Lead', 0x4ec3ff, 19, 4], ['Hats', 0xb98cff, 26, 2], ['Reverb (A)', 0x8a8a8a, 18, 7]];
const prof = (pk, w, b2) => Array.from({ length: 30 }, (_, i) => {
  let v = -18 - Math.pow(Math.abs(i - pk) / w, 2) * 12;
  if (b2) v = Math.max(v, -18 - b2[1] / 2 - Math.pow(Math.abs(i - b2[0]) / 1.5, 2) * 8);
  return Math.max(v, -110);
});
if (mode === 'grid') {
  // Pattern 1 mesure à 125 BPM : l'audio arrive à la vue avec 40 ms de retard.
  const pat = [['Kick', 0xff5a4e, [0, 4, 8, 12], [2, 5]], ['Basse', 0xffa53d, [0, 2, 6, 10, 14], [3, 7]],
    ['Clap', 0xf2d24a, [4, 12], [9, 14]], ['Hats', 0xb98cff, [1, 3, 5, 7, 9, 11, 13, 15], [25, 28]]];
  const spb = 60 / 125, stepMs = spb / 4 * 1000;
  song.is_playing = 1;
  for (let ms = 0; ms < 4 * 4 * spb * 1000 + 20 * stepMs; ms += 20) {    // 4 mesures + 5 pas
    clock = 1e6 + ms;
    if (ms % 60 === 0) { song.current_song_time = ms / 1000 / spb; tick(); }
    const audioStep = Math.floor((ms - 40) / stepMs) % 16, phase = ((ms - 40) % stepMs) / stepMs;
    pat.forEach((p, k) => {
      const hit = ms >= 40 && p[2].includes(audioStep) && phase < 0.6;
      m.probe(k + 1, p[1], p[0], ...Array.from({ length: 30 }, (_, i) => hit && i >= p[3][0] && i <= p[3][1] ? -14 - Math.abs(i - (p[3][0] + p[3][1]) / 2) * 3 : -110));
    });
  }
  const t = m.tracks()['1'];
  const steps = t.gfull.map((c, s) => Math.max(...c) > -60 ? s + 1 : null).filter(Boolean);
  console.error('Kick, pas actifs (cycle complet) :', steps.join(' '));
  console.error('Hats, pas actifs :', m.tracks()['4'].gfull.map((c, s) => Math.max(...c) > -60 ? s + 1 : null).filter(Boolean).join(' '));
} else demo.forEach((d, k) => m.probe(k + 1, d[1], d[0], ...prof(d[2], d[3], d[4])));
if (mode !== 'tracks') m.set(mode);
m.onidle(mode === 'guide' ? -1 : mode === 'grid' ? 140 : 300, mode === 'grid' ? 110 : 60);
m.paint();
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${el.join('')}</svg>`);
