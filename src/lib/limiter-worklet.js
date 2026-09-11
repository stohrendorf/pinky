/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */
import { LimiterDSP } from "./limiter-dsp.js";

class MixerLimiterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.dsp = new LimiterDSP(sampleRate);
    this.dsp.configure(options.processorOptions?.settings);
    this.metering = options.processorOptions?.metering !== false;
    this.interval = Math.ceil(sampleRate / 20);
    this.progressInterval = 0;
    this.nextProgressFrame = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "configure") {
        this.dsp.configure(data.settings);
      }
      if (data.type === "progress") {
        this.progressInterval = Number.isFinite(data.intervalFrames)
          ? Math.max(0, data.intervalFrames)
          : 0;
        this.nextProgressFrame = 0;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) {
      return true;
    }
    this.dsp.process(
      inputs[0]?.[0],
      inputs[0]?.[1],
      output[0],
      output[1],
      this.metering,
    );
    if (this.metering && this.dsp.meterFrames >= this.interval) {
      this.port.postMessage(this.dsp.readMeters());
    }
    // Absolute frames include silent tails and bypassed output. The interval
    // bounds message count; some offline engines cannot service acknowledgements.
    if (this.progressInterval) {
      const frames = currentFrame + output[0].length;
      if (frames >= this.nextProgressFrame) {
        this.port.postMessage({ type: "progress", frames });
        this.nextProgressFrame = frames + this.progressInterval;
      }
    }
    return true;
  }
}

registerProcessor("pinky-mixer-limiter", MixerLimiterProcessor);
