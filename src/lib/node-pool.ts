export interface NodePoolOptions {
  capacity?: number;
  coolTime?: number;
  reset?: (param: AudioParam, value: number) => void;
}

/**
 * Reuses the short-lived nodes created for a voice.
 *
 * The pool deliberately knows nothing about voices or synthesis. It only
 * owns node reset, context ownership, and the short cooling period required
 * by biquad filters before they can be used again.
 */
export class NodePool {
  private readonly gains: GainNode[] = [];
  private readonly biquads: BiquadFilterNode[] = [];
  private readonly panners: StereoPannerNode[] = [];
  private readonly cooling: CoolingNode[] = [];
  private context: BaseAudioContext | null = null;
  private flushBus: GainNode | null = null;
  private enabled = false;
  private readonly capacity: number;
  private readonly coolTime: number;
  private readonly reset: (param: AudioParam, value: number) => void;

  constructor(options: NodePoolOptions = {}) {
    this.capacity = options.capacity ?? 1024;
    this.coolTime = options.coolTime ?? 0.05;
    this.reset = options.reset ?? resetParam;
  }

  get size(): number {
    return (
      this.gains.length +
      this.biquads.length +
      this.panners.length +
      this.cooling.length
    );
  }

  get coolingCount(): number {
    return this.cooling.length;
  }

  /** Start pooling for a live context, discarding nodes from an old graph. */
  attach(
    context: BaseAudioContext,
    flushBus: GainNode,
    now: () => number,
  ): void {
    if (this.context !== context) {
      this.clear();
    }
    this.context = context;
    this.flushBus = flushBus;
    this.now = now;
    this.enabled = true;
  }

  takeGain(gain: number, context: BaseAudioContext): GainNode {
    const node =
      this.enabled && context === this.context ? this.gains.pop() : undefined;
    if (node) {
      this.reset(node.gain, gain);
      return node;
    }
    return new GainNode(context, { gain });
  }

  takeBiquad(
    frequency: number,
    q: number,
    gain: number,
    context: BaseAudioContext,
  ): BiquadFilterNode {
    const node =
      this.enabled && context === this.context ? this.biquads.pop() : undefined;
    if (node) {
      node.type = "peaking";
      this.reset(node.frequency, frequency);
      this.reset(node.Q, q);
      this.reset(node.gain, gain);
      this.reset(node.detune, 0);
      return node;
    }
    return new BiquadFilterNode(context, {
      type: "peaking",
      frequency,
      Q: q,
      gain,
    });
  }

  takePanner(pan: number, context: BaseAudioContext): StereoPannerNode {
    const node =
      this.enabled && context === this.context ? this.panners.pop() : undefined;
    if (node) {
      this.reset(node.pan, pan);
      return node;
    }
    return new StereoPannerNode(context, { pan });
  }

  /** Return a disconnected node to this pool when it belongs to this graph. */
  give(node: AudioNode): void {
    if (!this.enabled || node.context !== this.context) {
      return;
    }
    if (node instanceof GainNode) {
      if (this.gains.length < this.capacity) {
        this.gains.push(node);
      }
    } else if (node instanceof BiquadFilterNode) {
      if (this.biquads.length + this.cooling.length < this.capacity) {
        this.coolDown(node);
      }
    } else if (node instanceof StereoPannerNode) {
      if (this.panners.length < this.capacity) {
        this.panners.push(node);
      }
    }
  }

  /** Move cooled filters into the reusable filter pool. */
  sweep(now: number): void {
    while (this.cooling.length && this.cooling[0].at <= now) {
      const cooled = this.cooling.shift()!;
      safe(() => cooled.node.disconnect(cooled.sink));
      if (this.biquads.length < this.capacity) {
        this.biquads.push(cooled.node);
      }
    }
  }

  clear(): void {
    this.gains.length = 0;
    this.biquads.length = 0;
    this.panners.length = 0;
    this.cooling.length = 0;
  }

  private now: () => number = () => 0;

  private coolDown(node: BiquadFilterNode): void {
    if (!this.flushBus) {
      return;
    }
    node.type = "peaking";
    this.reset(node.frequency, 2000);
    this.reset(node.Q, 0.7);
    this.reset(node.gain, 0);
    this.reset(node.detune, 0);
    const sink = this.flushBus;
    safe(() => node.connect(sink));
    this.cooling.push({ node, at: this.now() + this.coolTime, sink });
  }
}

interface CoolingNode {
  node: BiquadFilterNode;
  at: number;
  sink: GainNode;
}

function resetParam(param: AudioParam, value: number): void {
  try {
    param.cancelScheduledValues(0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // A node may already have been detached by the teardown sweep.
  }
  param.value = value;
}

function safe(action: () => void): void {
  try {
    action();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // Disconnecting an already disconnected node is harmless.
  }
}
