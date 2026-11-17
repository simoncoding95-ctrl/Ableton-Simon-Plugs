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
var mode = "tracks";   // "tracks" | "guide"
var holdOn = 1;
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
    if (!t) t = tracks[id] = { cur: filled(-120), hold: filled(-120), last: now };
    t.color = Number(a[1]);
    t.name = String(a[2]);
    var dt = Math.min(0.5, (now - t.last) / 1000);
    for (var i = 0; i < N; i++) {
        var v = Number(a[3 + i]);
        t.cur[i] = v > t.cur[i] ? v : Math.max(v, t.cur[i] - REL_DB_S * dt);
        if (holdOn) t.hold[i] = v > t.hold[i] ? v : t.hold[i] - HOLD_DB_S * dt;
        else t.hold[i] = t.cur[i];
    }
    t.last = now;
}

function bye(id) { delete tracks[String(id)]; }

function reset() {
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
    if (now - lastOrder > 2000) { lastOrder = now; refreshOrder(); }
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
    maxRowH = big ? 44 : 26;
    var pw = W - L - Rm, ph = H - top - bottom;
    function X(f) { return L + pw * Math.log(f / FMIN) / Math.log(FMAX / FMIN); }

    g.set_source_rgba(0.12, 0.12, 0.13, 1);
    g.rectangle(0, 0, W, H); g.fill();
    g.select_font_face("Arial Bold");
    g.set_font_size(fs);

    // Grille
    for (var k = 0; k < TICKS.length; k++) {
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

    if (mode === "guide") {
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
    if (hoverX >= L && hoverX <= L + pw) {
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
    var labels = [["mode", mode === "guide" ? "GUIDE" : "PISTES", 1],
                  ["hold", "MÉMOIRE", holdOn], ["reset", "RESET", 0]];
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
        if (b[0] === "mode") mode = mode === "guide" ? "tracks" : "guide";
        else if (b[0] === "hold") holdOn = holdOn ? 0 : 1;
        else if (b[0] === "reset") reset();
        else if (b[0] === "open") outlet(0, "open");
        mgraphics.redraw();
        return;
    }
}

function onidle(x, y) { hoverX = x; }
function onidleout() { hoverX = -1; }

function notifydeleted() { task.cancel(); }
