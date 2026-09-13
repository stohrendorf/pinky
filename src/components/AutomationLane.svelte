<script lang="ts">
    import type { AutoParamDef } from '../lib/automation';
    import type { AutomationLane, AutomationPoint } from '../lib/types';

    import {
        clampPoint,
        CURVE_SHAPES,
        segmentProgress,
        setAutomationPointValue,
        sortPoints,
    } from '../lib/automation';
    /* One automation lane body: the curve of a single parameter over the song.
     * Click = add a point (and drag it), drag a point = move it, right-click a
     * point = delete it. Values are linear between the points, held outside. */
    import { touch } from '../lib/project';
    import { preventDefault, stopPropagation } from './event-modifiers';

    interface Props {
        lane: AutomationLane;
        def: AutoParamDef;
        color: string;
        cellWidth: number;
        width: number;
        height: number;
        selectedPoint?: AutomationPoint | null;
        hasSelectedPoint?: boolean;
        editorKey?: string;
        contextualEditor?: string | null;
        onselect?: (point: AutomationPoint | null) => void;
        canEdit?: boolean;
        onblocked?: () => void;
    }

    let {
        lane = $bindable(),
        def,
        color,
        cellWidth,
        width,
        height,
        selectedPoint = null,
        hasSelectedPoint = false,
        editorKey = '',
        contextualEditor = $bindable(null),
        onselect = () => {},
        canEdit = true,
        onblocked = () => {},
    }: Props = $props();

    const PAD = 5; // px of headroom so the extreme values stay grabbable

    let svgEl: SVGSVGElement | undefined = $state();
    let drag: AutomationPoint | null = null;
    let editingPoint: AutomationPoint | null = $state(null);
    let editingValue = $state('');
    let editingError = $state('');
    let editorInput: HTMLInputElement | undefined = $state();

    function local(e: MouseEvent): { step: number; value: number } {
        const r = svgEl!.getBoundingClientRect();
        return { step: (e.clientX - r.left) / cellWidth, value: yToVal(e.clientY - r.top) };
    }

    function pointAt(e: MouseEvent): AutomationPoint | null {
        const r = svgEl!.getBoundingClientRect();
        const x = e.clientX - r.left,
            y = e.clientY - r.top;
        let best: AutomationPoint | null = null,
            bestD = 8 * 8;
        for (const p of pts) {
            const dx = p.step * cellWidth - x,
                dy = valToY(p.value) - y;
            const d = dx * dx + dy * dy;
            if (d <= bestD) {
                bestD = d;
                best = p;
            }
        }
        return best;
    }

    function onDown(e: MouseEvent) {
        if (e.button === 1) {
            return;
        } // middle drag = the playlist's pan gesture
        e.stopPropagation();
        if (contextualEditor !== editorKey) {
            contextualEditor = null;
        }
        const hit = pointAt(e);
        if (e.button === 2) {
            // right-click removes a point (never the last one)
            if (hit && pts.length > 1) {
                lane.points = pts.filter(p => p !== hit);
                if (selectedPoint === hit) {
                    onselect(null);
                }
                if (editingPoint === hit) {
                    closePointEditor();
                }
                touch();
            }
            return;
        }
        if (e.button !== 0) {
            return;
        }
        if (!canEdit) {
            onblocked();
            return;
        }
        if (hit) {
            onselect(hit);
            drag = hit;
            return;
        }
        if (hasSelectedPoint) {
            onselect(null);
            return;
        }
        closePointEditor();
        const l = local(e);
        const pt: AutomationPoint = { step: l.step, value: l.value };
        clampPoint(lane, pt);
        lane.points = [...pts, pt];
        sortPoints(lane);
        onselect(pt);
        drag = pt;
        touch();
    }

    function onMove(e: MouseEvent) {
        if (!drag) {
            return;
        }
        const l = local(e);
        drag.step = l.step;
        drag.value = l.value;
        clampPoint(lane, drag);
        sortPoints(lane);
        lane.points = [...lane.points];
        onselect(drag);
        touch();
    }

    function onUp() {
        if (drag) {
            drag = null;
            touch();
        }
    }

    function closePointEditor() {
        editingPoint = null;
        editingError = '';
        if (contextualEditor === editorKey) {
            contextualEditor = null;
        }
    }

    function savePointEditor() {
        if (!editingPoint) {
            return;
        }
        if (setAutomationPointValue(lane, editingPoint, editingValue)) {
            onselect(editingPoint);
            touch();
            closePointEditor();
        } else {
            editingError = 'Enter a number';
        }
    }

    function updatePointValue(point: AutomationPoint, value: string) {
        if (!setAutomationPointValue(lane, point, value)) {
            return;
        }
        onselect(point);
        touch();
    }

    function onPointEditorKeydown(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closePointEditor();
        }
    }

    function onPointKeydown(e: KeyboardEvent, point: AutomationPoint) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            if (
                setAutomationPointValue(
                    lane,
                    point,
                    point.value + (e.key === 'ArrowUp' ? def.step : -def.step),
                )
            ) {
                onselect(point);
                touch();
            }
            return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            point.step = Math.max(0, Math.round(point.step + (e.key === 'ArrowRight' ? 1 : -1)));
            clampPoint(lane, point);
            sortPoints(lane);
            lane.points = [...lane.points];
            onselect(point);
            touch();
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && pts.length > 1) {
            e.preventDefault();
            e.stopPropagation();
            lane.points = pts.filter(p => p !== point);
            if (selectedPoint === point) {
                onselect(null);
            }
            if (editingPoint === point) {
                closePointEditor();
            }
            touch();
        }
    }

    function curvePath(points: AutomationPoint[]): string {
        if (!points.length) {
            return '';
        }
        const segments: string[] = [];
        let from: AutomationPoint | null = null;
        const addSegment = (start: AutomationPoint, end: AutomationPoint) => {
            if (start.curve === 'hold') {
                segments.push(`L ${end.step * cellWidth} ${valToY(start.value)}`);
                segments.push(`L ${end.step * cellWidth} ${valToY(end.value)}`);
                return;
            }
            for (let sample = 1; sample <= 12; sample++) {
                const t = sample / 12;
                const step = start.step + (end.step - start.step) * t;
                const value = start.value + (end.value - start.value) * segmentProgress(start.curve, t);
                segments.push(`L ${step * cellWidth} ${valToY(value)}`);
            }
        };
        for (const to of points) {
            if (to.active === false) {
                if (from) {
                    addSegment(from, to);
                }
                from = null;
                continue;
            }
            if (!from) {
                segments.push(`M ${to.step * cellWidth} ${valToY(to.value)}`);
                from = to;
                continue;
            }
            addSegment(from, to);
            from = to;
        }
        if (from) {
            segments.push(`L ${width} ${valToY(from.value)}`);
        }
        return segments.join(' ');
    }

    // Render every point as a compound path instead of a DOM element per
    // point. Dense imported lanes remain inexpensive, while every authored
    // node stays visible and selectable through pointAt().
    function pointMarkerPath(points: AutomationPoint[]): string {
        const radius = 3.5;
        return points
            .map(point => {
                const x = point.step * cellWidth;
                const y = valToY(point.value);
                return `M ${x - radius} ${y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
            })
            .join(' ');
    }

    function setPointCurve(point: AutomationPoint, curve: string) {
        if (!CURVE_SHAPES.some(shape => shape.id === curve)) {
            return;
        }
        point.curve = curve as AutomationPoint['curve'];
        lane.points = [...lane.points];
        touch();
    }

    function setPointActive(point: AutomationPoint, active: boolean) {
        point.active = active ? undefined : false;
        lane.points = [...lane.points];
        touch();
    }

    function pointControlPosition(point: AutomationPoint): number {
        const editorWidth = 250;
        return Math.max(4, Math.min(width - editorWidth, point.step * cellWidth - editorWidth / 2));
    }

    const fmt = (v: number): string =>
        (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) +
        (def.unit ? ' ' + def.unit : '');
    const span = $derived(Math.max(1e-9, def.max - def.min));
    const valToY = $derived(
        (v: number) => height - PAD - ((v - def.min) / span) * (height - 2 * PAD),
    );
    const yToVal = $derived(
        (y: number) => def.min + ((height - PAD - y) / (height - 2 * PAD)) * span,
    );
    // the drawn path: held before the first point, held after the last one
    const pts = $derived(lane.points);
    const activePoint = $derived(editingPoint ?? selectedPoint);
    const activePointPath = $derived(
        pointMarkerPath(activePoint ? [activePoint] : []),
    );
    const pointPath = $derived(
        pointMarkerPath(
            pts.filter(point => point !== activePoint && point.active !== false),
        ),
    );
    const inactivePointPath = $derived(
        pointMarkerPath(
            pts.filter(point => point !== activePoint && point.active === false),
        ),
    );
    const path = $derived(curvePath(pts));
    const fillPath = $derived(
        path && !pts.some(point => point.active === false)
            ? `${path} L ${width} ${height} L 0 ${height} Z`
            : '',
    );
    $effect.pre(() => {
        if (contextualEditor !== editorKey && editingPoint) {
            editingPoint = null;
            editingError = '';
        }
    });
</script>

<svelte:window onmousemove={onMove} onmouseup={onUp} />

<div style="width: {width}px" class="auto-lane-wrap">
    <svg
        bind:this={svgEl}
        class="auto-lane"
        aria-label={`${def.label} automation editor`}
        {height}
        oncontextmenu={preventDefault(() => {})}
        onmousedown={onDown}
        role="grid"
        tabindex="0"
        {width}
    >
        <line
            class="mid"
            x1="0"
            x2={width}
            y1={valToY(def.min + span / 2)}
            y2={valToY(def.min + span / 2)}
        />
        {#if pts.length}
            <path style="fill: {color}" class="curve-fill" d={fillPath} />
            {#if path}
                <path style="stroke: {color}" class="curve" d={path} />
            {/if}
            <path style="stroke: {color}" class="curve-nodes" d={pointPath} />
            <path
                style="stroke: {color}"
                class="curve-nodes inactive"
                d={inactivePointPath}
            />
            {#if activePoint}
                <g
                    class="pt"
                    class:active={selectedPoint === activePoint || editingPoint === activePoint}
                    class:inactive={activePoint.active === false}
                    aria-label={`${def.label}: ${fmt(activePoint.value)} at step ${Math.round(activePoint.step)}`}
                    onfocus={() => onselect(activePoint)}
                    onkeydown={e => onPointKeydown(e, activePoint)}
                    role="button"
                    tabindex="0"
                >
                    <circle
                        style="stroke: {color}"
                        class="curve-node"
                        cx={activePoint.step * cellWidth}
                        cy={valToY(activePoint.value)}
                        r="3.5"
                    />
                    <title>{fmt(activePoint.value)} @ step {Math.round(activePoint.step)}</title>
                </g>
            {/if}
        {/if}
        <text class="val" x="4" y="11">{fmt(def.max)}</text>
        <text class="val" x="4" y={height - 4}>{fmt(def.min)}</text>
    </svg>

    {#if selectedPoint && !editingPoint}
        <div
            style="left: {pointControlPosition(selectedPoint)}px;"
            class="point-readout"
            aria-live="polite"
        >
            <label>
                <input
                    aria-label={`Set ${def.label} value`}
                    inputmode="decimal"
                    max={def.max}
                    min={def.min}
                    oninput={event => updatePointValue(selectedPoint, event.currentTarget.value)}
                    onkeydown={stopPropagation()}
                    step={def.step}
                    type="number"
                    value={selectedPoint.value}
                />
            </label>
            <label class="point-active">
                <input
                    aria-label="Automation active from this point"
                    checked={selectedPoint.active !== false}
                    onchange={event => setPointActive(selectedPoint, event.currentTarget.checked)}
                    type="checkbox"
                />
                {selectedPoint.active === false ? 'Resume automation' : 'Automation active'}
            </label>
            {#if selectedPoint !== pts[pts.length - 1]}
                <select
                    aria-label="Curve to next point"
                    onchange={event => setPointCurve(selectedPoint, event.currentTarget.value)}
                    value={selectedPoint.curve || 'linear'}
                >
                    {#each CURVE_SHAPES as shape}
                        <option value={shape.id}>{shape.label}</option>
                    {/each}
                </select>
            {/if}
        </div>
    {/if}

    {#if editingPoint}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (the form stops pointer and Escape events from reaching the spatial editor) -->
        <form
            style="left: {pointControlPosition(editingPoint)}px;"
            class="point-editor"
            aria-label={`Set ${def.label} value`}
            onkeydown={onPointEditorKeydown}
            onsubmit={preventDefault(savePointEditor)}
        >
            <input
                bind:this={editorInput}
                aria-label={`Set ${def.label} value`}
                inputmode="decimal"
                max={def.max}
                min={def.min}
                step={def.step}
                type="number"
                bind:value={editingValue}
            />
            <span>Enter to apply · Esc to cancel</span>
            {#if editingError}<small>{editingError}</small>{/if}
        </form>
    {/if}
</div>

<style>
    .auto-lane {
        display: block;
        background:
            linear-gradient(90deg, rgba(231, 109, 117, 0.035), transparent 40%), var(--color-canvas);
        border-bottom: 1px solid var(--border-subtle);
        cursor: crosshair;
    }

    .auto-lane-wrap {
        position: relative;
    }

    .mid {
        stroke: var(--color-border-subtle);
        stroke-width: 1;
        opacity: 0.55;
    }

    .curve-fill {
        opacity: 0.13;
    }

    .curve {
        fill: none;
        stroke-width: 1.25;
        opacity: 0.95;
        vector-effect: non-scaling-stroke;
    }

    .curve-nodes {
        fill: var(--color-canvas);
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
    }

    .pt {
        outline: none;
    }

    .curve-node {
        fill: var(--color-canvas);
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
    }

    .pt.active .curve-node,
    .pt:focus .curve-node {
        fill: var(--color-playhead);
        stroke-width: 2;
        filter: drop-shadow(0 0 3px rgba(255, 244, 244, 0.55));
    }

    .pt.inactive .curve-node,
    .curve-nodes.inactive {
        fill: var(--color-canvas);
        stroke-dasharray: 2 1;
        opacity: 0.55;
    }

    .point-readout,
    .point-editor {
        position: absolute;
        bottom: calc(100% + 4px);
        z-index: 5;
        padding: 3px 5px;
        border: 1px solid var(--accent);
        border-radius: 2px;
        background: var(--color-surface);
        color: var(--primary-text);
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
        font-size: 10px;
        pointer-events: auto;
        white-space: nowrap;
    }

    .point-editor {
        display: grid;
        gap: 2px;
        pointer-events: auto;
    }

    .point-readout {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .point-readout select {
        padding: 1px 3px;
        border: 1px solid var(--color-border);
        border-radius: 2px;
        background: var(--surface-input);
        color: inherit;
        font: inherit;
    }

    .point-readout input,
    .point-editor input {
        padding: 3px 5px;
        border: 1px solid var(--color-border);
        border-radius: 2px;
        background: var(--surface-input);
        color: var(--primary-text);
        font: inherit;
        appearance: textfield;
        -moz-appearance: textfield;
    }

    .point-readout input {
        width: 64px;
    }

    .point-active {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        cursor: pointer;
    }

    .point-active input {
        width: auto;
        margin: 0;
    }

    .point-editor input {
        width: 132px;
    }

    .point-readout input::-webkit-outer-spin-button,
    .point-readout input::-webkit-inner-spin-button,
    .point-editor input::-webkit-outer-spin-button,
    .point-editor input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .point-readout input:focus,
    .point-editor input:focus {
        border-color: var(--accent);
        outline: none;
    }

    .point-editor span,
    .point-editor small {
        opacity: 0.65;
        font-size: 9px;
    }

    .val {
        font-size: 9px;
        fill: var(--color-text-faint);
        pointer-events: none;
    }
</style>
