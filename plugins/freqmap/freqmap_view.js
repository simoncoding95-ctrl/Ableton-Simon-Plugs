// FreqMap — grille 16 pas par piste. Une ligne par piste équipée d'une
// FreqMap Probe, une colonne par pas de 1/16 sur 1 mesure, et dans chaque case
// le spectre de la piste à ce pas (grave en bas). Les zones où plusieurs pistes
// sont fortes sur la même bande au même pas sont en couleur pleine et cerclées
// de blanc ; le reste est atténué. Dernière ligne : synthèse des conflits.
autowatch = 1;
inlets = 1;
outlets = 1; // "open" -> pcontrol (grande fenêtre)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var N = 30, F0 = 25, R = Math.pow(2, 1 / 3);
var RANGE_DB = 20;     // affiché = à moins de 20 dB du pic de la piste
var FLOOR_DB = -66;    // en dessous : silence
var CONFLICT_DB = 9;   // fort = à moins de 9 dB du pic de la piste
var LAT_MS = 40;       // retard estimé entre l'audio de la probe et la position lue dans Live

var tracks = {};       // id -> {name, color, gacc[][], gfull[][], gcycle, last}
var order = [];        // ids dans l'ordre du Live Set
var hoverX = -1, hoverY = -1;
var buttons = [];
var toolbarH = 15;
var lastSlow = 0;
var sigNum = 4, sigDen = 4, tempo = 120;
var playing = 0, songTime = 0, pollAt = 0, curStep = -1, songApi = null;

function fc(i) { return F0 * Math.pow(R, i); }
function filled(v) { var a = []; for (var i = 0; i < N; i++) a[i] = v; return a; }
function newGrid(n) { var a = []; for (var s = 0; s < n; s++) a[s] = filled(-120); return a; }
function steps() { return Math.round(sigNum * 16 / sigDen); }     // 1 mesure en 1/16
function barLen() { return sigNum * 4 / sigDen; }                 // 1 mesure en noires
function rgb(c) { return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; }

// Position estimée (en noires) de l'audio reçu à l'instant "now".
function estTime(now) { return songTime + (now - pollAt - LAT_MS) / 1000 * tempo / 60; }

function probe() {
    var a = arrayfromargs(arguments);
    var id = String(a[0]);
    var now = Date.now();
    var t = tracks[id];
    if (!t) t = tracks[id] = { gcycle: -1 };
    t.color = Number(a[1]);
    t.name = String(a[2]);
    t.last = now;
    var n = steps();
    if (!t.gacc || t.gacc.length !== n) { t.gacc = newGrid(n); t.gfull = newGrid(n); t.gcycle = -1; }
    if (!playing) return;
    var len = barLen(), tt = estTime(now);
    if (tt < 0) return;
    var gc = Math.floor(tt / len);
    if (gc !== t.gcycle) {
        t.gfull = gc === t.gcycle + 1 ? t.gacc : newGrid(n);
        t.gacc = newGrid(n);
        t.gcycle = gc;
    }
    var st = Math.floor((tt - gc * len) / len * n);
    if (st < 0 || st >= n) return;
    var cell = t.gacc[st];
    for (var i = 0; i < N; i++) { var v = Number(a[3 + i]); if (v > cell[i]) cell[i] = v; }
}

function bye(id) { delete tracks[String(id)]; }

function reset() {
    for (var id in tracks) { tracks[id].gacc = null; tracks[id].gcycle = -1; }
}

// Case affichée : pas déjà joués dans la mesure en cours -> mesure en cours,
// sinon mesure précédente.
function gridCell(t, st) {
    if (!t.gacc) return null;
    return st <= curStep ? t.gacc[st] : t.gfull[st];
}

function pollTransport(slow) {
    try {
        if (!songApi || songApi.id == 0) songApi = new LiveAPI("live_set");
        if (songApi.id == 0) return;
        playing = Number(songApi.get("is_playing"));
        songTime = Number(songApi.get("current_song_time"));
        pollAt = Date.now();
        if (slow) {
            sigNum = Number(songApi.get("signature_numerator")) || 4;
            sigDen = Number(songApi.get("signature_denominator")) || 4;
            tempo = Number(songApi.get("tempo")) || 120;
        }
    } catch (e) { return; }
    if (playing) {
        var len = barLen(), tt = estTime(Date.now());
        curStep = tt < 0 ? -1 : Math.floor((tt - Math.floor(tt / len) * len) / len * steps());
    }
}

function refreshOrder() {
    try {
        var s = new LiveAPI("live_set");
        if (s.id == 0) return;
        var ids = [];
        var lists = [s.get("tracks"), s.get("return_tracks"), s.get("master_track")];
        for (var l = 0; l < lists.length; l++) {
            var L = lists[l];
            for (var k = 0; k + 1 < L.length; k += 2) if (L[k] === "id") ids.push(String(L[k + 1]));
        }
        order = ids;
    } catch (e) { }
}

function sortedIds() {
    var now = Date.now();
    var out = [];
    for (var id in tracks) {
        if (now - tracks[id].last > 3000) { delete tracks[id]; continue; }
        if (tracks[id].gacc) out.push(id);
    }
    out.sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia < 0) ia = 9999; if (ib < 0) ib = 9999;
        return ia - ib;
    });
    return out;
}

var task = new Task(function () {
    var now = Date.now();
    var slow = now - lastSlow > 500;
    if (slow) lastSlow = now;
    if (slow && Math.random() < 0.25) refreshOrder();
    pollTransport(slow);
    mgraphics.redraw();
}, this);
task.interval = 20;
task.repeat();

function fmtHz(f) {
    if (f >= 1000) return (Math.round(f / 100) / 10) + " kHz";
    return Math.round(f) + " Hz";
}

// Teinte "hors conflit" : couleur de la piste désaturée et assombrie.
function dim(c) {
    var l = (c[0] + c[1] + c[2]) / 3;
    return [l * 0.35 + c[0] * 0.4, l * 0.35 + c[1] * 0.4, l * 0.35 + c[2] * 0.4];
}

function fit(g, s, w) {
    if (g.text_measure(s)[0] <= w) return s;
    while (s.length > 1 && g.text_measure(s + "…")[0] > w) s = s.substring(0, s.length - 1);
    return s + "…";
}

function paint() {
    var g = mgraphics;
    var sz = g.size || [box.rect[2] - box.rect[0], box.rect[3] - box.rect[1]];
    var W = sz[0], H = sz[1];
    var big = W > 900;
    var fs = big ? 12 : 9;
    var top = big ? 26 : 15, bottom = big ? 20 : 13, L = 6, Rm = 6;
    toolbarH = top;

    g.set_source_rgba(0.12, 0.12, 0.13, 1);
    g.rectangle(0, 0, W, H); g.fill();
    g.select_font_face("Arial Bold");
    g.set_font_size(fs);

    var n = steps();
    var nameW = big ? 110 : 64;
    var x0 = L + nameW, gw = W - Rm - x0, cw = gw / n, ph = H - top - bottom;
    var perBeat = Math.max(1, Math.round(16 / sigDen));
    var s, i, r, k;

    // Colonnes : temps marqués, pas courant en surbrillance
    for (s = 0; s < n; s++) {
        var cx = x0 + s * cw;
        if (s % perBeat === 0) {
            g.set_source_rgba(1, 1, 1, s === 0 ? 0.35 : 0.15);
            g.move_to(cx, top); g.line_to(cx, top + ph); g.stroke();
            g.set_source_rgba(1, 1, 1, 0.45);
            g.move_to(cx + 2, H - 3); g.show_text(String(s + 1));
        }
        if (playing && s === curStep) {
            g.set_source_rgba(1, 1, 1, 0.08);
            g.rectangle(cx, top, cw, ph); g.fill();
        }
    }

    var ids = sortedIds();
    if (ids.length === 0) {
        g.set_source_rgba(1, 1, 1, 0.6);
        g.move_to(x0 + 8, top + ph / 2); g.show_text("Pose « FreqMap Probe » sur chaque piste à cartographier");
    }

    // Conflit = au moins 2 pistes fortes sur la même bande au même pas.
    var mx = {}, who = [];
    for (s = 0; s < n; s++) { who[s] = []; for (i = 0; i < N; i++) who[s][i] = []; }
    for (r = 0; r < ids.length; r++) {
        var t = tracks[ids[r]], m = -200, c;
        for (s = 0; s < n; s++) { c = gridCell(t, s); if (c) for (i = 0; i < N; i++) m = Math.max(m, c[i]); }
        mx[ids[r]] = m;
        for (s = 0; s < n; s++) {
            c = gridCell(t, s); if (!c) continue;
            for (i = 0; i < N; i++) if (m > FLOOR_DB && c[i] > FLOOR_DB && c[i] >= m - CONFLICT_DB) who[s][i].push(t.name);
        }
    }
    var hover = null;
    var lane = ids.length > 1 ? 1 : 0;
    var count = ids.length + lane;
    var rowH = count ? Math.min(ph / count, big ? 120 : 60) : 0;

    for (r = 0; r < count; r++) {
        var gap = rowH > 8 ? 2 : 1;
        var y = top + r * rowH + gap / 2, h = rowH - gap, bh = h / N;
        var isLane = r === ids.length;
        var tr = isLane ? null : tracks[ids[r]];
        var col = isLane ? [1, 1, 1] : rgb(tr.color), mm = isLane ? 0 : mx[ids[r]];
        g.set_source_rgba(col[0], col[1], col[2], 1);
        g.rectangle(L, y, 3, h); g.fill();
        if (h >= fs - 2) {
            g.set_source_rgba(1, 1, 1, 0.9);
            g.move_to(L + 6, y + h / 2 + fs / 3); g.show_text(fit(g, isLane ? "CONFLITS" : tr.name, nameW - 10));
        }
        var refs = [[100, "100"], [1000, "1k"], [10000, "10k"]];
        for (k = 0; k < refs.length; k++) {
            var ry = y + h - (Math.log(refs[k][0] / F0) / Math.log(R) + 0.5) * bh;
            g.set_source_rgba(1, 1, 1, 0.07);
            g.move_to(x0, ry); g.line_to(x0 + gw, ry); g.stroke();
            if (bh * 6 >= fs) {
                g.set_source_rgba(1, 1, 1, 0.3);
                g.move_to(x0 - g.text_measure(refs[k][1])[0] - 3, ry + fs / 3); g.show_text(refs[k][1]);
            }
        }
        for (s = 0; s < n; s++) {
            var sx = x0 + s * cw, cell = isLane ? null : gridCell(tr, s);
            g.set_source_rgba(1, 1, 1, 0.04);
            g.rectangle(sx + 0.5, y, cw - 1, h); g.fill();
            if (isLane) {
                // Synthèse : seulement les bandes en conflit, plus vif à 3 pistes et plus.
                for (i = 0; i < N; i++) {
                    var nb = who[s][i].length;
                    if (nb < 2) continue;
                    g.set_source_rgba(1, 1, 1, nb >= 3 ? 0.95 : 0.6);
                    g.rectangle(sx + 0.5, y + h - (i + 1) * bh, cw - 1, Math.max(bh, 1)); g.fill();
                }
            } else if (cell && mm > FLOOR_DB) {
                var dc = dim(col);
                for (i = 0; i < N; i++) {
                    var a = (cell[i] - (mm - RANGE_DB)) / RANGE_DB;
                    if (a <= 0 || cell[i] <= FLOOR_DB) continue;
                    var on = who[s][i].length > 1 && cell[i] >= mm - CONFLICT_DB;
                    var cc = on ? col : dc;
                    g.set_source_rgba(cc[0], cc[1], cc[2], Math.min(a, 1) * (on ? 1 : 0.6));
                    g.rectangle(sx + 0.5, y + h - (i + 1) * bh, cw - 1, Math.max(bh, 1)); g.fill();
                }
                // Contour blanc autour de chaque zone contiguë en conflit
                var start = -1;
                for (i = 0; i <= N; i++) {
                    var inC = i < N && who[s][i].length > 1 && cell[i] >= mm - CONFLICT_DB;
                    if (inC && start < 0) start = i;
                    if (!inC && start >= 0) {
                        g.set_source_rgba(1, 1, 1, 0.95);
                        g.rectangle(sx + 1.5, y + h - i * bh, cw - 3, (i - start) * bh); g.stroke();
                        start = -1;
                    }
                }
            }
            if (hoverX >= sx && hoverX < sx + cw && hoverY >= y && hoverY < y + h) {
                var bi = Math.min(N - 1, Math.max(0, Math.floor((y + h - hoverY) / bh)));
                var w = who[s][bi];
                hover = "pas " + (s + 1) + " · " + fmtHz(fc(bi)) +
                    (w.length > 1 ? " : conflit " + w.join(" + ") : w.length ? " : " + w[0] : "");
            }
        }
    }
    if (hover) {
        var hw = g.text_measure(hover)[0] + 8;
        var hx = Math.min(Math.max(hoverX + 6, 0), W - hw - 2);
        g.set_source_rgba(0, 0, 0, 0.85);
        g.rectangle(hx, top + 1, hw, fs + 5); g.fill();
        g.set_source_rgba(1, 1, 1, 0.95);
        g.move_to(hx + 4, top + fs + 2); g.show_text(hover);
    }

    // Barre d'outils
    buttons = [];
    g.set_source_rgba(0.93, 0.45, 0.13, 1);
    g.move_to(L, top - 4); g.show_text("FreqMap");
    g.set_source_rgba(1, 1, 1, playing ? 0.9 : 0.5);
    g.move_to(L + g.text_measure("FreqMap")[0] + 10, top - 4);
    g.show_text(n + " pas" + (playing ? "  ● pas " + (curStep + 1) : "  lecture arrêtée"));
    var labels = [["reset", "RESET"]];
    if (!big) labels.push(["open", "AGRANDIR"]);
    var bx = W - Rm;
    for (k = labels.length - 1; k >= 0; k--) {
        var lw = g.text_measure(labels[k][1])[0] + 8;
        bx -= lw;
        g.set_source_rgba(1, 1, 1, 0.15);
        g.rectangle_rounded(bx, 1, lw, top - 3, 3, 3); g.fill();
        g.set_source_rgba(1, 1, 1, 0.85);
        g.move_to(bx + 4, top - 4); g.show_text(labels[k][1]);
        buttons.push([labels[k][0], bx, bx + lw]);
        bx -= 3;
    }
}

function onclick(x, y) {
    if (y > toolbarH) return;
    for (var k = 0; k < buttons.length; k++) {
        var b = buttons[k];
        if (x < b[1] || x > b[2]) continue;
        if (b[0] === "reset") reset();
        else if (b[0] === "open") outlet(0, "open");
        mgraphics.redraw();
        return;
    }
}

function onidle(x, y) { hoverX = x; hoverY = y; }
function onidleout() { hoverX = -1; hoverY = -1; }

function notifydeleted() { task.cancel(); }
