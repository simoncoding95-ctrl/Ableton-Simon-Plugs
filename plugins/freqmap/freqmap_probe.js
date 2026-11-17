// FreqMap Probe — analyse la piste qui l'héberge et envoie son profil
// (30 bandes de 1/3 d'octave, 25 Hz à 20 kHz, en dBFS) au bus "freqmap_bus".
autowatch = 1;
inlets = 30;
outlets = 1; // -> [s freqmap_bus]

var N = 30;
var lv = [];
for (var i = 0; i < N; i++) lv[i] = 0;

var trackId = 0;
var trackName = "?";
var trackColor = 0x888888;
var nameApi = null;
var colorApi = null;
var task = null;

function msg_float(v) { lv[inlet] = v; }
function msg_int(v) { lv[inlet] = v; }

function clean(s) {
    if (s instanceof Array) s = s.join(" ");
    s = String(s);
    if (s.charAt(0) === "\"") s = s.substring(1, s.length - 1);
    return s;
}

// Remonte jusqu'à la piste, même si le device est dans un rack.
function findTrackPath() {
    var p = "this_device canonical_parent";
    for (var k = 0; k < 8; k++) {
        var a = new LiveAPI(p);
        if (a.id == 0) return null;
        if (a.type === "Track") return p;
        p += " canonical_parent";
    }
    return null;
}

function onName(args) {
    if (args && args[0] === "name") trackName = clean(args.slice(1));
}
function onColor(args) {
    if (args && args[0] === "color") trackColor = Number(args[1]);
}

function init() {
    var p = findTrackPath();
    if (!p) { post("FreqMap Probe : piste introuvable\n"); return; }
    nameApi = new LiveAPI(onName, p);
    colorApi = new LiveAPI(onColor, p);
    trackId = Number(nameApi.id);
    trackName = clean(nameApi.get("name"));
    trackColor = Number(colorApi.get("color"));
    nameApi.property = "name";
    colorApi.property = "color";
    if (task) task.cancel();
    task = new Task(send, this);
    task.interval = 20;
    task.repeat();
}

function send() {
    var out = ["probe", trackId, trackColor, trackName];
    for (var i = 0; i < N; i++) {
        var v = lv[i];
        out.push(v > 0.000001 ? 20 * Math.log(v) / Math.LN10 : -120);
    }
    outlet(0, out);
}

function notifydeleted() {
    if (task) task.cancel();
    if (trackId) outlet(0, "bye", trackId);
}
