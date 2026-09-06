import {
    afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';

import {
    createMixer, defaultChannel, type MixerBus
} from './mixer';
import {
    loadLimiter, MasterLimiter, MixerAudio
} from './mixer-audio';

// These doubles verify native graph topology/lifecycle, not native DSP. Actual
// limiter samples are exercised independently in limiter-dsp/worklet tests.
class Param {
    cancelScheduledValues = vi.fn();
    constructor(public value = 0) {}
    setValueAtTime(value: number) {this.value = value;}
    linearRampToValueAtTime(value: number) {this.value = value;}
}

class Node {
    connections = new Set<Node>();
    gain: Param;
    frequency: Param;
    Q = new Param();
    pan = new Param();
    threshold = new Param();
    ratio = new Param();
    delayTime = new Param();
    type: string;
    signal = 0;
    port = {postMessage: vi.fn(), close: vi.fn(), onmessage: null};
    constructor(public context: Context, public kind: string, public options: Record<string, unknown> = {}) {
        context.nodes.push(this);
        this.gain = new Param(Number(options.gain ?? (kind === 'GainNode' ? 1 : 0)));
        this.frequency = new Param(Number(options.frequency ?? 350));
        this.type = typeof options.type === 'string' ? options.type : '';
    }
    connect(node: Node) {
        if (node.context !== this.context) {throw new Error('Cross-context connection');}
        this.connections.add(node);
        return node;
    }
    disconnect(node?: Node) {
        if (node) {this.connections.delete(node);} else {this.connections.clear();}
    }
    start = vi.fn();
    stop = vi.fn();
    getFloatTimeDomainData(samples: Float32Array) {samples.fill(this.signal);}
}

class Buffer {
    data: Float32Array[];
    duration: number;
    constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
        this.data = Array.from({length: numberOfChannels}, () => new Float32Array(length));
        this.duration = length / sampleRate;
    }
    getChannelData(channel: number) {return this.data[channel];}
    copyToChannel(data: Float32Array, channel: number) {this.data[channel].set(data);}
}

class Context {
    static instances: Context[] = [];
    static render: ((context: Context) => Promise<Buffer>) | null = null;
    static moduleError = false;
    nodes: Node[] = [];
    destination = new Node(this, 'destination');
    currentTime = 0;
    state = 'running';
    audioWorklet = {addModule: vi.fn(() => Context.moduleError ? Promise.reject(new Error('module failed')) : Promise.resolve())};
    constructor(public channels = 2, public length = 4800, public sampleRate = 48000) {Context.instances.push(this);}
    createBuffer(channels: number, length: number, rate: number) {return new Buffer(channels, length, rate);}
    resume() {return Promise.resolve();}
    close() {return Promise.resolve();}
    startRendering() {
        if (Context.render) {return Context.render(this);}
        const result = this.createBuffer(this.channels, this.length, this.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            for (let i = 0; i < this.length; i++) {result.data[channel][i] = i / this.length;}
        }
        return Promise.resolve(result);
    }
}

beforeEach(() => {
    Context.instances = [];
    Context.render = null;
    Context.moduleError = false;
    vi.useFakeTimers();
    for (const kind of ['GainNode', 'BiquadFilterNode', 'StereoPannerNode', 'DynamicsCompressorNode',
        'DelayNode', 'ChannelSplitterNode', 'AnalyserNode', 'AudioBufferSourceNode', 'ConvolverNode']) {
        vi.stubGlobal(kind, class extends Node {
            constructor(context: Context, options?: Record<string, unknown>) {super(context, kind, options);}
        });
    }
    vi.stubGlobal('AudioWorkletNode', class extends Node {
        constructor(context: Context, name: string, options?: Record<string, unknown>) {super(context, name, options);}
    });
    vi.stubGlobal('OfflineAudioContext', Context);
    vi.stubGlobal('window', {AudioContext: Context, addEventListener: vi.fn()});
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function graph(meter = false) {
    const context = new Context();
    const master = new Node(context, 'master'), reverb = new Node(context, 'reverb');
    const audio = new MixerAudio(context as unknown as BaseAudioContext, master as unknown as AudioNode,
        reverb as unknown as AudioNode, meter);
    return {audio, context, master, reverb};
}

function strip(input: AudioNode | undefined) {
    const source = input as unknown as Node;
    const highpass = [...source.connections][0];
    const low = [...highpass.connections][0], high = [...low.connections][0];
    const volume = [...high.connections][0], pan = [...volume.connections][0], gate = [...pan.connections][0];
    return {source, highpass, low, high, volume, pan, gate};
}

const bus = (id: string, effect: MixerBus['effect'] = 'none'): MixerBus => ({
    ...defaultChannel(), id, name: id, reverb: 0, effect, delayTime: 0.2, feedback: 0.4
});

describe('persistent mixer audio routing', () => {
    it('keeps held voices connected when activating the mixer or restoring a strip', () => {
        const {audio, master} = graph();
        const tap = audio.voiceInput('a') as unknown as Node;
        expect(tap.connections.has(master)).toBe(true);
        const mixer = createMixer(['a']);
        audio.configure(mixer);
        expect(audio.voiceInput('a')).toBe(tap);
        expect(tap.connections.has(master)).toBe(false);
        expect(tap.connections.has(audio.input('a') as unknown as Node)).toBe(true);
        audio.configure(createMixer([]));
        expect(tap.connections.size).toBe(0);
        audio.configure(mixer);
        expect(tap.connections.has(audio.input('a') as unknown as Node)).toBe(true);
        audio.configure(undefined);
        expect(tap.connections.has(master)).toBe(true);
        audio.dispose();
        expect(tap.connections.size).toBe(0);
    });

    it('updates native parameters without allocating/reconnecting a graph on fader edits', () => {
        const {audio, context} = graph();
        const mixer = createMixer(['a']);
        audio.configure(mixer);
        const before = context.nodes.length;
        const {volume, pan, highpass, low, high} = strip(audio.input('a'));
        mixer.channels.a.volume = 0.4;
        mixer.channels.a.pan = -0.5;
        mixer.channels.a.highpass = 320;
        mixer.channels.a.tilt = 3;
        audio.configure(mixer);
        expect(context.nodes.length).toBe(before);
        expect([volume.gain.value, pan.pan.value, highpass.frequency.value, low.gain.value, high.gain.value])
            .toEqual([0.4, -0.5, 320, -3, 3]);
        const writes = volume.gain.cancelScheduledValues.mock.calls.length;
        audio.configure(mixer);
        expect(volume.gain.cancelScheduledValues).toHaveBeenCalledTimes(writes);
    });

    it('routes nested buses and post-fader sends; mute gates dry, reverb and every send together', () => {
        const {audio, master, reverb} = graph();
        const mixer = createMixer(['a', 'b']);
        mixer.buses = [bus('group'), bus('parent'), bus('echo', 'delay')];
        mixer.buses[0].output = 'parent';
        mixer.channels.a.output = 'group';
        mixer.channels.a.sends = [{busId: 'echo', level: 0.3}];
        audio.configure(mixer);
        const a = strip(audio.input('a'));
        expect([...a.gate.connections].some(edge => edge.connections.has(audio.input('group') as unknown as Node))).toBe(true);
        expect([...a.gate.connections].some(edge => edge.gain.value === 0.3 && edge.connections.has(audio.input('echo') as unknown as Node))).toBe(true);
        expect([...a.gate.connections].some(edge => edge.connections.has(reverb))).toBe(true);
        expect(master.connections.size).toBe(0);
        mixer.channels.a.mute = true;
        audio.configure(mixer);
        expect(a.gate.gain.value).toBe(0);
        expect(strip(audio.input('b')).gate.gain.value).toBe(1);
        mixer.channels.a.mute = false;
        mixer.buses[0].solo = true;
        audio.configure(mixer);
        expect(a.gate.gain.value).toBe(1);
        expect(strip(audio.input('b')).gate.gain.value).toBe(0);
        expect(strip(audio.input('parent')).gate.gain.value).toBe(1);
    });

    it('uses delay-only wet returns and disconnects removed sends, buses and channels', () => {
        const {audio, context, master} = graph();
        const mixer = createMixer(['a']);
        mixer.buses = [bus('echo', 'delay')];
        mixer.channels.a.sends = [{busId: 'echo', level: 0.5}];
        audio.configure(mixer);
        const echo = audio.input('echo') as unknown as Node;
        const delay = [...echo.connections][0];
        expect(delay.kind).toBe('DelayNode');
        expect(echo.connections.size).toBe(1);
        const feedback = [...delay.connections].find(node => node.kind === 'GainNode')!;
        expect(feedback.gain.value).toBe(0.4);
        expect(feedback.connections.has(delay)).toBe(true);
        mixer.buses = [];
        mixer.channels.a.sends = [];
        audio.configure(mixer);
        expect(audio.input('echo')).toBeUndefined();
        expect(delay.connections.size).toBe(0);
        expect(context.nodes.some(node => node.connections.has(echo))).toBe(false);
        audio.configure(undefined);
        expect(audio.input('a')).toBeUndefined();
        expect(context.nodes.some(node => node.connections.has(master))).toBe(false);
    });

    it('inserts/removes a channel compressor only when enabled', () => {
        const {audio} = graph();
        const mixer = createMixer(['a']);
        audio.configure(mixer);
        const a = strip(audio.input('a'));
        mixer.channels.a.compressor = {enabled: true, threshold: -30, ratio: 8};
        audio.configure(mixer);
        const compressor = [...a.high.connections][0];
        expect(compressor.kind).toBe('DynamicsCompressorNode');
        expect(compressor.threshold.value).toBe(-30);
        expect(compressor.ratio.value).toBe(8);
        expect(compressor.connections.has(a.volume)).toBe(true);
        mixer.channels.a.compressor.enabled = false;
        audio.configure(mixer);
        expect(a.high.connections.has(a.volume)).toBe(true);
        expect(compressor.connections.size).toBe(0);
    });

    it('meters both stereo channels independently and allocates no analysers offline', () => {
        const {audio, context} = graph(true);
        audio.configure(createMixer(['a']));
        const analysers = context.nodes.filter(node => node.kind === 'AnalyserNode');
        analysers[0].signal = 0.5;
        analysers[1].signal = -0.5;
        expect(audio.meters().a).toEqual({peak: 0.5, rms: 0.5});
        const other = graph(false);
        other.audio.configure(createMixer(['a']));
        expect(other.context.nodes.some(node => node.kind === 'AnalyserNode')).toBe(false);
    });

    it('loads protection once per context, propagates failure, and coalesces limiter updates', async () => {
        const c = new Context();
        const context = c as unknown as BaseAudioContext;
        await Promise.all([loadLimiter(context), loadLimiter(context)]);
        expect(c.audioWorklet.addModule).toHaveBeenCalledTimes(1);
        const settings = createMixer([]).master;
        const limiter = new MasterLimiter(context, settings, false);
        const node = limiter.node as unknown as Node;
        limiter.configure(settings);
        expect(node.port.postMessage).not.toHaveBeenCalled();
        limiter.configure({...settings, driveDb: 6});
        expect(node.port.postMessage).toHaveBeenCalledTimes(1);
        Context.moduleError = true;
        await expect(loadLimiter(new Context() as unknown as BaseAudioContext)).rejects.toThrow('module failed');
    });
});

async function freshEngine() {
    vi.resetModules();
    return import('./engine');
}

describe('engine graph isolation and latency trimming', () => {
    it('retains pre-init configuration, places protection last and does not double-feed reverb', async () => {
        const engine = await freshEngine();
        const mixer = createMixer(['a']);
        mixer.master = {...mixer.master, vol: 0.3, rev: 0.6, tilt: 4, driveDb: 9};
        engine.configureMixer(mixer, ['a']);
        await engine.ensureAudio();
        const c = Context.instances[0];
        const limiter = c.nodes.find(n => n.kind === 'pinky-mixer-limiter')!;
        const master = c.nodes.find(n => n.connections.has(limiter))!;
        expect(master.gain.value).toBe(0.3);
        expect(limiter.connections.has(c.destination)).toBe(true);
        const reverb = c.nodes.find(n => n.kind === 'ConvolverNode')!;
        const reverbInputs = c.nodes.filter(n => n.connections.has(reverb));
        expect(reverbInputs.every(n => n.kind === 'GainNode')).toBe(true);
        expect(reverbInputs).toHaveLength(1);
        expect(c.nodes.filter(n => n.kind === 'DynamicsCompressorNode').every(n => !n.connections.size)).toBe(true);
        expect(engine.outputLatency()).toBe(0.005);
    });

    it('keeps the old sum-fed reverb and compressor for a missing mixer', async () => {
        const engine = await freshEngine();
        await engine.ensureAudio();
        const c = Context.instances[0];
        const compressor = c.nodes.find(n => n.kind === 'DynamicsCompressorNode')!;
        const reverb = c.nodes.find(n => n.kind === 'ConvolverNode')!;
        expect(reverb.connections.has(compressor)).toBe(true);
        expect([...compressor.connections][0].kind).toBe('GainNode');
        const limiter = c.nodes.find(n => n.kind === 'pinky-mixer-limiter')!;
        expect(limiter.options.processorOptions).toMatchObject({settings: {enabled: false}});
    });

    it('restores legacy manual defaults when switching away from a mixed project', async () => {
        const engine = await freshEngine();
        const mixer = createMixer(['a']);
        mixer.master.vol = 0.25;
        mixer.master.rev = 0.5;
        mixer.master.tilt = -3;
        engine.configureMixer(mixer, ['a']);
        await engine.ensureAudio();
        engine.configureMixer(undefined, ['b']);
        expect(engine.master).toEqual({vol: 0.8, rev: 0.18, tilt: 0});
        expect(engine.masterState()).toEqual({vol: 0.8, tilt: 0});
    });

    it.each([false, true])('restores live controls and graph after offline success/error (%s)', async fail => {
        const engine = await freshEngine();
        const mixer = createMixer(['a']);
        engine.configureMixer(mixer, ['a']);
        await engine.ensureAudio();
        engine.applyMaster('vol', 0.42);
        engine.applyMaster('rev', 0.31);
        engine.applyMaster('tilt', -2);
        const saved = {...engine.master};
        const analyser = engine.getAnalyser();
        const request = engine.renderOffline(0.1, 44100, () => {
            engine.applyMaster('vol', 0.99);
            engine.applyMaster('rev', 0.01);
            engine.applyMaster('tilt', 12);
            if (fail) {throw new Error('schedule failed');}
        });
        if (fail) {await expect(request).rejects.toThrow('schedule failed');}
        else {
            const buffer = await request;
            expect(buffer.length).toBe(4410);
            expect(buffer.sampleRate).toBe(44100);
            expect(Context.instances[1].length).toBe(4410 + 221);
            expect(buffer.getChannelData(0)[0]).toBeCloseTo(221 / 4631, 6);
            expect(buffer.getChannelData(1)[4409]).toBeCloseTo(4630 / 4631, 6);
        }
        expect(engine.master).toEqual(saved);
        expect(engine.masterState()).toEqual({vol: 0.42, tilt: -2});
        expect(engine.getAnalyser()).toBe(analyser);
        expect(engine.isRendering()).toBe(false);
        engine.applyMaster('vol', 0.2);
        expect(engine.masterState().vol).toBe(0.2);
    });

    it('guards concurrent bounces and keeps project edits out of the offline graph', async () => {
        const engine = await freshEngine();
        engine.configureMixer(createMixer(['a']), ['a']);
        await engine.ensureAudio();
        engine.applyMaster('vol', 0.91);
        let finish!: (buffer: Buffer) => void;
        let ready!: () => void;
        const started = new Promise<void>(resolve => {ready = resolve;});
        Context.render = () => {ready(); return new Promise(resolve => {finish = resolve;});};
        const rendering = engine.renderOffline(0.1, 48000, () => undefined);
        await started;
        await expect(engine.renderOffline(0.1, 48000, () => undefined)).rejects.toThrow('already in progress');
        const offline = Context.instances[1];
        const count = offline.nodes.length;
        const changed = createMixer(['b']);
        changed.master.vol = 0.23;
        engine.configureMixer(changed, ['b']);
        engine.applyMaster('tilt', 7);
        engine.noteOn('b', 'C4', {} as Parameters<typeof engine.noteOn>[2]);
        expect(offline.nodes.length).toBe(count);
        const limiter = offline.nodes.find(node => node.kind === 'pinky-mixer-limiter')!;
        expect(limiter.port.postMessage).not.toHaveBeenCalled();
        finish(offline.createBuffer(2, offline.length, offline.sampleRate));
        await rendering;
        Context.instances[0].currentTime = 1;
        vi.advanceTimersByTime(80);
        expect(engine.masterState()).toEqual({vol: 0.23, tilt: 7});
        expect(Object.keys(engine.mixerMeters().channels)).toEqual(['b']);
    });

    it('restores the live graph if the offline worklet module fails to load', async () => {
        const engine = await freshEngine();
        await engine.ensureAudio();
        const analyser = engine.getAnalyser();
        const saved = {...engine.master};
        Context.moduleError = true;
        await expect(engine.renderOffline(0.1, 48000, () => undefined)).rejects.toThrow('module failed');
        expect(engine.getAnalyser()).toBe(analyser);
        expect(engine.master).toEqual(saved);
        expect(engine.isRendering()).toBe(false);
    });

    it('restores after a rendering rejection and can render again', async () => {
        const engine = await freshEngine();
        await engine.ensureAudio();
        engine.applyMaster('rev', 0.37);
        const saved = {...engine.master};
        const analyser = engine.getAnalyser();
        Context.render = () => Promise.reject(new Error('render failed'));
        await expect(engine.renderOffline(0.1, 48000, () => undefined)).rejects.toThrow('render failed');
        expect(engine.master).toEqual(saved);
        expect(engine.getAnalyser()).toBe(analyser);
        expect(engine.isRendering()).toBe(false);
        Context.render = null;
        expect((await engine.renderOffline(0.1, 48000, () => undefined)).length).toBe(4800);
    });

    it('accepts an explicit offline snapshot without initializing or changing live configuration', async () => {
        const engine = await freshEngine();
        const mixer = createMixer(['offline']);
        mixer.master.vol = 0.17;
        mixer.master.driveDb = 12;
        const saved = {...engine.master};
        await engine.renderOffline(0.1, 48000, () => {
            const c = Context.instances[0];
            const limiter = c.nodes.find(n => n.kind === 'pinky-mixer-limiter')!;
            const master = c.nodes.find(n => n.connections.has(limiter))!;
            expect(master.gain.value).toBe(0.17);
            expect(limiter.options.processorOptions).toMatchObject({metering: false, settings: {enabled: true, driveDb: 12}});
            engine.configureMixer(mixer, ['offline']);
            expect(limiter.port.postMessage).not.toHaveBeenCalled();
        }, {mixer, instrumentIds: ['offline']});
        expect(engine.master).toEqual(saved);
        expect(engine.getAnalyser()).toBeNull();
        expect(engine.mixerMeters().channels).toEqual({});
        await engine.ensureAudio();
        expect(engine.getAnalyser()).not.toBeNull();
    });

    it('accepts independent manual levels for a legacy export without changing live levels', async () => {
        const engine = await freshEngine();
        engine.applyMaster('vol', 0.2);
        await engine.renderOffline(0.1, 48000, () => {
            const c = Context.instances[0];
            const limiter = c.nodes.find(n => n.kind === 'pinky-mixer-limiter')!;
            const master = c.nodes.find(n => n.connections.has(limiter))!;
            expect(master.gain.value).toBe(1);
            expect(limiter.options.processorOptions).toMatchObject({settings: {enabled: false}});
            engine.configureMixer(undefined, []);
            expect(master.gain.value).toBe(1);
        }, {mixer: undefined, instrumentIds: [], master: {vol: 1, rev: 0, tilt: 0}});
        expect(engine.master.vol).toBe(0.2);
    });
});