<script lang="ts">
    import {
        onMount
    } from 'svelte';
    import {
        run
    } from 'svelte/legacy';

    import type {
        VoiceBand
    } from '../lib/engine';

    import {
        activeVoiceBands, audioSampleRate, engineLoad, getAnalyser, masterState
    } from '../lib/engine';
    import {
        type FrequencyAnchor, pinkNoisePower, quadraticFrequencySamples
    } from '../lib/filter-response';
    import {
        project
    } from '../lib/project';

    let canvas: HTMLCanvasElement | undefined = $state();

    // instrument id -> color, kept fresh by Svelte reactivity
    let instColors = $state(new Map<string, string>());
    run(() => {
        instColors = new Map(($project?.instruments || []).map(i => [i.id, i.color]));
    });

    /* ---- what the curve actually models ----
     * A voice is dry pink noise *minus* the same noise sent through a serial
     * chain of peaking boosts (see engine.ts), so its transfer function is
     * |H1·H2·… - 1|, not |H|: where the chain is transparent the two copies
     * cancel. Drawing |H| was the reason the overlay disagreed with the FFT —
     * it showed a flat 0 dB "floor" where the real output is quiet, and its
     * peaks lived on a private 0..48 dB scale unrelated to the bars.
     *
     * So the overlay predicts the *output spectrum*:
     *   rank(f) = level · env · (∏H(f) − 1)                (dry − filtered)
     *   power(f) = Σ ranks² · pinkNoisePSD(f) · tilt(f) · masterVol²
     * and is plotted on the analyser's own dB scale, so it lies on top of the
     * bars.
     *
     * That subtraction has to be done with *complex* H, and using the magnitude
     * (|∏H| − 1) instead was why the curve showed only a few spikes while the
     * FFT showed broadband noise falling off towards the top end: away from its
     * center a peaking filter still has |H| ≈ 1 but a *phase* shift, so the two
     * copies no longer cancel — |∏H − 1| ≈ |phase deviation| ≫ 0. Every band
     * leaks a skirt of pink noise on both sides of itself, and a chain of a
     * dozen bands leaks a broad pink haze. That haze is real (it is what makes
     * these voices sound breathy at all), it is most of what the analyser sees
     * between the peaks, and it is now part of the prediction.
     *
     * One honest fudge: the absolute level depends on the noise buffer's RMS,
     * the analyser's window and the FFT normalisation. Instead of hard-coding
     * that constant, the offset is fitted continuously against the measured
     * spectrum (see `cal`), so the *shape* is predicted and only the overall
     * gain is matched to reality.
     *
     * Performance: H(e^jw) = (b0 + b1·z + b2·z²)/(1 + a1·z + a2·z²) with
     * z = e^-jw, so a band is five stored coefficients and a column is just
     * cos/sin of w and 2w — both precomputed. The numerators and denominators
     * of each band are divided before the chain is accumulated. That avoids the
     * tiny product denominators that otherwise underflow for very low notes. No
     * trig or allocation is needed per band/column. */
    const CURVE_PTS = 1920;   // regular display-grid samples of the overlay curve
    const MAX_RESONANCE_ANCHORS = 128; // exact narrow-band centers added to the regular grid
    const CURVE_CAPACITY = CURVE_PTS + MAX_RESONANCE_ANCHORS * 3;
    const MAX_VOICES = 48;   // dense sections stack far more; the loudest ones define the curve
    const OVERLAY_MS = 32;   // recompute the overlay at ~30 fps, redraw the cached curve every frame
    const MIN_GAIN_DB = 0.1; // a band this flat can't be seen anyway
    const FRAME_MS = 24;     // cap the whole scope at ~40 fps — a 144 Hz monitor gains nothing here
    const CAL_START = -12;   // initial guess for the level offset before the first fit

    // Drawing competes with audio for the main thread, so the scope goes quiet
    // whenever it can't be seen (scrolled away, background tab) and can be
    // switched off by clicking it.
    let paused = $state(false);

    // One peaking band (RBJ), normalized to a0 = 1: [b0, b1, b2, a1, a2].
    const BAND_C = 5; // coefficients stored per band

    function bandCoefs(out: Float64Array, o: number, f0: number, q: number, gainDb: number, fs: number): void {
        const w0 = 2 * Math.PI * Math.min(f0, fs * 0.49) / fs;
        const A = Math.pow(10, gainDb / 40);
        const alpha = Math.sin(w0) / (2 * Math.max(0.1, q));
        const c = -2 * Math.cos(w0);
        const a0 = 1 + alpha / A;
        out[o] = (1 + alpha * A) / a0;
        out[o + 1] = c / a0;
        out[o + 2] = (1 - alpha * A) / a0;
        out[o + 3] = c / a0;
        out[o + 4] = (1 - alpha / A) / a0;
    }

    /* ∏H(e^jw) − 1 of the first `nPre` bands — the voice's actual response,
     * dry copy included (see the note above) — times the plain |H| of the
     * remaining ones. Those are the formants: they sit downstream of the
     * cancellation, so they colour what is left instead of creating a band out
     * of raw noise. Each band's complex response is evaluated before multiplying
     * it into the chain, which keeps low-frequency values numerically stable. */
    function chainResponse(t: Float64Array, nPre: number, n: number,
        cw: number, sw: number, c2w: number, s2w: number,
        out: Float64Array): void {
        let real = 1, imaginary = 0;
        for (let k = 0, o = 0; k < nPre; k++, o += BAND_C) {
            const b1 = t[o + 1], b2 = t[o + 2], a1 = t[o + 3], a2 = t[o + 4];
            const br = t[o] + b1 * cw + b2 * c2w, bi = -(b1 * sw + b2 * s2w);
            const ar = 1 + a1 * cw + a2 * c2w, ai = -(a1 * sw + a2 * s2w);
            const denominator = Math.max(1e-30, ar * ar + ai * ai);
            const filterReal = (br * ar + bi * ai) / denominator;
            const filterImaginary = (bi * ar - br * ai) / denominator;
            const nextReal = real * filterReal - imaginary * filterImaginary;
            imaginary = real * filterImaginary + imaginary * filterReal;
            real = nextReal;
        }
        real -= 1;
        for (let k = nPre, o = nPre * BAND_C; k < n; k++, o += BAND_C) {
            const b1 = t[o + 1], b2 = t[o + 2], a1 = t[o + 3], a2 = t[o + 4];
            const br = t[o] + b1 * cw + b2 * c2w, bi = -(b1 * sw + b2 * s2w);
            const ar = 1 + a1 * cw + a2 * c2w, ai = -(a1 * sw + a2 * s2w);
            const denominator = Math.max(1e-30, ar * ar + ai * ai);
            const postReal = (br * ar + bi * ai) / denominator;
            const postImaginary = (bi * ar - br * ai) / denominator;
            const nextReal = real * postReal - imaginary * postImaginary;
            imaginary = real * postImaginary + imaginary * postReal;
            real = nextReal;
        }
        out[0] = Number.isFinite(real) ? real : 0;
        out[1] = Number.isFinite(imaginary) ? imaginary : 0;
    }

    // The master tilt: a low shelf and a high shelf across the whole mix (RBJ),
    // in the same six-term form so it can ride the same cos tables.
    function shelfTerms(out: Float64Array, o: number, f0: number, gainDb: number, high: boolean, fs: number): void {
        const w0 = 2 * Math.PI * Math.min(f0, fs * 0.49) / fs;
        const A = Math.pow(10, gainDb / 40);
        const cw = Math.cos(w0);
        const alpha = Math.sin(w0) / 2 * Math.sqrt(2); // S = 1 (browser default shelf slope)
        const s = 2 * Math.sqrt(A) * alpha;
        const g = high ? 1 : -1; // the two shelves differ only in these signs
        const b0 = A * ((A + 1) + g * (A - 1) * cw + s);
        const b1 = -2 * g * A * ((A - 1) + g * (A + 1) * cw);
        const b2 = A * ((A + 1) + g * (A - 1) * cw - s);
        const a0 = (A + 1) - g * (A - 1) * cw + s;
        const a1 = 2 * g * ((A - 1) - g * (A + 1) * cw);
        const a2 = (A + 1) - g * (A - 1) * cw - s;
        out[o] = b0 * b0 + b1 * b1 + b2 * b2;
        out[o + 1] = 2 * (b0 * b1 + b1 * b2);
        out[o + 2] = 2 * b0 * b2;
        out[o + 3] = a0 * a0 + a1 * a1 + a2 * a2;
        out[o + 4] = 2 * (a0 * a1 + a1 * a2);
        out[o + 5] = 2 * a0 * a2;
    }

    const termsAt = (t: Float64Array, o: number, cw: number, c2w: number): number =>
        (t[o] + t[o + 1] * cw + t[o + 2] * c2w) / (t[o + 3] + t[o + 4] * cw + t[o + 5] * c2w);

    interface Chain {
        inst: string;
        env: number;
        level: number;
        bands: VoiceBand[];
        terms: Float64Array;
        nPre: number; // bands taking part in the cancellation, stored first
        n: number;
    }

    interface Dot {
        x: number;
        y: number;
        color: string;
        alpha: number;
    }

    onMount(() => {
        const scopeCanvas = canvas;
        if (!scopeCanvas) {
            return;
        }
        const g2d = scopeCanvas.getContext('2d');
        if (!g2d) {
            return;
        }
        let raf: number;
        let onScreen = true, lastFrame = 0;
        const io = new IntersectionObserver(es => onScreen = es[0].isIntersecting);
        io.observe(scopeCanvas);
        let fft: Uint8Array<ArrayBuffer> | null = null;              // FFT scratch, allocated once
        // Per-sample tables include the regular grid and exact live resonance centers.
        const freqT = new Float64Array(CURVE_CAPACITY);
        const cwT = new Float64Array(CURVE_CAPACITY), c2wT = new Float64Array(CURVE_CAPACITY);
        const swT = new Float64Array(CURVE_CAPACITY), s2wT = new Float64Array(CURVE_CAPACITY);
        const pinkT = new Float64Array(CURVE_CAPACITY); // exact pink-source power response
        const binT = new Int32Array(CURVE_CAPACITY);    // matching analyser bin (for the level fit)
        // cached overlay geometry, redrawn every frame but recomputed at OVERLAY_MS
        const curveY = new Float32Array(CURVE_CAPACITY);
        const curveDb = new Float64Array(CURVE_CAPACITY); // uncalibrated prediction, dB
        const response = new Float64Array(2);              // one complex response, reused for every chain
        let curveOk = false, curvePoints = 0, lastOverlay = 0;
        const dots: Dot[] = [];
        let cal = CAL_START;                            // fitted level offset (dB)
        const tilt = new Float64Array(12);              // two shelves = 2 x 6 terms
        // reused per-voice scratch so a frame allocates nothing
        const chains: Chain[] = [];
        for (let i = 0; i < MAX_VOICES; i++) {
            chains.push({
                inst: '',
                env: 0,
                level: 0,
                bands: [],
                terms: new Float64Array(BAND_C * 24),
                nPre: 0,
                n: 0
            });
        }

        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            // idle unless the scope is actually on screen, and never faster
            // than FRAME_MS — every frame here is time the audio thread doesn't get
            if (paused || !onScreen || document.hidden) {
                return;
            }
            if (now - lastFrame < FRAME_MS) {
                return;
            }
            lastFrame = now;
            const W = scopeCanvas.width, H = scopeCanvas.height;
            g2d.fillStyle = '#0a0a14';
            g2d.fillRect(0, 0, W, H);
            const analyser = getAnalyser();
            if (!analyser) {
                return;
            }
            if (!fft || fft.length !== analyser.frequencyBinCount) {
                fft = new Uint8Array(analyser.frequencyBinCount);
            }
            analyser.getByteFrequencyData(fft);
            const bars = 320, bw = W / bars;
            for (let i = 0; i < bars; i++) {
                const idx = Math.round(Math.pow(i / bars, 2) * fft.length * 0.5); // log-ish scale
                const h = (fft[idx] / 255) * H;
                g2d.fillStyle = `hsl(${340 - (h / H) * 120}, 80%, 55%)`;
                g2d.fillRect(i * bw, H - h, bw - 1, h);
            }

            /* ---- predicted output spectrum of the sounding voices + dots ---- */
            const fs = audioSampleRate();
            const nyq = fs / 2;
            // the analyser's own scale — the bars are (byte/255)·H, and the byte
            // is minDecibels..maxDecibels mapped onto 0..255, so this puts the
            // curve in exactly the same coordinate system as the bars
            const dbMin = analyser.minDecibels, dbSpan = Math.max(1, analyser.maxDecibels - dbMin);
            // frequency mapping matches the FFT bars: f(x) = (x/W)^2 * nyq/2
            const fToX = (f: number) => W * Math.sqrt(2 * f / nyq);
            const dbToY = (db: number) => H - Math.max(0, Math.min(1, (db - dbMin) / dbSpan)) * H;

            if (now - lastOverlay >= OVERLAY_MS) {
                lastOverlay = now;
                curveOk = false;
                dots.length = 0;
                let voices = activeVoiceBands();
                if (voices.length) {
                    if (voices.length > MAX_VOICES) { // keep the loudest — they shape the curve
                        voices = voices.slice()
                            .sort((a, b) => b.env * b.level - a.env * a.level)
                            .slice(0, MAX_VOICES);
                    }
                    const anchors: FrequencyAnchor[] = [];
                    for (const voice of voices) {
                        for (const band of voice.bands) {
                            if (band.q < 8 || band.freq > nyq * 0.5) {
                                continue;
                            }
                            anchors.push({frequency: band.freq, q: band.q});
                            if (anchors.length >= MAX_RESONANCE_ANCHORS) {
                                break;
                            }
                        }
                        if (anchors.length >= MAX_RESONANCE_ANCHORS) {
                            break;
                        }
                    }
                    const frequencies = quadraticFrequencySamples(CURVE_PTS, nyq * 0.5, 1, anchors);
                    curvePoints = Math.min(frequencies.length, CURVE_CAPACITY);
                    for (let i = 0; i < curvePoints; i++) {
                        const f = frequencies[i];
                        const w = Math.PI * f / nyq;
                        freqT[i] = f;
                        cwT[i] = Math.cos(w);
                        swT[i] = Math.sin(w);
                        c2wT[i] = Math.cos(2 * w);
                        s2wT[i] = Math.sin(2 * w);
                        pinkT[i] = pinkNoisePower(f, fs);
                        binT[i] = Math.min(fft.length - 1, Math.round(f / nyq * fft.length));
                    }
                    const ms = masterState();
                    const gMaster = ms.vol * ms.vol;
                    shelfTerms(tilt, 0, 500, -ms.tilt, false, fs);
                    shelfTerms(tilt, 6, 2000, ms.tilt, true, fs);
                    let nv = 0;
                    for (const v of voices) {
                        const ch = chains[nv];
                        ch.inst = v.inst;
                        ch.env = v.env;
                        ch.level = v.level;
                        ch.bands = v.bands;
                        // cancelled bands first, the post-cancellation ones
                        // (formants) after them — see `chainRel`
                        let n = 0;
                        for (const post of [false, true]) {
                            for (const b of v.bands) {
                                if (!!b.post !== post) {
                                    continue;
                                }
                                if (Math.abs(b.gain) < MIN_GAIN_DB || (n + 1) * BAND_C > ch.terms.length) {
                                    continue;
                                }
                                bandCoefs(ch.terms, n * BAND_C, b.freq, b.q, b.gain, fs);
                                n++;
                            }
                            if (!post) {
                                ch.nPre = n;
                            }
                        }
                        ch.n = n;
                        nv++;
                    }
                    /* The stereo pink buffer has independent channels and ranks
                     * are spread through the stereo field. Summing their complex
                     * responses as one scalar creates nulls which the analyser
                     * cannot have after that routing, so it reads rank power. */
                    const spectrumPower = (cw: number, sw: number, c2w: number, s2w: number): number => {
                        let power = 0;
                        for (let j = 0; j < nv; j++) {
                            const ch = chains[j];
                            chainResponse(ch.terms, ch.nPre, ch.n, cw, sw, c2w, s2w, response);
                            const level = ch.level * ch.env;
                            power += level * level * (response[0] * response[0] + response[1] * response[1]);
                        }
                        return power;
                    };
                    let peakDb = -Infinity;
                    for (let i = 0; i < curvePoints; i++) {
                        const cw = cwT[i], sw = swT[i], c2w = c2wT[i], s2w = s2wT[i];
                        let pow = spectrumPower(cw, sw, c2w, s2w);
                        pow *= pinkT[i] * gMaster * termsAt(tilt, 0, cw, c2w) * termsAt(tilt, 6, cw, c2w);
                        const db = 10 * Math.log10(Math.max(1e-12, pow));
                        curveDb[i] = db;
                        if (db > peakDb) {
                            peakDb = db;
                        }
                    }
                    /* Fit the one unknown — the overall level — against the
                     * measurement, but only near the predicted peaks: that is
                     * where the model is trustworthy, while the valleys are
                     * dominated by the reverb tail and by neighbouring voices
                     * the cap dropped. */
                    let fitSum = 0, fitN = 0;
                    for (let i = 0; i < curvePoints; i++) {
                        const meas = fft[binT[i]];
                        if (meas > 24 && curveDb[i] > peakDb - 24) {
                            fitSum += (dbMin + (meas / 255) * dbSpan) - curveDb[i];
                            fitN++;
                        }
                    }
                    if (fitN > 8) {
                        cal = Math.max(-80, Math.min(60, fitSum / fitN));
                    }
                    for (let i = 0; i < curvePoints; i++) {
                        curveY[i] = dbToY(curveDb[i] + cal);
                    }
                    curveOk = nv > 0;
                    // Dots use the exact curve calculation at their resonance center.
                    for (let j = 0; j < nv; j++) {
                        const ch = chains[j];
                        const color = instColors.get(ch.inst) || '#ffffff';
                        const alpha = 0.35 + 0.65 * Math.min(1, ch.env); // fade out with the release tail
                        for (const b of ch.bands) {
                            const x = fToX(b.freq);
                            if (x < 0 || x > W) {
                                continue;
                            }
                            const f = Math.max(1, b.freq);
                            const w = Math.PI * f / nyq;
                            const cw = Math.cos(w), sw = Math.sin(w), c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
                            const pow = spectrumPower(cw, sw, c2w, s2w) * pinkNoisePower(f, fs) * gMaster
                                * termsAt(tilt, 0, cw, c2w) * termsAt(tilt, 6, cw, c2w);
                            dots.push({x, y: dbToY(10 * Math.log10(Math.max(1e-12, pow)) + cal), color, alpha});
                        }
                    }
                }
            }

            /* Load readout: how many audio nodes the engine is running right
             * now, against the budget from the toolbar's `Nodes` slider. Orange
             * means the governor has engaged — that section is asking too much
             * of the audio thread, and new voices are being thinned out. */
            const load = engineLoad();
            g2d.font = '15px monospace';
            g2d.fillStyle = load.nodes > load.budget * 0.85 ? '#ff7a00' : '#ffffff';
            g2d.fillText(`${load.voices} voices · ${load.nodes} / ${load.budget} nodes · ${load.pooled} pooled`, 8, 19);

            if (!curveOk) {
                return;
            }
            g2d.beginPath();
            for (let i = 0; i < curvePoints; i++) {
                const x = fToX(freqT[i]), y = curveY[i];
                if (i === 0) {
                    g2d.moveTo(x, y);
                } else {
                    g2d.lineTo(x, y);
                }
            }
            g2d.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            g2d.lineWidth = 1.5;
            g2d.stroke();
            g2d.strokeStyle = '#0a0a14';
            g2d.lineWidth = 1;
            for (const d of dots) {
                g2d.globalAlpha = d.alpha;
                g2d.beginPath();
                g2d.arc(d.x, d.y, 3, 0, Math.PI * 2);
                g2d.fillStyle = d.color;
                g2d.fill();
                g2d.stroke();
            }
            g2d.globalAlpha = 1;
        };
        raf = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(raf);
            io.disconnect();
        };
    });
</script>

<div class="scope-wrap">
    <canvas
            bind:this={canvas}
            height="100"
            onclick={() => paused = !paused}
            title="Combined live spectrum — dots mark every sounding voice. Click to pause/resume the analyser"
            width="1280"></canvas>
    {#if paused}
        <div class="scope-off">analyser paused — click to resume</div>
    {/if}
</div>

<style>
    .scope-wrap {
        position: relative;
    }

    .scope-wrap canvas {
        cursor: pointer;
        display: block;
    }

    .scope-off {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        letter-spacing: .08em;
        color: var(--color-text-subtle);
        background: var(--color-canvas-deep);
        pointer-events: none;
    }

    canvas {
        width: 100%;
        height: 100px;
        background: var(--color-canvas);
        border-radius: 2px;
        display: block;
    }
</style>
