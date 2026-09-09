<script lang="ts">
    import { tick } from 'svelte';

    import type { MarkerPoint } from '../lib/conductor-markers';
    import type { ConductorData, TempoMarker } from '../lib/timing';
    import type { Project } from '../lib/types';

    import {
        markerPoints,
        moveMarkerAt,
        removeMarkerAt,
        updateMarkerAt,
    } from '../lib/conductor-markers';
    import { playing, project, songCursor, touch } from '../lib/project';
    import { rendering } from '../lib/render';
    import { barAt, createTimingMap } from '../lib/timing';
    import Dialog from './ui/Dialog.svelte';

    interface Props {
        cellWidth: number;
        totalLength: number;
        scrollLeft: number;
        viewportWidth: number;
    }

    const { cellWidth, totalLength, scrollLeft, viewportWidth }: Props = $props();
    // touch() publishes in-place edits; copy the marker lists to invalidate the strip and editor.
    const conductor: ConductorData = $derived(
        structuredClone(
            $project?.conductor ?? {
                tempos: [],
                meters: [],
                sections: [],
            },
        ),
    );
    const points = $derived(markerPoints(conductor));
    const locked = $derived($playing || $rendering || !$project);
    let show = $state(false);
    let editingId: string | null = $state(null);
    let markerStep = $state(0);
    let tempoBpm: number | undefined = $state(undefined);
    let tempoCurve: TempoMarker['curve'] = $state('hold');
    let signature = $state('');
    let sectionName = $state('');
    let error = $state('');
    let laneMessage = $state('');
    let selectedId = $state<string | null>(null);
    let editorProject: Project | null = null;
    let editorSnapshot = '';
    let opener: HTMLElement | null = null;
    let dragProject: Project | null = null;
    let suppressClick = false;
    let drag = $state<{
        id: string;
        pointer: number;
        x: number;
        scroll: number;
        from: number;
        to: number;
        moved: boolean;
        problem: string;
        snapshot: string;
    } | null>(null);
    const inheritedTempo = $derived(
        $project
            ? String(Math.round(createTimingMap($project).bpmAt(markerStep) * 100) / 100)
            : '120',
    );
    const inheritedMeter = $derived(barAt($project ?? { bpm: 120 }, markerStep));

    function positionLabel(step: number): string {
        const position = barAt($project ?? { bpm: 120 }, step);
        const offset = step - position.start - ((position.beat - 1) * 16) / position.denominator;
        return `Bar ${position.bar} · beat ${position.beat}${offset ? ` + ${offset} step${offset === 1 ? '' : 's'}` : ''}`;
    }

    function closeDialog() {
        show = false;
        void tick().then(() => {
            if (opener?.isConnected) {
                opener.focus();
            }
        });
    }

    function focusEditor(node: HTMLElement) {
        const frame = requestAnimationFrame(() =>
            node.querySelector<HTMLInputElement>('.marker-value')?.focus(),
        );
        return {
            destroy() {
                cancelAnimationFrame(frame);
            },
        };
    }

    function markerLabel(point: MarkerPoint): string {
        return [
            point.section?.name,
            point.tempo && `${point.tempo.bpm} BPM${point.tempo.curve === 'linear' ? ' ↗' : ''}`,
            point.meter && `${point.meter.numerator}/${point.meter.denominator}`,
        ]
            .filter(Boolean)
            .join(' · ');
    }

    function openDialog() {
        if (!show) {
            opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        show = true;
    }

    function focusMarker(id: string) {
        selectedId = id;
        void tick().then(() =>
            document.querySelector<HTMLButtonElement>(`[data-marker-id="${id}"]`)?.focus(),
        );
    }

    function boundedStep(at: number): number {
        return Math.max(0, Math.min(1000000, Math.round(at)));
    }

    function newMarker(at?: number) {
        if (!$project || $playing || $rendering) {
            return;
        }
        const step = boundedStep(at ?? $songCursor);
        const existing = points.find(point => point.step === step);
        if (existing) {
            focusMarker(existing.id);
            return;
        }
        try {
            const data = updateMarkerAt(conductor, step, {
                name: 'Marker',
                bpm: undefined,
                curve: 'hold',
                signature: '',
            });
            $project.conductor = data;
            touch();
            focusMarker(markerPoints(data).find(point => point.step === step)!.id);
            laneMessage = '';
        } catch (cause) {
            laneMessage = (cause as Error).message;
        }
    }

    function addAtPointer(event: MouseEvent) {
        const left = (event.currentTarget as HTMLElement).getBoundingClientRect().left;
        newMarker((event.clientX - left) / cellWidth);
    }

    function editMarker(id: string) {
        if ($rendering) {
            return;
        }
        const point = points.find(item => item.id === id);
        if (!point) {
            return;
        }
        editingId = id;
        selectedId = id;
        markerStep = point.step;
        tempoBpm = point.tempo?.bpm;
        tempoCurve = point.tempo?.curve ?? 'hold';
        signature = point.meter ? `${point.meter.numerator}/${point.meter.denominator}` : '';
        sectionName = point.section?.name ?? '';
        editorProject = $project;
        editorSnapshot = JSON.stringify(conductor);
        error = '';
        openDialog();
    }

    function editorIsCurrent(): boolean {
        if (
            $project !== editorProject ||
            JSON.stringify(conductor) !== editorSnapshot ||
            !points.some(point => point.id === editingId && point.step === markerStep)
        ) {
            error = 'This marker has changed. Close and reopen it to edit.';
            return false;
        }
        return true;
    }

    function saveMarker() {
        if (!$project || $playing || $rendering) {
            return;
        }
        if (!editorIsCurrent()) {
            return;
        }
        try {
            $project.conductor = updateMarkerAt(conductor, markerStep, {
                name: sectionName,
                bpm: tempoBpm,
                curve: tempoCurve,
                signature,
            });
            touch();
            closeDialog();
        } catch (cause) {
            error = (cause as Error).message;
        }
    }

    function deleteMarker() {
        if (!$project || $playing || $rendering || !editorIsCurrent()) {
            return;
        }
        $project.conductor = removeMarkerAt(conductor, markerStep);
        touch();
        closeDialog();
    }

    function movePoint(id: string, to: number) {
        if (!$project || $playing || $rendering) {
            return;
        }
        const point = points.find(item => item.id === id);
        if (!point || point.step === to) {
            return;
        }
        try {
            const data = moveMarkerAt(conductor, point.step, to);
            $project.conductor = data;
            touch();
            focusMarker(markerPoints(data).find(item => item.step === to)!.id);
            laneMessage = positionLabel(to);
        } catch (cause) {
            laneMessage = (cause as Error).message;
        }
    }

    function startDrag(event: PointerEvent, point: MarkerPoint) {
        if (event.button !== 0 || !$project || $playing || $rendering) {
            return;
        }
        event.stopPropagation();
        suppressClick = false;
        selectedId = point.id;
        laneMessage = '';
        dragProject = $project;
        drag = {
            id: point.id,
            pointer: event.pointerId,
            x: event.clientX,
            scroll: scrollLeft,
            from: point.step,
            to: point.step,
            moved: false,
            problem: '',
            snapshot: JSON.stringify(conductor),
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    function updateDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer) {
            return;
        }
        if (
            $playing ||
            $rendering ||
            $project !== dragProject ||
            JSON.stringify(conductor) !== drag.snapshot
        ) {
            cancelDrag();
            return;
        }
        if (!drag.moved && Math.abs(event.clientX - drag.x) < 4) {
            return;
        }
        drag.moved = true;
        suppressClick = true;
        drag.to = boundedStep(
            drag.from + (event.clientX - drag.x + scrollLeft - drag.scroll) / cellWidth,
        );
        try {
            moveMarkerAt(conductor, drag.from, drag.to);
            drag.problem = '';
        } catch (cause) {
            drag.problem = (cause as Error).message;
        }
        laneMessage = drag.problem || positionLabel(drag.to);
    }

    function finishDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer) {
            return;
        }
        updateDrag(event);
        const finished = drag;
        drag = null;
        if (finished?.moved && !finished.problem) {
            movePoint(finished.id, finished.to);
        }
    }

    function cancelDrag() {
        if (drag) {
            suppressClick = drag.moved;
        }
        drag = null;
    }

    function clickMarker(event: MouseEvent, id: string) {
        event.stopPropagation();
        if (suppressClick && event.detail !== 0) {
            suppressClick = false;
            return;
        }
        suppressClick = false;
        editMarker(id);
    }

    function markerKey(event: KeyboardEvent, point: MarkerPoint) {
        event.stopPropagation();
        if (drag) {
            dragKey(event);
            return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const beat = 16 / barAt($project ?? { bpm: 120 }, point.step).denominator;
            movePoint(
                point.id,
                boundedStep(
                    point.step + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? beat : 1),
                ),
            );
        }
    }

    function dragKey(event: KeyboardEvent) {
        if (drag && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelDrag();
        }
    }

    function handleDialogKey(event: KeyboardEvent, dialog: HTMLElement) {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }
        const controls = [
            ...dialog.querySelectorAll<HTMLElement>(
                'button, input, select, textarea, summary, [tabindex="0"]',
            ),
        ].filter(el => !el.matches(':disabled') && el.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) {
            event.preventDefault();
            dialog.focus();
        } else if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === dialog)
        ) {
            event.preventDefault();
            last?.focus();
        } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === dialog)
        ) {
            event.preventDefault();
            first.focus();
        }
    }

    function dialogKeyboard(node: HTMLElement) {
        const dialog = node.closest<HTMLElement>('[role="dialog"]');
        const handleKey = (event: KeyboardEvent) => {
            if (dialog) {
                handleDialogKey(event, dialog);
            }
        };
        dialog?.addEventListener('keydown', handleKey);
        return {
            destroy() {
                dialog?.removeEventListener('keydown', handleKey);
            },
        };
    }
</script>

<svelte:window onblur={cancelDrag} onkeydown={dragKey} />

<div class="conductor">
    <div class="conductor-label">
        <span>Markers</span>
    </div>
    <div style="max-width: {viewportWidth}px;" class="conductor-viewport">
        <div
            style="width: {totalLength * cellWidth}px; transform: translateX(-{scrollLeft}px);"
            class="conductor-lanes"
        >
            <button
                class="add-at-position"
                aria-label="Add marker here"
                disabled={locked}
                onclick={addAtPointer}
                tabindex="-1"
                title="Add marker"
                type="button"
            ></button>
            {#each points as point, index (point.id)}
                {#if point.step < totalLength}
                    {@const label = markerLabel(point)}
                    {@const moving = drag?.id === point.id && drag.moved}
                    {@const step = moving ? drag!.to : point.step}
                    <div
                        style="left: {step * cellWidth}px; max-width: {Math.max(
                            1,
                            Math.min(
                                320,
                                ((points[index + 1]?.step ?? totalLength) - point.step) *
                                    cellWidth -
                                    2,
                            ),
                        )}px;"
                        class="marker"
                        class:dragging={moving}
                        class:invalid={moving && !!drag?.problem}
                        class:selected={selectedId === point.id}
                        title={`${label} · ${positionLabel(step)}. Drag to move; arrow keys to nudge (Shift: beat).`}
                    >
                        <button
                            aria-label={`Edit ${label}. ${positionLabel(step)}`}
                            data-marker-id={point.id}
                            data-step={step}
                            disabled={$rendering}
                            onclick={event => clickMarker(event, point.id)}
                            onkeydown={event => markerKey(event, point)}
                            onlostpointercapture={cancelDrag}
                            onpointercancel={cancelDrag}
                            onpointerdown={event => startDrag(event, point)}
                            onpointermove={updateDrag}
                            onpointerup={finishDrag}
                            type="button">{label}</button
                        >
                    </div>
                {/if}
            {/each}
        </div>
    </div>
    <span class="lane-status" class:drag-feedback={!!drag?.moved} role="status">{laneMessage}</span>
</div>

<Dialog title="Edit marker" width="360px" bind:show>
    {#if show}
        <div class="conductor-editor" use:dialogKeyboard use:focusEditor>
            {#if locked}<p class="notice" role="status">
                    {$rendering ? 'Export in progress.' : 'Stop playback to edit.'}
                </p>{/if}
            <form
                novalidate
                onsubmit={event => {
                    event.preventDefault();
                    saveMarker();
                }}
            >
                <fieldset disabled={locked}>
                    <label
                        >Title
                        <input
                            class="marker-value"
                            maxlength="80"
                            placeholder="Marker"
                            type="text"
                            bind:value={sectionName}
                        />
                    </label>
                    <div class="timing-fields">
                        <label
                            >BPM
                            <input
                                max="300"
                                min="30"
                                placeholder={inheritedTempo}
                                step="any"
                                type="number"
                                bind:value={tempoBpm}
                            />
                        </label>
                        <label
                            >Time signature
                            <input
                                placeholder={`${inheritedMeter.numerator}/${inheritedMeter.denominator}`}
                                type="text"
                                bind:value={signature}
                            />
                        </label>
                    </div>
                    {#if tempoBpm !== undefined}
                        <label class="check">
                            <input
                                checked={tempoCurve === 'linear'}
                                onchange={event => {
                                    tempoCurve = event.currentTarget.checked ? 'linear' : 'hold';
                                }}
                                type="checkbox"
                            />
                            Gradually change to the next tempo
                        </label>
                    {/if}
                </fieldset>
                <p class="hint">Leave timing blank for no change.</p>
                {#if error}<p class="error" role="alert">{error}</p>{/if}
                <div class="form-actions">
                    <button class="delete" disabled={locked} onclick={deleteMarker} type="button"
                        >Delete</button
                    >
                    <button class="cancel" onclick={closeDialog} type="button">Cancel</button>
                    <button class="primary" disabled={locked} type="submit">Save</button>
                </div>
            </form>
        </div>
    {/if}
</Dialog>

<style>
    .conductor {
        position: relative;
        display: grid;
        grid-template-columns: 200px minmax(0, 1fr);
        height: 100%;
        min-width: 0;
        background: var(--color-surface);
        border-bottom: 1px solid var(--border);
        box-sizing: border-box;
    }

    .conductor-label {
        display: flex;
        align-items: center;
        min-width: 0;
        padding: 1px 6px;
        border-right: 1px solid var(--border);
    }

    .conductor-label span {
        font-size: 11px;
        color: var(--secondary-text);
    }

    .conductor-viewport {
        overflow: clip;
        min-width: 0;
    }

    .conductor-lanes {
        position: relative;
        height: 100%;
        will-change: transform;
    }

    button,
    input {
        font-family: inherit;
        font-size: 11px;
        color: var(--primary-text);
        background: var(--color-surface-input);
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 5px 8px;
        box-sizing: border-box;
    }

    button {
        cursor: pointer;
    }

    button:disabled {
        opacity: 0.45;
        cursor: default;
    }

    button:hover:not(:disabled) {
        background: var(--color-surface-hover);
    }

    button:focus-visible,
    input:focus-visible {
        outline: 2px solid var(--accent2);
        outline-offset: -2px;
    }

    .add-at-position,
    .add-at-position:hover:not(:disabled) {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
    }

    .marker {
        position: absolute;
        top: 2px;
        height: 24px;
        display: flex;
        width: max-content;
        border-left: 2px solid var(--accent2);
        overflow: hidden;
        background: var(--color-surface);
    }

    .marker:hover,
    .marker:focus-within,
    .marker.dragging {
        max-width: none !important;
        z-index: 2;
    }

    .marker button {
        min-width: 0;
        padding: 2px 6px;
        border: 0;
        border-radius: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
        cursor: grab;
        touch-action: none;
        user-select: none;
    }

    .marker.dragging button {
        cursor: grabbing;
    }

    .marker.selected {
        outline: 1px solid var(--accent2);
        outline-offset: -1px;
    }

    .marker.invalid {
        border-color: var(--accent);
        outline-color: var(--accent);
    }

    .conductor-editor {
        font-size: 12px;
        min-width: 0;
    }

    fieldset {
        display: grid;
        gap: 14px;
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }

    input {
        min-width: 0;
        width: 100%;
        padding: 7px;
    }

    .check {
        flex-direction: row;
        align-items: center;
        font-size: 11px;
    }

    .check input {
        width: auto;
        margin: 0;
    }

    .timing-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }

    .form-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .form-actions {
        border-top: 1px solid var(--border);
        padding-top: 12px;
        margin-top: 16px;
    }

    .cancel {
        margin-left: auto;
    }

    .primary {
        border-color: var(--accent);
    }

    .delete {
        color: var(--accent);
    }

    .notice,
    .error {
        font-size: 11px;
        line-height: 1.5;
    }

    .notice {
        margin: 0 0 12px;
        color: var(--secondary-text);
    }

    .error {
        color: var(--accent);
    }

    .hint {
        font-size: 11px;
        color: var(--secondary-text);
        margin-bottom: 0;
    }

    .lane-status {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }

    .lane-status.drag-feedback {
        clip-path: none;
        width: auto;
        height: auto;
        right: 8px;
        top: 100%;
        padding: 5px 8px;
        background: var(--color-surface);
        border: 1px solid var(--border);
        font-size: 11px;
        z-index: 3;
        pointer-events: none;
    }
</style>
