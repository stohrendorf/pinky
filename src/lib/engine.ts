import type {
    CurveShape, InstrumentParams
} from './types';

import {
    segmentProgress
} from './automation';
import clockWorkletUrl from './clock-worklet.js?url';
import {
    MasterControls, type MasterValues
} from './master-controls';
import {
    type MixerMaster, type MixerState, resolveMixer
} from './mixer';
import {
    type ChannelMeter, limiterLatencyFrames, loadLimiter, type MasterMeter, MasterLimiter, MixerAudio
} from './mixer-audio';
import {
    NodePool
} from './node-pool';
import {
    NoteScheduler
} from './note-scheduler';
/* Audio engine — framework-free Web Audio module.
 * A voice = dry pink noise + phase-inverted EQ'd copy. Perfect cancellation
 * everywhere except the bands the peaking filters boost: those survive.
 * Percussion uses the same trick: one wide (low-Q) band = noise burst,
 * a frequency sweep on the bands = kick/tom pitch drop. */
import {
    noteByName
} from './notes';
import {
    adsrLevel, type BandRecord, type BandSpec, VoiceBandRegistry, type VoiceSnapshot
} from './voice-band-registry';
import {
    type ManagedVoice, VoiceCollection
} from './voice-collection';

export type {VoiceBand, VoiceSnapshot} from './voice-band-registry';

export const master = {vol: 0.8, rev: 0.18, tilt: 0};

// The context the graph currently feeds: the live AudioContext, or — while
// bouncing to WAV — an OfflineAudioContext (see `renderOffline`).
let ctx: BaseAudioContext | null = null;
let liveCtx: AudioContext | null = null;

interface EngineObjects {
    noise?: AudioBufferSourceNode;
    noiseBus?: GainNode;
    noiseInv?: GainNode;
    voiceBus?: GainNode;
    tiltLow?: BiquadFilterNode;
    tiltHigh?: BiquadFilterNode;
    comp?: DynamicsCompressorNode;
    master?: GainNode;
    reverb?: ConvolverNode;
    revSend?: GainNode;
    analyser?: AnalyserNode;
    flushBus?: GainNode;
    // Vibrato LFOs, one per distinct rate (see `vibLfo`)
    lfos?: Map<number, GainNode>;
    clock?: AudioWorkletNode;
    onTick?: (time: number) => void;
    mixer?: MixerAudio;
    limiter?: MasterLimiter;
    legacy?: boolean;
    mixerMaster?: MixerMaster;
    mixerSignature?: string;
}

let engine: EngineObjects = {};
let liveGraph: EngineObjects | null = null;
export const SCOPE_FFT_SIZE = 8192;

function controlsFor(graph: EngineObjects, values: MasterValues): MasterControls {
    return new MasterControls({
        values,
        targets: () => graph.master && graph.revSend && graph.tiltLow && graph.tiltHigh ? {
            volume: graph.master.gain,
            reverb: graph.revSend.gain,
            tiltLow: graph.tiltLow.gain,
            tiltHigh: graph.tiltHigh.gain
        } : null,
        currentTime: () => graph.master?.context.currentTime ?? 0,
        rampTo: (param, value, at, duration) => rampTo(param, value, at, duration, graph === liveGraph)
    });
}

let masterControls = controlsFor(engine, master);
let liveMasterControls = masterControls;

export interface OfflineMixerConfig {
    mixer: MixerState | undefined;
    instrumentIds: string[];
    master?: MasterValues;
}

let mixerConfig: OfflineMixerConfig = {mixer: undefined, instrumentIds: []};
let rendering = false;
let schedulingOffline = false;
export const isRendering = (): boolean => rendering;

function copyMixer(mixer: MixerState | undefined, ids: string[]): MixerState | undefined {
    if (!mixer) {return undefined;}
    const resolved = resolveMixer(mixer, ids);
    const channel = <T extends MixerState['channels'][string]>(value: T): T => ({
        ...value, compressor: {...value.compressor}, sends: value.sends.map(send => ({...send}))
    });
    return {
        channels: Object.fromEntries(Object.entries(resolved.channels).map(([id, value]) => [id, channel(value)])),
        buses: resolved.buses.map(channel), master: {...resolved.master}
    };
}

export function configureMixer(mixer: MixerState | undefined, instrumentIds: string[]): void {
    const snapshot = copyMixer(mixer, instrumentIds);
    if (offline && schedulingOffline) {
        configureGraphMixer(engine, snapshot, masterControls);
        return;
    }
    mixerConfig = {mixer: snapshot, instrumentIds: [...instrumentIds]};
    const values = snapshot?.master ?? resolveMixer(undefined, []).master;
    for (const id of ['vol', 'rev', 'tilt'] as const) {
        if (master[id] !== values[id]) {liveMasterControls.apply(id, values[id]);}
    }
    if (liveGraph) {configureGraphMixer(liveGraph, snapshot, liveMasterControls);}
}

export function mixerMeters(): {master: MasterMeter; channels: Record<string, ChannelMeter>} {
    return {
        master: liveGraph?.limiter?.meters() ?? {peak: [0, 0], rms: [0, 0], reduction: 0},
        channels: liveGraph?.mixer?.meters() ?? {}
    };
}

/** Algorithmic limiter latency, in seconds, including bypass. Hardware latency
 * is intentionally separate; the returned value is also trimmed from exports. */
export function outputLatency(): number {
    const rate = liveCtx?.sampleRate ?? ctx?.sampleRate ?? 44100;
    return limiterLatencyFrames(rate) / rate;
}

type Voice = ManagedVoice<InstrumentParams>;

/* ---- the node budget: one number, and it is a *machine* property ----
 * Firefox walks the whole graph on every 128-sample quantum, so a node is a
 * node — a biquad and the gain around it cost the same bookkeeping — and how
 * many of them fit into a 2.7 ms render quantum depends on the CPU, the
 * browser and what else the tab is doing. Measured in Firefox on the machine
 * this was tuned on: 200-300 running nodes are comfortable, ~400 is the edge
 * and 600+ (the Toccata finale) starves the audio thread audibly. So the budget
 * is a slider (toolbar: `Nodes`) rather than a constant, and it is remembered
 * per browser — it says something about the machine, not about the song.
 *
 * Everything the governor does is derived from it:
 *   > 60%  new voices get fewer unison ranks      (`makeVoice`)
 *   > 85%  new voices shed their weakest partials (`makeRank`)
 *   > 100% the *quietest* still-held voice is stolen (`noteOnAt`)
 * ... so raising it trades crackle for timbre and lowering it the other way
 * around. Thinning is deliberately ordered: a missing detuned rank is a bit
 * less shimmer, a missing partial changes the *timbre* (a drawbar organ
 * registration *is* its partial set), so that stays the last resort. */
const BUDGET_KEY = 'pinky.nodeBudget';
export const BUDGET_MIN = 120, BUDGET_MAX = 1200, BUDGET_DEFAULT = 480;
let nodeBudget = BUDGET_DEFAULT;
try {
    const stored = Number(localStorage.getItem(BUDGET_KEY));
    if (stored >= BUDGET_MIN && stored <= BUDGET_MAX) {nodeBudget = stored;}
} catch (e) { /* no storage — keep the default */
}

export const getNodeBudget = (): number => nodeBudget;

export function setNodeBudget(n: number): void {
    nodeBudget = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.round(n)));
    try {
        localStorage.setItem(BUDGET_KEY, String(nodeBudget));
    } catch (e) { /* no storage — the setting just won't survive a reload */
    }
}

const partialShedNodes = (): number => nodeBudget * 0.85;
const softLiveNodes = (): number => nodeBudget * 0.6;
const MIN_BAND_DB = 0.5;    // a partial boosted less than this is inaudible
// Formant boost span in dB at level 1. These bands sit *after* the dry-noise
// cancellation (see makeRank), so they shape a signal instead of creating one —
// 22 dB on F1 is already a very pronounced vowel. Vocal formants are kept
// deliberately broad: a singer's tract colours several neighbouring partials,
// whereas a narrow resonance leaves the isolated flute/string bands exposed.
const FORMANT_DB = 22;
// Release tails: `setTargetAtTime(0, rel/3)` is 40 dB down after 1.5 x rel, so
// holding the nodes for 2 x rel (as before) just kept inaudible voices — and
// their filters — running a third longer than necessary.
const TAIL = 1.5;
let offline = false;        // true while bouncing into an OfflineAudioContext

const voiceCollection = new VoiceCollection<InstrumentParams>({
    maxNodes: () => nodeBudget,
    isOffline: () => offline
});

// Kept as a compatibility export for code that needs to inspect or clear
// scheduled note-ons. Ownership now lives in the instance above.
export const activeVoices = voiceCollection.active;

/* ---- batched node teardown ----
 * A voice is a couple of dozen nodes; disconnecting each one from its own
 * `setTimeout` means hundreds of timers *and* hundreds of audio-graph
 * mutations per second in dense sections — every one of them takes the graph
 * lock on the audio thread, which is exactly what makes playback stutter.
 * One sweeper timer collects them instead. */
interface Teardown {
    due: number;
    gen: number;
    size: number;
    cur: () => number;
    kill: () => void;
}

const teardowns: Teardown[] = [];
let sweeper: ReturnType<typeof setInterval> | null = null;
const SWEEP_MS = 80;        // often, so the queue never piles up ...
// ... and in small bites (see below). A `disconnect()` is cheap in itself; what
// matters is not doing a whole bar of them in one quantum. Since a swept voice
// also *returns its nodes to the pool*, a backlog now means the next notes have
// to allocate again — so the bite is bigger than it was.
const SWEEP_BUDGET = 96;

/* Every `disconnect()` is a graph mutation the render thread has to apply
 * under its lock at the start of a quantum. Dropping a whole bar's worth of
 * finished voices at once (easily several hundred edges) is a burst big enough
 * to blow the render deadline all by itself, so the sweeper spends a fixed
 * budget of edges per pass and lets the rest wait for the next one. */
function sweepTeardowns(now: number): void {
    // ... unless a backlog builds up (very dense unison sections): then spend
    // more per pass, a growing zombie graph would be worse than the burst.
    let budget = SWEEP_BUDGET * Math.min(8, 1 + Math.floor(teardowns.length / 50));
    /* Oldest first. Sweeping newest-first (as this did) starves the head of the
     * queue as soon as new teardowns arrive as fast as the budget retires them:
     * those voices are never disconnected, so their filters keep running for
     * the rest of the session. That is the "it only stutters the *second* time
     * I play the song" effect — the graph never went back to idle. */
    let i = 0;
    while (i < teardowns.length) {
        const t = teardowns[i];
        if (t.gen !== t.cur()) {
            teardowns.splice(i, 1);
            continue;
        } // glided onward — still alive
        if (t.due > now) {
            i++;
            continue;
        }
        if (budget <= 0) {break;}
        budget -= t.size;
        teardowns.splice(i, 1);
        t.kill();
    }
}

function scheduleTeardown(t: Teardown): void {
    if (offline) {return;} // the offline graph dies together with its context
    teardowns.push(t);
    startHousekeeping();
}

/* ---- param flattening: the real cost of an automated filter ----
 * A terminating ramp was only half the story. Firefox (and friends) take the
 * cheap "compute the coefficients once per 128-sample block" path only while a
 * biquad's params have *no events at all* — and a completed event is not
 * necessarily dropped from the timeline. So a single pitch bend, glide or
 * automation ramp can leave that filter recomputing its coefficients (with
 * sin/cos/pow!) for *every sample* for the rest of its life. With a dozen
 * partials per voice that is exactly the audible starvation in dense sections.
 *
 * The cure: once a scheduled ramp has finished, wipe the param's timeline and
 * write the final value as a plain constant, which puts the filter back on the
 * fast path. `tok` guards against a later schedule being clobbered by an older
 * pending flatten. */
interface Flatten {
    at: number;
    prm: AudioParam;
    v: number;
    tok: number;
}

const flattens: Flatten[] = [];
const paramTok = new WeakMap<AudioParam, number>();
let tokSeq = 0;

function flattenLater(prm: AudioParam, v: number, at: number, forceLive = false): void {
    if (offline && !forceLive) {return;} // the offline graph is thrown away after the bounce
    const tok = ++tokSeq;
    paramTok.set(prm, tok);
    flattens.push({prm, v, at: at + 0.03, tok});
    startHousekeeping();
}

function sweepFlattens(now: number): void {
    for (let i = flattens.length - 1; i >= 0; i--) {
        const f = flattens[i];
        if (paramTok.get(f.prm) !== f.tok) {
            flattens.splice(i, 1);
            continue;
        } // superseded
        if (f.at > now) {continue;}
        flattens.splice(i, 1);
        try {
            f.prm.cancelScheduledValues(0);
            f.prm.value = f.v;
        } catch (e) { /* node already gone */
        }
    }
}

function startHousekeeping(): void {
    if (sweeper === null) {sweeper = setInterval(housekeeping, SWEEP_MS);}
}

function housekeeping(): void {
    if (offline) {return;} // never recycle live nodes against the offline graph
    const now = liveCtx ? liveCtx.currentTime : 0;
    sweepFlattens(now);
    sweepTeardowns(now);
    sweepCooling(now);
    if (!teardowns.length && !flattens.length && !nodePool.coolingCount && sweeper !== null) {
        clearInterval(sweeper);
        sweeper = null;
    }
}

/* ---- node pool: the count that matters is nodes *ever created* ----
 * `disconnect()` takes a node out of the signal flow, but it does *not* remove
 * it from the browser's audio graph: the underlying stream lives until the JS
 * wrapper is cycle-collected, and until then the render thread keeps visiting
 * it on every 128-sample quantum. That is why the stutter
 *   - grows with every repeated playback (each play throws away ~700 nodes),
 *   - persists in a *sparse* section where the counted, connected node count is
 *     a handful (the counted number is the live graph, the corpses are not in
 *     it), and
 *   - suddenly disappears after a short audio hiccup — that hiccup is the GC /
 *     cycle collector finally reclaiming the corpses.
 * So a finished voice hands its nodes back here and the next note plays on
 * them: after the first playback of a section the engine allocates nothing,
 * and the graph has a fixed, bounded number of nodes in it forever. */
/* ---- why a recycled biquad has to cool down first ----
 * A gain or a panner is arithmetic on the current sample and nothing else:
 * hand it to the next note and it behaves like a brand new one. A biquad does
 * not. It carries two samples of internal state, and *nothing* in the Web
 * Audio API clears it — not `disconnect()`, not a type change, not
 * `cancelScheduledValues`. Our filters sit before the amp envelope, fed by the
 * always-on noise bus, so when a voice is torn down that state is frozen
 * mid-noise at full level — boosted by up to +40 dB.
 *
 * Give that node to the next note and it releases the stored energy through
 * its new coefficients: a burst at the *previous* instrument's resonance. And
 * because a voice is "dry noise minus the filtered copy", the leftover also
 * punches a hole in that cancellation, so raw noise leaks for as long as it
 * rings. That is the "a drum hit suddenly sounds like some other instrument"
 * artifact, and it is worst exactly where the state decays slowest: low,
 * resonant bands (the bass).
 *
 * A frozen state never decays on its own — a disconnected node is not
 * processed at all, so merely parking it achieves nothing. It has to be *run*
 * empty: flattened to a unity-gain, non-resonant setting, no input, its output
 * into a silent sink. Its memory then falls to zero within a millisecond or
 * two, and only then is the node as good as new. */
const nodePool = new NodePool({reset: claimParam});

// Pool only for the live context — the offline render's graph is thrown away
// together with its context, so recycling across the two would hand out nodes
// that belong to a dead graph.
function pooling(): boolean {
    if (offline || !ctx || !engine.flushBus) {return false;}
    nodePool.attach(ctx, engine.flushBus, () => liveCtx ? liveCtx.currentTime : 0);
    return true;
}

/* A reused param must start its new life empty: a leftover event (or a pending
 * `flattenLater` from the previous note) would otherwise fire into the new
 * voice. Bumping the token invalidates every flatten queued for this param. */
function claimParam(prm: AudioParam, v: number): void {
    paramTok.set(prm, ++tokSeq);
    try {
        prm.cancelScheduledValues(0);
    } catch (e) { /* nothing scheduled */
    }
    prm.value = v;
}

function takeGain(gain: number): GainNode {
    const context = ctx as BaseAudioContext;
    return pooling() ? nodePool.takeGain(gain, context) : new GainNode(context, {gain});
}

function takeBiquad(frequency: number, q: number, gain: number): BiquadFilterNode {
    const context = ctx as BaseAudioContext;
    return pooling()
        ? nodePool.takeBiquad(frequency, q, gain, context)
        : new BiquadFilterNode(context, {type: 'peaking', frequency, Q: q, gain});
}

function takePanner(pan: number): StereoPannerNode {
    const context = ctx as BaseAudioContext;
    return pooling() ? nodePool.takePanner(pan, context) : new StereoPannerNode(context, {pan});
}

// Hand a fully disconnected node back. Nodes from a foreign (offline) context
// are dropped on the floor rather than poisoning the live pool.
function giveNode(n: AudioNode): void {
    if (!pooling()) {return;}
    nodePool.give(n);
    startHousekeeping();
}

// Drained filters graduate into the pool. They are queued in time order, so
// the head is always the one that has been cooling the longest.
function sweepCooling(now: number): void {
    nodePool.sweep(now);
}

const pooledNodes = (): number => nodePool.size;

/* ---- vibrato LFOs ----
 * A vibrato is one sine per *rate*, shared by every voice that asks for it:
 * an oscillator per note would be a node (and a corpse) per note, and
 * oscillators cannot be pooled at all — `start()` may only be called once.
 * The shared sine outputs ±1 and the per-band gain that follows it turns that
 * into "±n Hz around this band", so one node serves the whole song. It is
 * never torn down (a handful of nodes, and a free-running LFO keeps every
 * voice's vibrato in phase with every other's, which is what an ensemble
 * does). Sources feeding an AudioParam are processed without a path to the
 * destination, so it needs no sink. */
function vibLfo(rate: number): GainNode | null {
    if (!ctx || !engine.lfos) {return null;}
    const r = Math.max(0.1, Math.round((rate || 5.5) * 10) / 10);
    let out = engine.lfos.get(r);
    if (!out) {
        const osc = new OscillatorNode(ctx, {type: 'sine', frequency: r});
        out = new GainNode(ctx, {gain: 1});
        osc.connect(out);
        osc.start();
        engine.lfos.set(r, out);
    }
    return out;
}

// Every edge under its own guard: a `disconnect(target)` that throws (the edge
// was already gone) must not skip the ones after it — that would leave a voice
// attached to the shared noise buses forever.
function cut(f: () => void): void {
    try {
        f();
    } catch (e) { /* already gone */
    }
}

/* How much of the graph is running right now, in nodes — the number the load
 * governor works with (see the node budget above), reported together with the
 * budget it is being measured against so a readout can show both. */
export function engineLoad(): { nodes: number; voices: number; budget: number; pooled: number } {
    if (offline) {return {nodes: 0, voices: 0, budget: nodeBudget, pooled: pooledNodes()};}
    const now = liveCtx ? liveCtx.currentTime : 0;
    voiceCollection.prune(now);
    let nodes = 0;
    for (const lv of voiceCollection.liveVoices) {nodes += lv.voice.cost;}
    // `pooled` = nodes parked for reuse. Once it stops growing the engine has
    // stopped allocating, i.e. it can no longer leave corpses in the graph.
    return {nodes, voices: voiceCollection.liveCount, budget: nodeBudget, pooled: pooledNodes()};
}

export const audioTime = (): number => (offline && !schedulingOffline ? liveCtx : ctx)?.currentTime ?? 0;
export const getAnalyser = (): AnalyserNode | null => liveGraph?.analyser ?? null;
export const audioSampleRate = (): number => ctx ? ctx.sampleRate : 44100;

/* What the master section is doing *right now* (automation moves the audio
 * params without touching the slider values) — the scope overlay needs it to
 * predict the spectrum that actually reaches the analyser. */
export const masterState = (): { vol: number; tilt: number } => liveMasterControls.state();

/* The scope overlay keeps its own time-windowed view of voices. */
const bandRegistry = new VoiceBandRegistry();

export function activeVoiceBands(): VoiceSnapshot[] {
    const c = ctx;
    if (!c) {return [];}
    return bandRegistry.snapshot(c.currentTime);
}

function pinkNoiseBuffer(seconds: number): AudioBuffer {
    if (!ctx) {throw new Error('Audio context not initialized');}
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.0168980;
            d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
        }
    }
    return buf;
}

function reverbImpulse(seconds: number, decay: number): AudioBuffer {
    if (!ctx) {throw new Error('Audio context not initialized');}
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);}
    }
    return buf;
}

/* The whole signal graph, built into `o` on the context `c` — shared by the
 * live context and the offline render (which needs its own copy of it). */
async function buildGraph(c: BaseAudioContext, o: EngineObjects, config: OfflineMixerConfig,
    values: MasterValues): Promise<void> {
    await loadLimiter(c);
    // Endless pink noise loop feeding every voice
    o.noise = new AudioBufferSourceNode(c, {
        buffer: pinkNoiseBuffer(4),
        loop: true
    });
    o.noiseBus = new GainNode(c);
    o.noise.connect(o.noiseBus);
    o.noise.start();
    /* One *shared* phase-inverted copy of the noise. A voice is "dry minus
     * filtered", which used to cost two gain nodes per voice (a dry copy and a
     * -1 inverter). Feeding the inverted bus straight into the voice's envelope
     * and adding the filtered chain on top gives (H-1)·noise instead of
     * (1-H)·noise — the same magnitude spectrum with the whole mix flipped in
     * polarity, i.e. inaudible — for zero per-voice nodes. Firefox walks every
     * node of the graph on every render quantum, so the node count is the
     * engine's real currency. */
    o.noiseInv = new GainNode(c, {
        gain: -1
    });
    o.noiseBus.connect(o.noiseInv);

    // Voice sum -> tilt EQ -> compressor -> master (+ reverb send)
    o.voiceBus = new GainNode(c);
    o.tiltLow = new BiquadFilterNode(c, {
        type: 'lowshelf',
        frequency: 500,
        gain: -values.tilt
    });
    o.tiltHigh = new BiquadFilterNode(c, {
        type: 'highshelf',
        frequency: 2000,
        gain: values.tilt
    });
    // A safety net against the odd stacked chord, not a mix compressor: only
    // what would clip gets touched. `threshold` is dBFS and the spec caps it at
    // 0 — it used to say 18, which every browser silently clamped to 0 while
    // logging a warning, so this is the same sound without the warning.
    o.comp = new DynamicsCompressorNode(c, {
        threshold: 0,
        ratio: 4
    });
    o.master = new GainNode(c, {
        gain: values.vol
    });
    o.reverb = new ConvolverNode(c, {
        buffer: reverbImpulse(2.2, 3)
    });
    o.revSend = new GainNode(c, {
        gain: values.rev
    });

    o.voiceBus.connect(o.tiltLow);
    o.tiltLow.connect(o.tiltHigh);
    const settings = config.mixer?.master ?? {...resolveMixer(undefined, []).master, ...values};
    o.limiter = new MasterLimiter(c, settings, !offline);
    o.master.connect(o.limiter.node);
    o.limiter.node.connect(c.destination);
    o.mixer = new MixerAudio(c, o.voiceBus, o.reverb, !offline);
    configureGraphMixer(o, config.mixer, masterControls, true);

    /* Silent sink for filters that are cooling down before they go back into
     * the pool (see `NodePool`). A node is only *processed* while it has a
     * path to the destination, so draining one needs somewhere to drain to;
     * at gain 0 nothing of it reaches the mix. */
    o.flushBus = new GainNode(c, {
        gain: 0
    });
    o.flushBus.connect(c.destination);

    o.lfos = new Map();
}

function configureGraphMixer(o: EngineObjects, mixer: MixerState | undefined, controls: MasterControls, initial = false): void {
    if (!o.master || !o.tiltHigh || !o.comp || !o.revSend || !o.reverb || !o.voiceBus) {return;}
    const signature = JSON.stringify(mixer ?? null);
    if (o.mixerSignature === signature) {return;}
    o.mixerSignature = signature;
    const legacy = !mixer;
    if (legacy !== o.legacy) {
        o.tiltHigh.disconnect();
        o.comp.disconnect();
        o.revSend.disconnect();
        o.reverb.disconnect();
        if (legacy) {
            // Preserve the exact old compressor/reverb order for legacy songs.
            o.tiltHigh.connect(o.comp);
            o.tiltHigh.connect(o.revSend);
            o.revSend.connect(o.reverb);
            o.reverb.connect(o.comp);
            o.comp.connect(o.master);
        } else {
            o.tiltHigh.connect(o.master);
            o.reverb.connect(o.revSend);
            o.revSend.connect(o.voiceBus);
        }
        o.legacy = legacy;
    }
    o.mixer?.configure(mixer);
    const settings = mixer?.master ?? {...resolveMixer(undefined, []).master, ...master};
    o.limiter?.configure(settings);
    if (mixer && !initial) {
        for (const id of ['vol', 'rev', 'tilt'] as const) {
            if (o.mixerMaster?.[id] !== settings[id]) {controls.apply(id, settings[id]);}
        }
    }
    o.mixerMaster = {...settings};
}

async function initAudio(): Promise<void> {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) {throw new Error('AudioContext is not supported');}
    liveCtx = new AudioContextCtor();
    ctx = liveCtx;
    if (!ctx) {throw new Error('Failed to create AudioContext');}

    liveGraph = engine;
    await buildGraph(ctx, engine, mixerConfig, master);
    // Configuration may have changed while the worklet module was loading.
    configureGraphMixer(engine, mixerConfig.mixer, liveMasterControls);

    engine.analyser = new AnalyserNode(ctx, {
        fftSize: SCOPE_FFT_SIZE,
        smoothingTimeConstant: 0
    });
    engine.limiter!.node.connect(engine.analyser);

    // Sample-accurate clock (AudioWorklet) — replaces setTimeout sequencing
    await ctx.audioWorklet.addModule(clockWorkletUrl);
    engine.clock = new AudioWorkletNode(ctx, 'eq-daw-clock');
    engine.clock.connect(engine.master!); // keep the node alive (it outputs silence)
    engine.clock.port.onmessage = ({data}) => {
        if (!rendering && data.type === 'tick' && liveGraph?.onTick) {liveGraph.onTick(data.time);}
    };
}

/* ---- clock API ---- */
export function setTickHandler(fn: (time: number) => void): void {
    (liveGraph ?? engine).onTick = fn;
}

// The clock is a plain wake-up pulse now — the transport decides which steps
// fall into its scheduling window (see lib/transport.ts).
export function clockStart(): void {
    liveGraph?.clock?.port.postMessage({type: 'start'});
}

export function clockStop(): void {
    liveGraph?.clock?.port.postMessage({type: 'stop'});
}

/* ---- voices ---- */

/* Parameter changes on a *sounding* voice.
 *
 * `setTargetAtTime` is off limits here: it is an exponential approach with no
 * end time, so the parameter keeps a pending automation event forever — and a
 * BiquadFilterNode whose gain/Q/frequency has a pending event has to recompute
 * its coefficients for *every single sample* (transcendentals included) for the
 * rest of the node's life. Multiply that by a dozen partials, several unison
 * ranks and a chord and the render thread misses its deadline: the crackle.
 * A linear ramp does the same job audibly and then drains from the event list,
 * letting the filter fall back to cheap constant coefficients. */
function rampTo(prm: AudioParam, v: number, at: number, t: number, forceLive = false): void {
    prm.cancelScheduledValues(at);
    prm.setValueAtTime(prm.value, at);
    prm.linearRampToValueAtTime(v, at + t);
    flattenLater(prm, v, at + t, forceLive); // ... and drop the timeline once it lands
}

const differs = (a: number, b: number, eps: number): boolean => Math.abs(a - b) > eps;

function sweep(param: AudioParam, target: number, when: number, p: InstrumentParams): void {
    // Bipolar pitch-bend envelope: start `pitchDrop` semitones away from the
    // note and glide to it. Positive = start above (drop), negative = start
    // below (rise) — slidable like the noise tilt.
    if (p.pitchDrop !== 0) {
        param.setValueAtTime(target * Math.pow(2, p.pitchDrop / 12), when);
        param.exponentialRampToValueAtTime(target, when + p.pitchTime);
        flattenLater(param, target, when + p.pitchTime); // back to constant coefficients
    } else {
        // Plain assignment on purpose: a scheduled event (even a constant one)
        // makes the browser recompute this biquad's coefficients per sample
        // for the rest of its life. With dozens of partials per note that is
        // the single most expensive thing in the whole engine.
        param.value = target;
    }
}

/* One rank = one full serial filter chain. Unison spawns several of them,
 * detuned and spread across the stereo field (see `makeVoice`). */
function makeRank(track: string, freq: number, when: number, p: InstrumentParams, vel: number,
    panOffset: number): Voice {
    if (!ctx || !engine.noiseBus || !engine.noiseInv || !engine.voiceBus) {throw new Error('Audio not initialized');}
    const voiceContext = ctx;
    const voiceOutput = engine.mixer?.voiceInput(track) ?? engine.voiceBus;
    const voiceNoiseBus = engine.noiseBus;
    const voiceNoiseInv = engine.noiseInv;
    /* Node budget per rank: `sum` (mixes the inverted dry copy with the filter
     * chain and carries the voice level) + `env` (ADSR) + the biquads. The old
     * layout also had a per-voice dry copy and a -1 inverter — both are now the
     * one shared `noiseInv` bus — and an unconditional panner, which is only
     * built for voices that are actually off centre. In a dense bar that is
     * three fewer nodes per rank out of ~13, and Firefox pays for every node on
     * every 128-sample quantum. */

    // Velocity scales the hit — that's what makes ghost notes and accents groove
    const velScale = Math.max(0, Math.min(1, vel));
    // Recycled where possible (see the node pool) — a fresh node per note means
    // a corpse per note in the browser's graph until the GC gets to it.
    const sum = takeGain(0.9 * p.gain * velScale);

    const env = takeGain(0);
    // Stereo placement + a whisper of drift per hit — keeps the mix wide and alive
    const panWanted = p.pan + panOffset;
    let pan: StereoPannerNode | null = null;

    function insertPan(v: number): void {
        if (pan) {return;}
        const value = Math.max(-1, Math.min(1, v));
        pan = ctx === voiceContext ? takePanner(value) : new StereoPannerNode(voiceContext, {pan: value});
        env.disconnect();
        env.connect(pan);
        pan.connect(voiceOutput);
    }

    // Serial chain of peaking boosts: fundamental + upper harmonics ...
    const filters: BiquadFilterNode[] = [];
    // pitched bands (glidable): r = partial ratio, level = its share of Tone Level
    const harmBands: { bq: BiquadFilterNode; r: number; level: number }[] = [];
    const bands: BandSpec[] = []; // mirrored specs for the scope overlay
    const bendRatio = Math.pow(2, p.pitchDrop / 12); // where a swept band starts, relative to its target
    // Inharmonicity: partial h sits at h^(1+stretch) × fundamental — 0 = pure
    // harmonic series, >0 spreads the overtones apart (bells, metal), <0 squashes.
    const partialRatio = (h: number): number => Math.pow(h, 1 + p.stretch);
    // The partial set: either hand-edited (harmonics editor: arbitrary ratios
    // and levels — drawbars, odd-only, bell partials) or the generated series.
    const custom = p.partials && p.partials.length ? p.partials : null;
    const partials: { r: number; level: number; q: number }[] = custom
        ? custom.filter(x => x.level > 0 && x.ratio > 0)
            .map(x => ({r: x.ratio, level: x.level, q: p.q * Math.sqrt(x.ratio)}))
        : Array.from({length: Math.max(0, Math.round(p.harm))}, (_, i) => ({
            r: partialRatio(i + 1),
            level: Math.pow(p.falloff, i),
            q: p.q * Math.sqrt(i + 1) // keep bandwidth musical up the series
        }));
    let node: AudioNode = engine.noiseBus;
    // The first band actually fed by the noise bus (the formants are not) — that
    // edge is the one the teardown has to cut by hand, see `noiseTap`.
    let chainHead: BiquadFilterNode | null = null;
    const nyq = ctx.sampleRate / 2;
    // A partial only exists as a boost over the dry noise, so one whose boost
    // is a fraction of a dB contributes nothing audible — but it still costs a
    // biquad on the audio thread. The tail of a steep falloff series is exactly
    // that, and dropping it is free headroom.
    let used = partials.filter(x => 40 * p.tone * x.level >= MIN_BAND_DB);
    if (!used.length && partials.length) {used = [partials[0]];} // never a silent voice
    /* Graceful degradation: if the thread is already carrying a lot of filters
     * (a dense finale, thick unison chords), new voices shed their *weakest*
     * partials instead of the whole voice being stolen or the render deadline
     * being missed. The chain's magnitude response doesn't care about the
     * order of the bands, so the loudest ones can simply be kept. */
    if (!offline && voiceCollection.load > partialShedNodes() && used.length > 4) {
        const keep = Math.max(4, Math.round(used.length * partialShedNodes() / voiceCollection.load));
        used = used.slice().sort((a, b) => b.level - a.level).slice(0, keep);
    }
    if (p.tone > 0) {
        for (const part of used) {
            const f = freq * part.r;
            if (f > nyq * 0.9) {continue;}
            const bq = takeBiquad(f, part.q, 40 * p.tone * part.level);
            sweep(bq.frequency, f, when, p);
            node.connect(bq);
            if (!chainHead) {chainHead = bq;}
            node = bq;
            filters.push(bq);
            harmBands.push({bq, r: part.r, level: part.level});
            bands.push({target: f, from: p.pitchDrop !== 0 ? f * bendRatio : f, q: bq.Q.value, gain: bq.gain.value});
        }
    }
    /* ---- formants: the bands that do *not* follow the note ----
     * Every band above sits at `freq × ratio`, so an instrument's whole
     * spectral shape slides up and down with the melody. That is exactly what
     * a pipe does — and exactly what a throat does not: a vocal tract has
     * fixed resonances, and singing a scale moves the harmonics *through*
     * them. Three absolute-frequency peaks (F1 openness, F2 vowel, F3 the
     * "singer's formant") are the difference between a flute and an "ah".
     * They are deliberately excluded from the bend/glide sweeps below.
     *
     * They are also the one part of the chain that is NOT fed by the noise bus.
     * A voice is "chain(noise) - noise", so only what the chain *boosts* escapes
     * the cancellation: a band inside the chain does not colour a sound, it
     * creates one out of raw noise. That is what the narrow harmonic bands are
     * for — but a formant is deliberately wide (Q ~ 3), so in there it produced
     * a wide *hiss* sitting on top of the voice rather than a vowel. Downstream
     * of `sum` the noise is already gone and only the harmonics are left, which
     * is exactly what a vocal tract gets handed by the glottis: the formants now
     * emphasise the harmonics that happen to fall inside them, and add nothing
     * where there is no harmonic to lift. */
    // `i` says which of F1/F2/F3 a band is, since a band can be skipped
    const formantBands: { bq: BiquadFilterNode; i: number; w: number; band: BandSpec }[] = [];
    if (p.formant > 0) {
        const fq = Math.max(1, p.formantQ || 3);
        // F1 carries the vowel, F2 identifies it, F3 only adds presence
        const spec = [{hz: p.f1, w: 1}, {hz: p.f2, w: 0.75}, {hz: p.f3, w: 0.45}];
        spec.forEach((f, i) => {
            const g = FORMANT_DB * p.formant * f.w;
            if (!(f.hz > 0) || f.hz > nyq * 0.9 || g < MIN_BAND_DB) {return;}
            const bq = takeBiquad(f.hz, fq, g);
            filters.push(bq); // wired in after `sum`, below
            const band: BandSpec = {target: f.hz, from: f.hz, q: fq, gain: g, post: true};
            bands.push(band);
            formantBands.push({bq, i, w: f.w, band});
        });
    }
    /* A formant is an emphasis, not a volume: without this, opening the vowel up
     * would simply make the singer louder. Half of the strongest boost is taken
     * back out of the voice level (the bands are built strongest-first, so [0]
     * carries the largest weight that actually survived). */
    const fWeight = formantBands.length ? formantBands[0].w : 0;
    const levelFor = (gain: number, fl: number): number => 0.9 * gain * velScale
        * (fWeight ? Math.pow(10, -FORMANT_DB * fl * fWeight / 40) : 1);
    if (fWeight) {sum.gain.value = levelFor(p.gain, p.formant);}
    // ... plus one optional WIDE band — that's the whole percussion secret.
    // With `noiseBend` > 0 it follows the pitch bend/glides (scaled by that factor).
    let noiseBand: { bq: BiquadFilterNode; from: number; target: number; band: BandSpec } | null = null;
    if (p.noise > 0) {
        const nb = takeBiquad(p.noiseFreq, 0.8, 40 * p.noise);
        const nbFrom = p.pitchDrop !== 0 && p.noiseBend > 0
            ? Math.min(nyq * 0.95, p.noiseFreq * Math.pow(2, p.pitchDrop * p.noiseBend / 12))
            : p.noiseFreq;
        if (nbFrom !== p.noiseFreq) { // only bent bands need a scheduled ramp (see `sweep`)
            nb.frequency.setValueAtTime(nbFrom, when);
            nb.frequency.exponentialRampToValueAtTime(p.noiseFreq, when + p.pitchTime);
            flattenLater(nb.frequency, p.noiseFreq, when + p.pitchTime);
        } else {
            nb.frequency.value = nbFrom;
        }
        node.connect(nb);
        if (!chainHead) {chainHead = nb;}
        node = nb;
        filters.push(nb);
        const band: BandSpec = {target: p.noiseFreq, from: nbFrom, q: 0.8, gain: 40 * p.noise};
        bands.push(band);
        noiseBand = {bq: nb, from: nbFrom, target: p.noiseFreq, band};
    }
    // (H - 1)·noise: the shared inverted bus is the "dry" term, the chain adds
    // the boosted bands back on top. Globally flipped polarity vs. the old
    // (1 - H)·noise, which no ear (and no analyser) can tell apart.
    // what the (shared, permanent) noise bus feeds directly — the teardown has
    // to cut that edge explicitly, `disconnect()` only drops a node's outputs
    const noiseTap: AudioNode = chainHead ?? sum;
    engine.noiseInv.connect(sum);

    /* ---- vibrato ----
     * The shared LFO (±1) is scaled per band into "±this many Hz", so all
     * pitched bands wobble by the same *interval* and the timbre stays intact;
     * the formants stay still, which is what a real singer's tract does. The
     * gain ramp from 0 is the onset delay — a note that starts with full
     * vibrato sounds like a siren, not like a voice. Cost: one gain per band
     * (budget-counted below), and a biquad whose frequency has an input runs
     * on the per-sample coefficient path — vibrato is for a lead, not for
     * every voice in a dense bar. */
    const vibGains: { g: GainNode; r: number }[] = [];
    let vibSource: GainNode | null = null;
    const vibRatio = Math.pow(2, Math.max(0, p.vib || 0) / 1200) - 1;
    if (vibRatio > 0 && harmBands.length) {
        vibSource = vibLfo(p.vibRate);
        if (vibSource) {
            const onset = Math.max(0, p.vibDelay || 0);
            for (const {bq, r} of harmBands) {
                const amp = freq * r * vibRatio;
                const g = takeGain(0);
                g.gain.setValueAtTime(0, when);
                if (onset > 0.005) {g.gain.linearRampToValueAtTime(amp, when + onset);}
                else {g.gain.setValueAtTime(amp, when);}
                flattenLater(g.gain, amp, when + onset);
                vibSource.connect(g);
                g.connect(bq.frequency);
                vibGains.push({g, r});
            }
        }
    }
    node.connect(sum);
    // ... and only *here*, downstream of the cancellation, the vocal tract
    const formantTail = formantBands.reduce<AudioNode>((prev, fb) => {
        prev.connect(fb.bq);
        return fb.bq;
    }, sum);
    formantTail.connect(env);
    if (Math.abs(panWanted) > 0.002) {insertPan(panWanted + (Math.random() - 0.5) * 0.06);}
    else {env.connect(voiceOutput);}

    // Amp ADSR (attack -> decay to sustain); ±0.7 dB humanization per hit
    const peak = 0.9 * (0.92 + Math.random() * 0.08);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + p.att);
    env.gain.setTargetAtTime(p.sus * peak, when + p.att, Math.max(0.01, p.dec / 3));
    // `setTargetAtTime` never ends by itself — without this the envelope gain of
    // *every* voice keeps an open automation event (and its per-sample exp) for
    // as long as the voice exists. After 2 decay times it is within 0.25 % of
    // the sustain level, so freezing it there is inaudible.
    flattenLater(env.gain, p.sus * peak, when + p.att + Math.max(0.05, p.dec * 2));

    // Register every detuned rank for the scope overlay (live keys use 'live-<instId>').
    // A single scaled rank cannot reproduce the separated high-Q peaks of unison.
    const rec: BandRecord = {
        inst: track.startsWith('live-') ? track.slice(5) : track,
        bands, level: sum.gain.value,
        start: when, end: Infinity, release: Infinity, bendStart: when,
        pitchTime: p.pitchTime, att: p.att, dec: p.dec, sus: p.sus, rel: p.rel
    };
    bandRegistry.add(rec, when);

    // Current bend segment (base frequency): note-start sweep, then glides
    let bendFrom = p.pitchDrop !== 0 ? freq * bendRatio : freq;
    let bendTarget = freq;
    let bendStart = when;
    let bendTime = p.pitchDrop !== 0 ? p.pitchTime : 0;
    const baseFreqAt = (t: number): number => {
        if (bendTime <= 0 || t >= bendStart + bendTime) {return bendTarget;}
        if (t <= bendStart) {return bendFrom;}
        return bendFrom * Math.pow(bendTarget / bendFrom, (t - bendStart) / bendTime);
    };

    let cleanupGen = 0; // a glide revives the voice — invalidate pending teardowns
    let curP = p;       // params currently applied (automation lanes move them)
    // The subset of params that can move on a *sounding* voice, as last applied
    // to the audio graph — automation is compared against this, not against the
    // previous lane value, so a slow sweep accumulates instead of being dropped.
    const app = {
        gain: p.gain, pan: p.pan, tone: p.tone, q: p.q, noise: p.noise, noiseFreq: p.noiseFreq,
        formant: p.formant, f: [p.f1, p.f2, p.f3], vib: p.vib
    };
    const voice: Voice = {
        stopAt: Infinity,
        // The budget is really "nodes the render thread has to visit per
        // quantum", so count the envelope and the summing gain too.
        cost: filters.length + 2 + vibGains.length,
        dead: false,
        /* How loud this voice is at `at`, without measuring anything: the amp
         * envelope is a closed formula and `rec` already carries its shape and
         * the voice's level (the scope overlay does the same sum). A voice that
         * has not started yet counts as full — it is about to be heard, and
         * stealing it would silence a note nobody has heard at all. */
        loudness(at: number) {
            if (voice.dead) {return 0;}
            if (at <= rec.start) {return rec.level;}
            let env = adsrLevel(rec, at - rec.start);
            if (at > rec.release) {
                env = adsrLevel(rec, rec.release - rec.start)
                    * Math.exp(-(at - rec.release) / Math.max(0.01, rec.rel / 3));
            }
            return rec.level * env;
        },
        stop(at: number) {
            // A recycled voice's nodes belong to somebody else now — touching
            // them would retune a *different* note (`allNotesOff` can legally
            // arrive after the sweeper already collected the voice).
            if (!ctx || voice.dead) {return;}
            voice.stopAt = Math.min(voice.stopAt, at);
            rec.release = Math.min(rec.release, at);
            const tail = curP.rel * TAIL;
            rec.end = at + tail;
            env.gain.cancelScheduledValues(at);
            env.gain.setTargetAtTime(0, at, Math.max(0.01, curP.rel / 3));
            // ends the open release event (and invalidates the sustain flatten
            // queued at note start) — by then the tail is ~40 dB down
            flattenLater(env.gain, 0, at + tail);
            const gen = ++cleanupGen;
            scheduleTeardown({ // node cleanup only — batched, not timing-critical
                due: at + tail + 0.05,
                gen,
                size: filters.length + 3,
                cur: () => cleanupGen,
                kill: () => {
                    if (voice.dead) {return;}
                    voice.dead = true;
                    cut(() => sum.disconnect());
                    cut(() => env.disconnect());
                    if (pan) {cut(() => pan!.disconnect());}
                    for (const {g} of vibGains) {
                        // both edges: the gain's own output *and* the shared
                        // LFO's edge into it (disconnect() only drops outputs)
                        cut(() => g.disconnect());
                        cut(() => vibSource!.disconnect(g));
                    }
                    for (const n of filters) {cut(() => n.disconnect());}
                    cut(() => voiceNoiseBus.disconnect(noiseTap));
                    cut(() => voiceNoiseInv.disconnect(sum));
                    // ... and back into the pool: fully detached, so the next
                    // note can play on them instead of adding new nodes to the
                    // graph (which the browser only reclaims on a GC pass).
                    giveNode(sum);
                    giveNode(env);
                    for (const {g} of vibGains) {giveNode(g);}
                    if (pan) {giveNode(pan);}
                    for (const n of filters) {giveNode(n);}
                }
            });
        },
        /* Automation of a *sounding* note: the values that can move without
         * restarting the voice are re-ramped here (level, panning, the EQ
         * bands themselves). Everything else — ADSR times, the partial set,
         * bend/glide — only shapes the next note, which is honest for a
         * one-shot-per-note engine. Untouched params are skipped on purpose:
         * a scheduled event on a biquad param costs per-sample coefficients. */
        setParams(np: InstrumentParams, at: number, ramp: number) {
            if (voice.dead) {return;} // recycled — its nodes are another voice's now
            // Short on purpose: the lane is read once per 16th, and a ramp that
            // spans the whole step means the filter never has a moment without
            // a pending event — i.e. it stays on the expensive per-sample
            // coefficient path for the entire sweep. A 40 ms ramp is smooth to
            // the ear and lets the param settle (and be flattened) in between.
            const t = Math.max(0.005, Math.min(ramp, 0.04));
            // Deliberately coarse: every accepted change costs a scheduled
            // event on an AudioParam, and a biquad with a pending event is
            // recomputed *per sample*. A sweep that moves by a thousandth of
            // a unit per step is inaudible but would keep every filter of
            // every sounding voice in that expensive mode permanently.
            // The voice level depends on the formant level too (see `levelFor`),
            // so both are collected first and the gain is written once.
            let reLevel = false;
            if (differs(np.gain, app.gain, 0.004)) {
                app.gain = np.gain;
                reLevel = true;
            }
            if (differs(np.pan, app.pan, 0.01)) {
                const v = Math.max(-1, Math.min(1, np.pan + panOffset));
                // a centred voice has no panner — build one the moment a lane
                // actually moves it off centre (rare, and only once per voice)
                if (!pan) {insertPan(v);}
                else {rampTo(pan.pan, v, at, t);}
                app.pan = np.pan;
            }
            const dTone = differs(np.tone, app.tone, 0.004);
            const dQ = differs(np.q, app.q, Math.max(0.4, app.q * 0.02));
            if (dTone || dQ) {
                harmBands.forEach(({bq, r, level}, i) => {
                    if (dTone) {
                        const g = 40 * np.tone * level;
                        rampTo(bq.gain, g, at, t);
                        bands[i].gain = g;
                    }
                    if (dQ) {
                        const q = np.q * Math.sqrt(r);
                        rampTo(bq.Q, q, at, t);
                        bands[i].q = q;
                    }
                });
                if (dTone) {app.tone = np.tone;}
                if (dQ) {app.q = np.q;}
            }
            if (formantBands.length) {
                if (differs(np.formant, app.formant, 0.004)) {
                    formantBands.forEach(fb => {
                        const g = FORMANT_DB * np.formant * fb.w;
                        rampTo(fb.bq.gain, g, at, t);
                        fb.band.gain = g;
                    });
                    app.formant = np.formant;
                    reLevel = true; // keep the emphasis-not-volume trim in step
                }
                /* Vowel morph: the formants are the one thing here a lane can
                 * move *without* the pitch following it — sliding F1/F2 on a
                 * held note is an "ah" turning into an "ee", the singer's
                 * mouth rather than the singer's tune. */
                const want = [np.f1, np.f2, np.f3];
                for (const fb of formantBands) {
                    const hz = want[fb.i];
                    if (!differs(hz, app.f[fb.i], Math.max(5, app.f[fb.i] * 0.02))) {continue;}
                    rampTo(fb.bq.frequency, hz, at, t);
                    fb.band.from = fb.band.target = hz;
                    app.f[fb.i] = hz;
                }
            }
            if (reLevel) {
                const g = levelFor(app.gain, app.formant);
                rampTo(sum.gain, g, at, t);
                rec.level = g;
            }
            // Vibrato depth: the LFO stays, only how far it reaches moves
            if (vibGains.length && differs(np.vib, app.vib, 0.5)) {
                const ratio = Math.pow(2, Math.max(0, np.vib) / 1200) - 1;
                for (const {g, r} of vibGains) {rampTo(g.gain, bendTarget * r * ratio, at, t);}
                app.vib = np.vib;
            }
            if (noiseBand) {
                if (differs(np.noise, app.noise, 0.004)) {
                    const g = 40 * np.noise;
                    rampTo(noiseBand.bq.gain, g, at, t);
                    noiseBand.band.gain = g;
                    app.noise = np.noise;
                }
                // only steer the wide band when it isn't riding a bend/glide
                if (differs(np.noiseFreq, app.noiseFreq, Math.max(5, app.noiseFreq * 0.02))
                    && noiseBand.from === noiseBand.target) {
                    rampTo(noiseBand.bq.frequency, np.noiseFreq, at, t);
                    noiseBand.from = noiseBand.target = np.noiseFreq;
                    noiseBand.band.from = noiseBand.band.target = np.noiseFreq;
                    app.noiseFreq = np.noiseFreq;
                }
            }
            curP = np;
        },
        glide(newFreq: number, at: number, time: number, curve: CurveShape = 'linear') {
            if (!ctx || voice.dead) {return;}
            cleanupGen++; // keep the nodes — the voice lives on
            const cur = baseFreqAt(at);
            const scheduleGlide = (param: AudioParam, from: number, to: number) => {
                param.cancelScheduledValues(at);
                param.setValueAtTime(from, at);
                if (curve === 'linear') {param.exponentialRampToValueAtTime(to, at + time);}
                else {
                    const values = Array.from({length: 17}, (_, index) =>
                        from * Math.pow(to / from, segmentProgress(curve, index / 16)));
                    param.setValueCurveAtTime(values, at, time);
                }
                flattenLater(param, to, at + time);
            };
            // progress of the segment being interrupted (shared by all swept bands)
            const k = bendTime > 0 ? Math.min(1, Math.max(0, (at - bendStart) / bendTime)) : 1;
            harmBands.forEach(({bq, r}, i) => {
                scheduleGlide(bq.frequency, cur * r, newFreq * r);
                bands[i].from = cur * r;
                bands[i].target = newFreq * r;
            });
            // the wobble is a *ratio* of the band frequency, so a glide to a
            // new pitch has to re-scale it or the vibrato would widen/narrow
            if (vibGains.length) {
                const ratio = Math.pow(2, Math.max(0, app.vib) / 1200) - 1;
                for (const {g, r} of vibGains) {rampTo(g.gain, newFreq * r * ratio, at, Math.max(0.01, time));}
            }
            if (noiseBand && p.noiseBend > 0) {
                const nbCur = noiseBand.from * Math.pow(noiseBand.target / noiseBand.from, k);
                const nbNew = Math.min(ctx.sampleRate * 0.475,
                    nbCur * Math.pow(newFreq / cur, p.noiseBend));
                scheduleGlide(noiseBand.bq.frequency, nbCur, nbNew);
                noiseBand.from = nbCur;
                noiseBand.target = nbNew;
                noiseBand.band.from = nbCur;
                noiseBand.band.target = nbNew;
            }
            bendFrom = cur;
            bendTarget = newFreq;
            bendStart = at;
            bendTime = time;
            // un-schedule the pre-queued release, re-assert sustain
            // (cancelAndHold avoids a level jump when gliding mid-attack)
            const g = env.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
            if (g.cancelAndHoldAtTime) {g.cancelAndHoldAtTime(at);} else {g.cancelScheduledValues(at);}
            env.gain.setTargetAtTime(p.sus * peak, at, Math.max(0.01, p.dec / 3));
            flattenLater(env.gain, p.sus * peak, at + Math.max(0.05, p.dec * 2));
            voice.stopAt = Infinity;
            rec.release = Infinity;
            rec.end = Infinity;
            rec.bendStart = at;
            rec.pitchTime = time;
        }
    };
    return voice;
}

/* Unison / detune: `voices` copies of the chain, spread symmetrically over
 * `detune` cents (and a touch of pan) — that beating between ranks is the organ
 * shimmer / lush-strings / supersaw effect. `voices` 1 = a single rank. */
function makeVoice(track: string, freq: number, when: number, p: InstrumentParams, vel = 1): Voice {
    let n = Math.max(1, Math.min(8, Math.round(p.voices || 1)));
    /* First stage of the load governor: a unison rank is a *whole* extra filter
     * chain, so dropping one in a dense section frees a dozen nodes at once —
     * and 3 detuned ranks instead of 4 is far less audible than losing the top
     * partials of every note. Held chords keep what they were born with; only
     * new voices are thinned. */
    // (never while bouncing to WAV — an offline render has no deadline to miss,
    // so it gets the patch exactly as it was written)
    if (!offline && n > 2 && voiceCollection.load > softLiveNodes()) {
        n = Math.max(2, Math.round(n * softLiveNodes() / voiceCollection.load));
    }
    if (n === 1 || p.detune <= 0) {return makeRank(track, freq, when, p, vel, 0);}
    const g = 1 / Math.sqrt(n);       // keep the perceived level constant
    const ratios: number[] = [];
    const ranks: Voice[] = [];
    for (let i = 0; i < n; i++) {
        const x = (2 * i) / (n - 1) - 1; // -1 .. +1 across the ranks
        const ratio = Math.pow(2, (x * p.detune / 2) / 1200);
        ratios.push(ratio);
        ranks.push(makeRank(track, freq * ratio, when, p, vel * g, x * 0.18));
    }
    const voice: Voice = {
        stopAt: Infinity,
        cost: ranks.reduce((s, r) => s + r.cost, 0),
        // the ranks are torn down together, so any of them answers this
        get dead() {
            return ranks[0].dead;
        },
        // every rank's `rec.level` already stands in for the whole voice
        // (level x sqrt(ranks)), so take the loudest rank, not their sum
        loudness: (at: number) => ranks.reduce((m, r) => Math.max(m, r.loudness(at)), 0),
        stop(at: number) {
            voice.stopAt = Math.min(voice.stopAt, at);
            ranks.forEach(r => r.stop(at));
        },
        glide(newFreq: number, at: number, time: number, curve: CurveShape = 'linear') {
            ranks.forEach((r, i) => r.glide(newFreq * ratios[i], at, time, curve));
            voice.stopAt = Infinity;
        },
        setParams(np: InstrumentParams, at: number, ramp: number) {
            ranks.forEach(r => r.setParams(np, at, ramp));
        }
    };
    return voice;
}

const noteScheduler = new NoteScheduler<InstrumentParams>({
    findNote: name => noteByName[name],
    currentTime: () => ctx ? ctx.currentTime : null,
    voices: voiceCollection,
    createVoice: makeVoice,
    releaseTail: TAIL
});

function whileScheduling<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args) => {if (!rendering || schedulingOffline) {fn(...args);}};
}

export const noteOnAt = whileScheduling(noteScheduler.noteOnAt.bind(noteScheduler));
export const automateInstrument = whileScheduling(noteScheduler.automateInstrument.bind(noteScheduler));
export const noteOn = whileScheduling(noteScheduler.noteOn.bind(noteScheduler));
export const noteOffAt = whileScheduling(noteScheduler.noteOffAt.bind(noteScheduler));
export const glideAt = (...args: Parameters<typeof noteScheduler.glideAt>): boolean =>
    (!rendering || schedulingOffline) && noteScheduler.glideAt(...args);
export const noteOff = whileScheduling(noteScheduler.noteOff.bind(noteScheduler));
export const allNotesOff = whileScheduling(noteScheduler.allNotesOff.bind(noteScheduler));

/* ---- master FX ---- */
const selectedMasterControls = (): MasterControls => offline && schedulingOffline ? masterControls : liveMasterControls;
export const applyMaster = (id: string, value: number): void => selectedMasterControls().apply(id, value);
export const automateMaster = (id: string, value: number, at: number, ramp: number): void =>
    selectedMasterControls().automate(id, value, at, ramp);
export const resetMaster = (): void => selectedMasterControls().reset();

/* ---- offline render (bounce to an AudioBuffer) ----
 * The whole engine talks to the module-level `ctx`/`engine`, so a render just
 * swaps both for an OfflineAudioContext + a fresh graph, lets the caller
 * schedule the song into the future, renders, and puts the live graph back. */
export async function renderOffline(seconds: number, sampleRate: number, schedule: () => void,
    config: OfflineMixerConfig = mixerConfig): Promise<AudioBuffer> {
    if (rendering) {throw new Error('An offline render is already in progress');}
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
        throw new Error('Invalid offline render duration or sample rate');
    }
    rendering = true;
    try {
        const snapshot = {mixer: copyMixer(config.mixer, config.instrumentIds), instrumentIds: [...config.instrumentIds]};
        const values = {...master, ...config.master, ...snapshot.mixer?.master};
        if (initPromise) {await initPromise;}
        const frames = Math.max(1, Math.ceil(seconds * sampleRate));
        const latency = limiterLatencyFrames(sampleRate);
        const oc = new OfflineAudioContext(2, frames + latency, sampleRate);
        const savedCtx = ctx;
        const savedEngine = engine;
        const savedControls = masterControls;
        const savedVoices = voiceCollection.snapshot();
        const savedBands = bandRegistry.take();
        try {
            ctx = oc;
            offline = true;
            engine = {};
            masterControls = controlsFor(engine, values);
            await buildGraph(oc, engine, snapshot, values);
            voiceCollection.reset();
            schedulingOffline = true;
            try {schedule();} finally {schedulingOffline = false;}
            const rendered = await oc.startRendering();
            if (engine.limiter?.error) {throw engine.limiter.error;}
            const trimmed = oc.createBuffer(2, frames, sampleRate);
            for (let channel = 0; channel < 2; channel++) {
                trimmed.copyToChannel(rendered.getChannelData(channel).subarray(latency, latency + frames), channel);
            }
            return trimmed;
        } finally {
            cut(() => engine.mixer?.dispose());
            cut(() => engine.limiter?.dispose());
            cut(() => engine.noise?.stop());
            ctx = savedCtx;
            offline = false;
            engine = savedEngine;
            masterControls = savedControls;
            voiceCollection.restore(savedVoices);
            bandRegistry.restore(savedBands);
        }
    } finally {
        rendering = false;
    }
}

/* ---- lifecycle — one user gesture unlocks audio (autoplay policy) ---- */
let initPromise: Promise<void> | null = null;

export function ensureAudio(): Promise<void> {
    if (!initPromise) {
        if (rendering) {return Promise.reject(new Error('Wait for the offline render before initializing live audio'));}
        initPromise = initAudio().catch(error => {
            cut(() => liveGraph?.mixer?.dispose());
            cut(() => liveGraph?.limiter?.dispose());
            if (liveCtx) {void liveCtx.close();}
            engine = {onTick: liveGraph?.onTick};
            liveGraph = null;
            liveCtx = null;
            ctx = null;
            masterControls = controlsFor(engine, master);
            liveMasterControls = masterControls;
            initPromise = null;
            throw error;
        });
    }
    if (liveCtx && liveCtx.state !== 'running') {liveCtx.resume();}
    return initPromise;
}

window.addEventListener('beforeunload', () => {
    if (liveCtx) {liveCtx.close();}
});
