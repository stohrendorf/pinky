import type { CurveShape } from "./types";

export interface ManagedVoice<Params = unknown> {
  stopAt: number;
  cost: number;
  dead: boolean;
  loudness: (at: number) => number;
  stop: (at: number) => void;
  glide: (freq: number, at: number, time: number, curve?: CurveShape) => void;
  setParams: (
    params: Params,
    at: number,
    ramp: number,
    curve?: CurveShape,
  ) => void;
}

interface LiveVoice<Params> {
  inst: string;
  voice: ManagedVoice<Params>;
  tail: number;
  overrides?: Partial<Params>;
  transitionUntil?: number;
}

interface LastVoice<Params> {
  voice: ManagedVoice<Params>;
  key: string;
  start: number;
}

export interface VoiceCollectionSnapshot<Params = unknown> {
  active: Map<string, ManagedVoice<Params>>;
  last: Map<string, LastVoice<Params>>;
  live: LiveVoice<Params>[];
}

export interface VoiceCollectionOptions<Params = unknown> {
  maxVoices?: () => number;
  maxNodes: () => number;
  mergeParams?: (base: Params, overrides: Partial<Params>) => Params;
}

/** Owns voice identity, lifecycle bookkeeping, and polyphony policy. */
export class VoiceCollection<Params = unknown> {
  readonly active = new Map<string, ManagedVoice<Params>>();
  private readonly live: LiveVoice<Params>[] = [];
  private readonly lastOnTrack = new Map<string, LastVoice<Params>>();
  private readonly maxVoices: () => number;
  private readonly maxNodes: () => number;
  private readonly mergeParams: (
    base: Params,
    overrides: Partial<Params>,
  ) => Params;
  private currentLoad = 0;

  constructor(options: VoiceCollectionOptions<Params>) {
    this.maxVoices = options.maxVoices ?? (() => 96);
    this.maxNodes = options.maxNodes;
    this.mergeParams =
      options.mergeParams ?? ((base, overrides) => ({ ...base, ...overrides }));
  }

  get load(): number {
    return this.currentLoad;
  }

  set load(value: number) {
    this.currentLoad = value;
  }

  get liveCount(): number {
    return this.live.length;
  }

  get liveVoices(): readonly LiveVoice<Params>[] {
    return this.live;
  }

  prune(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const voice = this.live[i];
      if (voice.voice.stopAt + voice.tail < now) {
        this.live.splice(i, 1);
      }
    }
  }

  /**
   * Applies the node/voice budget and returns the load available to a new
   * voice. Released tails remain part of the cost until their teardown.
   */
  prepare(at: number): number {
    this.prune(at);
    let held = 0;
    let cost = 0;
    for (const live of this.live) {
      cost += live.voice.cost;
      if (live.voice.stopAt > at) {
        held++;
      }
    }

    while (held >= this.maxVoices() || cost > this.maxNodes()) {
      let victim: ManagedVoice<Params> | null = null;
      let quietest = Infinity;
      for (const live of this.live) {
        if (live.voice.stopAt <= at || live.voice.dead) {
          continue;
        }
        const loudness = live.voice.loudness(at);
        if (loudness < quietest) {
          quietest = loudness;
          victim = live.voice;
        }
      }
      if (!victim) {
        break;
      }
      victim.stop(at);
      held--;
      cost -= victim.cost;
    }
    this.currentLoad = cost;
    return cost;
  }

  glide(
    track: string,
    fromKey: string,
    toKey: string,
    at: number,
    frequency: number,
    time: number,
    curve: CurveShape = "linear",
    params?: Params,
    overrides?: Partial<Params>,
  ): boolean {
    const voice = this.active.get(fromKey);
    if (!voice || voice.dead || voice.stopAt <= at + 0.005) {
      return false;
    }
    voice.glide(frequency, at, time, curve);
    const live = this.live.find((entry) => entry.voice === voice);
    if (live) {
      live.overrides = overrides;
      live.transitionUntil = at + time;
    }
    if (params) {
      voice.setParams(params, at, time, curve);
    }
    this.active.delete(fromKey);
    this.active.set(toKey, voice);
    this.lastOnTrack.set(track, { voice, key: toKey, start: at });
    return true;
  }

  replaceActive(key: string, at: number): void {
    this.active.get(key)?.stop(at);
  }

  register(
    track: string,
    key: string,
    at: number,
    voice: ManagedVoice<Params>,
    tail: number,
    overrides?: Partial<Params>,
  ): void {
    this.active.set(key, voice);
    this.lastOnTrack.set(track, { voice, key, start: at });
    this.live.push({
      inst: track.startsWith("live-") ? track.slice(5) : track,
      voice,
      tail,
      overrides,
    });
    this.currentLoad += voice.cost;
  }

  noteOff(key: string, at: number): void {
    const voice = this.active.get(key);
    if (!voice) {
      return;
    }
    voice.stop(at);
    this.active.delete(key);
  }

  automate(inst: string, params: Params, at: number, ramp: number): void {
    this.prune(at);
    for (const live of this.live) {
      if (
        live.inst !== inst ||
        live.voice.stopAt <= at ||
        (live.transitionUntil !== undefined && at < live.transitionUntil)
      ) {
        continue;
      }
      live.voice.setParams(
        live.overrides ? this.mergeParams(params, live.overrides) : params,
        at,
        ramp,
      );
    }
  }

  allNotesOff(at: number): void {
    this.active.forEach((voice) => voice.stop(at));
    this.active.clear();
    this.live.forEach((live) => live.voice.stop(at));
    this.live.length = 0;
    this.lastOnTrack.clear();
    this.currentLoad = 0;
  }

  snapshot(): VoiceCollectionSnapshot<Params> {
    return {
      active: new Map(this.active),
      last: new Map(this.lastOnTrack),
      live: this.live.slice(),
    };
  }

  reset(): void {
    this.active.clear();
    this.lastOnTrack.clear();
    this.live.length = 0;
    this.currentLoad = 0;
  }

  restore(snapshot: VoiceCollectionSnapshot<Params>): void {
    this.reset();
    snapshot.active.forEach((voice, key) => this.active.set(key, voice));
    snapshot.last.forEach((voice, track) => this.lastOnTrack.set(track, voice));
    snapshot.live.forEach((voice) => this.live.push(voice));
    this.currentLoad = this.live.reduce(
      (sum, live) => sum + live.voice.cost,
      0,
    );
  }
}
