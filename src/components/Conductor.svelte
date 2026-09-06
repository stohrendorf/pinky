<script lang="ts">
    import {
        tick
    } from 'svelte';

    import type {
        ConductorData, MeterMarker, SectionMarker, TempoMarker
    } from '../lib/timing';

    import {
        playing, project, songCursor, touch
    } from '../lib/project';
    import {
        rendering
    } from '../lib/render';
    import {
        barAt, createTimingMap, ensureConductor
    } from '../lib/timing';
    import Dialog from './ui/Dialog.svelte';

    type MarkerKind = 'tempo' | 'meter' | 'section';
    type Marker = TempoMarker | MeterMarker | SectionMarker;

    interface Props {
        cellWidth: number;
        totalLength: number;
        scrollLeft: number;
        viewportWidth: number;
    }

    const {cellWidth, totalLength, scrollLeft, viewportWidth}: Props = $props();
    // touch() publishes in-place edits; copy the marker lists to invalidate the strip and editor.
    const conductor: ConductorData = $derived(structuredClone($project?.conductor ?? {tempos: [], meters: [], sections: []}));
    const groups = $derived([
        {kind: 'section' as const, title: 'Section', markers: conductor.sections as Marker[]},
        {kind: 'tempo' as const, title: 'Tempo', markers: conductor.tempos as Marker[]},
        {kind: 'meter' as const, title: 'Time signature', markers: conductor.meters as Marker[]}
    ]);
    const points = $derived(timelineMarkers());
    const locked = $derived($playing || $rendering || !$project);
    let show = $state(false);
    let markerKind: MarkerKind = $state('section');
    let editingId: string | null = $state(null);
    let markerStep: number | undefined = $state(0);
    let tempoBpm: number | undefined = $state(120);
    let tempoCurve: TempoMarker['curve'] = $state('hold');
    let meterNumerator: number | undefined = $state(4);
    let meterDenominator: MeterMarker['denominator'] = $state(4);
    let sectionName = $state('');
    let error = $state('');
    let positionOpen = $state(false);
    let opener: HTMLElement | null = null;

    function timelineMarkers() {
        const entries = groups.flatMap(group => group.markers.map(marker => ({kind: group.kind, marker})));
        const steps = [...new Set(entries.map(entry => entry.marker.step))].sort((a, b) => a - b);
        return steps.map(step => ({step, entries: entries.filter(entry => entry.marker.step === step)}));
    }

    function positionLabel(step: number): string {
        const position = barAt($project ?? {bpm: 120}, step);
        const offset = step - position.start - (position.beat - 1) * 16 / position.denominator;
        return `Bar ${position.bar} · beat ${position.beat}${offset ? ` + ${offset} step${offset === 1 ? '' : 's'}` : ''}`;
    }

    function closeDialog() {
        show = false;
        void tick().then(() => {
            if (opener?.isConnected) {opener.focus();}
            else {document.querySelector<HTMLButtonElement>('[aria-label="Add marker at cursor"]')?.focus();}
        });
    }

    function focusEditor(node: HTMLElement) {
        const frame = requestAnimationFrame(() => node.querySelector<HTMLInputElement>('.marker-value')?.focus());
        return {destroy() {cancelAnimationFrame(frame);}};
    }

    function markerList(kind: MarkerKind): Marker[] {
        if (kind === 'tempo') {return conductor.tempos;}
        if (kind === 'meter') {return conductor.meters;}
        return conductor.sections;
    }

    function markerLabel(marker: Marker): string {
        if ('bpm' in marker) {return `${marker.bpm} BPM${marker.curve === 'linear' ? ' ↗' : ''}`;}
        if ('numerator' in marker) {return `${marker.numerator}/${marker.denominator}`;}
        return marker.name;
    }

    function openDialog() {
        if (!show) {opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;}
        show = true;
    }

    function newMarker(kind: MarkerKind = 'section', at: number = $songCursor) {
        if (!$project || $playing || $rendering) {return;}
        markerKind = kind;
        editingId = null;
        markerStep = Math.max(0, Math.min(1000000, Math.round(at)));
        tempoBpm = $project ? createTimingMap($project).bpmAt(markerStep) : 120;
        tempoCurve = 'hold';
        const meter = $project ? barAt($project, markerStep) : null;
        meterNumerator = meter?.numerator ?? 4;
        meterDenominator = (meter?.denominator ?? 4) as MeterMarker['denominator'];
        sectionName = '';
        error = '';
        positionOpen = false;
        openDialog();
    }

    function addAtPointer(event: MouseEvent) {
        const left = (event.currentTarget as HTMLElement).getBoundingClientRect().left;
        newMarker('section', (event.clientX - left) / cellWidth);
    }

    function editMarker(kind: MarkerKind, id: string) {
        if ($rendering) {return;}
        const marker = markerList(kind).find(item => item.id === id);
        if (!marker) {return;}
        markerKind = kind;
        editingId = id;
        markerStep = marker.step;
        if ('bpm' in marker) {
            tempoBpm = marker.bpm;
            tempoCurve = marker.curve;
        } else if ('numerator' in marker) {
            meterNumerator = marker.numerator;
            meterDenominator = marker.denominator;
        } else {sectionName = marker.name;}
        error = '';
        positionOpen = false;
        openDialog();
    }

    function useCursor() {
        markerStep = Math.max(0, Math.min(1000000, Math.round($songCursor)));
        error = '';
    }

    function saveMarker() {
        if (!$project || $playing || $rendering) {return;}
        error = '';
        if (typeof markerStep !== 'number' || !Number.isInteger(markerStep) || markerStep < 0 || markerStep > 1000000) {
            error = 'Step must be a whole number from 0 to 1,000,000.';
            return;
        }
        const list = markerList(markerKind);
        if (editingId && !list.some(marker => marker.id === editingId)) {
            error = 'This marker no longer exists. Choose Add marker to start again.';
            return;
        }
        if (list.some(marker => marker.step === markerStep && marker.id !== editingId)) {
            error = `A ${markerKind} marker already exists at step ${markerStep}. Edit it or choose another step.`;
            return;
        }
        if (markerKind === 'tempo' && (typeof tempoBpm !== 'number' || !Number.isFinite(tempoBpm) || tempoBpm < 30 || tempoBpm > 300
            || !['hold', 'linear'].includes(tempoCurve))) {
            error = 'Tempo must be from 30 to 300 BPM, with Hold or Linear ramp.';
            return;
        }
        if (markerKind === 'meter' && (typeof meterNumerator !== 'number' || !Number.isInteger(meterNumerator)
            || meterNumerator < 1 || meterNumerator > 32 || ![1, 2, 4, 8, 16].includes(meterDenominator))) {
            error = 'Time signature needs 1–32 beats and a denominator of 1, 2, 4, 8 or 16.';
            return;
        }
        const name = sectionName.trim();
        if (markerKind === 'section' && (!name || name.length > 80)) {
            error = 'Section name must contain 1–80 characters after trimming spaces.';
            return;
        }
        const data = ensureConductor($project);
        let id = editingId;
        if (!id) {
            do {id = crypto.randomUUID();}
            while ([...data.tempos, ...data.meters, ...data.sections].some(marker => marker.id === id));
        }
        const step = markerStep;
        if (markerKind === 'tempo') {
            data.tempos = [...data.tempos.filter(marker => marker.id !== id), {id, step, bpm: tempoBpm!, curve: tempoCurve}]
                .sort((a, b) => a.step - b.step);
        } else if (markerKind === 'meter') {
            data.meters = [...data.meters.filter(marker => marker.id !== id), {id, step, numerator: meterNumerator!, denominator: meterDenominator}]
                .sort((a, b) => a.step - b.step);
        } else {
            data.sections = [...data.sections.filter(marker => marker.id !== id), {id, step, name}].sort((a, b) => a.step - b.step);
        }
        editingId = id;
        touch();
        closeDialog();
    }

    function deleteMarker(kind: MarkerKind, id: string) {
        if (!$project || $playing || $rendering || !markerList(kind).some(marker => marker.id === id)) {return;}
        const data = ensureConductor($project);
        if (kind === 'tempo') {data.tempos = data.tempos.filter(marker => marker.id !== id);}
        else if (kind === 'meter') {data.meters = data.meters.filter(marker => marker.id !== id);}
        else {data.sections = data.sections.filter(marker => marker.id !== id);}
        if (editingId === id) {editingId = null;}
        error = '';
        touch();
        closeDialog();
    }

    function handleDialogKey(event: KeyboardEvent, dialog: HTMLElement) {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
            return;
        }
        if (event.key !== 'Tab') {return;}
        const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, [tabindex="0"]')]
            .filter(el => !el.matches(':disabled') && el.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) {
            event.preventDefault();
            dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
            event.preventDefault();
            first.focus();
        }
    }

    function dialogKeyboard(node: HTMLElement) {
        const dialog = node.closest<HTMLElement>('[role="dialog"]');
        const handleKey = (event: KeyboardEvent) => {if (dialog) {handleDialogKey(event, dialog);}};
        dialog?.addEventListener('keydown', handleKey);
        return {destroy() {dialog?.removeEventListener('keydown', handleKey);}};
    }
</script>

<div class="conductor">
    <div class="conductor-label">
        <span>Markers</span>
        <button
                aria-label="Add marker at cursor"
                disabled={locked}
                onclick={() => newMarker()}
                title={$playing ? 'Stop playback to add a marker' : 'Add marker at cursor'}
                type="button">+</button>
    </div>
    <div style="max-width: {viewportWidth}px;" class="conductor-viewport">
        <div style="width: {totalLength * cellWidth}px; transform: translateX(-{scrollLeft}px);" class="conductor-lanes">
            <button
                    class="add-at-position"
                    aria-label="Add marker here"
                    disabled={locked}
                    onclick={addAtPointer}
                    tabindex="-1"
                    title="Add marker"
                    type="button"></button>
            {#each points as point, index (point.step)}
                {#if point.step < totalLength}
                    {@const label = point.entries.map(entry => markerLabel(entry.marker)).join(' · ')}
                    <div
                            style="left: {point.step * cellWidth}px; max-width: {Math.max(1, Math.min(320, ((points[index + 1]?.step ?? totalLength) - point.step) * cellWidth - 2))}px;"
                            class="marker"
                            title={`${label} · ${positionLabel(point.step)}`}>
                        {#each point.entries as entry (entry.marker.id)}
                            <button
                                    class:timing={entry.kind !== 'section'}
                                    aria-label={`Edit ${markerLabel(entry.marker)}. ${positionLabel(point.step)}`}
                                    disabled={$rendering}
                                    onclick={() => editMarker(entry.kind, entry.marker.id)}
                                    type="button">{markerLabel(entry.marker)}</button>
                        {/each}
                    </div>
                {/if}
            {/each}
        </div>
    </div>
</div>

<Dialog title={editingId ? 'Edit marker' : 'Add marker'} width="360px" bind:show>
    {#if show}
        <div class="conductor-editor" use:dialogKeyboard use:focusEditor>
            {#if locked}<p class="notice" role="status">{$rendering ? 'Export in progress.' : 'Stop playback to edit.'}</p>{/if}
            <form novalidate onsubmit={event => {event.preventDefault(); saveMarker();}}>
                <fieldset disabled={locked}>
                    {#if !editingId}
                        <div class="marker-types" aria-label="Marker type" role="group">
                            {#each groups as group (group.kind)}
                                <button
                                        aria-pressed={markerKind === group.kind}
                                        onclick={() => {markerKind = group.kind; error = '';}}
                                        type="button">{group.title}</button>
                            {/each}
                        </div>
                    {/if}
                    {#if markerKind === 'tempo'}
                        <label>Tempo (BPM)
                            <input
                                    class="marker-value"
                                    max="300"
                                    min="30"
                                    required
                                    step="any"
                                    type="number"
                                    bind:value={tempoBpm}/>
                        </label>
                        <label class="check">
                            <input checked={tempoCurve === 'linear'} onchange={event => {tempoCurve = event.currentTarget.checked ? 'linear' : 'hold';}} type="checkbox"/>
                            Gradually change to the next tempo
                        </label>
                    {:else if markerKind === 'meter'}
                        <div class="meter-input">
                            <label>Beats per bar
                                <input
                                        class="marker-value"
                                        max="32"
                                        min="1"
                                        required
                                        step="1"
                                        type="number"
                                        bind:value={meterNumerator}/>
                            </label>
                            <span>/</span>
                            <label>Beat unit
                                <select aria-label="Beat unit" bind:value={meterDenominator}>
                                    {#each [1, 2, 4, 8, 16] as denominator (denominator)}
                                        <option value={denominator}>{denominator}</option>
                                    {/each}
                                </select>
                            </label>
                        </div>
                    {:else}
                        <label>Section name
                            <input
                                    class="marker-value"
                                    maxlength="80"
                                    placeholder="e.g. Chorus"
                                    required
                                    type="text"
                                    bind:value={sectionName}/>
                        </label>
                    {/if}
                    <details bind:open={positionOpen}>
                        <summary>{typeof markerStep === 'number' && Number.isFinite(markerStep) ? positionLabel(markerStep) : 'Position'} <span>· position</span></summary>
                        <div class="position-fields">
                            <label>Exact step (0-based)
                                <input
                                        max="1000000"
                                        min="0"
                                        required
                                        step="1"
                                        type="number"
                                        bind:value={markerStep}/>
                            </label>
                            <button onclick={useCursor} type="button">Use cursor</button>
                        </div>
                    </details>
                </fieldset>
                {#if error}<p class="error" role="alert">{error}</p>{/if}
                <div class="form-actions">
                    {#if editingId}<button class="delete" disabled={locked} onclick={() => deleteMarker(markerKind, editingId!)} type="button">Delete</button>{/if}
                    <button class="cancel" onclick={closeDialog} type="button">Cancel</button>
                    <button class="primary" disabled={locked} type="submit">{editingId ? 'Save' : 'Add'}</button>
                </div>
            </form>
        </div>
    {/if}
</Dialog>

<style>
    .conductor {display: grid; grid-template-columns: 200px minmax(0, 1fr); height: 100%; min-width: 0; background: var(--color-surface); border-bottom: 1px solid var(--border); box-sizing: border-box;}
    .conductor-label {display: flex; gap: 4px; align-items: center; min-width: 0; padding: 1px 6px; border-right: 1px solid var(--border);}
    .conductor-label span {flex: 1; font-size: 11px; color: var(--secondary-text);}
    .conductor-label button {height: 24px; width: 28px; padding: 0; font-size: 16px;}
    .conductor-viewport {overflow: hidden; min-width: 0;}
    .conductor-lanes {position: relative; height: 100%; will-change: transform;}
    button, input, select {font-family: inherit; font-size: 11px; color: var(--primary-text); background: var(--color-surface-input); border: 1px solid var(--border); border-radius: 3px; padding: 5px 8px; box-sizing: border-box;}
    button, summary {cursor: pointer;}
    button:disabled {opacity: .45; cursor: default;}
    button:hover:not(:disabled) {background: var(--color-surface-hover);}
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {outline: 2px solid var(--accent2); outline-offset: -2px;}
    .add-at-position, .add-at-position:hover:not(:disabled) {position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: transparent;}
    .marker {position: absolute; top: 2px; height: 24px; display: flex; width: max-content; border-left: 2px solid var(--accent2); overflow: hidden; background: var(--color-surface);}
    .marker:hover, .marker:focus-within {max-width: none !important; z-index: 2;}
    .marker button {min-width: 0; padding: 2px 6px; border: 0; border-radius: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;}
    .marker button + button {border-left: 1px solid var(--border-subtle);}
    .marker button.timing {color: var(--accent);}
    .conductor-editor {font-size: 12px; min-width: 0;}
    fieldset {display: grid; gap: 14px; border: 0; margin: 0; padding: 0; min-width: 0;}
    label {display: flex; flex-direction: column; gap: 6px; min-width: 0;}
    input, select {min-width: 0; width: 100%; padding: 7px;}
    .check {flex-direction: row; align-items: center; font-size: 11px;}
    .check input {width: auto; margin: 0;}
    .meter-input {display: flex; align-items: end; gap: 10px;}
    .meter-input label {flex: 1;}
    .meter-input span {padding-bottom: 8px;}
    summary {color: var(--secondary-text); font-size: 11px; line-height: 1.5;}
    summary span {color: var(--color-text-muted);}
    .position-fields {display: flex; align-items: end; gap: 8px; margin-top: 10px;}
    .position-fields label {flex: 1;}
    .position-fields button {white-space: nowrap;}
    .form-actions, .marker-types {display: flex; align-items: center; gap: 6px; flex-wrap: wrap;}
    .marker-types [aria-pressed="true"] {border-color: var(--accent2);}
    .form-actions {border-top: 1px solid var(--border); padding-top: 12px; margin-top: 16px;}
    .cancel {margin-left: auto;}
    .primary {border-color: var(--accent);}
    .delete {color: var(--accent);}
    .notice, .error {font-size: 11px; line-height: 1.5;}
    .notice {margin: 0 0 12px; color: var(--secondary-text);}
    .error {color: var(--accent);}
</style>