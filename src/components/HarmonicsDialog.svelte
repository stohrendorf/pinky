<script lang="ts">
    import type { HarmonicsGen } from '../lib/instruments';
    import type { InstrumentParams } from '../lib/types';

    /* Harmonics generator — creates the initial partial set of an instrument
     * from a timbre shape + count + falloff + stretch. The four values are
     * remembered on the instrument, so re-opening the dialog shows whatever
     * was entered last for it. */
    import {
        findShape,
        genPartials,
        genSettings,
        MAX_PARTIALS,
        PARTIAL_SHAPES,
    } from '../lib/instruments';
    import Slider from './Slider.svelte';
    import Button from './ui/Button.svelte';
    import Dialog from './ui/Dialog.svelte';

    interface Props {
        show?: boolean;
        params: InstrumentParams;
        onapply?: () => void;
    }

    let { show = $bindable(false), params = $bindable(), onapply = () => {} }: Props = $props();

    let gen: HarmonicsGen = $state(genSettings(params));
    let wasOpen = $state(false);

    // (re-)read the remembered settings whenever the dialog opens
    $effect.pre(() => {
        if (show !== wasOpen) {
            wasOpen = show;
            if (show) {
                gen = genSettings(params);
            }
        }
    });

    const shape = $derived(findShape(gen.shape));
    const maxCount = $derived(Math.min(MAX_PARTIALS, shape.max));
    const preview = $derived(genPartials(gen));

    function pickShape(name: string) {
        gen = { ...gen, shape: name, count: Math.min(gen.count, findShape(name).max) };
    }

    function apply() {
        params.harmShape = gen.shape;
        params.harm = Math.min(gen.count, maxCount);
        params.falloff = gen.falloff;
        params.stretch = gen.stretch;
        params.partials = preview;
        show = false;
        onapply();
    }
</script>

<Dialog title="Generate Harmonics" width="420px" bind:show>
    <div class="body">
        <label class="field">
            <span>Timbre Shape</span>
            <select
                onchange={e => pickShape((e.target as HTMLSelectElement).value)}
                value={gen.shape}
            >
                {#each PARTIAL_SHAPES as s (s.name)}
                    <option value={s.name}>{s.name}</option>
                {/each}
            </select>
        </label>
        <Slider
            label="Partials"
            max={maxCount}
            min={1}
            onchange={v => (gen = { ...gen, count: v })}
            step={1}
            value={Math.min(gen.count, maxCount)}
        />
        <Slider
            label="Falloff Strength"
            max={1}
            min={0.3}
            onchange={v => (gen = { ...gen, falloff: v })}
            step={0.01}
            value={gen.falloff}
        />
        <Slider
            label="Harmonic Stretch"
            max={0.8}
            min={-0.3}
            onchange={v => (gen = { ...gen, stretch: v })}
            step={0.01}
            value={gen.stretch}
        />

        <div class="preview">
            <div style="--n: {preview.length}" class="bars">
                {#each preview as p, i (i)}
                    <div class="col" title="partial {i + 1}: ×{p.ratio}, level {p.level}">
                        <div style="height: {p.level * 100}%" class="bar"></div>
                    </div>
                {/each}
            </div>
            <div class="ratios">{preview.map(p => p.ratio).join('  ')}</div>
        </div>

        <div class="note">
            Generating replaces the current profile of this instrument. Afterwards every partial can
            still be dragged by hand — 1 2 3 4 6 8 at comparable levels is an organ registration, 1
            3 5 7 a clarinet, stretched ratios a bell.
        </div>

        <div class="actions">
            <Button onclick={() => (show = false)} variant="secondary">Cancel</Button>
            <Button onclick={apply}><i class="fa fa-wand-magic-sparkles"></i> Generate</Button>
        </div>
    </div>
</Dialog>

<style>
    .body {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .field {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        color: var(--secondary-text);
    }

    .field select {
        background: var(--border);
        color: var(--primary-text);
        border: none;
        border-radius: 6px;
        padding: 6px;
        font-size: 12px;
        flex: 1;
    }

    .preview {
        margin-top: 4px;
    }

    .bars {
        display: grid;
        grid-template-columns: repeat(var(--n), 1fr);
        gap: 3px;
        height: 70px;
        padding: 4px;
        background: var(--border);
        border-radius: 6px;
    }

    .col {
        display: flex;
        align-items: flex-end;
        background: rgba(0, 0, 0, 0.25);
        border-radius: 3px;
        overflow: hidden;
    }

    .bar {
        width: 100%;
        min-height: 1px;
        background: linear-gradient(to top, var(--accent), var(--accent2));
    }

    .ratios {
        font-size: 10px;
        opacity: 0.5;
        text-align: center;
        margin-top: 3px;
    }

    .note {
        font-size: 11px;
        opacity: 0.5;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
    }
</style>
