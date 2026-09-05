"""What the picture knows about the sound: a per-frame spectrum (on the scope's
quadratic frequency axis), loudness, kick/hit envelopes, and the scope overlay
— the *predicted* output spectrum of the voices sounding at time t, computed
like Scope.svelte does it: Σ level²·|∏H(f) − 1|² · pinkPSD(f)."""
from __future__ import annotations

import math

import numpy as np

from . import score as sc
from .gfx import x_to_freq
from .response import SR, Inst, chain_response, pink_psd

N_BARS = 112
FMAX = 12000.0


def env_at(inst, dt: float, gate: float) -> float:
    """ADSR level `dt` seconds into a note with the given gate length."""
    if dt < 0:
        return 0.0
    if dt < inst.att:
        return dt / inst.att
    lvl = inst.sus + (1 - inst.sus) * math.exp(-3 * (min(dt, gate) - inst.att) / max(inst.dec, 1e-3))
    if dt <= gate:
        return lvl
    tr = dt - gate
    if tr > inst.rel * 1.05:
        return 0.0
    return lvl * math.exp(-5 * tr / max(inst.rel, 1e-3))


class Analysis:
    def __init__(self, audio: np.ndarray, song: sc.Song, fps: int, log=print):
        self.song = song
        self.fps = fps
        self.nframes = int(math.ceil(song.length * fps))
        mono = audio.mean(axis=0).astype(np.float32)
        win = 4096
        window = np.hanning(win).astype(np.float32)
        freqs = np.fft.rfftfreq(win, 1 / SR)
        # bar i covers the frequencies under pixel column i/N..(i+1)/N of the scope
        edges = x_to_freq(np.arange(N_BARS + 1) / N_BARS, 1.0, FMAX)
        bin_of_bar = np.clip(np.searchsorted(freqs, edges), 0, len(freqs) - 1)
        raw = np.zeros((self.nframes, N_BARS), np.float32)
        rms = np.zeros(self.nframes, np.float32)
        pad = np.concatenate([np.zeros(win // 2, np.float32), mono, np.zeros(win, np.float32)])
        for i in range(self.nframes):
            c = int(i / fps * SR)
            seg = pad[c:c + win] * window
            mag = np.abs(np.fft.rfft(seg)) * (2 / win)
            db = 20 * np.log10(mag + 1e-7)
            for b in range(N_BARS):
                lo, hi = bin_of_bar[b], max(bin_of_bar[b] + 1, bin_of_bar[b + 1])
                raw[i, b] = db[lo:hi].max()
            rms[i] = np.sqrt((seg ** 2).mean())
        # analyser-style dB window, then the fast-attack / slow-release ballistics
        self.bars_raw = np.clip((raw + 78) / 66, 0, 1)
        self.bars = np.empty_like(self.bars_raw)
        prev = np.zeros(N_BARS, np.float32)
        release = 1.6 / fps
        for i in range(self.nframes):
            prev = np.maximum(self.bars_raw[i], prev - release)
            self.bars[i] = prev
        self.rms = np.clip(rms / max(1e-6, np.percentile(rms, 98)), 0, 1)
        self.events = sorted(song.events, key=lambda e: e.t)
        self.by_inst = {}
        for n in song.notes:
            self.by_inst.setdefault(n.inst, []).append(n)
        log(f'  analysed {self.nframes} frames')

    # ---- envelopes ----
    def frame(self, t: float) -> int:
        return int(min(self.nframes - 1, max(0, round(t * self.fps))))

    def spectrum(self, t: float) -> np.ndarray:
        return self.bars[self.frame(t)]

    def loudness(self, t: float) -> float:
        return float(self.rms[self.frame(t)])

    def pulse(self, t: float, kinds=('kick', 'boom', 'hit'), decay: float = 0.18) -> float:
        v = 0.0
        for e in self.events:
            if e.t > t:
                break
            if e.kind in kinds:
                v = max(v, e.strength * math.exp(-(t - e.t) / decay))
        return v

    def hit(self, t: float, decay: float = 0.5) -> float:
        return self.pulse(t, ('hit',), decay)

    def last_event(self, t: float, kinds=('kick', 'boom', 'hit')):
        last = None
        for e in self.events:
            if e.t > t:
                break
            if e.kind in kinds:
                last = e
        return last

    # ---- what is sounding ----
    def active(self, t: float, insts=None) -> list[tuple[Inst, float, float, sc.Note]]:
        """(instrument, frequency, level, note) of every voice alive at t."""
        out = []
        for name, notes in self.by_inst.items():
            if insts is not None and name not in insts:
                continue
            inst = self.song.instruments[name]
            for n in notes:
                if n.t <= t <= n.t + n.dur + inst.rel * 1.05:
                    lvl = env_at(inst, t - n.t, n.dur) * n.vel * inst.voice_gain
                    if lvl > 1e-4:
                        out.append((inst, sc.hz(n.midi), lvl, n))
        return out

    def overlay(self, t: float, f: np.ndarray, insts=None, max_voices: int = 40):
        """Predicted output spectrum at time t: the frequency grid (the given
        one plus every active band centre and its half-power points, like the
        scope's resonance anchors — a Q-40 peak falls between pixels otherwise),
        the dB curve on it, and the coloured dots for the band centres."""
        voices = sorted(self.active(t, insts), key=lambda v: -v[2])[:max_voices]
        anchors = []
        for inst, f0, _, _ in voices:
            for bf, q, _ in inst.bands(f0):
                if bf < f[-1]:
                    anchors += [bf, bf * (1 - 0.5 / q), bf * (1 + 0.5 / q)]
        if anchors:
            f = np.unique(np.concatenate([f, np.array(anchors)]))
        power = np.zeros(len(f))
        dots = []
        for inst, f0, lvl, _ in voices:
            bands = inst.bands(f0)
            if not bands:
                continue
            fr, qs, gs = zip(*bands)
            h = chain_response(fr, qs, gs, f)
            p = (lvl ** 2) * np.abs(h) ** 2
            power += p
            for bf in fr:
                if bf < f[-1]:
                    hb = chain_response(fr, qs, gs, np.array([bf]))
                    dots.append((bf, 10 * np.log10(max(1e-12, (lvl ** 2) * abs(hb[0]) ** 2 * pink_psd(bf))), inst.color,
                                 min(1.0, 0.45 + 0.55 * min(1.0, lvl * 8))))
        power *= pink_psd(f)
        return f, 10 * np.log10(np.maximum(power, 1e-12)), dots
