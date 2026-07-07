import type {
    InstrumentParams, PartialSpec
} from './types';

import {
    noteByName
} from './notes';

const MIN_GAIN_DB = 0.5;
const FORMANT_DB = 22;

interface ResponseBand {
    frequency: number;
    q: number;
    gain: number;
    post?: boolean;
}

export interface FilterResponsePoint {
    frequency: number;
    magnitude: number;
}

export interface FrequencyAnchor {
    frequency: number;
    q: number;
}

const PINK_POLES = [0.99886, 0.99332, 0.96900, 0.86650, 0.55000, -0.7616];
const PINK_GAINS = [0.0555179, 0.0750759, 0.1538520, 0.3104856, 0.5329522, -0.0168980];
const PINK_DIRECT = 0.5362;
const PINK_DELAY = 0.115926;

export function quadraticFrequencySamples(points: number, upper: number, lower: number,
    anchors: readonly FrequencyAnchor[] = []): number[] {
    const count = Math.max(2, Math.round(points));
    const samples = Array.from({length: count}, (_, index) =>
        Math.max(lower, upper * Math.pow(index / (count - 1), 2))
    );

    for (const {frequency, q} of anchors) {
        if (!Number.isFinite(frequency) || !Number.isFinite(q) || frequency <= 0) {continue;}
        const halfWidth = frequency / Math.max(1, q);
        samples.push(frequency - halfWidth, frequency, frequency + halfWidth);
    }

    samples.sort((a, b) => a - b);
    return samples.filter((frequency, index) => frequency >= lower && frequency <= upper
        && (index === 0 || frequency !== samples[index - 1]));
}

/** The pink source is an IIR filter fed by white noise, not an ideal 1/f slope.
 * Its overall level is fitted to the analyser, while this exact transfer keeps
 * relative low-frequency levels aligned with the generated buffer. */
export function pinkNoisePower(frequency: number, sampleRate = 48000): number {
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {return 0;}
    const w = 2 * Math.PI * frequency / sampleRate;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    let real = PINK_DIRECT + PINK_DELAY * cosW;
    let imaginary = -PINK_DELAY * sinW;

    for (let index = 0; index < PINK_POLES.length; index++) {
        const denominatorReal = 1 - PINK_POLES[index] * cosW;
        const denominatorImaginary = PINK_POLES[index] * sinW;
        const denominatorPower = denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary;
        real += PINK_GAINS[index] * denominatorReal / denominatorPower;
        imaginary -= PINK_GAINS[index] * denominatorImaginary / denominatorPower;
    }

    return real * real + imaginary * imaginary;
}

function partialsFor(params: InstrumentParams): PartialSpec[] {
    if (params.partials?.length) {return params.partials;}
    return Array.from({length: Math.max(0, Math.round(params.harm))}, (_, index) => {
        const ratio = Math.pow(index + 1, 1 + params.stretch);
        return {ratio, level: Math.pow(params.falloff, index)};
    });
}

function responseBands(params: InstrumentParams, fundamental: number, sampleRate: number): ResponseBand[] {

    const nyquist = sampleRate / 2;
    const pre: ResponseBand[] = [];
    const post: ResponseBand[] = [];
    const tone = params.tone || 0;

    if (tone > 0) {
        for (const partial of partialsFor(params)) {
            const gain = 40 * tone * partial.level;
            const frequency = fundamental * partial.ratio;
            if (partial.level <= 0 || frequency > nyquist * 0.9 || gain < MIN_GAIN_DB) {continue;}
            pre.push({frequency, q: params.q * Math.sqrt(partial.ratio), gain});
        }
    }

    if (params.noise > 0 && params.noiseFreq > 0 && params.noiseFreq <= nyquist * 0.9) {
        pre.push({frequency: params.noiseFreq, q: 0.8, gain: 40 * params.noise});
    }

    if (params.formant > 0) {
        const formantQ = Math.max(1, params.formantQ || 3);
        for (const {frequency, weight} of [
            {frequency: params.f1, weight: 1},
            {frequency: params.f2, weight: 0.75},
            {frequency: params.f3, weight: 0.45}
        ]) {
            const gain = FORMANT_DB * params.formant * weight;
            if (!(frequency > 0) || frequency > nyquist * 0.9 || gain < MIN_GAIN_DB) {continue;}
            post.push({frequency, q: formantQ, gain, post: true});
        }
    }

    return [...pre, ...post];
}

function unisonRankCount(params: InstrumentParams): number {
    const ranks = Math.max(1, Math.min(8, Math.round(params.voices || 1)));
    return ranks > 1 && params.detune > 0 ? ranks : 1;
}

function unisonBands(params: InstrumentParams, fundamental: number, sampleRate: number): ResponseBand[] {
    const ranks = unisonRankCount(params);
    if (ranks === 1) {return responseBands(params, fundamental, sampleRate);}

    return Array.from({length: ranks}, (_, index) => {
        const position = 2 * index / (ranks - 1) - 1;
        const ratio = Math.pow(2, position * params.detune / 2400);
        return responseBands(params, fundamental * ratio, sampleRate);
    }).flat();
}

function bandTerms(band: ResponseBand, cosW: number, sinW: number, cos2W: number, sin2W: number,
    sampleRate: number): { br: number; bi: number; ar: number; ai: number } {
    const w0 = 2 * Math.PI * Math.min(band.frequency, sampleRate * 0.49) / sampleRate;
    const amplitude = Math.pow(10, band.gain / 40);
    const alpha = Math.sin(w0) / (2 * Math.max(0.1, band.q));
    const cosine = -2 * Math.cos(w0);
    const a0 = 1 + alpha / amplitude;
    const b0 = (1 + alpha * amplitude) / a0;
    const b1 = cosine / a0;
    const b2 = (1 - alpha * amplitude) / a0;
    const a1 = cosine / a0;
    const a2 = (1 - alpha / amplitude) / a0;
    return {
        br: b0 + b1 * cosW + b2 * cos2W,
        bi: -(b1 * sinW + b2 * sin2W),
        ar: 1 + a1 * cosW + a2 * cos2W,
        ai: -(a1 * sinW + a2 * sin2W)
    };
}

export function filterMagnitude(params: InstrumentParams, note: string, frequency: number, sampleRate = 48000): number {
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {return 0;}
    const fundamental = noteByName[note]?.freq;
    if (!fundamental) {return 0;}
    return filterMagnitudeForFundamental(params, fundamental, frequency, sampleRate);
}

function filterMagnitudeForFundamental(params: InstrumentParams, fundamental: number,
    frequency: number, sampleRate: number): number {
    return filterMagnitudeForBands(responseBands(params, fundamental, sampleRate), frequency, sampleRate);
}

function filterMagnitudeForBands(bands: ResponseBand[], frequency: number, sampleRate: number): number {
    const response = filterResponseForBands(bands, frequency, sampleRate);
    return Math.hypot(response.real, response.imaginary);
}

interface ComplexResponse {
    real: number;
    imaginary: number;
}

function filterResponseForFundamental(params: InstrumentParams, fundamental: number,
    frequency: number, sampleRate: number): ComplexResponse {
    return filterResponseForBands(responseBands(params, fundamental, sampleRate), frequency, sampleRate);
}

function filterResponseForBands(bands: ResponseBand[], frequency: number, sampleRate: number): ComplexResponse {
    const w = 2 * Math.PI * frequency / sampleRate;
    const cosW = Math.cos(w), sinW = Math.sin(w), cos2W = Math.cos(2 * w), sin2W = Math.sin(2 * w);
    let real = 1, imaginary = 0;

    for (const band of bands.filter(band => !band.post)) {
        const {br, bi, ar, ai} = bandTerms(band, cosW, sinW, cos2W, sin2W, sampleRate);
        const denominator = Math.max(1e-30, ar * ar + ai * ai);
        const bandReal = (br * ar + bi * ai) / denominator;
        const bandImaginary = (bi * ar - br * ai) / denominator;
        const nextReal = real * bandReal - imaginary * bandImaginary;
        imaginary = real * bandImaginary + imaginary * bandReal;
        real = nextReal;
    }

    real -= 1;

    for (const band of bands.filter(band => band.post)) {
        const {br, bi, ar, ai} = bandTerms(band, cosW, sinW, cos2W, sin2W, sampleRate);
        const denominator = Math.max(1e-30, ar * ar + ai * ai);
        const postReal = (br * ar + bi * ai) / denominator;
        const postImaginary = (bi * ar - br * ai) / denominator;
        const nextReal = real * postReal - imaginary * postImaginary;
        imaginary = real * postImaginary + imaginary * postReal;
        real = nextReal;
    }

    return Number.isFinite(real) && Number.isFinite(imaginary) ? {real, imaginary} : {real: 0, imaginary: 0};
}

/** Unison ranks are spread through the stereo field and the source buffer has
 * independent left/right noise. The analyser therefore reads their combined
 * spectral power, rather than a single scalar sum that can create false nulls
 * between detuned resonances. */
export function unisonFilterMagnitude(params: InstrumentParams, note: string,
    frequency: number, sampleRate = 48000): number {
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {return 0;}
    const fundamental = noteByName[note]?.freq;
    if (!fundamental) {return 0;}
    const ranks = unisonRankCount(params);
    let power = 0;
    for (let index = 0; index < ranks; index++) {
        const position = ranks === 1 ? 0 : 2 * index / (ranks - 1) - 1;
        const ratio = Math.pow(2, position * params.detune / 2400);
        const response = filterResponseForFundamental(params, fundamental * ratio, frequency, sampleRate);
        power += (response.real * response.real + response.imaginary * response.imaginary) / ranks;
    }
    return Math.sqrt(power);
}

export function filterResponseCurve(params: InstrumentParams, note: string, points = 128, sampleRate = 48000): FilterResponsePoint[] {
    const upper = Math.min(18000, sampleRate / 4);
    const lower = Math.min(20, upper / 2);
    const fundamental = noteByName[note]?.freq;
    if (!fundamental) {return [];}
    const bands = unisonBands(params, fundamental, sampleRate);
    const count = Math.max(2, Math.round(points));
    const samples = Array.from({length: count}, (_, index) =>
        lower * Math.pow(upper / lower, index / (count - 1))
    );

    for (const {frequency} of bands) {
        if (frequency >= lower && frequency <= upper) {samples.push(frequency);}
    }

    return samples.sort((a, b) => a - b).filter((frequency, index) => index === 0 || frequency !== samples[index - 1]).map(frequency => {
        const magnitude = unisonFilterMagnitude(params, note, frequency, sampleRate);
        return {frequency, magnitude};
    });
}
