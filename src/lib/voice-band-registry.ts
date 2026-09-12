export interface VoiceBand {
  freq: number;
  q: number;
  gain: number;
  post?: boolean;
}

export interface BandSpec {
  target: number;
  from: number;
  q: number;
  gain: number;
  post?: boolean;
}

export interface BandRecord {
  inst: string;
  bands: BandSpec[];
  level: number;
  start: number;
  end: number;
  release: number;
  bendStart: number;
  pitchTime: number;
  att: number;
  dec: number;
  sus: number;
  rel: number;
  visual?: BandVisualState;
}

interface BandVisualState {
  bands: VoiceBand[];
  initialBands: BandSpec[];
  level: number;
  bendStart: number;
  pitchTime: number;
  changes: BandChange[];
}

interface BandChange {
  at: number;
  duration: number;
  curve: CurveShape;
  glide: boolean;
  frequencyChanged: boolean[];
  from: VoiceSnapshot;
  to: VoiceSnapshot;
}

export interface VoiceSnapshot {
  inst: string;
  env: number;
  level: number;
  bands: VoiceBand[];
}

/** Keeps the scheduled bands used by the scope overlay separate from audio state. */
export class VoiceBandRegistry {
  private readonly records: BandRecord[] = [];

  constructor(private readonly capacity = 384) {}

  add(record: BandRecord, now: number): void {
    record.visual = {
      bands: record.bands.map((band) => ({
        freq: band.from,
        q: band.q,
        gain: band.gain,
        post: band.post,
      })),
      initialBands: record.bands.map((band) => ({ ...band })),
      level: record.level,
      bendStart: record.bendStart,
      pitchTime: record.pitchTime,
      changes: [],
    };
    this.records.push(record);
    this.trim(now);
  }

  /** Mirror a future AudioParam change without showing it before it is audible. */
  schedule(
    record: BandRecord,
    bands: readonly BandSpec[],
    level: number,
    at: number,
    duration: number,
    curve: CurveShape = "linear",
    glide = false,
    frequencyChanges?: ReadonlySet<BandSpec>,
  ): void {
    if (!record.visual || !Number.isFinite(at)) {
      return;
    }
    const from = this.visualAt(record, at);
    const to: VoiceSnapshot = {
      inst: record.inst,
      level,
      env: 1,
      bands: bands.map((band) => ({
        freq: band.target,
        q: band.q,
        gain: band.gain,
        post: band.post,
      })),
    };
    const change: BandChange = {
      at,
      duration: Math.max(0, duration),
      curve,
      glide,
      frequencyChanged: bands.map((band, index) =>
        glide
          ? band.target !== from.bands[index]?.freq
          : !!frequencyChanges?.has(band),
      ),
      from,
      to,
    };
    const changes = record.visual.changes;
    const index = changes.findIndex((existing) => existing.at > at);
    if (index === -1) {
      changes.push(change);
    } else {
      changes.splice(index, 0, change);
    }
    // Lookahead scheduling can discover an earlier event after a later one
    // was already added. Rebase every source state so the visual timeline has
    // the same continuity as the AudioParam event timeline.
    for (let i = 0; i < changes.length; i++) {
      changes[i].from = this.visualAt(record, changes[i].at, i);
    }
  }

  snapshot(now: number): VoiceSnapshot[] {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].end < now) {
        this.records.splice(i, 1);
      }
    }
    const out: VoiceSnapshot[] = [];
    for (const record of this.records) {
      if (record.start > now) {
        continue;
      }
      const elapsed = now - record.start;
      let env = adsrLevel(record, elapsed);
      if (now > record.release) {
        env =
          adsrLevel(record, record.release - record.start) *
          Math.exp(-(now - record.release) / Math.max(0.01, record.rel / 3));
      }
      if (env < 0.004) {
        continue;
      }
      const visual = this.visualAt(record, now);
      out.push({
        inst: record.inst,
        env,
        level: visual.level,
        bands: visual.bands,
      });
    }
    return out;
  }

  take(): BandRecord[] {
    return this.records.splice(0, this.records.length);
  }

  restore(records: BandRecord[]): void {
    this.records.length = 0;
    this.records.push(...records);
  }

  private trim(now: number): void {
    if (this.records.length <= this.capacity) {
      return;
    }
    for (
      let i = this.records.length - 1;
      i >= 0 && this.records.length > this.capacity;
      i--
    ) {
      if (this.records[i].end < now) {
        this.records.splice(i, 1);
      }
    }
    while (this.records.length > this.capacity) {
      let worst = 0;
      for (let i = 1; i < this.records.length; i++) {
        // "most nearly finished", held voices (end === Infinity) last
        if (this.records[i].end < this.records[worst].end) {
          worst = i;
        }
      }
      this.records.splice(worst, 1);
    }
  }

  private visualAt(
    record: BandRecord,
    now: number,
    changeCount = record.visual?.changes.length ?? 0,
  ): VoiceSnapshot {
    const visual = record.visual;
    if (!visual) {
      return {
        inst: record.inst,
        env: 1,
        level: record.level,
        bands: record.bands.map((band) => ({
          freq: band.target,
          q: band.q,
          gain: band.gain,
          post: band.post,
        })),
      };
    }
    const bend =
      visual.pitchTime > 0
        ? Math.min(1, Math.max(0, (now - visual.bendStart) / visual.pitchTime))
        : 1;
    let state: VoiceSnapshot = {
      inst: record.inst,
      env: 1,
      level: visual.level,
      bands: visual.bands.map((band, index) => {
        const source = visual.initialBands[index];
        return {
          ...band,
          freq:
            source && source.from !== source.target
              ? source.from * Math.pow(source.target / source.from, bend)
              : band.freq,
        };
      }),
    };
    for (let index = 0; index < changeCount; index++) {
      const change = visual.changes[index];
      if (now < change.at) {
        break;
      }
      if (now >= change.at + change.duration || change.duration === 0) {
        state = mergeSnapshot(state, change.to, change.frequencyChanged);
        continue;
      }
      const progress = curveProgress(
        change.curve,
        (now - change.at) / change.duration,
      );
      state = mergeSnapshot(
        state,
        interpolate(change.from, change.to, progress, change.glide),
        change.frequencyChanged,
      );
      break;
    }
    return state;
  }
}

type CurveShape = "hold" | "linear" | "ease-in" | "ease-out" | "smooth";

function curveProgress(curve: CurveShape, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (curve === "hold") return t < 1 ? 0 : 1;
  if (curve === "ease-in") return t * t;
  if (curve === "ease-out") return 1 - (1 - t) * (1 - t);
  return curve === "smooth" ? t * t * (3 - 2 * t) : t;
}

function interpolate(
  from: VoiceSnapshot,
  to: VoiceSnapshot,
  progress: number,
  exponentialFrequency: boolean,
): VoiceSnapshot {
  return {
    inst: to.inst,
    env: 1,
    level: from.level + (to.level - from.level) * progress,
    bands: to.bands.map((target, index) => {
      const source = from.bands[index] || target;
      return {
        ...target,
        freq:
          exponentialFrequency && source.freq > 0 && target.freq > 0
            ? source.freq * Math.pow(target.freq / source.freq, progress)
            : source.freq + (target.freq - source.freq) * progress,
        q: source.q + (target.q - source.q) * progress,
        gain: source.gain + (target.gain - source.gain) * progress,
      };
    }),
  };
}

function mergeSnapshot(
  state: VoiceSnapshot,
  next: VoiceSnapshot,
  frequencyChanged: readonly boolean[],
): VoiceSnapshot {
  return {
    inst: next.inst,
    env: 1,
    level: next.level,
    bands: next.bands.map((band, index) => ({
      ...band,
      freq: frequencyChanged[index]
        ? band.freq
        : (state.bands[index]?.freq ?? band.freq),
    })),
  };
}

export function adsrLevel(record: BandRecord, elapsed: number): number {
  if (elapsed < record.att) {
    return record.att > 0 ? elapsed / record.att : 1;
  }
  return (
    record.sus +
    (1 - record.sus) *
      Math.exp(-(elapsed - record.att) / Math.max(0.01, record.dec / 3))
  );
}
