/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import {
    LimiterDSP
} from './limiter-dsp.js';

class MixerLimiterProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.dsp = new LimiterDSP(sampleRate);
        this.dsp.configure(options.processorOptions?.settings);
        this.metering = options.processorOptions?.metering !== false;
        this.interval = Math.ceil(sampleRate / 20);
        this.port.onmessage = ({data}) => {
            if (data.type === 'configure') {this.dsp.configure(data.settings);}
        };
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length < 2) {return true;}
        this.dsp.process(inputs[0]?.[0], inputs[0]?.[1], output[0], output[1], this.metering);
        if (this.metering && this.dsp.meterFrames >= this.interval) {
            this.port.postMessage(this.dsp.readMeters());
        }
        return true;
    }
}

registerProcessor('pinky-mixer-limiter', MixerLimiterProcessor);