#!/usr/bin/env python3
"""Génère FreqMap Probe.amxd et FreqMap.amxd (Max for Live, Live 12 / Max 9)."""
import json, struct, sys, os

def amxd(patcher, path):
    data = json.dumps({"patcher": patcher}, indent=1).encode() + b"\n\x00"
    head = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0)
    with open(path, "wb") as f:
        f.write(head + b"ptch" + struct.pack("<I", len(data)) + data)

class P:
    def __init__(self, width):
        self.boxes, self.lines, self.n, self.width = [], [], 0, width
    def box(self, maxclass="newobj", text=None, rect=(0, 0, 100, 20), ins=1, outs=0, otypes=None, **kw):
        self.n += 1
        b = {"id": f"obj-{self.n}", "maxclass": maxclass, "numinlets": ins, "numoutlets": outs,
             "patching_rect": list(rect)}
        if text is not None: b["text"] = text
        if otypes is not None: b["outlettype"] = otypes
        b.update(kw)
        self.boxes.append({"box": b})
        return b["id"]
    def wire(self, a, ao, b, bi):
        self.lines.append({"patchline": {"source": [a, ao], "destination": [b, bi]}})
    def patcher(self, rect=(100, 100, 1000, 700), presentation=True):
        return {"fileversion": 1,
                "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
                "classnamespace": "box", "rect": list(rect), "openrect": [0.0, 0.0, 0.0, 169.0],
                "openinpresentation": int(presentation), "default_fontsize": 10.0,
                "default_fontname": "Arial Bold", "gridsize": [8.0, 8.0],
                "devicewidth": float(self.width), "boxes": self.boxes, "lines": self.lines,
                "dependency_cache": [], "latency": 0, "autosave": 0}

def passthrough(p):
    i = p.box(text="plugin~", rect=(20, 20, 60, 20), ins=2, outs=2, otypes=["signal", "signal"])
    o = p.box(text="plugout~", rect=(20, 400, 60, 20), ins=2, outs=2, otypes=["signal", "signal"])
    p.wire(i, 0, o, 0); p.wire(i, 1, o, 1)
    return i

def probe():
    N = 30
    p = P(150)
    i = passthrough(p)
    add = p.box(text="+~", rect=(120, 60, 40, 20), ins=2, outs=1, otypes=["signal"])
    half = p.box(text="*~ 0.5", rect=(120, 90, 50, 20), ins=2, outs=1, otypes=["signal"])
    fb = p.box(text="fffb~ 30 25. 1.259921 4.32", rect=(120, 120, 600, 20), ins=1, outs=N, otypes=["signal"] * N)
    p.wire(i, 0, add, 0); p.wire(i, 1, add, 1); p.wire(add, 0, half, 0); p.wire(half, 0, fb, 0)
    js = p.box(text="js freqmap_probe.js", rect=(120, 260, 600, 20), ins=N, outs=1, otypes=[""])
    for k in range(N):
        pk = p.box(text="peakamp~ 50", rect=(120 + k * 20, 180 + (k % 2) * 30, 70, 20), ins=2, outs=1, otypes=["float"])
        p.wire(fb, k, pk, 0); p.wire(pk, 0, js, k)
    snd = p.box(text="s freqmap_bus", rect=(120, 300, 90, 20), ins=1, outs=0)
    p.wire(js, 0, snd, 0)
    td = p.box(text="live.thisdevice", rect=(400, 20, 90, 20), ins=1, outs=3, otypes=["bang", "int", "int"])
    m = p.box("message", text="init", rect=(400, 50, 40, 20), ins=2, outs=1, otypes=[""])
    p.wire(td, 0, m, 0); p.wire(m, 0, js, 0)
    p.box("comment", text="FreqMap Probe", rect=(20, 460, 140, 20), presentation=1,
          presentation_rect=[8, 8, 140, 20], fontsize=12.0, textcolor=[0.93, 0.45, 0.13, 1])
    p.box("comment", text="Analyse cette piste et l'envoie au device FreqMap.", rect=(20, 490, 140, 60),
          linecount=4, presentation=1, presentation_linecount=4, presentation_rect=[8, 32, 136, 60],
          textcolor=[0.8, 0.8, 0.8, 1])
    return p.patcher()

def view_patcher(w, h, big):
    p = P(w)
    if not big:
        passthrough(p)
    rcv = p.box(text="r freqmap_bus", rect=(20, 60, 90, 20), ins=0, outs=1, otypes=[""])
    ui = p.box("jsui", rect=(20, 100, w, h), ins=1, outs=1, otypes=[""], filename="freqmap_view.js",
               parameter_enable=0, presentation=1, presentation_rect=[0, 0, w, h])
    p.wire(rcv, 0, ui, 0)
    return p, ui

def view():
    p, ui = view_patcher(760, 169, False)
    big, _ = view_patcher(1200, 620, True)
    sub = big.patcher(rect=(60, 60, 1200, 620), presentation=True)
    sub.pop("devicewidth"); sub["toolbarvisible"] = 0; sub["statusbarvisible"] = 0
    sub["boxes"].insert(0, {"box": {"id": "obj-100", "maxclass": "inlet", "numinlets": 0, "numoutlets": 1,
                                    "outlettype": [""], "patching_rect": [20, 20, 30, 30]}})
    pc = p.box(text="pcontrol", rect=(20, 300, 60, 20), ins=1, outs=1, otypes=[""])
    s = p.box(text="p FreqMap_Grand", rect=(20, 340, 110, 20), ins=1, outs=0, patcher=sub)
    p.wire(ui, 0, pc, 0); p.wire(pc, 0, s, 0)
    return p.patcher()

out = sys.argv[1] if len(sys.argv) > 1 else "dist"
os.makedirs(out, exist_ok=True)
amxd(probe(), os.path.join(out, "FreqMap Probe.amxd"))
amxd(view(), os.path.join(out, "FreqMap.amxd"))
print("ok ->", out)
