import type { MixerBus, MixerChannel, MixerMaster, MixerState } from "./mixer";

import { LIMITER_LOOKAHEAD } from "./limiter-dsp.js";
import limiterWorkletUrl from "./limiter-worklet.js?worker&url";
import { audibleMixerIds } from "./mixer";

export interface MasterMeter {
  peak: number[];
  rms: number[];
  reduction: number;
}

export interface ChannelMeter {
  peak: number;
  rms: number;
}

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

export function loadLimiter(context: BaseAudioContext): Promise<void> {
  let pending = modules.get(context);
  if (!pending) {
    // Vite bundles the worklet AND its DSP dependency into this asset.
    // Failure is deliberately propagated; never route around protection.
    pending = context.audioWorklet.addModule(limiterWorkletUrl);
    modules.set(context, pending);
  }
  return pending;
}

export const limiterLatencyFrames = (rate: number): number =>
  Math.ceil(rate * LIMITER_LOOKAHEAD);

export class MasterLimiter {
  readonly node: AudioWorkletNode;
  error: Error | null = null;
  private latest: MasterMeter = { peak: [0, 0], rms: [0, 0], reduction: 0 };
  private signature: string;
  private onFrames: ((frames: number) => void) | null = null;

  constructor(
    context: BaseAudioContext,
    settings: MixerMaster,
    metering: boolean,
  ) {
    const values = this.settings(settings);
    this.signature = JSON.stringify(values);
    this.node = new AudioWorkletNode(context, "pinky-mixer-limiter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { settings: values, metering },
    });
    this.node.onprocessorerror = () => {
      this.error = new Error("Master limiter processor failed");
    };
    this.node.port.onmessage = ({
      data,
    }: MessageEvent<MasterMeter | { type: "progress"; frames: number }>) => {
      if ("type" in data && data.type === "progress") {
        this.onFrames?.(data.frames);
      } else if (metering && "peak" in data) {
        this.latest = data;
      }
    };
  }

  trackProgress(
    totalFrames: number,
    listener: (frames: number) => void,
  ): () => void {
    this.onFrames = listener;
    // At most ~200 updates per bounce, and no more than four per audio second.
    const intervalFrames =
      Math.ceil(
        Math.max(this.node.context.sampleRate / 4, totalFrames / 200) / 128,
      ) * 128;
    this.node.port.postMessage({ type: "progress", intervalFrames });
    return () => {
      this.onFrames = null;
      this.node.port.postMessage({ type: "progress", intervalFrames: 0 });
    };
  }

  configure(settings: MixerMaster): void {
    const values = this.settings(settings);
    const signature = JSON.stringify(values);
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    this.node.port.postMessage({ type: "configure", settings: values });
  }

  meters(): MasterMeter {
    return {
      peak: [...this.latest.peak],
      rms: [...this.latest.rms],
      reduction: this.latest.reduction,
    };
  }

  dispose(): void {
    this.onFrames = null;
    this.node.disconnect();
    this.node.port.onmessage = null;
    this.node.port.close();
  }

  private settings(master: MixerMaster) {
    return {
      enabled: master.limiter,
      driveDb: master.driveDb,
      ceilingDb: master.ceilingDb,
      release: master.release,
    };
  }
}

interface Route {
  gain: GainNode;
  target: AudioNode;
}

interface Strip {
  input: GainNode;
  highpass: BiquadFilterNode;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  compressor: DynamicsCompressorNode | null;
  volume: GainNode;
  pan: StereoPannerNode;
  gate: GainNode;
  reverb: GainNode;
  delay: DelayNode | null;
  feedback: GainNode | null;
  routes: Map<string, Route>;
  splitter: ChannelSplitterNode | null;
  analysers: AnalyserNode[];
  samples: Float32Array<ArrayBuffer>;
}

const bounded = (v: number, min: number, max: number): number =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;

/** Persistent native strips. Only structural edits change edges; fader/EQ edits
 * touch parameters. Reverb is one shared return, never fed from the master sum. */
export class MixerAudio {
  private readonly strips = new Map<string, Strip>();
  private readonly values = new WeakMap<AudioParam, number>();
  private readonly scheduled = new WeakMap<
    AudioParam,
    { at: number; value: number }
  >();
  private readonly voiceInputs = new Map<string, GainNode>();
  private readonly voiceTargets = new Map<string, AudioNode>();
  private mixed = false;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly master: AudioNode,
    private readonly reverb: AudioNode,
    private readonly metering: boolean,
  ) {}

  input(id: string): AudioNode | undefined {
    return this.strips.get(id)?.input;
  }

  /** Held voices keep this tap while a legacy project activates its mixer,
   * or undo replaces a removed strip. Never leave them on a bypassed bus. */
  voiceInput(id: string): AudioNode {
    let tap = this.voiceInputs.get(id);
    if (!tap) {
      tap = new GainNode(this.context);
      this.voiceInputs.set(id, tap);
      this.routeVoice(id, tap);
    }
    return tap;
  }

  configure(mixer: MixerState | undefined): void {
    this.mixed = !!mixer;
    const entries: [string, MixerChannel | MixerBus][] = mixer
      ? [
          ...Object.entries(mixer.channels),
          ...mixer.buses.map((bus) => [bus.id, bus] as [string, MixerBus]),
        ]
      : [];
    const ids = new Set(entries.map(([id]) => id));
    for (const [id, strip] of this.strips) {
      if (!ids.has(id)) {
        this.disconnect(strip);
        this.strips.delete(id);
      }
    }
    for (const [id] of entries) {
      if (!this.strips.has(id)) {
        this.strips.set(id, this.create());
      }
    }
    const audible = mixer ? audibleMixerIds(mixer) : new Set<string>();
    const busIds = new Set(mixer?.buses.map((bus) => bus.id));
    for (const [id, settings] of entries) {
      const strip = this.strips.get(id)!;
      this.update(strip, settings, audible.has(id));
      const routes = new Map<string, { target: AudioNode; level: number }>();
      const target = busIds.has(settings.output)
        ? this.strips.get(settings.output)?.input
        : this.master;
      if (target) {
        routes.set("output", { target, level: 1 });
      }
      for (const send of settings.sends) {
        const target = busIds.has(send.busId)
          ? this.strips.get(send.busId)?.input
          : undefined;
        if (target) {
          routes.set(`send:${send.busId}`, {
            target,
            level: bounded(send.level, 0, 1),
          });
        }
      }
      for (const [key, route] of strip.routes) {
        if (routes.get(key)?.target === route.target) {
          continue;
        }
        strip.gate.disconnect(route.gain);
        route.gain.disconnect();
        strip.routes.delete(key);
      }
      for (const [key, route] of routes) {
        let edge = strip.routes.get(key);
        if (!edge) {
          const gain = new GainNode(this.context, { gain: route.level });
          strip.gate.connect(gain);
          gain.connect(route.target);
          edge = { gain, target: route.target };
          strip.routes.set(key, edge);
        }
        this.set(edge.gain.gain, route.level);
      }
    }
    for (const [id, tap] of this.voiceInputs) {
      this.routeVoice(id, tap);
    }
  }

  reset(mixer: MixerState): void {
    const audible = audibleMixerIds(mixer);
    const entries: [string, MixerChannel | MixerBus][] = [
      ...Object.entries(mixer.channels),
      ...mixer.buses.map((bus) => [bus.id, bus] as [string, MixerBus]),
    ];
    for (const [id, settings] of entries) {
      const strip = this.strips.get(id);
      if (strip) {
        this.update(strip, settings, audible.has(id), true);
      }
    }
  }

  meters(): Record<string, ChannelMeter> {
    const result: Record<string, ChannelMeter> = {};
    for (const [id, strip] of this.strips) {
      let peak = 0,
        squares = 0;
      for (const analyser of strip.analysers) {
        analyser.getFloatTimeDomainData(strip.samples);
        for (const v of strip.samples) {
          if (!Number.isFinite(v)) {
            continue;
          }
          peak = Math.max(peak, Math.abs(v));
          squares += v * v;
        }
      }
      result[id] = {
        peak,
        rms: Math.sqrt(
          squares / Math.max(1, strip.samples.length * strip.analysers.length),
        ),
      };
    }
    return result;
  }

  /** Schedule only automatable strip values. Structural mixer configuration
   * remains untouched so lookahead ramps are not cancelled between steps. */
  automate(
    id: string,
    param: string,
    value: number,
    at: number,
    ramp: number,
  ): boolean {
    const strip = this.strips.get(id);
    if (
      !strip ||
      !Number.isFinite(value) ||
      !Number.isFinite(at) ||
      !Number.isFinite(ramp)
    ) {
      return false;
    }
    const schedule = (audioParam: AudioParam | null, next: number): boolean => {
      if (!audioParam) {
        return false;
      }
      const previous = this.scheduled.get(audioParam);
      const from =
        previous && previous.at <= at ? previous.value : audioParam.value;
      audioParam.cancelScheduledValues(at);
      audioParam.setValueAtTime(from, at);
      audioParam.linearRampToValueAtTime(next, at + Math.max(0, ramp));
      this.scheduled.set(audioParam, {
        at: at + Math.max(0, ramp),
        value: next,
      });
      this.values.set(audioParam, next);
      return true;
    };
    if (param === "volume") {
      return schedule(strip.volume.gain, bounded(value, 0, 2));
    }
    if (param === "pan") {
      return schedule(strip.pan.pan, bounded(value, -1, 1));
    }
    if (param === "reverb") {
      return schedule(strip.reverb.gain, bounded(value, 0, 1));
    }
    if (param === "highpass") {
      return schedule(strip.highpass.frequency, bounded(value, 20, 1000));
    }
    if (param === "tilt") {
      const next = bounded(value, -12, 12);
      return schedule(strip.low.gain, -next) && schedule(strip.high.gain, next);
    }
    if (param === "delayTime") {
      return schedule(strip.delay?.delayTime ?? null, bounded(value, 0.02, 2));
    }
    if (param === "feedback") {
      return schedule(strip.feedback?.gain ?? null, bounded(value, 0, 0.8));
    }
    return false;
  }

  dispose(): void {
    for (const strip of this.strips.values()) {
      this.disconnect(strip);
    }
    this.strips.clear();
    for (const tap of this.voiceInputs.values()) {
      tap.disconnect();
    }
    this.voiceInputs.clear();
    this.voiceTargets.clear();
  }

  private routeVoice(id: string, tap: GainNode): void {
    const channelId = this.strips.has(id)
      ? id
      : id.startsWith("live-")
        ? id.slice(5)
        : id;
    const target = this.mixed ? this.input(channelId) : this.master;
    if (this.voiceTargets.get(id) === target) {
      return;
    }
    tap.disconnect();
    this.voiceTargets.delete(id);
    if (target) {
      tap.connect(target);
      this.voiceTargets.set(id, target);
    }
  }

  private create(): Strip {
    const c = this.context;
    const strip: Strip = {
      input: new GainNode(c),
      highpass: new BiquadFilterNode(c, {
        type: "highpass",
        frequency: 20,
        Q: Math.SQRT1_2,
      }),
      low: new BiquadFilterNode(c, { type: "lowshelf", frequency: 500 }),
      high: new BiquadFilterNode(c, { type: "highshelf", frequency: 2000 }),
      compressor: null,
      volume: new GainNode(c),
      pan: new StereoPannerNode(c),
      gate: new GainNode(c),
      reverb: new GainNode(c, { gain: 0 }),
      delay: null,
      feedback: null,
      routes: new Map(),
      splitter: this.metering
        ? new ChannelSplitterNode(c, { numberOfOutputs: 2 })
        : null,
      analysers: this.metering
        ? [
            new AnalyserNode(c, { fftSize: 1024 }),
            new AnalyserNode(c, { fftSize: 1024 }),
          ]
        : [],
      samples: new Float32Array(this.metering ? 1024 : 0),
    };
    strip.input.connect(strip.highpass);
    strip.highpass.connect(strip.low);
    strip.low.connect(strip.high);
    strip.high.connect(strip.volume);
    strip.volume.connect(strip.pan);
    strip.pan.connect(strip.gate);
    strip.gate.connect(strip.reverb);
    strip.reverb.connect(this.reverb);
    if (strip.splitter) {
      strip.gate.connect(strip.splitter);
      strip.analysers.forEach((analyser, index) =>
        strip.splitter!.connect(analyser, index),
      );
    }
    return strip;
  }

  private update(
    strip: Strip,
    settings: MixerChannel | MixerBus,
    audible: boolean,
    force = false,
  ): void {
    const delay = "effect" in settings && settings.effect === "delay";
    if (delay !== !!strip.delay) {
      strip.input.disconnect();
      if (strip.delay) {
        strip.delay.disconnect();
        strip.feedback!.disconnect();
      }
      strip.delay = delay
        ? new DelayNode(this.context, {
            maxDelayTime: 2,
            delayTime: settings.delayTime,
          })
        : null;
      strip.feedback = delay
        ? new GainNode(this.context, {
            gain: bounded(settings.feedback, 0, 0.8),
          })
        : null;
      if (strip.delay && strip.feedback) {
        strip.input.connect(strip.delay);
        strip.delay.connect(strip.feedback);
        strip.feedback.connect(strip.delay);
        strip.delay.connect(strip.highpass);
      } else {
        strip.input.connect(strip.highpass);
      }
    }
    if (strip.delay && strip.feedback && "delayTime" in settings) {
      this.set(
        strip.delay.delayTime,
        bounded(settings.delayTime, 0.02, 2),
        force,
      );
      this.set(strip.feedback.gain, bounded(settings.feedback, 0, 0.8), force);
    }
    if (settings.compressor.enabled !== !!strip.compressor) {
      strip.high.disconnect();
      strip.compressor?.disconnect();
      strip.compressor = settings.compressor.enabled
        ? new DynamicsCompressorNode(this.context, {
            threshold: bounded(settings.compressor.threshold, -60, 0),
            ratio: bounded(settings.compressor.ratio, 1, 20),
          })
        : null;
      if (strip.compressor) {
        strip.high.connect(strip.compressor);
        strip.compressor.connect(strip.volume);
      } else {
        strip.high.connect(strip.volume);
      }
    }
    if (strip.compressor) {
      this.set(
        strip.compressor.threshold,
        bounded(settings.compressor.threshold, -60, 0),
        force,
      );
      this.set(
        strip.compressor.ratio,
        bounded(settings.compressor.ratio, 1, 20),
        force,
      );
    }
    this.set(
      strip.highpass.frequency,
      bounded(settings.highpass, 20, 1000),
      force,
    );
    this.set(strip.low.gain, -bounded(settings.tilt, -12, 12), force);
    this.set(strip.high.gain, bounded(settings.tilt, -12, 12), force);
    this.set(strip.volume.gain, bounded(settings.volume, 0, 2), force);
    this.set(strip.pan.pan, bounded(settings.pan, -1, 1), force);
    // Immediate gate silences direct output AND every post-fader wet send.
    this.set(strip.gate.gain, audible ? 1 : 0, force);
    this.set(strip.reverb.gain, bounded(settings.reverb, 0, 1), force);
  }

  private set(param: AudioParam, value: number, force = false): void {
    if (!force && this.values.get(param) === value) {
      return;
    }
    this.values.set(param, value);
    this.scheduled.delete(param);
    // Mixer edits are infrequent and constant: do not leave filter automation
    // events making native biquads recompute coefficients on every sample.
    param.cancelScheduledValues(0);
    param.value = value;
  }

  private disconnect(strip: Strip): void {
    strip.gate.gain.value = 0;
    for (const route of strip.routes.values()) {
      route.gain.disconnect();
    }
    for (const node of [
      strip.input,
      strip.highpass,
      strip.low,
      strip.high,
      strip.compressor,
      strip.volume,
      strip.pan,
      strip.gate,
      strip.reverb,
      strip.delay,
      strip.feedback,
      strip.splitter,
      ...strip.analysers,
    ]) {
      node?.disconnect();
    }
  }
}
