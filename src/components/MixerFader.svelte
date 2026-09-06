<script lang="ts">
    interface Props {
        name: string;
        value: number;
        max?: number;
        peaks: number[];
        onchange: (value: number) => void;
    }

    // eslint-disable-next-line prefer-const
    let {name, value, max = 2, peaks, onchange}: Props = $props();

    function level(value: number): string {
        return value > 0 ? (20 * Math.log10(value)).toFixed(1) : '−∞';
    }

    function change(input: HTMLInputElement) {
        if (Number.isFinite(input.valueAsNumber)) {
            onchange(Math.max(0, Math.min(max, input.valueAsNumber)));
        }
    }
</script>

<div class="fader">
    <div class="travel">
        <input
                aria-label={`${name} fader`}
                aria-orientation="vertical"
                aria-valuetext={`${level(value)} dB`}
                {max}
                min="0"
                oninput={e => change(e.currentTarget)}
                step="0.01"
                type="range"
                {value}>
        <div class="meters">
            {#each peaks as peak, i (i)}
                {@const decibels = peak > 0 ? 20 * Math.log10(peak) : -60}
                <div
                        class="meter"
                        class:overload={peak > 1}
                        aria-label={peaks.length === 2 ? `${name} ${i === 0 ? 'L' : 'R'} peak` : `${name} peak`}
                        aria-valuemax="6"
                        aria-valuemin="-60"
                        aria-valuenow={Math.max(-60, Math.min(6, decibels))}
                        aria-valuetext={`${level(peak)} dBFS`}
                        role="meter"
                        title={`${level(peak)} dBFS`}>
                    <span style:height={`${Math.max(0, Math.min(100, (decibels + 60) / 66 * 100))}%`}></span>
                </div>
            {/each}
        </div>
    </div>
    <output>{level(value)} <span>dB</span></output>
</div>

<style>
    .fader {
        display: grid;
        justify-items: center;
        gap: 10px;
    }

    .travel {
        display: flex;
        align-items: stretch;
        justify-content: center;
        gap: 8px;
        height: 160px;
    }

    input[type=range] {
        writing-mode: vertical-lr;
        direction: rtl;
        width: 28px;
        height: 100%;
        margin: 0;
        padding: 0;
        accent-color: var(--strip-color, var(--accent));
        cursor: ns-resize;
    }

    .meters {
        display: flex;
        gap: 3px;
        padding-block: 7px;
    }

    .meter {
        position: relative;
        width: 5px;
        background: var(--color-surface-input);
        border-radius: 2px;
        overflow: hidden;
    }

    .meter span {
        position: absolute;
        bottom: 0;
        width: 100%;
        background: var(--accent2);
    }

    .meter.overload span {
        background: var(--color-error);
    }

    output {
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text);
    }

    output span {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 3px;
    }
</style>