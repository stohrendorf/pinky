"""The soundtrack — a trailer-shaped piece in D minor at 100 BPM.

Bars are 2.4 s; the picture cuts on these bar lines:

    bar  0- 1  hiss + sub drone          "every sound in this video is pink noise"
    bar  2- 3  choir pad, booms          the spectrum gets carved
    bar  4     TITLE HIT, riser          "pinky"
    bar  6-13  groove                    feature sequence (4 × 2 bars)
    bar 14-15  break, snare roll         "no samples / no oscillators / just EQ"
    bar 16-18  climax with the soprano   full-screen scope
    bar 19     final hit, ring-out       logo + link

The music lives in the DAW: it is the "Pinky Promo" demo song
(src/lib/promo-demo.ts) and is bounced through the real engine by
`node promo/bounce.mjs`, which writes the WAV and, next to it, the score file
this module reads — every note in seconds, the hits, the chapter times and the
instrument patches for the scope overlays.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .response import Inst

BPM = 100
BEAT = 60 / BPM
STEP = BEAT / 4
BAR = 16 * STEP


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


@dataclass
class Song:
    notes: list[Note] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    sections: dict[str, tuple[float, float]] = field(default_factory=dict)
    instruments: dict[str, Inst] = field(default_factory=dict)
    length: float = 0.0


def load(path: Path) -> Song:
    """Read the score file the bounce wrote next to the WAV."""
    data = json.loads(path.read_text(encoding='utf-8'))
    if data['bpm'] != BPM:
        raise SystemExit(f'{path}: the demo runs at {data["bpm"]} BPM, the storyboard is cut for {BPM}')
    return Song(
        notes=[Note(n['inst'], n['midi'], n['t'], n['dur'], n['vel']) for n in data['notes']],
        events=[Event(e['t'], e['kind'], e['strength']) for e in data['events']],
        sections={name: (a, b) for name, (a, b) in data['sections'].items()},
        instruments={name: Inst.from_score(entry) for name, entry in data['instruments'].items()},
        length=data['length'],
    )
