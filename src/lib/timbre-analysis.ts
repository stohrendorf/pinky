import type { InstrumentParams } from "./types";

import { noteByName } from "./notes";

/* ---- offline timbre analysis ----
 * A pure-JS model of one engine voice (see engine.ts `makeRank`): pink noise
 * through the serial chain of peaking boosts, minus the dry noise, through the
 * fixed formant bands and the amp envelope. It exists so that instruments can
 * be *measured* instead of guessed at — the question "does this patch sound
 * like a note or like a noise burst?" has a number.
 *
 * Why an instrument that looks fine on paper can still be pure noise: a
 * partial only survives the cancellation as the residual (H − 1) of its
 * peaking band, and that residual is a resonator whose Q is not `q` but
 * `q · 10^(dB/40)` — 10 × `q` at the full 40 dB boost. A resonator rings up
 * (and narrows down) with the time constant τ = Q_eff / (π · f): at 30 Hz and
 * q 34 that is *two seconds*, so a 100 ms bass note never becomes a pitch — the
 * ear only gets the transient plus whatever wide noise band is in the chain. */

export const ANALYSIS_SAMPLE_RATE = 44100;

const MIN_BAND_DB = 0.5;
const FORMANT_DB = 22;
const TAIL = 1.5;
// Below this the fundamental is felt rather than heard on ordinary speakers, so
// it is neither counted as pitch nor as noise.
const AUDIBLE_LOW_HZ = 40;
const AUDIBLE_HIGH_HZ = 16000;
// Half-width of the window that still counts as "on the partial" (cents).
const PITCH_WINDOW_CENTS = 25;
// Sweeps and vibrato retune the biquads once per block, like an a-rate param.
const COEFF_BLOCK = 32;

/** Deterministic noise, so a measurement is repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paul Kellet's pink filter — the same one `pinkNoiseBuffer` in engine.ts uses.
function pinkNoise(length: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(length);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** RBJ / Web Audio peaking EQ, transposed direct form II. */
class Peaking {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(
    private readonly sampleRate: number,
    frequency: number,
    private readonly q: number,
    private readonly gainDb: number,
  ) {
    this.tune(frequency);
  }

  tune(frequency: number): void {
    const w0 =
      (2 * Math.PI * Math.min(frequency, this.sampleRate * 0.49)) /
      this.sampleRate;
    const amplitude = Math.pow(10, this.gainDb / 40);
    const alpha = Math.sin(w0) / (2 * Math.max(0.1, this.q));
    const cosine = -2 * Math.cos(w0);
    const a0 = 1 + alpha / amplitude;
    this.b0 = (1 + alpha * amplitude) / a0;
    this.b1 = cosine / a0;
    this.b2 = (1 - alpha * amplitude) / a0;
    this.a1 = cosine / a0;
    this.a2 = (1 - alpha / amplitude) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

interface SweptBand {
  filter: Peaking;
  from: number; // where the band starts (Hz)
  target: number; // where it lands after `pitchTime`
  vibrato: boolean;
}

export interface UsedPartial {
  ratio: number;
  level: number;
  q: number;
}

/** The partials the engine actually builds bands for (see `makeRank`). */
export function usedPartials(params: InstrumentParams): UsedPartial[] {
  const custom =
    params.partials && params.partials.length ? params.partials : null;
  const all: UsedPartial[] = custom
    ? custom
        .filter((x) => x.level > 0 && x.ratio > 0)
        .map((x) => ({
          ratio: x.ratio,
          level: x.level,
          q: params.q * Math.sqrt(x.ratio),
        }))
    : Array.from({ length: Math.max(0, Math.round(params.harm)) }, (_, i) => ({
        ratio: Math.pow(i + 1, 1 + params.stretch),
        level: Math.pow(params.falloff, i),
        q: params.q * Math.sqrt(i + 1),
      }));
  const used = all.filter((x) => 40 * params.tone * x.level >= MIN_BAND_DB);
  return used.length || !all.length ? used : [all[0]];
}

/** Unison rank ratios exactly as `makeVoice` spreads them (1 = a single rank). */
export function unisonRatios(params: InstrumentParams): number[] {
  const n = Math.max(1, Math.min(8, Math.round(params.voices || 1)));
  if (n === 1 || params.detune <= 0) {
    return [1];
  }
  return Array.from({ length: n }, (_, i) => {
    const x = (2 * i) / (n - 1) - 1;
    return Math.pow(2, (x * params.detune) / 2 / 1200);
  });
}

/** Ring-up time constant (s) of the residual resonator behind one band. */
export function ringTime(frequency: number, q: number, gainDb: number): number {
  return (q * Math.pow(10, gainDb / 40)) / (Math.PI * frequency);
}

export interface RenderedNote {
  samples: Float32Array;
  sampleRate: number;
  /** frequencies (Hz) that count as "the pitch": every rank × every partial */
  partialFrequencies: number[];
  /** widest vibrato excursion as a ratio (1 = none) */
  vibratoSpread: number;
  /** how long the amp envelope stays above a tenth of its peak (s) */
  effectiveDuration: number;
}

/**
 * Render one note of an instrument the way the engine plays it: `hold`
 * seconds of key-down, then the release tail. Velocity is left at 1 — it only
 * scales the level, which the clarity measure is independent of.
 */
export function renderNote(
  params: InstrumentParams,
  frequency: number,
  hold: number,
  sampleRate = ANALYSIS_SAMPLE_RATE,
  seed = 1,
): RenderedNote {
  const nyquist = sampleRate / 2;
  const release = Math.max(0.02, params.rel);
  const total = Math.ceil((hold + release * TAIL) * sampleRate);
  const noise = pinkNoise(total, seed);
  const out = new Float32Array(total);
  const ratios = unisonRatios(params);
  const rankLevel = 1 / Math.sqrt(ratios.length);
  const partials = usedPartials(params);
  const partialFrequencies: number[] = [];
  const bendRatio = Math.pow(2, params.pitchDrop / 12);
  const vibRatio = Math.pow(2, Math.max(0, params.vib || 0) / 1200) - 1;
  const vibOnset = Math.max(0, params.vibDelay || 0);
  const vibRate = Math.max(0.1, params.vibRate || 5.5);
  let loudSamples = 0;

  // Formant trim: an emphasis, not a volume (see `levelFor` in engine.ts)
  let formantWeight = 0;
  const formantSpecs =
    params.formant > 0
      ? [
          { hz: params.f1, w: 1 },
          { hz: params.f2, w: 0.75 },
          { hz: params.f3, w: 0.45 },
        ].filter(
          (f) =>
            f.hz > 0 &&
            f.hz <= nyquist * 0.9 &&
            FORMANT_DB * params.formant * f.w >= MIN_BAND_DB,
        )
      : [];
  if (formantSpecs.length) {
    formantWeight = formantSpecs[0].w;
  }
  const level =
    0.9 *
    params.gain *
    rankLevel *
    (formantWeight
      ? Math.pow(10, (-FORMANT_DB * params.formant * formantWeight) / 40)
      : 1);

  for (const rankRatio of ratios) {
    const base = frequency * rankRatio;
    const bands: SweptBand[] = [];
    if (params.tone > 0) {
      for (const part of partials) {
        const f = base * part.ratio;
        if (f > nyquist * 0.9) {
          continue;
        }
        const from = params.pitchDrop !== 0 ? f * bendRatio : f;
        bands.push({
          filter: new Peaking(
            sampleRate,
            from,
            part.q,
            40 * params.tone * part.level,
          ),
          from,
          target: f,
          vibrato: vibRatio > 0,
        });
        partialFrequencies.push(f);
      }
    }
    if (params.noise > 0 && params.noiseFreq <= nyquist * 0.9) {
      const from =
        params.pitchDrop !== 0 && params.noiseBend > 0
          ? Math.min(
              nyquist * 0.95,
              params.noiseFreq *
                Math.pow(2, (params.pitchDrop * params.noiseBend) / 12),
            )
          : params.noiseFreq;
      bands.push({
        filter: new Peaking(sampleRate, from, 0.8, 40 * params.noise),
        from,
        target: params.noiseFreq,
        vibrato: false,
      });
    }
    const formants = formantSpecs.map(
      (f) =>
        new Peaking(
          sampleRate,
          f.hz,
          Math.max(1, params.formantQ || 3),
          FORMANT_DB * params.formant * f.w,
        ),
    );
    const moving = bands.some((b) => b.from !== b.target || b.vibrato);

    // Amp ADSR exactly as scheduled by the engine: linear attack, then
    // setTargetAtTime towards sustain (τ = dec/3) and towards 0 (τ = rel/3).
    const peak = 0.9;
    const attackSamples = Math.max(1, Math.round(params.att * sampleRate));
    const decayCoefficient =
      1 - Math.exp(-1 / (Math.max(0.01, params.dec / 3) * sampleRate));
    const releaseCoefficient =
      1 - Math.exp(-1 / (Math.max(0.01, release / 3) * sampleRate));
    const holdSamples = Math.round(hold * sampleRate);
    let env = 0;
    loudSamples = 0;

    for (let i = 0; i < total; i++) {
      if (moving && i % COEFF_BLOCK === 0) {
        const t = i / sampleRate;
        const sweep =
          params.pitchTime > 0 ? Math.min(1, t / params.pitchTime) : 1;
        const wobble =
          vibRatio > 0
            ? 1 +
              vibRatio *
                Math.sin(2 * Math.PI * vibRate * t) *
                (vibOnset > 0.005 ? Math.min(1, t / vibOnset) : 1)
            : 1;
        for (const band of bands) {
          let f =
            band.from === band.target
              ? band.target
              : band.from * Math.pow(band.target / band.from, sweep);
          if (band.vibrato) {
            f *= wobble;
          }
          band.filter.tune(f);
        }
      }
      const x = noise[i];
      let y = x;
      for (const band of bands) {
        y = band.filter.process(y);
      }
      y = (y - x) * level;
      for (const formant of formants) {
        y = formant.process(y);
      }
      if (i < attackSamples) {
        env = (peak * (i + 1)) / attackSamples;
      } else if (i < holdSamples) {
        env += (params.sus * peak - env) * decayCoefficient;
      } else {
        env += (0 - env) * releaseCoefficient;
      }
      if (env >= peak * 0.1) {
        loudSamples++;
      }
      out[i] += y * env;
    }
  }
  return {
    samples: out,
    sampleRate,
    partialFrequencies,
    vibratoSpread: 1 + vibRatio,
    effectiveDuration: loudSamples / sampleRate,
  };
}

/* In-place iterative radix-2 FFT on (re, im). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j],
          ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface NoteAnalysis {
  /** share (0..1) of the audible energy that sits on the note's partials */
  clarity: number;
  /** loudest 50 ms RMS of the rendered note, dBFS — is it even audible? */
  peakDb: number;
}

interface EnergySplit {
  harmonic: number;
  total: number;
  peak: number; // mean square of the loudest 50 ms
}

/**
 * How much of what the ear gets is *the note*. Power spectrum of the whole
 * rendered note (attack, body and release included — a slow ring-up or a
 * chirping sweep is heard, so it counts), then the energy inside ±25 cents
 * (plus vibrato) of every partial over the energy in the audible band.
 * 1 = every joule is on a harmonic, 0 = none is. A note that only lasts T
 * seconds cannot be narrower than ~1/T Hz whatever the filter does — that is
 * a short note, not a noisy one — so the window never closes below that.
 */
export function analyzeNote(note: RenderedNote): NoteAnalysis {
  return summarize(splitEnergy(note));
}

const summarize = ({ harmonic, total, peak }: EnergySplit): NoteAnalysis => ({
  clarity: total > 0 ? harmonic / total : 0,
  peakDb: peak > 0 ? 10 * Math.log10(peak) : -Infinity,
});

function splitEnergy(note: RenderedNote): EnergySplit {
  const { samples, sampleRate, partialFrequencies } = note;
  let size = 1 << 15;
  while (size < samples.length) {
    size <<= 1;
  }
  // resolution matters at the bottom: ±25 cents of 40 Hz is ±0.6 Hz
  size = Math.max(size, 1 << 17);
  const re = new Float64Array(size),
    im = new Float64Array(size);
  let peak = 0;
  const window = Math.round(sampleRate * 0.05);
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    re[i] = samples[i];
    acc += samples[i] * samples[i];
    if (i >= window) {
      acc -= samples[i - window] * samples[i - window];
    }
    if (i >= window - 1) {
      peak = Math.max(peak, acc / window);
    }
  }
  fft(re, im);
  const binHz = sampleRate / size;
  const low = Math.ceil(AUDIBLE_LOW_HZ / binHz),
    high = Math.min(size / 2, Math.floor(AUDIBLE_HIGH_HZ / binHz));
  const spread = Math.pow(2, PITCH_WINDOW_CENTS / 1200) * note.vibratoSpread;
  const uncertainty = 1 / Math.max(0.02, note.effectiveDuration);
  const onPitch = new Uint8Array(size / 2);
  for (const f of partialFrequencies) {
    const halfWidth = Math.max(f * spread - f, uncertainty);
    const from = Math.max(low, Math.floor((f - halfWidth) / binHz));
    const to = Math.min(high, Math.ceil((f + halfWidth) / binHz));
    for (let k = from; k <= to; k++) {
      onPitch[k] = 1;
    }
  }
  let total = 0,
    harmonic = 0;
  for (let k = low; k <= high; k++) {
    const power = re[k] * re[k] + im[k] * im[k];
    total += power;
    if (onPitch[k]) {
      harmonic += power;
    }
  }
  return { harmonic, total, peak };
}

export interface InstrumentClarity extends NoteAnalysis {
  pitch: string;
  frequency: number;
  hold: number;
}

// A 100 ms note is one random draw of noise through a resonator, so a single
// rendering is a noisy measurement of the instrument; pooling a few draws is
// what the ear does over a whole song.
const MEASURE_SEEDS = 3;

/** Render + analyze one note by name, `steps` sixteenths long at `bpm`. */
export function measureNote(
  params: InstrumentParams,
  pitch: string,
  steps: number,
  bpm: number,
): InstrumentClarity {
  const frequency = noteByName[pitch]?.freq;
  if (!frequency) {
    throw new Error(`Unknown pitch ${pitch}`);
  }
  // long pads are measured on their first two seconds — that is what decides
  // whether they read as a chord or as a wash
  const hold = Math.min(2, Math.max(0.05, (steps * 60) / bpm / 4));
  const pooled: EnergySplit = { harmonic: 0, total: 0, peak: 0 };
  for (let seed = 1; seed <= MEASURE_SEEDS; seed++) {
    const split = splitEnergy(
      renderNote(params, frequency, hold, ANALYSIS_SAMPLE_RATE, seed),
    );
    pooled.harmonic += split.harmonic;
    pooled.total += split.total;
    pooled.peak = Math.max(pooled.peak, split.peak);
  }
  return { pitch, frequency, hold, ...summarize(pooled) };
}

/**
 * Is this patch meant to be heard as a pitch at all? Drums live on the wide
 * noise band and on big sweeps (kicks, toms), risers sweep for seconds, a rim
 * click is over before any band could ring, and a low-q body with a noise
 * band is a drum skin (timpani). Everything else is expected to hold a note.
 */
export function isPitched(params: InstrumentParams): boolean {
  if (params.tone < 0.5 || params.noise >= 0.5) {
    return false;
  }
  if (Math.abs(params.pitchDrop) >= 10) {
    return false;
  }
  if (params.sus === 0 && params.dec <= 0.08) {
    return false;
  }
  if (params.q < 8 && params.noise > 0.1) {
    return false;
  }
  return usedPartials(params).length > 0;
}
