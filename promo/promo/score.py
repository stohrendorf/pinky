"""The soundtrack — a trailer-shaped piece in D minor at 100 BPM.

Bars are 2.4 s; the picture cuts on these bar lines:

    bar  0- 1  hiss + sub drone          "every sound in this video is pink noise"
    bar  2- 3  choir pad, booms          the spectrum gets carved
    bar  4     TITLE HIT, riser          "pinky"
    bar  6-13  groove                    feature sequence (4 × 2 bars)
    bar 14-15  break, snare roll         "no samples / no oscillators / just EQ"
    bar 16-18  climax with the soprano   full-screen scope
    bar 19     final hit, ring-out       logo + link

Every instrument is a pinky preset (see src/lib/instruments.ts) — the score
only places notes; the sound is pink noise through peaking EQ, nothing else.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

from .synth import SR, Inst, harmonic, master, normalize_bus, pink_noise, render_voice, reverb, ride

BPM = 100
BEAT = 60 / BPM
STEP = BEAT / 4
BAR = 16 * STEP
LENGTH = 21 * BAR  # 50.4 s, the last two bars are the ring-out

_NOTE = re.compile(r'^([A-Ga-g])([#b]?)(-?\d)$')
_SEMI = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name: str) -> int:
    m = _NOTE.match(name)
    if not m:
        raise ValueError(name)
    return 12 * (int(m.group(3)) + 1) + _SEMI[m.group(1).upper()] + {'#': 1, 'b': -1, '': 0}[m.group(2)]


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def bar_time(bar: float, step: float = 0) -> float:
    return bar * BAR + step * STEP


@dataclass
class Note:
    inst: str
    midi: float
    t: float
    dur: float
    vel: float = 1.0


@dataclass
class Event:
    t: float
    kind: str      # 'kick' | 'snare' | 'hit' | 'boom'
    strength: float = 1.0


# ------------------------------------------------------------- the presets
BELL = [(0.5, .7), (1, 1), (1.19, .8), (1.5, .6), (2, .9), (2.5, .5), (3.36, .4), (4.13, .3)]
CHOIR = [(1, 1), (2, .5), (3, .33), (4, .24), (5, .18), (6, .13)]
SOPRANO = [(1, 1), (2, .6), (3, .42), (4, .3), (5, .22), (6, .16), (7, .12), (8, .09)]

INSTRUMENTS: dict[str, Inst] = {
    'air': Inst('Air', '#85828a', tone=0, noise=1, noiseFreq=2200, att=2.6, dec=.5, sus=1, rel=2.0, gain=.5, level_db=-27),
    'sub': Inst('Sub', '#53d8fb', q=30, partials=harmonic(2, .5), att=1.2, dec=.3, sus=1, rel=.6, gain=.9, level_db=-13),
    'boom': Inst('Boom', '#ff9f43', q=8, partials=harmonic(1, 1), pitchDrop=26, pitchTime=.09, noise=.12, noiseFreq=3200,
                 att=.002, dec=.55, sus=0, rel=.5, gain=1, level_db=-9),
    'kick': Inst('Kick', '#ff9f43', q=8, partials=harmonic(1, 1), pitchDrop=26, pitchTime=.07, noise=.12, noiseFreq=4000,
                 att=.002, dec=.16, sus=0, rel=.12, gain=1, level_db=-9),
    'snare': Inst('Snare', '#ee5253', tone=.5, q=6, partials=harmonic(2, .5), pitchDrop=7, pitchTime=.05, noise=.9,
                  noiseFreq=4500, att=.002, dec=.16, sus=0, rel=.14, gain=.9, level_db=-14),
    'clap': Inst('Clap', '#ff6b6b', tone=.15, q=5, partials=harmonic(1, 1), noise=1, noiseFreq=1800, att=.004, dec=.12,
                 sus=0, rel=.15, gain=.85, level_db=-18),
    'hat': Inst('Hi-Hat', '#f9ca24', tone=0, noise=1, noiseFreq=9500, att=.002, dec=.05, sus=0, rel=.05, gain=.6, level_db=-24),
    'ohat': Inst('Open Hat', '#f9ca24', tone=0, noise=1, noiseFreq=8500, att=.002, dec=.3, sus=0, rel=.3, gain=.55, level_db=-26),
    'bass': Inst('Bass', '#10ac84', q=25, partials=harmonic(3, .5), att=.005, dec=.25, sus=.6, rel=.15, gain=.9, level_db=-13),
    'pad': Inst('Choir (oo)', '#a29bfe', tone=.82, q=36, partials=CHOIR, formant=.85, f1=350, f2=800, f3=2600, formantQ=2.8,
                vib=12, vibRate=4.6, vibDelay=.6, voices=4, detune=18, att=.45, dec=.6, sus=.9, rel=1.1, gain=.45, level_db=-21),
    'strings': Inst('Strings', '#0abde3', q=35, partials=harmonic(8, .75), voices=5, detune=26, att=.25, dec=.8, sus=.9,
                    rel=1.2, gain=.45, level_db=-23),
    'pluck': Inst('Pluck', '#badc58', q=60, partials=harmonic(5, .55), att=.003, dec=.28, sus=.12, rel=.35, gain=.7, level_db=-20),
    'lead': Inst('Lead (saw)', '#e056fd', q=45, partials=[(h, 1 / h) for h in range(1, 7)], voices=3, detune=14, att=.02,
                 dec=.3, sus=.7, rel=.3, gain=.6, level_db=-17),
    'voice': Inst('Soprano (ah)', '#f06f73', tone=.95, q=42, partials=SOPRANO, formant=.9, f1=800, f2=1150, f3=2900,
                  formantQ=3.2, vib=34, vibRate=5.6, vibDelay=.4, noise=.03, noiseFreq=3800, voices=2, detune=9,
                  att=.09, dec=.3, sus=.85, rel=.45, gain=.5, level_db=-14),
    'bell': Inst('Bell', '#48dbfb', q=80, partials=BELL, att=.002, dec=1.4, sus=0, rel=1.6, gain=.6, level_db=-16),
    'impact': Inst('Impact', '#7ed6df', q=6, partials=harmonic(1, 1), pitchDrop=30, pitchTime=.28, noise=.5, noiseFreq=1500,
                   noiseBend=1, att=.001, dec=1.1, sus=0, rel=1.6, gain=1, level_db=-7),
    'riser': Inst('Riser', '#aaa7ac', q=30, partials=harmonic(1, 1), noise=.35, noiseFreq=3500, pitchDrop=-24, pitchTime=4.6,
                  noiseBend=1, att=.6, dec=.3, sus=1, rel=.4, gain=.5, level_db=-21),
}

CHORDS = {
    'Dm': ['D3', 'F3', 'A3', 'D4'],
    'Bb': ['Bb2', 'D3', 'F3', 'Bb3'],
    'F': ['C3', 'F3', 'A3', 'C4'],
    'C': ['C3', 'E3', 'G3', 'C4'],
}
ROOTS = {'Dm': 'D2', 'Bb': 'Bb1', 'F': 'F2', 'C': 'C2'}
ARPS = {
    'Dm': ['D4', 'A4', 'D5', 'F5', 'A4', 'D5', 'F5', 'A5'],
    'Bb': ['Bb3', 'F4', 'Bb4', 'D5', 'F4', 'Bb4', 'D5', 'F5'],
    'F': ['F4', 'C5', 'F5', 'A5', 'C5', 'F5', 'A5', 'C6'],
    'C': ['C4', 'G4', 'C5', 'E5', 'G4', 'C5', 'E5', 'G5'],
}


@dataclass
class Song:
    notes: list[Note] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    sections: dict[str, tuple[float, float]] = field(default_factory=dict)
    length: float = LENGTH
    bus_gain: dict[str, float] = field(default_factory=dict)  # fader factor per instrument, filled by render()

    def n(self, inst: str, pitch: str | float, bar: float, step: float, steps: float, vel: float = 1.0) -> None:
        m = midi(pitch) if isinstance(pitch, str) else pitch
        self.notes.append(Note(inst, m, bar_time(bar, step), steps * STEP, vel))

    def hit(self, kind: str, bar: float, step: float, strength: float = 1.0) -> None:
        self.events.append(Event(bar_time(bar, step), kind, strength))

    def chord(self, inst: str, name: str, bar: float, step: float, steps: float, vel: float = 1.0, octave: int = 0) -> None:
        for p in CHORDS[name]:
            self.n(inst, midi(p) + 12 * octave, bar, step, steps, vel)

    def kick(self, bar: float, step: float, vel: float = 1.0) -> None:
        self.n('kick', 'A1', bar, step, 1, vel)
        self.hit('kick', bar, step, vel)

    def boom(self, bar: float, step: float, vel: float = 1.0) -> None:
        self.n('boom', 'G1', bar, step, 2, vel)
        self.hit('boom', bar, step, vel)

    def snare(self, bar: float, step: float, vel: float = 1.0) -> None:
        self.n('snare', 'D3', bar, step, 1, vel)
        self.n('clap', 'D3', bar, step, 1, vel * .8)
        self.hit('snare', bar, step, vel)

    def impact(self, bar: float, step: float, strength: float = 1.0) -> None:
        self.n('impact', 'G1', bar, step, 4, strength)
        self.n('boom', 'D1', bar, step, 3, strength)
        self.n('bell', 'D4', bar, step, 6, strength * .8)
        self.n('bell', 'A4', bar, step + .02, 6, strength * .5)
        self.hit('hit', bar, step, strength)


def compose() -> Song:
    s = Song()
    s.sections = {
        'noise': (bar_time(0), bar_time(2)), 'carve': (bar_time(2), bar_time(4)),
        'title': (bar_time(4), bar_time(6)), 'features': (bar_time(6), bar_time(14)),
        'break': (bar_time(14), bar_time(16)), 'climax': (bar_time(16), bar_time(19)),
        'outro': (bar_time(19), LENGTH),
    }

    # bars 0-1: hiss swells in, the sub drone appears underneath
    s.n('air', 'A4', 0, 0, 30, .9)
    s.n('sub', 'D2', 0, 4, 60, .9)

    # bars 2-3: choir pad, cinematic booms
    s.chord('pad', 'Dm', 2, 0, 32, .9)
    s.boom(2, 0, 1)
    s.boom(3, 0, .9)
    s.boom(3, 10, .7)
    s.boom(3, 13, .8)

    # bar 4: the title hit — then the riser pulls into the groove
    s.impact(4, 0, 1)
    s.chord('pad', 'Dm', 4, 0, 32, 1)
    s.n('riser', 'D3', 4, 2, 30, .9)
    s.n('sub', 'D2', 4, 0, 32, 1)
    for st in range(0, 16, 2):
        s.n('hat', 'A5', 5, st, 1, .55 + .3 * (st % 4 == 0))
    s.kick(5, 8, .7)
    s.kick(5, 14, .8)

    # bars 6-13: the groove — Dm | Bb | F | C, two bars each
    progression = ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C']
    for i, ch in enumerate(progression):
        bar = 6 + i
        s.chord('pad', ch, bar, 0, 16, .9)
        if i >= 4:
            s.chord('strings', ch, bar, 0, 16, .8, octave=1)
        root = ROOTS[ch]
        for st in (0, 3, 6, 8, 11, 14):
            s.n('bass', root, bar, st, 2 if st in (0, 8) else 1.5, 1 if st in (0, 8) else .75)
        for k, pitch in enumerate(ARPS[ch]):
            s.n('pluck', pitch, bar, k * 2, 1.5, .8 + .2 * (k % 2 == 0))
        for st in (0, 6, 8) if i % 2 == 0 else (0, 8, 10):
            s.kick(bar, st, 1 if st in (0, 8) else .85)
        s.snare(bar, 4, .9)
        s.snare(bar, 12, 1)
        for st in range(0, 16, 2):
            s.n('hat', 'A5', bar, st, 1, .5 + .35 * (st % 4 == 0))
        s.n('ohat', 'A5', bar, 14, 2, .8)
    # a lead motif over the second half of the groove
    motif = [(10, 0, 'D5', 3), (10, 4, 'F5', 2), (10, 6, 'E5', 2), (10, 8, 'D5', 6),
             (11, 0, 'C5', 4), (11, 4, 'A4', 3), (11, 8, 'D5', 8),
             (12, 0, 'F5', 3), (12, 4, 'G5', 2), (12, 6, 'A5', 2), (12, 8, 'G5', 6),
             (13, 0, 'F5', 4), (13, 4, 'E5', 3), (13, 8, 'D5', 8)]
    for bar, st, pitch, ln in motif:
        s.n('lead', pitch, bar, st, ln, .9)

    # bars 14-15: the break — the floor drops away, then the roll and the riser
    s.boom(14, 0, 1)
    s.chord('pad', 'Dm', 14, 0, 32, 1)
    s.n('sub', 'D2', 14, 0, 32, 1)
    s.n('riser', 'D3', 14, 2, 30, 1)
    for st in range(0, 16, 2):
        s.n('hat', 'A5', 14, st, 1, .5)
    for st in range(0, 8, 2):
        s.n('snare', 'D3', 15, st, 1, .55 + st * .04)
    for st in range(8, 16):
        s.n('snare', 'D3', 15, st, 1, .7 + (st - 8) * .04)
    s.n('lead', 'D5', 14, 0, 8, .8)
    s.n('lead', 'A4', 14, 8, 8, .7)

    # bars 16-18: the climax — everything, plus the soprano
    for i, ch in enumerate(['Dm', 'Bb', 'F']):
        bar = 16 + i
        s.chord('pad', ch, bar, 0, 16, 1)
        s.chord('strings', ch, bar, 0, 16, 1, octave=1)
        root = ROOTS[ch]
        for st in range(0, 16, 2):
            s.n('bass', root, bar, st, 1.5, 1 if st % 4 == 0 else .8)
        for k, pitch in enumerate(ARPS[ch]):
            s.n('pluck', pitch, bar, k * 2, 1.5, .9)
            s.n('pluck', pitch, bar, k * 2 + 1, 1, .5)
        for st in (0, 4, 8, 12):
            s.kick(bar, st, 1)
        s.kick(bar, 14, .8)
        s.snare(bar, 4, 1)
        s.snare(bar, 12, 1)
        for st in range(0, 16):
            s.n('hat', 'A5', bar, st, 1, .45 + .4 * (st % 4 == 0) + .15 * (st % 2 == 0))
        s.n('ohat', 'A5', bar, 14, 2, .9)
    aria = [(16, 0, 'A4', 4), (16, 4, 'D5', 4), (16, 8, 'F5', 8),
            (17, 0, 'E5', 4), (17, 4, 'D5', 4), (17, 8, 'C5', 4), (17, 12, 'D5', 4),
            (18, 0, 'F5', 6), (18, 6, 'E5', 2), (18, 8, 'D5', 8)]
    for bar, st, pitch, ln in aria:
        s.n('voice', pitch, bar, st, ln, 1)

    # bar 19: the last hit, ringing out
    s.impact(19, 0, 1)
    s.chord('pad', 'Dm', 19, 0, 24, 1)
    s.chord('strings', 'Dm', 19, 0, 20, .9, octave=1)
    s.n('sub', 'D2', 19, 0, 20, 1)
    s.n('voice', 'D5', 19, 0, 16, 1)
    return s


def render(song: Song, log=print) -> np.ndarray:
    n = int(song.length * SR)
    noise = pink_noise(n + SR)
    buses: dict[str, np.ndarray] = {}
    by_inst: dict[str, list[Note]] = {}
    for note in song.notes:
        by_inst.setdefault(note.inst, []).append(note)
    mix = np.zeros((2, n))
    for name, notes in by_inst.items():
        inst = INSTRUMENTS[name]
        bus = np.zeros((2, n))
        for note in notes:
            render_voice(bus, noise, inst, hz(note.midi), note.t, note.dur, note.vel)
        buses[name] = normalize_bus(bus, inst.level_db)
        peak = float(np.abs(bus).max())
        song.bus_gain[name] = float(np.abs(buses[name]).max()) / peak if peak > 0 else 1.0
        mix += buses[name]
        log(f'  {inst.name:<14} {len(notes):4d} notes')
    mix = reverb(mix, mix=0.28)
    # the trailer arc: whisper, swell, and the title hit opens the master up
    mix = ride(mix, [(0, -11), (bar_time(2), -6), (bar_time(4) - 0.05, -3), (bar_time(4), 0), (bar_time(14), 0),
                     (bar_time(14) + 0.3, -3), (bar_time(16) - 0.05, -3), (bar_time(16), 0), (song.length, 0)])
    return master(mix).astype(np.float32)
