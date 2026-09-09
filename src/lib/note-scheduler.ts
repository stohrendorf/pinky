import type { CurveShape } from './types';
import type { ManagedVoice } from './voice-collection';

export interface NoteSchedulingParams {
    rel: number;
}

export interface NoteSchedulingCollection<Params> {
    load: number;

    glide(
        track: string,
        fromKey: string,
        toKey: string,
        at: number,
        frequency: number,
        time: number,
        curve?: CurveShape,
    ): boolean;

    replaceActive(key: string, at: number): void;

    prepare(at: number): number;

    register(
        track: string,
        key: string,
        at: number,
        voice: ManagedVoice<Params>,
        tail: number,
    ): void;

    noteOff(key: string, at: number): void;

    automate(inst: string, params: Params, at: number, ramp: number): void;

    allNotesOff(at: number): void;
}

export interface NoteSchedulerOptions<Params extends NoteSchedulingParams> {
    findNote: (name: string) => { freq: number } | undefined;
    currentTime: () => number | null;
    voices: NoteSchedulingCollection<Params>;
    createVoice: (
        track: string,
        frequency: number,
        at: number,
        params: Params,
        velocity: number,
    ) => ManagedVoice<Params>;
    releaseTail: number;
}

/** Coordinates note commands without knowing how notes or voices are implemented. */
export class NoteScheduler<Params extends NoteSchedulingParams> {
    private readonly findNote: NoteSchedulerOptions<Params>['findNote'];
    private readonly currentTime: NoteSchedulerOptions<Params>['currentTime'];
    private readonly voices: NoteSchedulingCollection<Params>;
    private readonly createVoice: NoteSchedulerOptions<Params>['createVoice'];
    private readonly releaseTail: number;

    constructor(options: NoteSchedulerOptions<Params>) {
        this.findNote = options.findNote;
        this.currentTime = options.currentTime;
        this.voices = options.voices;
        this.createVoice = options.createVoice;
        this.releaseTail = options.releaseTail;
    }

    noteOnAt(track: string, name: string, atTime: number, params: Params, velocity = 1): void {
        const note = this.findNote(name);
        const now = this.currentTime();
        if (!note || now === null) {
            return;
        }

        const key = track + ':' + name;
        const at = Math.max(atTime, now);
        this.voices.replaceActive(key, at);
        const cost = this.voices.prepare(at);
        this.voices.load = cost;
        const voice = this.createVoice(track, note.freq, at, params, velocity);
        this.voices.load = cost + voice.cost;
        this.voices.register(track, key, at, voice, params.rel * this.releaseTail + 0.1);
    }

    noteOn(track: string, name: string, params: Params): void {
        this.noteOnAt(track, name, 0, params);
    }

    noteOffAt(track: string, name: string, atTime: number): void {
        const now = this.currentTime();
        if (now === null) {
            return;
        }
        const key = track + ':' + name;
        this.voices.noteOff(key, Math.max(atTime, now));
    }

    noteOff(track: string, name: string, when = 0): void {
        this.noteOffAt(track, name, (this.currentTime() ?? 0) + when);
    }

    glideAt(
        track: string,
        from: string,
        to: string,
        atTime: number,
        time: number,
        curve: CurveShape = 'linear',
    ): boolean {
        const note = this.findNote(to);
        const now = this.currentTime();
        if (!note || now === null) {
            return false;
        }
        const at = Math.max(atTime, now);
        return this.voices.glide(
            track,
            track + ':' + from,
            track + ':' + to,
            at,
            note.freq,
            time,
            curve,
        );
    }

    allNotesOff(): void {
        const now = this.currentTime();
        if (now !== null) {
            this.voices.allNotesOff(now);
        }
    }

    automateInstrument(inst: string, params: Params, at: number, ramp: number): void {
        if (this.currentTime() !== null) {
            this.voices.automate(inst, params, at, ramp);
        }
    }
}
