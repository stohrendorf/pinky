import type {
    CurveShape
} from './types';

export interface ManagedVoice<Params = unknown> {
    stopAt: number;
    cost: number;
    dead: boolean;
    loudness: (at: number) => number;
    stop: (at: number) => void;
    glide: (freq: number, at: number, time: number, curve?: CurveShape) => void;
    setParams: (params: Params, at: number, ramp: number) => void;
}

interface LiveVoice<Params> {
    inst: string;
    voice: ManagedVoice<Params>;
    tail: number;
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

export interface VoiceCollectionOptions {
    maxVoices?: () => number;
    maxNodes: () => number;
}

/** Owns voice identity, lifecycle bookkeeping, and polyphony policy. */
export class VoiceCollection<Params = unknown> {
    readonly active = new Map<string, ManagedVoice<Params>>();
    private readonly live: LiveVoice<Params>[] = [];
    private readonly lastOnTrack = new Map<string, LastVoice<Params>>();
    private readonly maxVoices: () => number;
    private readonly maxNodes: () => number;
    private currentLoad = 0;

    constructor(options: VoiceCollectionOptions) {
        this.maxVoices = options.maxVoices ?? (() => 96);
        this.maxNodes = options.maxNodes;
    }

    get load(): number {
        return this.currentLoad;
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


    glide(track: string, fromKey: string, toKey: string, at: number, frequency: number, time: number, curve: CurveShape = 'linear'): boolean {
        const voice = this.active.get(fromKey);
        if (!voice || voice.dead || voice.stopAt <= at + 0.005) {
            return false;
        }
        voice.glide(frequency, at, time, curve);
        this.active.delete(fromKey);
        this.active.set(toKey, voice);
        this.lastOnTrack.set(track, {voice, key: toKey, start: at});
        return true;
    }

    register(track: string, key: string, at: number, voice: ManagedVoice<Params>, tail: number): void {
        this.active.set(key, voice);
        this.lastOnTrack.set(track, {voice, key, start: at});
        this.live.push({inst: track.startsWith('live-') ? track.slice(5) : track, voice, tail});
        this.currentLoad += voice.cost;
    }

    snapshot(): VoiceCollectionSnapshot<Params> {
        return {
            active: new Map(this.active),
            last: new Map(this.lastOnTrack),
            live: this.live.slice()
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
        snapshot.live.forEach(voice => this.live.push(voice));
        this.currentLoad = this.live.reduce((sum, live) => sum + live.voice.cost, 0);
    }
}