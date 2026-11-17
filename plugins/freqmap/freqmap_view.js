// FreqMap — vue « où vit chaque son » : une ligne par piste équipée d'une
// FreqMap Probe, sur un axe log 20 Hz – 20 kHz. Les zones où plusieurs
// pistes sont fortes en même temps sont teintées en orange (masquage).
autowatch = 1;
inlets = 1;
outlets = 1; // "open" -> pcontrol (grande fenêtre)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var N = 30, F0 = 25, R = Math.pow(2, 1 / 3);
var FMIN = 20, FMAX = 20000;
var RANGE_DB = 20;     // bande "occupée" = à moins de 20 dB du pic de la piste
var FLOOR_DB = -66;    // en dessous : silence
var CONFLICT_DB = 9;   // conflit = 2 pistes à moins de 9 dB de leur pic sur la même bande
var REL_DB_S = 40;     // retombée de l'affichage instantané (dB/s)
var HOLD_DB_S = 1.5;   // retombée de la mémoire (dB/s) : ~40 s pour oublier

var tracks = {};       // id -> {name, color, cur[], hold[], last}
var order = [];        // ids dans l'ordre du Live Set
var mode = "tracks";   // "tracks" | "grid" | "guide"
var MODES = ["tracks", "grid", "guide"];
var MODE_LABEL = { tracks: "PISTES", grid: "GRILLE", guide: "GUIDE" };
var holdOn = 1;
// Mode BOUCLE : cycle calé sur le tempo (1, 2, 4 ou 8 mesures). La carte montre
// tout ce qui a sonné pendant le dernier cycle complet, renouvelée à chaque cycle.
var LOOP_CHOICES = [0, 1, 2, 4, 8];
var loopBars = 0, loopOn = 0, sigNum = 4, sigDen = 4, cycle = -1;
var playing = 0, songTime = 0, inLoop = 0, songApi = null;
// Mode GRILLE : une ligne par piste, une colonne par pas de 1/16, spectre vertical
// (grave en bas) dans chaque case. Cycle = BOUCLE si active, sinon 1 mesure.
var tempo = 120, pollAt = 0, hoverY = -1, curStep = -1;
var LAT_MS = 40;       // retard estimé probe -> vue (peakamp~ 20 ms + envoi 20 ms)
var hoverX = -1;
var buttons = [];
var lastOrder = 0;
var toolbarH = 15;
var maxRowH = 26;

var GUIDE = [
    ["Sub", 20, 60, 0], ["Kick", 45, 110, 0], ["Basse", 60, 250, 0],
    ["« Boue »", 200, 500, 1], ["Corps snare / synthé", 150, 900, 0],
    ["Présence, attaque", 2000, 5000, 0], ["Hats, cymbales", 5000, 12000, 0],
    ["Air", 10000, 20000, 0]
];
var TICKS = [[20, "20 Hz"], [50, "50"], [100, "100"], [250, "250"], [500, "500"],
    [1000, "1k"], [2500, "2,5k"], [5000, "5k"], [10000, "10k"], [20000, "20k"]];

function fc(i) { return F0 * Math.pow(R, i); }
function fLo(i) { return fc(i) / Math.pow(R, 0.5); }
function fHi(i) { return fc(i) * Math.pow(R, 0.5); }
function filled(v) { var a = []; for (var i = 0; i < N; i++) a[i] = v; return a; }

function probe() {
    var a = arrayfromargs(arguments);
    var id = String(a[0]);
    var now = Date.now();
    var t = tracks[id];
    if (!t) t = tracks[id] = { cur: filled(-120), hold: filled(-120), acc: filled(-120), full: filled(-120), last: now };
    t.color = Number(a[1]);
    t.name = String(a[2]);
    var dt = Math.min(0.5, (now - t.last) / 1000);
    for (var i = 0; i < N; i++) {
        var v = Number(a[3 + i]);
        t.cur[i] = v > t.cur[i] ? v : Math.max(v, t.cur[i] - REL_DB_S * dt);
        if (loopOn) {
            if (inLoop && v > t.acc[i]) t.acc[i] = v;
            t.hold[i] = Math.max(t.full[i], t.acc[i]);
        }
        else if (holdOn) t.hold[i] = v > t.hold[i] ? v : t.hold[i] - HOLD_DB_S * dt;
        else t.hold[i] = t.cur[i];
    }
    gridAdd(t, a, now);
    t.last = now;
}

function gridBars() { return loopBars || 1; }
function gridSteps() { return Math.round(gridBars() * sigNum * 16 / sigDen); }
function newGrid(n) { var a = []; for (var s = 0; s < n; s++) a[s] = filled(-120); return a; }

// Position estimée (en noires) de l'audio reçu à l'instant "now".
function estTime(now) {
    return songTime + (now - pollAt - LAT_MS) / 1000 * tempo / 60;
}

function gridAdd(t, a, now) {
    var n = gridSteps();
    if (!t.gacc || t.gacc.length !== n) { t.gacc = newGrid(n); t.gfull = newGrid(n); t.gcycle = -1; }
    if (!playing) return;
    var len = gridBars() * sigNum * 4 / sigDen;
    var tt = estTime(now);
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

// Case affichée : pas déjà joués dans ce cycle -> cycle en cours, sinon cycle précédent.
function gridCell(t, st) {
    if (!t.gacc) return null;
    return st <= curStep ? t.gacc[st] : t.gfull[st];
}

function bye(id) { delete tracks[String(id)]; }

// Boucle : "full" = dernier passage complet, "acc" = passage en cours.
function loopReset() {
    for (var id in tracks) { tracks[id].full = filled(-120); tracks[id].acc = filled(-120); tracks[id].hold = filled(-120); }
}
function loopWrap() {
    for (var id in tracks) { tracks[id].full = tracks[id].acc; tracks[id].acc = filled(-120); }
}
function loopEnter() {
    for (var id in tracks) tracks[id].acc = filled(-120);
}

function pollTransport(full) {
    try {
        if (!songApi || songApi.id == 0) songApi = new LiveAPI("live_set");
        if (songApi.id == 0) return;
        playing = Number(songApi.get("is_playing"));
        songTime = Number(songApi.get("current_song_time"));
        pollAt = Date.now();
        if (full) {
            sigNum = Number(songApi.get("signature_numerator")) || 4;
            sigDen = Number(songApi.get("signature_denominator")) || 4;
            tempo = Number(songApi.get("tempo")) || 120;
        }
    } catch (e) { return; }
    if (playing) {
        var glen = gridBars() * sigNum * 4 / sigDen;
        var tt = estTime(Date.now());
        curStep = tt < 0 ? -1 : Math.floor((tt - Math.floor(tt / glen) * glen) / glen * gridSteps());
    }
    inLoop = playing && loopOn;
    if (!loopOn || !playing) { cycle = -1; return; }
    var len = loopBars * sigNum * 4 / sigDen;          // en temps (noires)
    var c = Math.floor(songTime / len);
    if (cycle < 0) loopEnter();
    else if (c !== cycle) loopWrap();
    cycle = c;
}

function cyclePos() {
    var len = loopBars * sigNum * 4 / sigDen;
    var steps = loopBars * sigNum * 16 / sigDen;        // pas de 1/16
    return Math.floor((songTime % len) / len * steps) + 1 + " / " + steps;
}

function reset() {
    if (loopOn) { loopReset(); return; }
    for (var id in tracks) tracks[id].hold = tracks[id].cur.slice();
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
        out.push(id);
    }
    out.sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia < 0) ia = 9999; if (ib < 0) ib = 9999;
        return ia - ib;
    });
    return out;
}

// Bandes occupées d'une piste (d'après la mémoire), en segments contigus.
function analyse(t) {
    var mx = -200;
    for (var i = 0; i < N; i++) mx = Math.max(mx, t.hold[i]);
    var segs = [], strong = [], start = -1;
    for (i = 0; i <= N; i++) {
        var on = i < N && mx > FLOOR_DB && t.hold[i] > FLOOR_DB && t.hold[i] >= mx - RANGE_DB;
        if (i < N) strong[i] = mx > FLOOR_DB && t.hold[i] > FLOOR_DB && t.hold[i] >= mx - CONFLICT_DB;
        if (on && start < 0) start = i;
        if (!on && start >= 0) { segs.push([start, i - 1]); start = -1; }
    }
    return { max: mx, segs: segs, strong: strong };
}

function rgb(c) { return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; }

var task = new Task(function () {
    var now = Date.now();
    var slow = now - lastOrder > 500;
    if (slow) lastOrder = now;
    if (slow && Math.random() < 0.25) refreshOrder();
    pollTransport(slow);
    mgraphics.redraw();
}, this);
task.interval = 50;
task.repeat();

function fmtHz(f) {
    if (f >= 1000) return (Math.round(f / 100) / 10) + " kHz";
    return Math.round(f) + " Hz";
}

function paint() {
    var g = mgraphics;
    var sz = g.size || [box.rect[2] - box.rect[0], box.rect[3] - box.rect[1]];
    var W = sz[0], H = sz[1];
    var big = W > 900;
    var fs = big ? 12 : 9;
    var top = big ? 26 : 15, bottom = big ? 20 : 13, L = 6, Rm = 6;
    toolbarH = top;
    maxRowH = mode === "grid" ? (big ? 120 : 60) : (big ? 44 : 26);
    var pw = W - L - Rm, ph = H - top - bottom;
    function X(f) { return L + pw * Math.log(f / FMIN) / Math.log(FMAX / FMIN); }

    g.set_source_rgba(0.12, 0.12, 0.13, 1);
    g.rectangle(0, 0, W, H); g.fill();
    g.select_font_face("Arial Bold");
    g.set_font_size(fs);

    // Axe des fréquences
    for (var k = 0; mode !== "grid" && k < TICKS.length; k++) {
        var x = X(TICKS[k][0]);
        g.set_source_rgba(1, 1, 1, 0.07);
        g.move_to(x, top); g.line_to(x, top + ph); g.stroke();
        g.set_source_rgba(1, 1, 1, 0.45);
        var tw = g.text_measure(TICKS[k][1])[0];
        g.move_to(Math.min(Math.max(x - tw / 2, 1), W - tw - 1), H - 3);
        g.show_text(TICKS[k][1]);
    }

    var ids = sortedIds();
    var info = {}, conflicts = [];
    for (var b = 0; b < N; b++) conflicts[b] = [];
    for (var n = 0; n < ids.length; n++) {
        var t = tracks[ids[n]];
        info[ids[n]] = analyse(t);
        for (b = 0; b < N; b++) if (info[ids[n]].strong[b]) conflicts[b].push(t.name);
    }

    if (mode === "grid") {
        drawGrid(g, ids, W, H, top, bottom, L, Rm, fs, big);
    } else if (mode === "guide") {
        drawRows(g, GUIDE.length, top, ph, function (r, y, h) {
            var e = GUIDE[r];
            bar(g, X(e[1]), X(e[2]), y, h, e[3] ? [0.93, 0.45, 0.13] : [0.42, 0.42, 0.46], e[0], fs, null, X);
        });
    } else {
        // Zones de masquage
        for (b = 0; b < N; b++) {
            if (conflicts[b].length < 2) continue;
            g.set_source_rgba(0.93, 0.45, 0.13, Math.min(0.12 * conflicts[b].length, 0.45));
            g.rectangle(X(fLo(b)), top, X(fHi(b)) - X(fLo(b)), ph); g.fill();
        }
        if (ids.length === 0) {
            g.set_source_rgba(1, 1, 1, 0.6);
            var msg = "Pose « FreqMap Probe » sur chaque piste à cartographier";
            var mw = g.text_measure(msg)[0];
            g.move_to((W - mw) / 2, top + ph / 2); g.show_text(msg);
        }
        drawRows(g, ids.length, top, ph, function (r, y, h) {
            var t = tracks[ids[r]], a = info[ids[r]];
            if (a.segs.length === 0) {
                g.set_source_rgba(1, 1, 1, 0.3);
                g.move_to(L + 2, y + h / 2 + fs / 3); g.show_text(t.name + " (silence)");
                return;
            }
            for (var q = 0; q < a.segs.length; q++)
                bar(g, X(fLo(a.segs[q][0])), X(fHi(a.segs[q][1])), y, h, rgb(t.color), q === 0 ? t.name : "", fs, t, X);
        });
    }

    // Survol : fréquence + pistes en conflit
    if (mode !== "grid" && hoverX >= L && hoverX <= L + pw) {
        var f = FMIN * Math.pow(FMAX / FMIN, (hoverX - L) / pw);
        var bi = Math.round(Math.log(f / F0) / Math.log(R));
        var txt = fmtHz(f);
        if (mode === "tracks" && bi >= 0 && bi < N && conflicts[bi].length > 1)
            txt += " : " + conflicts[bi].join(", ");
        g.set_source_rgba(1, 1, 1, 0.5);
        g.move_to(hoverX, top); g.line_to(hoverX, top + ph); g.stroke();
        var hw = g.text_measure(txt)[0] + 8;
        var hx = Math.min(hoverX + 4, W - hw - 2);
        g.set_source_rgba(0, 0, 0, 0.85);
        g.rectangle(hx, top + 1, hw, fs + 5); g.fill();
        g.set_source_rgba(1, 1, 1, 0.95);
        g.move_to(hx + 4, top + fs + 2); g.show_text(txt);
    }

    // Barre d'outils
    buttons = [];
    g.set_source_rgba(0.93, 0.45, 0.13, 1);
    g.move_to(L, top - 4); g.show_text("FreqMap");
    if (mode === "grid") {
        var gs = "grille " + gridBars() + " mes. · " + gridSteps() + " pas" + (playing ? "  ● pas " + (curStep + 1) : "  lecture arrêtée");
        g.set_source_rgba(1, 1, 1, playing ? 0.9 : 0.5);
        g.move_to(L + g.text_measure("FreqMap")[0] + 10, top - 4); g.show_text(gs);
    } else if (loopOn) {
        var st = "cycle " + loopBars + " mes. " + (playing ? " ● pas " + cyclePos() : " lecture arrêtée");
        g.set_source_rgba(1, 1, 1, inLoop ? 0.9 : 0.5);
        g.move_to(L + g.text_measure("FreqMap")[0] + 10, top - 4); g.show_text(st);
    }
    var labels = [["mode", MODE_LABEL[mode], 1],
                  ["loop", loopOn ? "BOUCLE " + loopBars + " MES." : "BOUCLE", loopOn], ["hold", "MÉMOIRE", holdOn && !loopOn], ["reset", "RESET", 0]];
    if (!big) labels.push(["open", "AGRANDIR", 0]);
    var bx = W - Rm;
    for (k = labels.length - 1; k >= 0; k--) {
        var lw = g.text_measure(labels[k][1])[0] + 8;
        bx -= lw;
        g.set_source_rgba(1, 1, 1, labels[k][2] ? 0.25 : 0.1);
        g.rectangle_rounded(bx, 1, lw, top - 3, 3, 3); g.fill();
        g.set_source_rgba(1, 1, 1, 0.85);
        g.move_to(bx + 4, top - 4); g.show_text(labels[k][1]);
        buttons.push([labels[k][0], bx, bx + lw]);
        bx -= 3;
    }
}

function drawRows(g, count, top, ph, fn) {
    if (count === 0) return;
    var rowH = Math.min(ph / count, maxRowH);
    for (var r = 0; r < count; r++) {
        var gap = rowH > 8 ? 2 : 1;
        fn(r, top + r * rowH + gap / 2, rowH - gap);
    }
}

function bar(g, x0, x1, y, h, c, name, fs, t, X) {
    var w = Math.max(x1 - x0, 3);
    g.set_source_rgba(c[0], c[1], c[2], 0.35);
    g.rectangle_rounded(x0, y, w, h, 3, 3); g.fill();
    if (t) {
        // Profil instantané : intensité par bande
        var mx = -200;
        for (var i = 0; i < N; i++) mx = Math.max(mx, t.hold[i]);
        for (i = 0; i < N; i++) {
            var a = (t.cur[i] - (mx - RANGE_DB)) / RANGE_DB;
            if (a <= 0) continue;
            var bx0 = Math.max(X(fLo(i)), x0), bx1 = Math.min(X(fHi(i)), x0 + w);
            if (bx1 <= bx0) continue;
            g.set_source_rgba(c[0], c[1], c[2], Math.min(a, 1) * 0.9);
            g.rectangle(bx0, y, bx1 - bx0, h); g.fill();
        }
    }
    g.set_source_rgba(c[0], c[1], c[2], 1);
    g.rectangle_rounded(x0, y, w, h, 3, 3); g.stroke();
    if (h < fs - 2 || !name) return;
    var tw = g.text_measure(name)[0];
    var tx = tw + 8 <= w ? x0 + 4 : x0 + w + 4;
    g.set_source_rgba(0, 0, 0, 0.6);
    g.move_to(tx + 1, y + h / 2 + fs / 3 + 1); g.show_text(name);
    g.set_source_rgba(1, 1, 1, 0.95);
    g.move_to(tx, y + h / 2 + fs / 3); g.show_text(name);
}

function onclick(x, y) {
    if (y > toolbarH) return;
    for (var k = 0; k < buttons.length; k++) {
        var b = buttons[k];
        if (x < b[1] || x > b[2]) continue;
        if (b[0] === "mode") mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        else if (b[0] === "hold") { holdOn = holdOn ? 0 : 1; loopOn = 0; loopBars = 0; }
        else if (b[0] === "loop") {
            var li = (LOOP_CHOICES.indexOf(loopBars) + 1) % LOOP_CHOICES.length;
            loopBars = LOOP_CHOICES[li]; loopOn = loopBars > 0 ? 1 : 0; cycle = -1;
            if (loopOn) loopReset();
        }
        else if (b[0] === "reset") reset();
        else if (b[0] === "open") outlet(0, "open");
        mgraphics.redraw();
        return;
    }
}

function onidle(x, y) { hoverX = x; hoverY = y; }
function onidleout() { hoverX = -1; hoverY = -1; }

function drawGrid(g, ids, W, H, top, bottom, L, Rm, fs, big) {
    var n = gridSteps();
    var nameW = big ? 110 : 64;
    var x0 = L + nameW, gw = W - Rm - x0, cw = gw / n, ph = H - top - bottom;
    var perBeat = Math.max(1, Math.round(16 / sigDen));     // pas par temps
    // Colonnes : temps marqués, pas courant en surbrillance
    for (var s = 0; s < n; s++) {
        var cx = x0 + s * cw;
        if (s % perBeat === 0) {
            g.set_source_rgba(1, 1, 1, s % (perBeat * sigNum) === 0 ? 0.35 : 0.15);
            g.move_to(cx, top); g.line_to(cx, top + ph); g.stroke();
            g.set_source_rgba(1, 1, 1, 0.45);
            g.move_to(cx + 2, H - 3); g.show_text(String(s + 1));
        }
        if (playing && s === curStep) {
            g.set_source_rgba(1, 1, 1, 0.08);
            g.rectangle(cx, top, cw, ph); g.fill();
        }
    }
    if (ids.length === 0) {
        g.set_source_rgba(1, 1, 1, 0.6);
        g.move_to(x0 + 8, top + ph / 2); g.show_text("Pose « FreqMap Probe » sur chaque piste à cartographier");
        return;
    }
    // Pics par piste, et forces par case pour les conflits (même pas, même bande)
    var mx = {}, strongCount = [];
    for (s = 0; s < n; s++) strongCount[s] = filled(0);
    for (var r = 0; r < ids.length; r++) {
        var t = tracks[ids[r]], m = -200;
        for (s = 0; s < n; s++) { var c = gridCell(t, s); if (c) for (var i = 0; i < N; i++) m = Math.max(m, c[i]); }
        mx[ids[r]] = m;
        for (s = 0; s < n; s++) {
            c = gridCell(t, s); if (!c) continue;
            for (i = 0; i < N; i++) if (m > FLOOR_DB && c[i] > FLOOR_DB && c[i] >= m - CONFLICT_DB) strongCount[s][i]++;
        }
    }
    var hover = null;
    drawRows(g, ids.length, top, ph, function (r, y, h) {
        var t = tracks[ids[r]], col = rgb(t.color), m = mx[ids[r]];
        g.set_source_rgba(col[0], col[1], col[2], 1);
        g.rectangle(L, y, 3, h); g.fill();
        if (h >= fs - 2) {
            g.set_source_rgba(1, 1, 1, 0.9);
            g.move_to(L + 6, y + h / 2 + fs / 3); g.show_text(fit(g, t.name, nameW - 10));
        }
        var bh = h / N;
        // Repères 100 Hz, 1 kHz, 10 kHz (bande la plus proche)
        var refs = [[100, "100"], [1000, "1k"], [10000, "10k"]];
        for (var k = 0; k < refs.length; k++) {
            var ry = y + h - (Math.log(refs[k][0] / F0) / Math.log(R) + 0.5) * bh;
            g.set_source_rgba(1, 1, 1, 0.07);
            g.move_to(x0, ry); g.line_to(x0 + gw, ry); g.stroke();
            if (bh * 6 >= fs) {
                g.set_source_rgba(1, 1, 1, 0.3);
                g.move_to(x0 - g.text_measure(refs[k][1])[0] - 3, ry + fs / 3); g.show_text(refs[k][1]);
            }
        }
        for (var s = 0; s < n; s++) {
            var cx = x0 + s * cw, c = gridCell(t, s), clash = 0;
            g.set_source_rgba(1, 1, 1, 0.04);
            g.rectangle(cx + 0.5, y, cw - 1, h); g.fill();
            if (!c || m <= FLOOR_DB) continue;
            for (var i = 0; i < N; i++) {
                var a = (c[i] - (m - RANGE_DB)) / RANGE_DB;
                if (a <= 0 || c[i] <= FLOOR_DB) continue;
                g.set_source_rgba(col[0], col[1], col[2], Math.min(a, 1));
                g.rectangle(cx + 0.5, y + h - (i + 1) * bh, cw - 1, Math.max(bh, 1)); g.fill();
                if (c[i] >= m - CONFLICT_DB && strongCount[s][i] > 1) {
                    clash = 1;
                    g.set_source_rgba(0.93, 0.45, 0.13, 1);
                    g.rectangle(cx + cw - 3, y + h - (i + 1) * bh, 2.5, Math.max(bh, 1)); g.fill();
                }
            }
            if (clash) {
                g.set_source_rgba(0.93, 0.45, 0.13, 0.9);
                g.rectangle(cx + 0.5, y + 0.5, cw - 1, h - 1); g.stroke();
            }
            if (hoverX >= cx && hoverX < cx + cw && hoverY >= y && hoverY < y + h) {
                var bi = Math.min(N - 1, Math.max(0, Math.floor((y + h - hoverY) / bh)));
                var who = [];
                for (var q = 0; q < ids.length; q++) {
                    var tq = tracks[ids[q]], cq = gridCell(tq, s), mq = mx[ids[q]];
                    if (cq && mq > FLOOR_DB && cq[bi] > FLOOR_DB && cq[bi] >= mq - CONFLICT_DB) who.push(tq.name);
                }
                hover = "pas " + (s + 1) + " · " + fmtHz(fc(bi)) + (who.length ? " : " + who.join(", ") : "");
            }
        }
    });
    if (hover) {
        var hw = g.text_measure(hover)[0] + 8;
        var hx = Math.min(Math.max(hoverX + 6, 0), W - hw - 2);
        g.set_source_rgba(0, 0, 0, 0.85);
        g.rectangle(hx, top + 1, hw, fs + 5); g.fill();
        g.set_source_rgba(1, 1, 1, 0.95);
        g.move_to(hx + 4, top + fs + 2); g.show_text(hover);
    }
}

function fit(g, s, w) {
    if (g.text_measure(s)[0] <= w) return s;
    while (s.length > 1 && g.text_measure(s + "…")[0] > w) s = s.substring(0, s.length - 1);
    return s + "…";
}

function notifydeleted() { task.cancel(); }
