"""The storyboard. Cuts land on the bar lines of score.py:

    0.0   NOISE      static, "every sound in this video is pink noise"
    4.8   CARVE      the scope: peaks rise out of the pink slope
    9.6   TITLE      hit → "pinky" / the EQ-only DAW
    14.4  FEATURES   4 × 4.8 s: sequence · sculpt · sing · arrange
    33.6  BREAK      no samples / no oscillators / no plugins / just EQ
    38.4  CLIMAX     hero scope, shockwaves, browser / install / MIT
    45.6  OUTRO      hit → wordmark, link, fade
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image

from . import gfx
from .analysis import FMAX, Analysis
from .gfx import (ACCENT, BG, BORDER, BORDER_SUBTLE, CANVAS, DEEP, FAINT, GRID, MUTED, PLAYHEAD, RAISED, SUBTLE,
                  SURFACE, TEXT, Canvas, draw_text, ease_in_out, ease_out_back, ease_out_cubic, ease_out_expo, fade,
                  font, freq_to_x, lerp, mix_color, rgba, seg, smoothstep)
from .score import BAR, BEAT, INSTRUMENTS, STEP, bar_time
from .synth import peaking_sos

T_CARVE, T_TITLE, T_FEAT, T_BREAK, T_CLIMAX, T_OUTRO = (bar_time(b) for b in (2, 4, 6, 14, 16, 19))
FEATURE_LEN = 2 * BAR


class Frame:
    """Everything a scene needs for one frame."""

    def __init__(self, t: float, canvas: Canvas, an: Analysis, rng: np.random.Generator, url: str):
        self.t, self.c, self.an, self.rng, self.url = t, canvas, an, rng, url
        self.W, self.H, self.s = canvas.w, canvas.h, canvas.s
        # post-chain requests, filled by the scenes
        self.flash = 0.0
        self.flash_color = TEXT
        self.grain = 0.028
        self.vignette = 0.5
        self.zoom_extra = 0.0
        self.fade_black = 0.0

    def px(self, v: float) -> float:
        return v * self.s

    def f(self, weight: str, size: float):
        return font(weight, size * self.s)


# ------------------------------------------------------------ components
def scope(fr: Frame, box, bars: np.ndarray, alpha: float = 1.0, color: str = ACCENT, base: str = '#3a3036',
          overlay: bool = False, insts=None, dots: bool = True, gap: float = 0.25, glow: float = 0.0) -> None:
    """The DAW's spectrum analyser: bars on the quadratic axis, optionally with
    the predicted overlay curve and the coloured band-centre dots."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    n = len(bars)
    bw = w / n
    im, d = fr.c.layer()
    for i, v in enumerate(bars):
        if v <= 0.003:
            continue
        col = mix_color(base, color, float(v) ** 1.3)
        bx = x0 + i * bw
        d.rectangle((bx + bw * gap / 2, y1 - v * h, bx + bw * (1 - gap / 2), y1), fill=rgba(col, alpha * (0.55 + 0.45 * v)))
    fr.c.composite(im, glow=glow, glow_gain=0.6)
    if not overlay:
        return
    f0 = gfx.x_to_freq(np.linspace(0, w, 420), w, FMAX)
    f, db, dot_list = fr.an.overlay(fr.t, f0, insts)
    if not dot_list:
        return
    xs = freq_to_x(f, w, FMAX)
    peak = db.max()
    top = float(bars.max())
    norm = np.clip(top + (db - peak) / 66, 0, 1)
    im, d = fr.c.layer()
    pts = [(x0 + xs[i], y1 - norm[i] * h) for i in range(len(xs)) if norm[i] > 0.002]
    if len(pts) > 2:
        d.line(pts, fill=rgba(TEXT, alpha * 0.85), width=max(1, int(fr.px(2))))
    if dots:
        r = fr.px(5)
        for bf, ddb, col, a in dot_list:
            x = x0 + freq_to_x(bf, w, FMAX)
            y = y1 - float(np.clip(top + (ddb - peak) / 66, 0, 1)) * h
            d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(col, alpha * a))
    fr.c.composite(im, glow=fr.px(6), glow_gain=0.7)


def freq_axis(fr: Frame, box, alpha: float = 1.0) -> None:
    x0, y0, x1, y1 = box
    w = x1 - x0
    im, d = fr.c.layer()
    f_mono = fr.f('mono', 15)
    for f, label in ((50, '50'), (100, '100'), (200, '200'), (500, '500'), (1000, '1k'), (2000, '2k'), (5000, '5k'), (10000, '10k')):
        x = x0 + freq_to_x(f, w, FMAX)
        d.line((x, y0, x, y1), fill=rgba(BORDER_SUBTLE, alpha), width=1)
        draw_text(d, (x, y1 + fr.px(16)), label, f_mono, rgba(FAINT, alpha), align='center')
    d.line((x0, y1, x1, y1), fill=rgba(BORDER, alpha), width=max(1, int(fr.px(1))))
    fr.c.composite(im)


def index_label(fr: Frame, x: float, y: float, text: str, t0: float, alpha: float = 1.0) -> None:
    p = ease_out_expo(seg(fr.t, t0, t0 + 0.5))
    im, d = fr.c.layer()
    d.rectangle((x, y - fr.px(1), x + fr.px(46) * p, y + fr.px(1)), fill=rgba(ACCENT, alpha))
    draw_text(d, (x + fr.px(62), y), text, fr.f('mono', 20), rgba(ACCENT, alpha * p), tracking=fr.px(3))
    fr.c.composite(im, glow=fr.px(4), glow_gain=0.4)


def headline(fr: Frame, x: float, y: float, lines: list[str], t0: float, size: float = 78, alpha: float = 1.0,
             weight: str = 'semibold', color: str = TEXT, stagger: float = 0.12, align: str = 'left') -> None:
    im, d = fr.c.layer()
    f = fr.f(weight, size)
    for i, line in enumerate(lines):
        p = ease_out_expo(seg(fr.t, t0 + i * stagger, t0 + i * stagger + 0.7))
        if p <= 0:
            continue
        dy = (1 - p) * fr.px(40)
        col = color if isinstance(color, str) else color[i]
        draw_text(d, (x, y + i * size * 1.15 * fr.s + dy), line, f, rgba(col, alpha * p), align=align)
    fr.c.composite(im)


def sub_text(fr: Frame, x: float, y: float, text: str, t0: float, size: float = 27, alpha: float = 1.0, align='left') -> None:
    p = ease_out_cubic(seg(fr.t, t0, t0 + 0.6))
    if p <= 0:
        return
    im, d = fr.c.layer()
    draw_text(d, (x, y + (1 - p) * fr.px(18)), text, fr.f('regular', size), rgba(MUTED, alpha * p), align=align)
    fr.c.composite(im)


def card(fr: Frame, box, t0: float, alpha: float = 1.0):
    """A DAW panel sliding in from the right with a little overshoot.
    Returns the inner box (or None while it is still off-screen)."""
    p = seg(fr.t, t0, t0 + 0.75)
    if p <= 0:
        return None
    e = ease_out_back(p, 0.9)
    x0, y0, x1, y1 = box
    dx = (1 - e) * fr.px(220)
    sc = lerp(0.94, 1.0, e)
    cx, cy = (x0 + x1) / 2 + dx, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2 * sc, (y1 - y0) / 2 * sc
    b = (cx - hw, cy - hh, cx + hw, cy + hh)
    im, d = fr.c.layer()
    # drop shadow
    sh = fr.px(18)
    d.rounded_rectangle((b[0] + sh * .2, b[1] + sh * .6, b[2] + sh * .2, b[3] + sh * .6), radius=fr.px(10), fill=(0, 0, 0, int(110 * alpha * p)))
    fr.c.composite(im, glow=fr.px(14), glow_gain=0.5)
    im, d = fr.c.layer()
    gfx.panel(d, b, fr.s, SURFACE, BORDER_SUBTLE, 10, alpha * min(1, p * 1.5))
    fr.c.composite(im)
    pad = fr.px(18)
    return b[0] + pad, b[1] + pad, b[2] - pad, b[3] - pad


def ticker(fr: Frame, alpha: float = 0.55) -> None:
    h = fr.px(64)
    scope(fr, (0, fr.H - h, fr.W, fr.H), fr.an.spectrum(fr.t), alpha=alpha, gap=0.35)


def wordmark(fr: Frame, cx: float, cy: float, size: float, tracking: float, alpha: float = 1.0, glow: float = 26,
             color: str = ACCENT) -> None:
    im, d = fr.c.layer()
    draw_text(d, (cx, cy), 'pinky', fr.f('black', size), rgba(color, alpha), align='center', tracking=tracking)
    fr.c.composite(im, glow=fr.px(glow), glow_gain=0.55)


# ----------------------------------------------------------------- scenes
def scene_noise(fr: Frame) -> None:
    t = fr.t
    fr.c.fill(DEEP)
    # literal pink noise: coarse static, tinted, breathing with the hiss
    loud = fr.an.loudness(t)
    q = max(1, int(round(3 * fr.s)))
    ns = fr.rng.random((fr.H // q + 1, fr.W // q + 1)).astype(np.float32) - 0.5
    ns = np.repeat(np.repeat(ns, q, axis=0), q, axis=1)[:fr.H, :fr.W]
    amount = smoothstep(seg(t, 0.2, 3.5)) * (0.05 + 0.16 * loud)
    tint = gfx.rgbf(ACCENT) * 0.55 + 0.45
    fr.c.img += ns[..., None] * amount * tint
    fr.c.radial_glow(fr.W / 2, fr.H / 2, fr.W * 0.45, ACCENT, 0.05 * smoothstep(seg(t, 1.0, 4.0)))

    a1 = fade(t, 0.8, 1.7, 4.2, 4.75)
    tr1 = lerp(fr.px(22), fr.px(9), ease_out_expo(seg(t, 0.8, 2.4)))
    im, d = fr.c.layer()
    f = fr.f('semibold', 44)
    draw_text(d, (fr.W / 2, fr.H / 2 - fr.px(46)), 'EVERY SOUND IN THIS VIDEO', f, rgba(MUTED, a1), align='center', tracking=tr1)
    fr.c.composite(im)
    a2 = fade(t, 2.55, 2.75, 4.2, 4.75)
    if a2 > 0:
        im, d = fr.c.layer()
        f2 = fr.f('black', 74)
        tr2 = lerp(fr.px(18), fr.px(4), ease_out_expo(seg(t, 2.55, 3.4)))
        w_is = gfx.text_width('IS ', f2, tr2)
        total = w_is + gfx.text_width('PINK NOISE.', f2, tr2)
        x = fr.W / 2 - total / 2
        draw_text(d, (x, fr.H / 2 + fr.px(40)), 'IS ', f2, rgba(TEXT, a2), tracking=tr2)
        draw_text(d, (x + w_is, fr.H / 2 + fr.px(40)), 'PINK NOISE.', f2, rgba(ACCENT, a2), tracking=tr2)
        fr.c.composite(im, glow=fr.px(18), glow_gain=0.5)
    a3 = fade(t, 3.2, 3.8, 4.3, 4.75)
    if a3 > 0:
        im, d = fr.c.layer()
        draw_text(d, (fr.W / 2, fr.H - fr.px(72)), '0 samples   ·   0 oscillators   ·   0 plugins', fr.f('mono', 19),
                  rgba(SUBTLE, a3), align='center', tracking=fr.px(1))
        fr.c.composite(im)


def scene_carve(fr: Frame) -> None:
    t = fr.t
    t0 = T_CARVE
    fr.c.fill(BG)
    box = (fr.px(120), fr.px(300), fr.W - fr.px(120), fr.H - fr.px(150))
    a = smoothstep(seg(t, t0, t0 + 0.4))
    freq_axis(fr, box, a)
    scope(fr, box, fr.an.spectrum(t), alpha=a, overlay=t > t0 + 0.6, insts=('pad', 'boom', 'sub'), glow=fr.px(3))
    headline(fr, fr.px(120), fr.px(120), ['Take away everything', "that isn't music."], t0 + 0.15, size=70,
             color=[TEXT, ACCENT])
    # the three-step recipe, lighting up on the beats
    steps = [('PINK NOISE', t0 + 1.2), ('PEAKING EQ', t0 + 1.8), ('− DRY COPY', t0 + 2.4), ('= A VOICE', t0 + 3.0)]
    im, d = fr.c.layer()
    f = fr.f('mono', 19)
    x = fr.W - fr.px(120)
    y = fr.px(150)
    widths = [gfx.text_width(s, f, fr.px(2)) + fr.px(36) for s, _ in steps]
    x -= sum(widths) + fr.px(28) * (len(steps) - 1)
    for (label, ts), w in zip(steps, widths):
        p = ease_out_expo(seg(t, ts, ts + 0.35))
        lit = p > 0
        col = ACCENT if label.startswith('=') else TEXT
        d.rounded_rectangle((x, y - fr.px(20), x + w, y + fr.px(20)), radius=fr.px(6),
                            fill=rgba(RAISED, 0.4 + 0.6 * p), outline=rgba(mix_color(BORDER, col, p * 0.7), 1))
        draw_text(d, (x + w / 2, y), label, f, rgba(col if lit else FAINT, 0.35 + 0.65 * p), align='center', tracking=fr.px(2))
        x += w + fr.px(28)
        if label != steps[-1][0]:
            d.line((x - fr.px(24), y, x - fr.px(4), y), fill=rgba(BORDER, 1), width=max(1, int(fr.px(2))))
    fr.c.composite(im)
    sub_text(fr, fr.px(120), fr.px(300) - fr.px(38), 'live spectrum  ·  predicted response  ·  band centres', t0 + 0.9, 19)


def scene_title(fr: Frame) -> None:
    t = fr.t
    t0 = T_TITLE
    fr.c.fill(BG)
    # dim scope at the bottom, breathing with the riser
    bars = fr.an.spectrum(t)
    scope(fr, (0, fr.H * 0.55, fr.W, fr.H), bars, alpha=0.32, gap=0.4, base='#2a2226')
    fr.c.fill(BG, 0.25)
    fr.c.radial_glow(fr.W / 2, fr.H * 0.44, fr.W * 0.42, ACCENT, 0.10 + 0.06 * fr.an.hit(t, 0.7))

    p = ease_out_expo(seg(t, t0, t0 + 1.0))
    drift = 1 + 0.035 * seg(t, t0, T_FEAT)
    size = 250 * drift * lerp(1.12, 1.0, p)
    tracking = lerp(fr.px(60), fr.px(-6), p) * drift
    wordmark(fr, fr.W / 2, fr.H * 0.40, size, tracking, alpha=min(1, p * 2), glow=30 + 20 * fr.an.hit(t, 0.4))

    # rule + tagline
    rule = ease_out_expo(seg(t, t0 + 0.45, t0 + 1.1))
    im, d = fr.c.layer()
    rw = fr.px(360) * rule
    y = fr.H * 0.40 + fr.px(175) * drift
    d.rectangle((fr.W / 2 - rw / 2, y, fr.W / 2 + rw / 2, y + fr.px(2)), fill=rgba(ACCENT, rule))
    fr.c.composite(im)
    tp = ease_out_expo(seg(t, t0 + 0.7, t0 + 1.4))
    if tp > 0:
        im, d = fr.c.layer()
        draw_text(d, (fr.W / 2, y + fr.px(58) + (1 - tp) * fr.px(24)), 'THE EQ-ONLY DAW', fr.f('semibold', 40),
                  rgba(TEXT, tp), align='center', tracking=lerp(fr.px(26), fr.px(12), tp))
        fr.c.composite(im)
    sp = fade(t, t0 + 2.2, t0 + 2.8, T_FEAT - 0.3, T_FEAT)
    if sp > 0:
        im, d = fr.c.layer()
        draw_text(d, (fr.W / 2, y + fr.px(120)), 'pink noise   ·   peaking filters   ·   phase cancellation', fr.f('mono', 20),
                  rgba(SUBTLE, sp), align='center', tracking=fr.px(1))
        fr.c.composite(im)


# ---- the four feature cards ----
FEATURES = [
    ('01 / SEQUENCE', ['Draw notes.', 'Noise becomes melody.'], 'Piano-roll patterns, velocity, legato glides, swing.'),
    ('02 / SCULPT', ['Any timbre.', "It's just bands."], 'Drawbars, odd partials, bells — edit the harmonics directly.'),
    ('03 / SING', ['Fixed formants.', 'A pipe becomes a voice.'], 'F1 / F2 / F3 resonances and vibrato — vowels out of noise.'),
    ('04 / ARRANGE', ['Patterns. Clips.', 'Automation curves.'], 'Arrange, automate, bounce to WAV. A real DAW.'),
]


def scene_features(fr: Frame) -> None:
    t = fr.t
    i = min(3, int((t - T_FEAT) // FEATURE_LEN))
    t0 = T_FEAT + i * FEATURE_LEN
    fr.c.fill(BG)
    fr.c.radial_glow(fr.W * 0.72, fr.H * 0.5, fr.W * 0.5, ACCENT, 0.035)
    ticker(fr, 0.45)
    label, lines, sub = FEATURES[i]
    x = fr.px(110)
    index_label(fr, x, fr.px(300), label, t0)
    headline(fr, x, fr.px(370), lines, t0 + 0.1, size=58, color=[TEXT, ACCENT])
    sub_text(fr, x, fr.px(545), sub, t0 + 0.5, 24)
    inner = card(fr, (fr.W * 0.44, fr.px(150), fr.W - fr.px(90), fr.H - fr.px(150)), t0 + 0.05)
    if inner is None:
        return
    (piano_roll, drawbars, formants, arranger)[i](fr, inner, t0)


def piano_roll(fr: Frame, box, t0: float) -> None:
    x0, y0, x1, y1 = box
    im, d = fr.c.layer()
    d.rounded_rectangle(box, radius=fr.px(4), fill=rgba(CANVAS, 1))
    key_w = fr.px(56)
    gx0 = x0 + key_w
    lo, hi = 62, 82  # D4 .. A5
    rows = hi - lo
    rh = (y1 - y0) / rows
    steps = 32  # two bars
    sw = (x1 - gx0) / steps
    black = {1, 3, 6, 8, 10}
    f_mono = fr.f('mono', 12)
    for r in range(rows):
        m = hi - 1 - r
        y = y0 + r * rh
        if m % 12 in black:
            d.rectangle((gx0, y, x1, y + rh), fill=rgba(GRID, 1))
        d.rectangle((x0, y + 1, gx0 - fr.px(4), y + rh - 1), fill=rgba('#2c2c31' if m % 12 in black else '#b8b5bb', 1))
        if m % 12 == 0:
            draw_text(d, (x0 + fr.px(6), y + rh / 2), f'C{m // 12 - 1}', f_mono, rgba('#4a4850', 1))
    for st in range(steps + 1):
        x = gx0 + st * sw
        col = BORDER if st % 16 == 0 else BORDER_SUBTLE if st % 4 == 0 else GRID
        d.line((x, y0, x, y1), fill=rgba(col, 1), width=max(1, int(fr.px(1 if st % 4 else 1.5))))
    # the actual pluck notes of bars 6-7, lit as the playhead passes them
    pos = (fr.t - t0) / STEP  # in steps since the card's bar
    notes = [n for n in fr.an.by_inst['pluck'] if t0 - 1e-6 <= n.t < t0 + 2 * BAR]
    for n in notes:
        st = (n.t - t0) / STEP
        appear = ease_out_back(seg(fr.t, t0 + 0.45 + st * 0.02, t0 + 0.75 + st * 0.02), 0.6)
        if appear <= 0:
            continue
        r = hi - 1 - int(n.midi)
        nx0 = gx0 + st * sw
        nx1 = nx0 + n.dur / STEP * sw * appear
        if nx1 - nx0 < fr.px(2):
            continue
        ny = y0 + r * rh
        lit = st <= pos <= st + n.dur / STEP
        col = INSTRUMENTS['pluck'].color
        d.rounded_rectangle((nx0 + 1, ny + 1, nx1 - 1, ny + rh - 1), radius=fr.px(2),
                            fill=rgba(mix_color(col, TEXT, 0.6) if lit else col, 0.95 if lit else 0.55 + 0.35 * n.vel),
                            outline=rgba(col, 1))
    fr.c.composite(im)
    if 0 <= pos <= steps:
        im, d = fr.c.layer()
        x = gx0 + pos * sw
        d.line((x, y0, x, y1), fill=rgba(PLAYHEAD, 0.9), width=max(1, int(fr.px(2))))
        fr.c.composite(im, glow=fr.px(6), glow_gain=0.6)


SHAPES = [
    ('Harmonic', [(h, 0.6 ** (h - 1)) for h in range(1, 9)]),
    ('Organ drawbars', [(1, 1), (2, 1), (3, .75), (4, .9), (6, .6), (8, .5), (10, .35), (16, .3)]),
    ('Odd (hollow)', [(2 * h - 1, 1 / (2 * h - 1)) for h in range(1, 9)]),
    ('Bell partials', [(0.5, .7), (1, 1), (1.19, .8), (1.5, .6), (2, .9), (2.5, .5), (3.36, .4), (4.13, .3)]),
]


def _morph_partials(t: float, t0: float):
    k = (t - t0) / (2 * BEAT)
    i = min(len(SHAPES) - 1, int(k))
    j = min(len(SHAPES) - 1, i + 1)
    p = ease_in_out(seg(k - i, 0.0, 0.3)) if j != i else 0.0
    a, b = SHAPES[i][1], SHAPES[j][1]
    out = []
    for (ra, la), (rb, lb) in zip(a, b):
        out.append((math.exp(lerp(math.log(ra), math.log(rb), p)), lerp(la, lb, p)))
    name = SHAPES[j][0] if p > 0.5 else SHAPES[i][0]
    return out, name, p


def drawbars(fr: Frame, box, t0: float) -> None:
    x0, y0, x1, y1 = box
    parts, name, _ = _morph_partials(fr.t, t0)
    f0 = 293.66  # D4
    im, d = fr.c.layer()
    d.rounded_rectangle(box, radius=fr.px(4), fill=rgba(CANVAS, 1))
    # response of the cancelled chain on the top half
    split = y0 + (y1 - y0) * 0.5
    w = x1 - x0
    xs = np.linspace(0, w, 420)
    f = gfx.x_to_freq(xs, w, 6000.0, 80.0)
    from .synth import chain_response, pink_psd  # local import keeps module load order simple
    fr_, qs, gs = zip(*[(f0 * r, 40 * math.sqrt(r), 40 * lv) for r, lv in parts if lv > 0.01])
    resp = 10 * np.log10(np.maximum(np.abs(chain_response(fr_, qs, gs, f)) ** 2 * pink_psd(f), 1e-12))
    resp = np.clip((resp - resp.max()) / 60 + 1, 0, 1)
    top = y0 + fr.px(40)
    poly = [(x0 + xs[i], split - resp[i] * (split - top)) for i in range(len(xs))]
    d.polygon([(x0, split)] + poly + [(x1, split)], fill=rgba(ACCENT, 0.18))
    d.line(poly, fill=rgba(ACCENT, 0.95), width=max(1, int(fr.px(2))))
    d.line((x0, split, x1, split), fill=rgba(BORDER, 1), width=1)
    # the drawbars
    n = len(parts)
    slot = w / n
    bw = slot * 0.42
    base = y1 - fr.px(34)
    f_mono = fr.f('mono', 15)
    for k, (r, lv) in enumerate(parts):
        cx = x0 + slot * (k + 0.5)
        d.rounded_rectangle((cx - bw / 2, split + fr.px(28), cx + bw / 2, base), radius=fr.px(3), fill=rgba(RAISED, 1))
        hgt = (base - split - fr.px(28)) * lv
        d.rounded_rectangle((cx - bw / 2, base - hgt, cx + bw / 2, base), radius=fr.px(3),
                            fill=rgba(mix_color('#a0555a', ACCENT, lv), 1))
        d.rectangle((cx - bw / 2 - fr.px(3), base - hgt - fr.px(4), cx + bw / 2 + fr.px(3), base - hgt + fr.px(4)), fill=rgba(TEXT, .9))
        label = f'{r:g}' if abs(r - round(r)) < 1e-6 else f'{r:.2f}'
        draw_text(d, (cx, y1 - fr.px(16)), label, f_mono, rgba(SUBTLE, 1), align='center')
    draw_text(d, (x0 + fr.px(14), y0 + fr.px(18)), 'HARMONICS  ·  D4', f_mono, rgba(SUBTLE, 1), tracking=fr.px(1))
    fr.c.composite(im)
    # shape chip
    im, d = fr.c.layer()
    f_chip = fr.f('semibold', 18)
    tw = gfx.text_width(name, f_chip) + fr.px(30)
    d.rounded_rectangle((x1 - fr.px(14) - tw, y0 + fr.px(8), x1 - fr.px(14), y0 + fr.px(30)), radius=fr.px(11),
                        fill=rgba(ACCENT, .16), outline=rgba(ACCENT, .8))
    draw_text(d, (x1 - fr.px(14) - tw / 2, y0 + fr.px(19)), name, f_chip, rgba(ACCENT, 1), align='center')
    fr.c.composite(im, glow=fr.px(5), glow_gain=0.4)


VOWELS = [('ah', 800, 1150, 2900), ('oo', 350, 800, 2600), ('ee', 270, 2300, 3000), ('ah', 800, 1150, 2900)]


def formants(fr: Frame, box, t0: float) -> None:
    x0, y0, x1, y1 = box
    k = (fr.t - t0) / (2 * BEAT)
    i = min(len(VOWELS) - 1, int(k))
    j = min(len(VOWELS) - 1, i + 1)
    p = ease_in_out(seg(k - i, 0.0, 0.45)) if j != i else 0.0
    fs = [math.exp(lerp(math.log(VOWELS[i][n]), math.log(VOWELS[j][n]), p)) for n in (1, 2, 3)]
    name = VOWELS[j][0] if p > 0.5 else VOWELS[i][0]
    im, d = fr.c.layer()
    d.rounded_rectangle(box, radius=fr.px(4), fill=rgba(CANVAS, 1))
    w = x1 - x0
    fmin_c = 120.0
    xs = np.linspace(0, w, 480)
    f = gfx.x_to_freq(xs, w, 5000.0, fmin_c)
    z = np.exp(-1j * 2 * np.pi * f / 48000)
    h = np.ones_like(z)
    for b0, b1, b2, _, a1, a2 in peaking_sos(fs, [3.0] * 3, [24, 22, 18]):
        h *= (b0 + b1 * z + b2 * z * z) / (1 + a1 * z + a2 * z * z)
    resp = 20 * np.log10(np.abs(h))
    resp = np.clip(resp / 30, 0, 1)
    floor = y1 - fr.px(44)
    top = y0 + fr.px(60)
    # the glottal comb: harmonics of A3, lit where a formant lifts them
    f_source = 220.0
    poly = [(x0 + xs[q], floor - resp[q] * (floor - top)) for q in range(len(xs))]
    d.polygon([(x0, floor)] + poly + [(x1, floor)], fill=rgba(ACCENT, 0.10))
    for n in range(1, 23):
        hf = f_source * n
        x = x0 + freq_to_x(hf, w, 5000.0, fmin_c)
        lift = float(np.interp(hf, f, resp))
        hgt = (floor - top) * (0.22 + 0.16 / n ** 0.5 + 0.55 * lift)
        col = mix_color('#6a5a62', INSTRUMENTS['voice'].color, lift ** 0.7)
        d.line((x, floor, x, floor - hgt), fill=rgba(col, 0.7 + 0.3 * lift), width=max(1, int(fr.px(4))))
        rr = fr.px(4)
        d.ellipse((x - rr, floor - hgt - rr, x + rr, floor - hgt + rr), fill=rgba(col, 1))
    d.line(poly, fill=rgba(ACCENT, 0.9), width=max(1, int(fr.px(2))))
    f_mono = fr.f('mono', 15)
    for n, fq in enumerate(fs):
        x = x0 + freq_to_x(fq, w, 5000.0, fmin_c)
        d.line((x, floor, x, floor + fr.px(8)), fill=rgba(ACCENT, 1), width=max(1, int(fr.px(2))))
        draw_text(d, (x, floor + fr.px(24)), f'F{n + 1} {fq:.0f} Hz', f_mono, rgba(MUTED, 1), align='center')
    draw_text(d, (x0 + fr.px(14), y0 + fr.px(18)), 'FORMANTS  ·  A3 source', f_mono, rgba(SUBTLE, 1), tracking=fr.px(1))
    fr.c.composite(im)
    im, d = fr.c.layer()
    draw_text(d, (x1 - fr.px(24), y0 + fr.px(70)), name, fr.f('light', 150), rgba(TEXT, 0.9), align='right')
    fr.c.composite(im, glow=fr.px(12), glow_gain=0.25)


TRACKS = [('Drums', '#ff9f43', [(0, 2, 'Intro'), (2, 4, 'Groove'), (6, 1, 'Break'), (7, 1, 'Drop')]),
          ('Bass', '#10ac84', [(2, 4, 'Ostinato'), (7, 1, 'Ostinato')]),
          ('Pad', '#a29bfe', [(0, 4, 'Dm'), (4, 2, 'Bb  ·  F'), (6, 2, 'Dm')]),
          ('Lead', '#e056fd', [(4, 2, 'Motif'), (7, 1, 'Aria')])]
AUTO_POINTS = [(0, .18), (1.5, .18), (3, .42), (4, .3), (5.5, .55), (6, .9), (7, .25), (8, .5)]


def arranger(fr: Frame, box, t0: float) -> None:
    x0, y0, x1, y1 = box
    im, d = fr.c.layer()
    d.rounded_rectangle(box, radius=fr.px(4), fill=rgba(CANVAS, 1))
    head_w = fr.px(96)
    gx0 = x0 + head_w
    ruler_h = fr.px(24)
    bars_shown = 8
    bw = (x1 - gx0) / bars_shown
    f_mono = fr.f('mono', 13)
    f_lbl = fr.f('semibold', 15)
    lane_h = fr.px(62)
    for b in range(bars_shown + 1):
        x = gx0 + b * bw
        d.line((x, y0 + ruler_h, x, y1), fill=rgba(BORDER_SUBTLE, 1), width=1)
        if b < bars_shown:
            draw_text(d, (x + fr.px(6), y0 + ruler_h / 2), str(b + 1), f_mono, rgba(FAINT, 1))
    d.line((x0, y0 + ruler_h, x1, y0 + ruler_h), fill=rgba(BORDER, 1), width=1)
    k = 0
    for ti, (name, col, clips) in enumerate(TRACKS):
        ly = y0 + ruler_h + fr.px(6) + ti * lane_h
        d.rounded_rectangle((x0 + fr.px(4), ly, gx0 - fr.px(6), ly + lane_h - fr.px(6)), radius=fr.px(4), fill=rgba(RAISED, 1))
        d.rectangle((x0 + fr.px(4), ly, x0 + fr.px(8), ly + lane_h - fr.px(6)), fill=rgba(col, 1))
        draw_text(d, (x0 + fr.px(16), ly + (lane_h - fr.px(6)) / 2), name, f_lbl, rgba(TEXT, .9))
        for start, ln, label in clips:
            appear = ease_out_back(seg(fr.t, t0 + 0.5 + k * 0.1, t0 + 0.9 + k * 0.1), 0.8)
            k += 1
            if appear <= 0:
                continue
            cx0 = gx0 + start * bw + fr.px(2)
            cx1 = cx0 + (ln * bw - fr.px(4)) * appear
            d.rounded_rectangle((cx0, ly, cx1, ly + lane_h - fr.px(6)), radius=fr.px(4), fill=rgba(col, .28), outline=rgba(col, .9))
            if cx1 - cx0 > fr.px(40):
                draw_text(d, (cx0 + fr.px(8), ly + fr.px(14)), label, f_mono, rgba(TEXT, .9))
    # automation lane
    ay0 = y0 + ruler_h + fr.px(6) + len(TRACKS) * lane_h + fr.px(6)
    ay1 = min(y1 - fr.px(8), ay0 + fr.px(170))
    d.rounded_rectangle((x0 + fr.px(4), ay0, gx0 - fr.px(6), ay1), radius=fr.px(4), fill=rgba(RAISED, 1))
    draw_text(d, (x0 + fr.px(16), ay0 + fr.px(16)), 'master', f_lbl, rgba(TEXT, .9))
    draw_text(d, (x0 + fr.px(16), ay0 + fr.px(36)), 'rev', f_mono, rgba(SUBTLE, 1))
    d.rectangle((gx0, ay0, x1, ay1), fill=rgba('#0e0e10', 1))
    shown = [pt for n_, pt in enumerate(AUTO_POINTS) if fr.t >= t0 + 1.1 + n_ * 0.32]
    if len(shown) >= 2:
        pts = []
        for (sa, va), (sb, vb) in zip(shown, shown[1:]):
            for q in np.linspace(0, 1, 24):
                s_ = lerp(sa, sb, q)
                v_ = lerp(va, vb, smoothstep(q))
                pts.append((gx0 + s_ * bw, ay1 - fr.px(6) - v_ * (ay1 - ay0 - fr.px(12))))
        d.polygon([(pts[0][0], ay1)] + pts + [(pts[-1][0], ay1)], fill=rgba(ACCENT, .16))
        d.line(pts, fill=rgba(ACCENT, .95), width=max(1, int(fr.px(2))))
    r = fr.px(5)
    for n_, (s_, v_) in enumerate(shown):
        pop = ease_out_back(seg(fr.t, t0 + 1.1 + n_ * 0.32, t0 + 1.4 + n_ * 0.32), 1.2)
        x = gx0 + s_ * bw
        y = ay1 - fr.px(6) - v_ * (ay1 - ay0 - fr.px(12))
        rr = r * pop
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=rgba(TEXT, 1), outline=rgba(ACCENT, 1))
    fr.c.composite(im)
    # playhead sweeps the 8 bars over the card's time
    pos = seg(fr.t, t0 + 0.6, t0 + FEATURE_LEN) * bars_shown
    im, d = fr.c.layer()
    x = gx0 + pos * bw
    d.line((x, y0, x, y1), fill=rgba(PLAYHEAD, .9), width=max(1, int(fr.px(2))))
    fr.c.composite(im, glow=fr.px(6), glow_gain=0.6)


PHRASES = [('NO SAMPLES.', TEXT), ('NO OSCILLATORS.', TEXT), ('NO PLUGINS.', TEXT), ('JUST EQ.', ACCENT)]


def scene_break(fr: Frame) -> None:
    t = fr.t
    fr.c.fill(DEEP)
    fr.grain = 0.035 + 0.05 * seg(t, T_BREAK + 2.4, T_CLIMAX)
    fr.vignette = 0.65
    i = min(3, int((t - T_BREAK) // (2 * BEAT)))
    ts = T_BREAK + i * 2 * BEAT
    text, col = PHRASES[i]
    p = seg(t, ts, ts + 0.3)
    scale = lerp(1.1, 1.0, ease_out_expo(p))
    tracking = lerp(fr.px(40), fr.px(6), ease_out_expo(p))
    size = (150 if i < 3 else 210) * scale
    loud = fr.an.loudness(t)
    if i == 3:
        fr.c.radial_glow(fr.W / 2, fr.H / 2, fr.W * 0.4, ACCENT, 0.08 + 0.1 * seg(t, ts, T_CLIMAX))
        size *= 1 + 0.06 * seg(t, ts, T_CLIMAX)
    im, d = fr.c.layer()
    draw_text(d, (fr.W / 2, fr.H / 2), text, fr.f('black', size), rgba(col, 0.85 + 0.15 * loud), align='center', tracking=tracking)
    fr.c.composite(im, glow=fr.px(16 if i == 3 else 6), glow_gain=0.5 if i == 3 else 0.2)
    # a hairline scope, barely there, for the roll
    scope(fr, (0, fr.H - fr.px(90), fr.W, fr.H), fr.an.spectrum(t), alpha=0.22, gap=0.5, base='#26202a')
    if p < 0.08:
        fr.flash = max(fr.flash, 0.12)


CLIMAX_LINES = [('Runs in your browser.', 'No install, no account — open a tab and play.'),
                ('Save, load, bounce to WAV.', 'Projects are plain JSON. Node budget for slow machines.'),
                ('Open source. MIT.', 'Human contributors are very welcome to improve this mess.')]


def scene_climax(fr: Frame) -> None:
    t = fr.t
    fr.c.fill(BG)
    kick = fr.an.pulse(t, ('kick',), 0.16)
    fr.c.radial_glow(fr.W / 2, fr.H * 0.85, fr.W * 0.6, ACCENT, 0.05 + 0.08 * kick)
    box = (fr.px(60), fr.H * 0.34, fr.W - fr.px(60), fr.H - fr.px(90))
    freq_axis(fr, box, 0.8)
    scope(fr, box, fr.an.spectrum(t), overlay=True, insts=('voice', 'pluck', 'lead', 'strings', 'pad', 'bass', 'kick'),
          glow=fr.px(4), color=mix_color(ACCENT, '#ffb3b6', kick * 0.5))
    # shockwave rings on the kicks
    last = fr.an.last_event(t, ('kick', 'hit'))
    if last is not None and t - last.t < 0.55:
        q = (t - last.t) / 0.55
        im, d = fr.c.layer()
        r = fr.px(80) + ease_out_cubic(q) * fr.px(900)
        cx, cy = fr.W / 2, fr.H * 0.62
        d.ellipse((cx - r, cy - r * 0.42, cx + r, cy + r * 0.42), outline=rgba(ACCENT, (1 - q) ** 1.6 * 0.7), width=max(1, int(fr.px(3 * (1 - q) + 1))))
        fr.c.composite(im, glow=fr.px(8), glow_gain=0.5)
    i = min(2, int((t - T_CLIMAX) // BAR))
    ts = T_CLIMAX + i * BAR
    line, sub = CLIMAX_LINES[i]
    headline(fr, fr.W / 2, fr.px(110), [line], ts, size=74, align='center')
    sub_text(fr, fr.W / 2, fr.px(210), sub, ts + 0.25, 26, align='center')
    im, d = fr.c.layer()
    draw_text(d, (fr.W - fr.px(110), fr.px(70)), 'pinky', fr.f('black', 30), rgba(ACCENT, .9), align='right', tracking=fr.px(-1))
    fr.c.composite(im, glow=fr.px(6), glow_gain=0.4)
    fr.zoom_extra = 0.02 * kick


def scene_outro(fr: Frame) -> None:
    t = fr.t
    t0 = T_OUTRO
    fr.c.fill(BG)
    ring = 1 - seg(t, t0, t0 + 3.5)
    scope(fr, (0, fr.H * 0.6, fr.W, fr.H), fr.an.spectrum(t), alpha=0.28 * ring, gap=0.4, base='#2a2226')
    fr.c.fill(BG, 0.2)
    fr.c.radial_glow(fr.W / 2, fr.H * 0.42, fr.W * 0.4, ACCENT, 0.09 + 0.1 * fr.an.hit(t, 0.6))
    p = ease_out_back(seg(t, t0, t0 + 0.6), 1.0)
    wordmark(fr, fr.W / 2, fr.H * 0.40, 300 * p, fr.px(-6), alpha=min(1, p * 2), glow=28)
    tp = ease_out_expo(seg(t, t0 + 0.5, t0 + 1.1))
    if tp > 0:
        im, d = fr.c.layer()
        draw_text(d, (fr.W / 2, fr.H * 0.40 + fr.px(170) + (1 - tp) * fr.px(16)), 'an EQ-only DAW', fr.f('regular', 36),
                  rgba(MUTED, tp), align='center', tracking=fr.px(2))
        fr.c.composite(im)
    # the link types itself out
    lp = seg(t, t0 + 1.2, t0 + 1.9)
    if lp > 0:
        im, d = fr.c.layer()
        shown = fr.url[:int(round(lp * len(fr.url)))]
        f = fr.f('mono', 40)
        w = gfx.text_width(fr.url, f)
        x = fr.W / 2 - w / 2
        y = fr.H * 0.40 + fr.px(250)
        draw_text(d, (x, y), shown, f, rgba(TEXT, 1))
        if lp < 1 or int(t * 3) % 2 == 0:
            cx = x + gfx.text_width(shown, f) + fr.px(4)
            d.rectangle((cx, y - fr.px(20), cx + fr.px(18), y + fr.px(20)), fill=rgba(ACCENT, 1))
        fr.c.composite(im, glow=fr.px(4), glow_gain=0.25)
    ep = fade(t, t0 + 2.5, t0 + 3.1, t0 + 4.4, t0 + 4.8)
    if ep > 0:
        im, d = fr.c.layer()
        draw_text(d, (fr.W / 2, fr.H - fr.px(90)), 'Every sound you just heard was pink noise.', fr.f('regular', 27),
                  rgba(SUBTLE, ep), align='center')
        fr.c.composite(im)
    fr.fade_black = smoothstep(seg(t, t0 + 4.0, t0 + 4.8))


# -------------------------------------------------------------- dispatcher
def render_frame(t: float, w: int, h: int, an: Analysis, url: str, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed * 100003 + int(t * 1000))
    fr = Frame(t, Canvas(w, h), an, rng, url)
    if t < T_CARVE:
        scene_noise(fr)
    elif t < T_TITLE:
        scene_carve(fr)
    elif t < T_FEAT:
        scene_title(fr)
    elif t < T_BREAK:
        scene_features(fr)
    elif t < T_CLIMAX:
        scene_break(fr)
    elif t < T_OUTRO:
        scene_climax(fr)
    else:
        scene_outro(fr)

    # ---- the film look, driven by the music ----
    hit = an.hit(t, 0.45)
    kick = an.pulse(t, ('kick', 'boom'), 0.15)
    flash = max(fr.flash, an.pulse(t, ('hit',), 0.09) * 0.85, an.pulse(t, ('boom',), 0.07) * 0.25)
    if flash > 0:
        fr.c.fill(mix_color(TEXT, ACCENT, 0.35), min(1.0, flash))
    gfx.vignette(fr.c.img, fr.vignette)
    gfx.grain(fr.c.img, fr.grain + 0.015 * hit, rng)
    if fr.fade_black > 0:
        fr.c.img *= (1 - fr.fade_black)
    u8 = fr.c.to_uint8()
    zoom = 1 + 0.06 * hit ** 2 + 0.018 * kick + fr.zoom_extra
    shake = hit ** 2 * fr.px(14)
    u8 = gfx.punch(u8, zoom, shake * math.sin(t * 173.0), shake * math.cos(t * 131.0))
    u8 = gfx.chromatic(u8, int(round(hit ** 1.5 * fr.px(9))))
    return u8
