"""The engine's filter maths, for the *picture* only.

The soundtrack itself is bounced from the DAW's real engine (promo/bounce.mjs);
nothing here makes sound. What the scenes need is the predicted frequency
response of a voice — the same Σ level²·|∏H(f) − 1|²·pinkPSD(f) that
Scope.svelte draws — to overlay band centres and curves on the analysed
spectrum. A voice is pink noise minus that noise through a serial chain of
RBJ peaking boosts: partial bands at `ratio × f0` with gain `40·tone·level` dB
and `Q = q·√ratio`, one optional wide (Q 0.8) noise band, formants downstream.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SR = 48000


def peaking_sos(f0, q, gain_db, fs: int = SR) -> np.ndarray:
    """RBJ peaking EQ as second-order sections, vectorised over bands."""
    f0 = np.minimum(np.asarray(f0, float), fs * 0.49)
    q = np.maximum(np.asarray(q, float), 0.1)
    w0 = 2 * np.pi * f0 / fs
    A = 10 ** (np.asarray(gain_db, float) / 40)
    alpha = np.sin(w0) / (2 * q)
    c = -2 * np.cos(w0)
    a0 = 1 + alpha / A
    sos = np.stack([(1 + alpha * A) / a0, c / a0, (1 - alpha * A) / a0,
                    np.ones_like(a0), c / a0, (1 - alpha / A) / a0], axis=-1)
    return sos.reshape(-1, 6)


def chain_response(freqs, qs, gains, f: np.ndarray, fs: int = SR) -> np.ndarray:
    """Complex ∏H(f) − 1 of a cancelled chain — what a voice actually outputs."""
    sos = peaking_sos(freqs, qs, gains, fs)
    z = np.exp(-1j * 2 * np.pi * np.asarray(f, float) / fs)
    h = np.ones_like(z)
    for b0, b1, b2, _, a1, a2 in sos:
        h *= (b0 + b1 * z + b2 * z * z) / (1 + a1 * z + a2 * z * z)
    return h - 1


def pink_psd(f: np.ndarray) -> np.ndarray:
    return 1.0 / np.maximum(np.asarray(f, float), 20.0)


@dataclass
class Inst:
    """The subset of InstrumentParams (types.ts) the overlay needs, as the
    bounce wrote it into the score file, plus the level one voice plays at."""
    name: str
    color: str
    tone: float = 1.0
    q: float = 40.0
    partials: list[tuple[float, float]] = field(default_factory=list)
    noise: float = 0.0
    noiseFreq: float = 6000.0
    att: float = 0.01
    dec: float = 0.25
    sus: float = 0.5
    rel: float = 0.35
    voice_gain: float = 0.72

    @classmethod
    def from_score(cls, entry: dict) -> 'Inst':
        p = entry['params']
        return cls(entry['name'].split('/')[-1], entry['color'], tone=p['tone'], q=p['q'],
                   partials=[(b['ratio'], b['level']) for b in p.get('partials') or []],
                   noise=p['noise'], noiseFreq=p['noiseFreq'], att=p['att'], dec=p['dec'], sus=p['sus'], rel=p['rel'],
                   voice_gain=entry['voiceGain'])

    def bands(self, f0: float) -> list[tuple[float, float, float]]:
        """(freq, q, gain_db) of every band of one rank — for the scope drawings."""
        out = [(f0 * r, self.q * np.sqrt(r), 40 * self.tone * lv) for r, lv in self.partials if lv > 0 and self.tone > 0]
        if self.noise > 0:
            out.append((self.noiseFreq, 0.8, 40 * self.noise))
        return out
