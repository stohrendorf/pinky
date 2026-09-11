import { afterEach, describe, expect, it, vi } from "vitest";

interface Processor {
  port: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: (event: { data: unknown }) => void;
  };

  process(input: Float32Array[][], output: Float32Array[][]): boolean;
}

async function processor(metering: boolean) {
  vi.resetModules();
  let Constructor!: new (options: unknown) => Processor;
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      port = { postMessage: vi.fn(), onmessage: null };
    },
  );
  vi.stubGlobal(
    "registerProcessor",
    (name: string, constructor: typeof Constructor) => {
      expect(name).toBe("pinky-mixer-limiter");
      Constructor = constructor;
    },
  );
  await import("./limiter-worklet.js");
  return new Constructor({
    processorOptions: {
      metering,
      settings: { enabled: true, ceilingDb: -6, driveDb: 18 },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("limiter worklet actual DSP wiring", () => {
  it("reports frames through silence and bypass at bounded intervals without needing audio-thread replies", async () => {
    const node = await processor(false);
    node.port.onmessage({
      data: { type: "configure", settings: { enabled: false } },
    });
    node.port.onmessage({ data: { type: "progress", intervalFrames: 12032 } });
    const output = [new Float32Array(128), new Float32Array(128)];
    for (let block = 0; block < 375; block++) {
      vi.stubGlobal("currentFrame", block * 128);
      node.process([[]], [output]);
    }
    expect(node.port.postMessage.mock.calls).toEqual(
      [128, 12160, 24192, 36224].map((frames) => [
        {
          type: "progress",
          frames,
        },
      ]),
    );
    vi.stubGlobal("currentFrame", 48000);
    node.process([[]], [output]);
    expect(node.port.postMessage).toHaveBeenCalledTimes(4);
    vi.stubGlobal("currentFrame", 48128);
    node.process([[]], [output]);
    expect(node.port.postMessage).toHaveBeenLastCalledWith({
      type: "progress",
      frames: 48256,
    });
    node.port.onmessage({ data: { type: "progress", intervalFrames: 0 } });
    vi.stubGlobal("currentFrame", 96000);
    node.process([[]], [output]);
    expect(node.port.postMessage).toHaveBeenCalledTimes(5);
    expect(output[0].every((value) => value === 0)).toBe(true);
  });

  it("leaves every audio sample unchanged when telemetry is enabled", async () => {
    const plain = await processor(false),
      tracked = await processor(false);
    tracked.port.onmessage({
      data: { type: "progress", intervalFrames: 12032 },
    });
    const input = [new Float32Array(128), new Float32Array(128)];
    const a = [new Float32Array(128), new Float32Array(128)],
      b = [new Float32Array(128), new Float32Array(128)];
    for (let block = 0; block < 200; block++) {
      vi.stubGlobal("currentFrame", block * 128);
      for (let i = 0; i < 128; i++) {
        input[0][i] = Math.sin((block * 128 + i) * 0.01) * 2;
        input[1][i] = -input[0][i] * 0.7;
      }
      plain.process([input], [a]);
      tracked.process([input], [b]);
      expect(b).toEqual(a);
    }
    expect(plain.port.postMessage).not.toHaveBeenCalled();
    expect(tracked.port.postMessage).toHaveBeenCalledTimes(3);
  });

  it("limits stereo at the output and sends bounded-rate output meters live", async () => {
    const node = await processor(true);
    const input = [
      new Float32Array(128).fill(20),
      new Float32Array(128).fill(-5),
    ];
    const output = [new Float32Array(128), new Float32Array(128)];
    for (let block = 0; block < 375; block++) {
      expect(node.process([input], [output])).toBe(true);
      expect(
        output[0].every((value) => Math.abs(value) <= Math.pow(10, -6 / 20)),
      ).toBe(true);
    }
    expect(node.port.postMessage.mock.calls.length).toBeLessThanOrEqual(20);
    expect(node.port.postMessage.mock.calls.length).toBeGreaterThanOrEqual(19);
    const meter = node.port.postMessage.mock.lastCall?.[0] as {
      peak: number[];
      rms: number[];
      reduction: number;
    };
    expect(meter.reduction).toBeGreaterThan(40);
    expect(meter.peak[1] / meter.peak[0]).toBeCloseTo(0.25);
    expect(meter.rms[0]).toBeCloseTo(meter.peak[0]);
  });

  it("does not send a single meter message offline and still protects every sample", async () => {
    const node = await processor(false);
    const input = [new Float32Array(128).fill(100)];
    const output = [new Float32Array(128), new Float32Array(128)];
    for (let block = 0; block < 400; block++) {
      node.process([input], [output]);
      expect(
        output[0].every((value) => Math.abs(value) <= Math.pow(10, -6 / 20)),
      ).toBe(true);
      expect(output[1]).toEqual(output[0]);
    }
    expect(node.port.postMessage).not.toHaveBeenCalled();
  });

  it("applies bypass configuration without removing the delay buffer", async () => {
    const node = await processor(false);
    node.port.onmessage({
      data: { type: "configure", settings: { enabled: false, driveDb: 18 } },
    });
    const input = [
      new Float32Array(128).fill(2),
      new Float32Array(128).fill(-1),
    ];
    const output = [new Float32Array(128), new Float32Array(128)];
    node.process([input], [output]);
    expect(output[0].every((value) => value === 0)).toBe(true);
    node.process([input], [output]);
    expect(output[0][111]).toBe(0);
    expect(output[0][112]).toBe(2);
    expect(output[1][112]).toBe(-1);
  });
});
