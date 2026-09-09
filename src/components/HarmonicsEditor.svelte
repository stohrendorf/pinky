<script lang="ts">
    import type { InstrumentParams, PartialSpec } from '../lib/types';

    /* Harmonics editor — the harmonic profile of an instrument, always visible.
     * Every partial has its own ratio (× fundamental) and level, which is what
     * actually defines a timbre: organ registration (1 2 3 4 6 8, no 5th),
     * odd-only (clarinet), inharmonic (bell). The initial set of values comes
     * from the "Generate" dialog; everything here is free hand-editing. */
    import { clampPartialLevel, ensurePartials, MAX_PARTIALS } from '../lib/instruments';
    import { preventDefault } from './event-modifiers';
    import HarmonicsDialog from './HarmonicsDialog.svelte';
    import Button from './ui/Button.svelte';

    interface Props {
        params: InstrumentParams;
        onchange?: () => void;
    }

    let { params = $bindable(), onchange = () => {} }: Props = $props();

    let showGen = $state(false);
    let list: PartialSpec[] = $state([]);
    let bound: InstrumentParams | null = $state(null);
    let source: PartialSpec[] | undefined = $state(); // the array currently mirrored in `list`

    function read(p: InstrumentParams) {
        bound = p;
        source = ensurePartials(p).partials;
        list = (source as PartialSpec[]).map(x => ({ ...x }));
    }

    function set(next: PartialSpec[]) {
        list = next;
        source = next;
        params.partials = next;
        onchange();
    }

    function addPartial() {
        if (list.length >= MAX_PARTIALS) {
            return;
        }
        const last = list[list.length - 1];
        set([...list, { ratio: Math.round(last.ratio) + 1, level: 0.5 }]);
    }

    function removePartial() {
        if (list.length <= 1) {
            return;
        }
        set(list.slice(0, -1));
    }

    function normalize() {
        const top = Math.max(...list.map(p => p.level));
        if (top <= 0) {
            return;
        }
        set(list.map(p => ({ ...p, level: Math.round((p.level / top) * 100) / 100 })));
    }

    function setLevel(i: number, level: number) {
        if (!Number.isFinite(level)) {
            return;
        }
        const next = [...list];
        next[i] = { ...next[i], level: clampPartialLevel(level) };
        set(next);
    }

    function setRatio(i: number, ratio: number) {
        if (!isFinite(ratio)) {
            return;
        }
        const next = [...list];
        next[i] = {
            ...next[i],
            ratio: Math.max(0.1, Math.min(24, Math.round(ratio * 1000) / 1000)),
        };
        set(next);
    }

    /* drag across the bars like drawbars / a tracker volume column */
    let dragging = $state(false);

    function indexAt(e: MouseEvent): number {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const n = Math.max(1, list.length);
        return Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / (r.width / n))));
    }

    function paint(e: MouseEvent) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setLevel(indexAt(e), 1 - (e.clientY - r.top) / r.height);
    }

    function down(e: PointerEvent) {
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        paint(e);
    }

    function move(e: PointerEvent) {
        if (dragging) {
            paint(e);
        }
    }

    const mute = (e: Event) => setLevel(indexAt(e as MouseEvent), 0); // right-click = partial off
    // re-read when another instrument is selected, a preset is applied or the
    // generator dialog replaced the profile
    $effect.pre(() => {
        if (params !== bound || params.partials !== source) {
            read(params);
        }
    });
</script>

<div class="group harm">
    <h4>
        Harmonics
        <span class="badge">{list.length} partials</span>
    </h4>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="--n: {list.length}"
        class="bars"
        oncontextmenu={preventDefault(mute)}
        onpointercancel={() => (dragging = false)}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={() => (dragging = false)}
    >
        {#each list as p, i (i)}
            <div class="col" title="partial {i + 1}: ×{p.ratio}, level {p.level}">
                <div class="drawbar-track">
                    <div style="height: {p.level * 100}%" class="drawbar-fill">
                        <span class="drawbar-cap" aria-hidden="true"></span>
                    </div>
                </div>
            </div>
        {/each}
    </div>
    <div style="--n: {list.length}" class="ratios">
        {#each list as p, i (i)}
            <div class="cell">
                <input
                    class="level-input"
                    aria-label="level of partial {i + 1} (0 to 1)"
                    max="1"
                    min="0"
                    onchange={e => setLevel(i, parseFloat((e.target as HTMLInputElement).value))}
                    step="0.01"
                    title="level of partial {i + 1} (0 to 1)"
                    type="number"
                    value={p.level}
                />
                <input
                    class="ratio-input"
                    aria-label="frequency ratio of partial {i + 1}"
                    max="24"
                    min="0.1"
                    onchange={e => setRatio(i, parseFloat((e.target as HTMLInputElement).value))}
                    step="0.001"
                    title="frequency ratio of partial {i + 1} (× the note)"
                    type="number"
                    value={p.ratio}
                />
            </div>
        {/each}
    </div>

    <div class="row">
        <Button
            onclick={() => (showGen = true)}
            title="Generate a new profile from a timbre shape, partial count, falloff and stretch"
            variant="secondary"
        >
            <i class="fa fa-wand-magic-sparkles"></i> Generate…
        </Button>
        <Button onclick={normalize} title="Scale the loudest partial to 1" variant="secondary"
            ><i class="fa fa-maximize"></i> Normalize
        </Button>
        <Button
            disabled={list.length <= 1}
            onclick={removePartial}
            title="Remove last partial"
            variant="secondary"><i class="fa fa-minus"></i></Button
        >
        <Button
            disabled={list.length >= MAX_PARTIALS}
            onclick={addPartial}
            title="Add partial"
            variant="secondary"><i class="fa fa-plus"></i></Button
        >
    </div>
    <div class="note">
        Drag across the bars to draw each partial's level, right-click one to switch it off. The
        number under a bar is its frequency ratio (× the played note) — that ratio set is what makes
        an organ an organ and a bell a bell.
    </div>
</div>

<HarmonicsDialog
    onapply={() => {
        read(params);
        onchange();
    }}
    {params}
    bind:show={showGen}
/>

<style>
    .harm {
        grid-column: 1 / -1;
    }

    .harm h4 {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .badge {
        color: var(--color-text-subtle);
        font-size: 9px;
        font-weight: 500;
        letter-spacing: 0.08em;
    }

    .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 6px 0;
    }

    .bars {
        display: grid;
        grid-template-columns: repeat(var(--n), 1fr);
        gap: 10px;
        height: 148px;
        padding: 10px 14px 8px;
        border: 1px solid var(--color-border-subtle);
        background: var(--color-canvas);
        touch-action: none;
        cursor: crosshair;
    }

    .col {
        display: flex;
        min-width: 0;
    }

    .drawbar-track {
        display: flex;
        position: relative;
        flex: 1;
        align-items: flex-end;
        min-width: 0;
        background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.02),
            rgba(255, 255, 255, 0.055),
            rgba(255, 255, 255, 0.02)
        );
    }

    .drawbar-fill {
        position: relative;
        width: 100%;
        min-height: 1px;
        background: linear-gradient(to top, #8d4249, var(--color-accent));
        opacity: 0.9;
    }

    .drawbar-cap {
        position: absolute;
        top: -2px;
        right: -3px;
        left: -3px;
        height: 4px;
        background: var(--color-playhead);
        box-shadow: 0 1px 5px rgba(255, 244, 244, 0.24);
    }

    .ratios {
        display: grid;
        grid-template-columns: repeat(var(--n), 1fr);
        gap: 10px;
        padding: 0 14px;
        margin-top: 5px;
    }

    .cell {
        text-align: center;
    }

    .level-input {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .ratio-input {
        width: 100%;
        min-width: 0;
        padding: 1px 2px;
        border: 0;
        background: transparent;
        color: var(--color-text-subtle);
        font: inherit;
        font-size: 10px;
        text-align: center;
        appearance: textfield;
        -moz-appearance: textfield;
    }

    .ratio-input:focus {
        color: var(--color-playhead);
        outline: 1px solid var(--color-accent);
        outline-offset: 2px;
    }

    .cell input::-webkit-outer-spin-button,
    .cell input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .note {
        font-size: 11px;
        opacity: 0.5;
    }
</style>
