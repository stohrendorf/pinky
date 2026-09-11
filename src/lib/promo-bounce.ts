import type { Project } from "./types";

import * as eng from "./engine";
import { resolveMixer } from "./mixer";
import { buildPromoDemo, PROMO_ID, type PromoPart } from "./promo-demo";
import { promoScore, type PromoScore } from "./promo-score";
import { scheduleRange, songLengthSteps } from "./transport";
import { encodeWav } from "./wav";

/* The promo soundtrack, bounced through the real engine.
 * `promo/bounce.mjs` opens the DAW in a headless browser and calls
 * `bouncePromo()`: the Pinky Promo demo is rendered into an OfflineAudioContext
 * exactly like the WAV export does it, and comes back as a WAV plus the score
 * the video renderer needs (every note in seconds, the hits, the patches). */

export interface PromoBounce {
  /** the finished soundtrack, 16-bit PCM WAV, base64 (binary can't cross `page.evaluate`) */
  wav: string;
  score: PromoScore;
  /** sample peak of the float render after master limiting, dBFS */
  peakDb: number;
  /** sample peak of every bar, dBFS — for riding the master lane where the mix runs hot */
  barPeaksDb: number[];
}

const base64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

/** Render a project into a fresh offline graph, all master values taken from the project's lanes. */
async function render(
  p: Project,
  seconds: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  // the master lanes take over at step 0 anyway — start the graph on their
  // first value so the bounce does not depend on where the UI sliders sit
  const master = resolveMixer(p.mixer, []).master;
  for (const param of ["vol", "rev", "tilt"] as const) {
    const first = p.automation?.find(
      (lane) => lane.target === "master" && lane.param === param,
    )?.points[0];
    if (first) {
      master[param] = first.value;
    }
  }
  return eng.renderOffline(
    seconds,
    sampleRate,
    () => scheduleRange(p, 0, songLengthSteps(p)),
    {
      mixer: p.mixer,
      instrumentIds: p.instruments.map((inst) => inst.id),
      master,
    },
  );
}

export async function bouncePromo(sampleRate = 48000): Promise<PromoBounce> {
  const p = buildPromoDemo();
  const score = promoScore(p);
  // exactly the length of the video: the last two bars are the ring-out
  const buf = await render(p, score.length, sampleRate);
  const bar = Math.round(((16 * 60) / p.bpm / 4) * sampleRate);
  const barPeaks = new Array<number>(Math.ceil(buf.length / bar)).fill(0);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const b = Math.floor(i / bar);
      barPeaks[b] = Math.max(barPeaks[b], Math.abs(data[i]));
    }
  }
  const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-9));
  const bytes = new Uint8Array(await encodeWav(buf).arrayBuffer());
  return {
    wav: base64(bytes),
    score,
    peakDb: db(Math.max(...barPeaks)),
    barPeaksDb: barPeaks.map(db),
  };
}

/* ---- fader calibration ----
 * The Python score set every instrument's level *after* rendering (its bus
 * was normalised to a target dBFS). To give the demo the same balance, each
 * part is rendered on its own — no master lanes, no reverb, unity volume —
 * and measured the way normalize_bus() did: the 99th percentile of the 50 ms
 * RMS of the mono sum. The gains then follow from the targets. */
export interface SoloLevel {
  part: PromoPart;
  gain: number;
  /** 99th-percentile 50 ms RMS, dBFS */
  refDb: number;
  peakDb: number;
}

export async function measurePromoParts(
  sampleRate = 48000,
): Promise<SoloLevel[]> {
  const out: SoloLevel[] = [];
  for (const part of Object.keys(PROMO_ID) as PromoPart[]) {
    const p = buildPromoDemo();
    p.automation = [];
    for (const inst of p.instruments) {
      inst.mute = inst.id !== PROMO_ID[part];
    }
    const steps = songLengthSteps(p);
    const buf = await eng.renderOffline(
      (steps * 60) / p.bpm / 4 + 3,
      sampleRate,
      () => scheduleRange(p, 0, steps),
      {
        mixer: undefined,
        instrumentIds: p.instruments.map((inst) => inst.id),
        master: { vol: 1, rev: 0, tilt: 0 },
      },
    );
    const l = buf.getChannelData(0),
      r = buf.getChannelData(1);
    const win = Math.round(0.05 * sampleRate);
    const rms: number[] = [];
    let peak = 0;
    for (let i = 0; i + win <= l.length; i += win) {
      let acc = 0;
      for (let k = i; k < i + win; k++) {
        const m = (l[k] + r[k]) / 2;
        acc += m * m;
        peak = Math.max(peak, Math.abs(l[k]), Math.abs(r[k]));
      }
      const v = Math.sqrt(acc / win);
      if (v > 1e-5) {
        rms.push(v);
      }
    }
    rms.sort((a, b) => a - b);
    const ref = rms.length
      ? rms[Math.min(rms.length - 1, Math.floor(0.99 * rms.length))]
      : 1e-9;
    const gain = p.instruments.find((i) => i.id === PROMO_ID[part])!.params
      .gain;
    out.push({
      part,
      gain,
      refDb: 20 * Math.log10(ref),
      peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
    });
  }
  return out;
}
