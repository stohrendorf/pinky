"""pinky's engine, in NumPy.

A voice is dry pink noise minus the same noise sent through a serial chain of
RBJ peaking boosts: everything cancels except the bands the chain lifts. This
module mirrors `src/lib/engine.ts` closely enough that the soundtrack really is
"just EQ on pink noise" — partial bands at `ratio × f0` with gain
`40·tone·level` dB and `Q = q·√ratio`, one optional wide (Q 0.8) noise band,
pitch-drop sweeps, vibrato, unison ranks, post-cancellation formants, and the
2.2 s noise-burst reverb.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import fftconvolve, lfilter, sosfilt

SR = 48000
BLOCK = 128  # Web Audio's render quantum — coefficient updates happen per block


# ---------------------------------------------------------------- pink noise
def pink_noise(n: int, seed: int = 7) -> np.ndarray:
    """Stereo (2, n) pink noise — Paul Kellet's filter, as in engine.ts."""
    rng = np.random.default_rng(seed)
    out = np.empty((2, n), np.float32)
    poles = [(0.99886, 0.0555179), (0.99332, 0.0750759), (0.96900, 0.1538520),
             (0.86650, 0.3104856), (0.55000, 0.5329522), (-0.7616, -0.0168980)]
    for ch in range(2):
        w = rng.uniform(-1.0, 1.0, n)
        acc = w * 0.5362
        for a, g in poles:
            acc += lfilter([g], [1.0, -a], w)
        acc[1:] += w[:-1] * 0.115926
        out[ch] = acc * 0.11
    return out


# ------------------------------------------------------------------ filters
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


def _filter_chain(x: np.ndarray, freqs, qs, gains, mod: np.ndarray | None, mod_exp) -> np.ndarray:
    """Serial peaking chain over stereo `x`. `mod[b]` is the pitch multiplier of
    block b (drop / vibrato), raised to `mod_exp[k]` per band (1 for partials,
    `noiseBend` for the wide band). Static chains are one sosfilt call."""
    freqs, qs, gains, mod_exp = map(np.asarray, (freqs, qs, gains, mod_exp))
    if mod is None:
        return sosfilt(peaking_sos(freqs, qs, gains), x, axis=-1)
    n = x.shape[-1]
    y = np.empty_like(x)
    zi = np.zeros((len(freqs), x.shape[0], 2))
    nblocks = int(np.ceil(n / BLOCK))
    static_from = len(mod) if len(mod) < nblocks else nblocks
    for b in range(min(nblocks, static_from)):
        s, e = b * BLOCK, min(n, (b + 1) * BLOCK)
        sos = peaking_sos(freqs * mod[b] ** mod_exp, qs, gains)
        y[:, s:e], zi = sosfilt(sos, x[:, s:e], axis=-1, zi=zi)
    if static_from < nblocks:  # the sweep is over — finish with constant coefficients
        s = static_from * BLOCK
        y[:, s:], _ = sosfilt(peaking_sos(freqs, qs, gains), x[:, s:], axis=-1, zi=zi)
    return y


# --------------------------------------------------------------- instrument
@dataclass
class Inst:
    """InstrumentParams from types.ts, same defaults as instruments.ts."""
    name: str = 'inst'
    color: str = '#53d8fb'
    tone: float = 1.0
    q: float = 40.0
    partials: list[tuple[float, float]] = field(default_factory=lambda: [(1, 1), (2, .6), (3, .36), (4, .216)])
    noise: float = 0.0
    noiseFreq: float = 6000.0
    noiseBend: float = 0.0
    formant: float = 0.0
    f1: float = 700.0
    f2: float = 1150.0
    f3: float = 2800.0
    formantQ: float = 6.0
    vib: float = 0.0
    vibRate: float = 5.5
    vibDelay: float = 0.35
    pitchDrop: float = 0.0
    pitchTime: float = 0.08
    voices: int = 1
    detune: float = 12.0
    att: float = 0.01
    dec: float = 0.25
    sus: float = 0.5
    rel: float = 0.35
    gain: float = 0.8
    pan: float = 0.0
    level_db: float = -18.0  # mixer fader for this instrument's bus

    def with_(self, **kw) -> 'Inst':
        return replace(self, **kw)

    def bands(self, f0: float) -> list[tuple[float, float, float]]:
        """(freq, q, gain_db) of every band of one rank — for the scope drawings."""
        out = [(f0 * r, self.q * np.sqrt(r), 40 * self.tone * lv) for r, lv in self.partials if lv > 0 and self.tone > 0]
        if self.noise > 0:
            out.append((self.noiseFreq, 0.8, 40 * self.noise))
        return out


def harmonic(n: int, falloff: float, stretch: float = 0.0) -> list[tuple[float, float]]:
    return [((h + 1) ** (1 + stretch), falloff ** h) for h in range(n)]


def adsr(n: int, gate_n: int, att: float, dec: float, sus: float, rel: float) -> np.ndarray:
    t = np.arange(n) / SR
    env = np.empty(n)
    a_n = max(1, int(att * SR))
    env[:a_n] = np.linspace(0, 1, a_n, endpoint=False)[:n]
    if n > a_n:
        td = t[a_n:] - t[a_n]
        env[a_n:] = sus + (1 - sus) * np.exp(-3 * td / max(dec, 1e-3))
    if gate_n < n:
        gate_n = max(gate_n, 1)
        level = env[gate_n - 1]
        tr = t[gate_n:] - t[gate_n]
        r = max(rel, 1e-3)
        tail = level * np.exp(-5 * tr / r) * np.clip((r * 1.05 - tr) / (r * 0.15), 0, 1)
        env[gate_n:] = tail
    return env


def render_voice(bus: np.ndarray, noise: np.ndarray, inst: Inst, freq: float, t0: float, gate: float,
                 vel: float = 1.0) -> None:
    """Schedule one note on `bus` — the equivalent of engine.ts `makeVoice`."""
    start = int(round(t0 * SR))
    n = int((gate + inst.rel * 1.05 + 0.02) * SR)
    n = min(n, bus.shape[1] - start)
    if n <= BLOCK or start < 0:
        return
    seg = noise[:, start:start + n].astype(np.float64)
    gate_n = int(gate * SR)
    env = adsr(n, gate_n, inst.att, inst.dec, inst.sus, inst.rel)

    nblocks = int(np.ceil(n / BLOCK))
    tb = np.arange(nblocks) * BLOCK / SR
    mod = None
    if inst.pitchDrop != 0 or inst.vib > 0:
        mod = np.ones(nblocks)
        if inst.pitchDrop != 0:
            sweep = tb < inst.pitchTime
            mod[sweep] *= 2 ** (inst.pitchDrop / 12 * (1 - tb[sweep] / inst.pitchTime))
        if inst.vib > 0:
            depth = np.clip(tb / max(inst.vibDelay, 1e-3), 0, 1) * inst.vib / 1200
            mod *= 2 ** (depth * np.sin(2 * np.pi * inst.vibRate * tb))
        if inst.vib == 0:  # only the drop: the rest of the note is static
            mod = mod[:int(np.ceil(inst.pitchTime * SR / BLOCK)) + 1]

    ranks = max(1, int(inst.voices))
    cents = np.linspace(-inst.detune / 2, inst.detune / 2, ranks) if ranks > 1 else np.zeros(1)
    pans = np.linspace(-0.6, 0.6, ranks) if ranks > 1 else np.zeros(1)
    out = np.zeros_like(seg)
    for c, p_off in zip(cents, pans):
        f0 = freq * 2 ** (c / 1200)
        freqs, qs, gains, exps = [], [], [], []
        if inst.tone > 0:
            for r, lv in inst.partials:
                if lv <= 0 or f0 * r > SR * 0.45:
                    continue
                freqs.append(f0 * r)
                qs.append(inst.q * np.sqrt(r))
                gains.append(40 * inst.tone * lv)
                exps.append(1.0)
        if inst.noise > 0:
            freqs.append(inst.noiseFreq)
            qs.append(0.8)
            gains.append(40 * inst.noise)
            exps.append(inst.noiseBend)
        if not freqs:
            continue
        rank = _filter_chain(seg, freqs, qs, gains, mod, exps) - seg  # the cancellation
        pan = np.clip(inst.pan + p_off, -1, 1)
        rank[0] *= np.sqrt(2) * np.cos((pan + 1) * np.pi / 4)
        rank[1] *= np.sqrt(2) * np.sin((pan + 1) * np.pi / 4)
        out += rank
    if inst.formant > 0:  # fixed resonances downstream of the cancellation
        sos = peaking_sos([inst.f1, inst.f2, inst.f3], [inst.formantQ] * 3,
                          [24 * inst.formant, 22 * inst.formant, 18 * inst.formant])
        out = sosfilt(sos, out, axis=-1) * 10 ** (-12 * inst.formant / 20)
    out *= env * (0.9 * inst.gain * np.clip(vel, 0, 1) / np.sqrt(ranks))
    bus[:, start:start + n] += out


# ------------------------------------------------------------------- master
def normalize_bus(bus: np.ndarray, target_db: float) -> np.ndarray:
    """Set the fader: the loud parts of the bus (99th percentile of 50 ms RMS)
    land at `target_db` dBFS regardless of how hot the EQ boosts came out."""
    mono = bus.mean(axis=0)
    win = int(0.05 * SR)
    frames = len(mono) // win
    rms = np.sqrt((mono[:frames * win].reshape(frames, win) ** 2).mean(axis=1))
    active = rms[rms > 1e-5]
    if not len(active):
        return bus
    ref = np.percentile(active, 99)
    return bus * (10 ** (target_db / 20) / ref)


def reverb(x: np.ndarray, seconds: float = 2.2, decay: float = 3.0, mix: float = 0.3, seed: int = 11) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    env = (1 - np.arange(n) / n) ** decay
    wet = np.empty_like(x)
    for ch in range(x.shape[0]):
        ir = rng.uniform(-1, 1, n) * env
        ir /= np.sqrt((ir ** 2).sum())
        wet[ch] = fftconvolve(x[ch], ir)[:x.shape[1]]
    return x + mix * wet


def limiter(x: np.ndarray, ceiling: float = 0.97) -> np.ndarray:
    """Look-ahead peak limiter. The gain is derived from a 50 ms running maximum
    and then smoothed over 10 ms — every sample inside the smoothing window saw
    the same peak, so the smoothed gain still keeps it under the ceiling; the
    clip is only a guard against rounding."""
    peak = np.abs(x).max(axis=0)
    env = maximum_filter1d(peak, int(0.05 * SR))
    gain = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
    gain = uniform_filter1d(gain, int(0.01 * SR))
    return np.clip(x * gain, -ceiling, ceiling)


def ride(x: np.ndarray, points: list[tuple[float, float]]) -> np.ndarray:
    """Master volume automation: (time s, gain dB) breakpoints, linear in dB."""
    t = np.arange(x.shape[1]) / SR
    ts, dbs = zip(*points)
    return x * 10 ** (np.interp(t, ts, dbs) / 20)


def master(x: np.ndarray, rms_db: float = -15.0) -> np.ndarray:
    mono = x.mean(axis=0)
    win = int(0.4 * SR)
    frames = len(mono) // win
    rms = np.sqrt((mono[:frames * win].reshape(frames, win) ** 2).mean(axis=1))
    loud = np.percentile(rms[rms > 1e-5], 90)
    x = x * (10 ** (rms_db / 20) / loud)
    return limiter(x)


def write_wav(path, x: np.ndarray) -> None:
    from scipy.io import wavfile
    pcm = np.clip(x.T, -1, 1)
    wavfile.write(str(path), SR, (pcm * 32767).astype(np.int16))
