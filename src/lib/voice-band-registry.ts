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
    this.records.push(record);
    this.trim(now);
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
      const bend =
        record.pitchTime > 0
          ? Math.min(
              1,
              Math.max(0, (now - record.bendStart) / record.pitchTime),
            )
          : 1;
      out.push({
        inst: record.inst,
        env,
        level: record.level,
        bands: record.bands.map((band) => ({
          q: band.q,
          gain: band.gain,
          post: band.post,
          freq:
            band.from === band.target
              ? band.target
              : band.from * Math.pow(band.target / band.from, bend),
        })),
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
