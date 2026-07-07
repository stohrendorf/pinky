<script lang="ts">
    import type {
        InstrumentParams
    } from '../lib/types';

    import {
        audioSampleRate
    } from '../lib/engine';
    import {
        filterResponseCurve
    } from '../lib/filter-response';

    interface Props {
        params: InstrumentParams;
        note?: string;
    }

    const { params, note = 'C4' }: Props = $props();

    const WIDTH = 720;
    const HEIGHT = 120;
    const PAD_X = 8;
    const PAD_Y = 8;
    const RESPONSE_POINTS = 360;

    const db = (magnitude: number): number => 20 * Math.log10(Math.max(1e-6, magnitude));
    const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
    const formatFrequency = (frequency: number): string => frequency >= 1000
        ? `${Math.round(frequency / 100) / 10} kHz`
        : `${Math.round(frequency)} Hz`;

    const response = $derived(filterResponseCurve(params, note, RESPONSE_POINTS, audioSampleRate()));
    const minFrequency = $derived(response[0]?.frequency || 1);
    const maxFrequency = $derived(response[response.length - 1]?.frequency || 1);
    const frequencyRange = $derived(Math.max(1, Math.log(maxFrequency / minFrequency)));
    const frequencyX = $derived((frequency: number) => PAD_X + (WIDTH - PAD_X * 2)
        * clamp(Math.log(frequency / minFrequency) / frequencyRange, 0, 1));
    const responseDb = $derived(response.map(point => db(point.magnitude)));
    const minDb = $derived(Math.min(...responseDb));
    const maxDb = $derived(Math.max(...responseDb));
    const dbRange = $derived(Math.max(1, maxDb - minDb));
    const yForDb = $derived((value: number) => HEIGHT - PAD_Y
        - clamp((value - minDb) / dbRange, 0, 1) * (HEIGHT - PAD_Y * 2));
    const path = $derived(response.map(point => {
        const x = frequencyX(point.frequency);
        const y = yForDb(db(point.magnitude));
        return `${point === response[0] ? 'M' : 'L'} ${x} ${y}`;
    }).join(' '));
</script>

<section class="filter-preview" aria-label="Filter response preview">
    <div class="filter-preview-header">
        <span>Filter curve</span>
        <strong>{note}</strong>
    </div>
    <svg
aria-label={`Filter curve for ${note}`}
preserveAspectRatio="none"
role="img"
         viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <line
class="grid"
x1={PAD_X}
x2={WIDTH - PAD_X}
y1={HEIGHT / 4}
y2={HEIGHT / 4}/>
        <line
class="grid"
x1={PAD_X}
x2={WIDTH - PAD_X}
y1={HEIGHT / 2}
y2={HEIGHT / 2}/>
        <line
class="grid"
x1={PAD_X}
x2={WIDTH - PAD_X}
y1={HEIGHT * 3 / 4}
y2={HEIGHT * 3 / 4}/>
        <path class="response" d={path}/>
        <text x={PAD_X} y={HEIGHT - 2}>20 Hz</text>
        <text text-anchor="middle" x={frequencyX(1000)} y={HEIGHT - 2}>1 kHz</text>
        <text text-anchor="end" x={WIDTH - PAD_X} y={HEIGHT - 2}>{formatFrequency(maxFrequency)}</text>
    </svg>
</section>

<style>
    .filter-preview {
        margin-top: 8px;
        padding: 8px 0 0;
        border-top: 1px solid var(--border);
    }

    .filter-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 5px;
        color: var(--accent2);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
    }

    .filter-preview-header strong {
        color: var(--primary-text);
    }

    svg {
        display: block;
        width: 100%;
        height: 104px;
        background: var(--color-surface-input);
        border-radius: 4px;
    }

    .grid {
        stroke: #292940;
        stroke-width: 1;
    }

    .response {
        fill: none;
        stroke: var(--accent);
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
    }


    text {
        fill: #777795;
        font-size: 9px;
    }
</style>