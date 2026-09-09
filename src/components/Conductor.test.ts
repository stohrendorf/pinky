import {
    randomUUID
} from 'node:crypto';
import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    runInNewContext
} from 'node:vm';
import {
    tick
} from 'svelte';
import {
    compile
} from 'svelte/compiler';
import {
    createSourceFile, isFunctionDeclaration, ScriptTarget, transpileModule
} from 'typescript';
import {
    describe, expect, it, vi
} from 'vitest';

import type {
    MarkerPoint
} from '../lib/conductor-markers';
import type {
    Project
} from '../lib/types';

import {
    markerPoints, moveMarkerAt, removeMarkerAt, updateMarkerAt
} from '../lib/conductor-markers';
import {
    barAt, barsInRange, createTimingMap
} from '../lib/timing';

const source = readFileSync(fileURLToPath(new URL('./Conductor.svelte', import.meta.url)), 'utf8');
const playlist = readFileSync(fileURLToPath(new URL('./Playlist.svelte', import.meta.url)), 'utf8');

interface Drag {
    id: string;
    pointer: number;
    x: number;
    scroll: number;
    from: number;
    to: number;
    moved: boolean;
    problem: string;
    snapshot: string;
}

interface Actions {
    newMarker: (at?: number) => void;
    addAtPointer: (event: MouseEvent) => void;
    closeDialog: () => void;
    positionLabel: (step: number) => string;
    markerLabel: (point: MarkerPoint) => string;
    editMarker: (id: string) => void;
    saveMarker: () => void;
    deleteMarker: () => void;
    movePoint: (id: string, to: number) => void;
    startDrag: (event: PointerEvent, point: MarkerPoint) => void;
    updateDrag: (event: PointerEvent) => void;
    finishDrag: (event: PointerEvent) => void;
    cancelDrag: () => void;
    clickMarker: (event: MouseEvent, id: string) => void;
    markerKey: (event: KeyboardEvent, point: MarkerPoint) => void;
    handleDialogKey: (event: KeyboardEvent, dialog: HTMLElement) => void;
    dialogKeyboard: (node: HTMLElement) => { destroy: () => void };
}

// Exercise the actual component handlers without starting the audio engine.
function handlers(scope: object): Actions {
    const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const parsed = createSourceFile('component.ts', script, ScriptTarget.Latest, true);
    const functions = parsed.statements.filter(isFunctionDeclaration).map(node => node.getText(parsed)).join('\n');
    const js = transpileModule(functions, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    return runInNewContext(`${js}\n({newMarker, addAtPointer, closeDialog, positionLabel, markerLabel, editMarker,
        saveMarker, deleteMarker, movePoint, startDrag, updateDrag, finishDrag, cancelDrag, clickMarker,
        markerKey, handleDialogKey, dialogKeyboard})`, scope) as Actions;
}

function fixture(grouped = false) {
    const p: Project = {
        formatVersion: 1, bpm: 120, instruments: [], patterns: [], tracks: [],
        arrangement: [{id: randomUUID(), patternId: 'polymeter', start: 0, len: 96, track: 0}],
        zoom: {seq: {width: 24, height: 32}, arr: {width: 24, height: 32}},
        loop: {start: 32, end: 64}
    };
    if (grouped) {
        p.conductor = {
            sections: [{id: randomUUID(), step: 0, name: 'Rain'}],
            tempos: [{id: randomUUID(), step: 0, bpm: 90, curve: 'linear'}],
            meters: [{id: randomUUID(), step: 0, numerator: 7, denominator: 8}]
        };
    }
    const scope = {
        $project: p as Project | null, $playing: false, $rendering: false, $songCursor: 19.3,
        get conductor() {
            return this.$project?.conductor ?? {tempos: [], meters: [], sections: []};
        },
        get points() {
            return markerPoints(this.conductor);
        },
        cellWidth: 24, scrollLeft: 0, totalLength: 128,
        editingId: null as string | null, selectedId: null as string | null, markerStep: 0,
        tempoBpm: undefined as number | undefined, tempoCurve: 'hold', signature: '',
        sectionName: '', error: '', show: false, laneMessage: '', suppressClick: false,
        drag: null as Drag | null, dragProject: null as Project | null,
        editorProject: null as Project | null, editorSnapshot: '',
        opener: {focus: vi.fn(), isConnected: true},
        document: {activeElement: null as unknown, querySelector: vi.fn()}, HTMLElement: class {
        },
        touch: vi.fn(), markerPoints, moveMarkerAt, removeMarkerAt, updateMarkerAt, createTimingMap, barAt, tick
    };
    return {p, scope, actions: handlers(scope)};
}

function keyboard(key: string, shiftKey = false) {
    return {key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn()} as unknown as KeyboardEvent;
}

function pointer(clientX: number, pointerId = 1) {
    return {
        clientX, pointerId, button: 0, stopPropagation: vi.fn(),
        currentTarget: {setPointerCapture: vi.fn()}
    } as unknown as PointerEvent;
}

function click(detail = 1) {
    return {detail, stopPropagation: vi.fn()} as unknown as MouseEvent;
}

describe('Conductor component', () => {
    it('compiles labelled controls and pointer interaction without accessibility warnings', () => {
        const result = compile(source, {filename: 'Conductor.svelte', generate: 'client'});
        expect(result.js.code.length).toBeGreaterThan(0);
        expect(result.warnings.filter(warning => warning.code.startsWith('a11y'))).toEqual([]);
        expect(compile(playlist, {filename: 'Playlist.svelte', generate: 'client'}).js.code.length).toBeGreaterThan(0);
    });

    it('keeps one compact strip and all fields together, without numeric position or type pickers', () => {
        expect(playlist).toContain('grid-template-rows: 24px 28px minmax(0, 1fr)');
        expect(source).toContain('width="360px"');
        expect(source).toContain('<label>Title');
        expect(source).toContain('<label>BPM');
        expect(source).toContain('<label>Time signature');
        for (const text of ['Exact step', 'Use cursor', 'Marker type', 'Jump here', 'Loop section', 'Clear loop', '<details', 'class="marker-lane"']) {
            expect(source).not.toContain(text);
        }
        expect(source).not.toContain('Add marker at cursor');
        expect(source).toMatch(/<div class="conductor-label">\s*<span>Markers<\/span>\s*<\/div>/);
        expect(source).toContain('aria-label="Add marker here"');
        expect(source).toContain('onpointercancel={cancelDrag}');
        expect(source).toContain('onlostpointercapture={cancelDrag}');
        expect(source).toContain('onblur={cancelDrag}');
        expect(source).toContain('.conductor-viewport {overflow: clip;');
    });

    it('adds an immediately draggable placeholder at the cursor without opening a dialog or changing timing', () => {
        const {p, scope, actions} = fixture();
        actions.newMarker();
        expect(p.conductor?.sections[0]).toMatchObject({step: 19, name: 'Marker'});
        expect(p.conductor?.tempos).toEqual([]);
        expect(p.conductor?.meters).toEqual([]);
        expect(scope.selectedId).toBe(p.conductor?.sections[0].id);
        expect(scope.show).toBe(false);
        expect(scope.touch).toHaveBeenCalledTimes(1);
        actions.newMarker();
        expect(p.conductor?.sections).toHaveLength(1);
        expect(scope.touch).toHaveBeenCalledTimes(1);
    });

    it('places at the clicked step with a scrolled/zoomed lane and clamps the start', () => {
        const {p, scope, actions} = fixture();
        scope.cellWidth = 12;
        actions.addAtPointer({
            clientX: 260,
            currentTarget: {getBoundingClientRect: () => ({left: -220})}
        } as unknown as MouseEvent);
        expect(p.conductor?.sections[0].step).toBe(40);
        actions.newMarker(-12);
        expect(p.conductor?.sections.map(marker => marker.step)).toEqual([0, 40]);
        expect(scope.show).toBe(false);
    });

    it('loads and saves title, tempo/ramp and signature together in one edit, preserving IDs and music', () => {
        const {p, scope, actions} = fixture(true);
        const ids = scope.points[0];
        const before = JSON.stringify({...p, conductor: undefined});
        actions.editMarker(ids.id);
        expect([scope.sectionName, scope.tempoBpm, scope.tempoCurve, scope.signature]).toEqual(['Rain', 90, 'linear', '7/8']);
        scope.sectionName = '  Bronze  ';
        scope.tempoBpm = 108;
        scope.signature = '3/4';
        actions.saveMarker();
        expect(scope.show).toBe(false);
        expect(scope.points[0]).toMatchObject({
            id: ids.id,
            section: {id: ids.section!.id, name: 'Bronze'}, tempo: {id: ids.tempo!.id, bpm: 108, curve: 'linear'},
            meter: {id: ids.meter!.id, numerator: 3, denominator: 4}
        });
        expect(scope.touch).toHaveBeenCalledTimes(1);
        expect(JSON.stringify({...p, conductor: undefined})).toBe(before);
    });

    it('does not insert implicit tempo or meter changes when editing only a title', () => {
        const {p, scope, actions} = fixture();
        actions.newMarker();
        actions.editMarker(scope.points[0].id);
        expect(scope.tempoBpm).toBeUndefined();
        expect(scope.signature).toBe('');
        scope.sectionName = 'Opening';
        actions.saveMarker();
        expect(p.conductor?.tempos).toEqual([]);
        expect(p.conductor?.meters).toEqual([]);
        actions.editMarker(scope.points[0].id);
        scope.sectionName = 'Unsaved';
        actions.closeDialog();
        expect(p.conductor?.sections[0].name).toBe('Opening');
    });

    it('clears individual timing changes and deletes all remaining fields together', () => {
        const {p, scope, actions} = fixture(true);
        actions.editMarker(scope.points[0].id);
        scope.tempoBpm = undefined;
        scope.signature = '';
        actions.saveMarker();
        expect(p.conductor?.tempos).toEqual([]);
        expect(p.conductor?.meters).toEqual([]);
        expect(p.conductor?.sections[0].name).toBe('Rain');
        actions.editMarker(scope.points[0].id);
        actions.deleteMarker();
        expect(scope.points).toEqual([]);
        expect(scope.touch).toHaveBeenCalledTimes(2);
    });

    it.each([{tempoBpm: 29}, {signature: '7/3'}, {sectionName: 'x'.repeat(81)}, {tempoCurve: 'exponential'}])('rejects an invalid field atomically: %j', invalid => {
        const {p, scope, actions} = fixture(true);
        actions.editMarker(scope.points[0].id);
        const before = JSON.stringify(p);
        Object.assign(scope, {sectionName: 'Not saved', ...invalid});
        actions.saveMarker();
        expect(scope.error).not.toBe('');
        expect(scope.show).toBe(true);
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('moves the entire group only on drop and suppresses the following click, not the next deliberate click', () => {
        const {p, scope, actions} = fixture(true);
        const point = scope.points[0];
        const before = JSON.stringify(p);
        const down = pointer(300);
        actions.startDrag(down, point);
        expect((down.currentTarget as HTMLElement).setPointerCapture).toHaveBeenCalledWith(1);
        actions.updateDrag(pointer(300 + 24 * 8));
        expect(scope.drag?.to).toBe(8);
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).not.toHaveBeenCalled();
        actions.finishDrag(pointer(300 + 24 * 8));
        expect(scope.points[0]).toMatchObject({
            id: point.id,
            step: 8,
            section: {step: 8},
            tempo: {step: 8},
            meter: {step: 8}
        });
        expect(scope.touch).toHaveBeenCalledTimes(1);
        actions.clickMarker(click(), point.id);
        expect(scope.show).toBe(false);
        actions.startDrag(pointer(500), scope.points[0]);
        actions.finishDrag(pointer(502));
        actions.clickMarker(click(), point.id);
        expect(scope.show).toBe(true);
    });

    it('accounts for scrolling during drag, zoom, pointer identity and integer snapping', () => {
        const {scope, actions} = fixture(true);
        scope.cellWidth = 10;
        scope.scrollLeft = 200;
        actions.startDrag(pointer(300), scope.points[0]);
        actions.updateDrag(pointer(800, 2));
        expect(scope.drag?.to).toBe(0);
        scope.scrollLeft = 220;
        actions.updateDrag(pointer(326));
        expect(scope.drag?.to).toBe(5);
        actions.finishDrag(pointer(326));
        expect(scope.points[0].step).toBe(5);
    });

    it.each(['escape', 'cancel'] as const)('cancels a drag via %s without mutating the project', how => {
        const {p, scope, actions} = fixture(true);
        const before = JSON.stringify(p);
        const point = scope.points[0];
        actions.startDrag(pointer(300), point);
        actions.updateDrag(pointer(600));
        if (how === 'escape') {
            actions.markerKey(keyboard('Escape'), point);
        } else {
            actions.cancelDrag();
        }
        actions.finishDrag(pointer(600));
        actions.clickMarker(click(), point.id);
        expect(scope.drag).toBeNull();
        expect(scope.show).toBe(false);
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('rejects occupied same-kind drops and keeps every source/destination field', () => {
        const {p, scope, actions} = fixture(true);
        p.conductor!.tempos.push({id: randomUUID(), step: 8, bpm: 160, curve: 'hold'});
        const before = JSON.stringify(p);
        actions.startDrag(pointer(300), scope.points[0]);
        actions.updateDrag(pointer(492));
        expect(scope.drag?.problem).not.toBe('');
        actions.finishDrag(pointer(492));
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('merges disjoint marker fields when dropped on the same step', () => {
        const {p, scope, actions} = fixture();
        actions.newMarker(0);
        p.conductor!.tempos.push({id: randomUUID(), step: 8, bpm: 160, curve: 'hold'});
        actions.movePoint(scope.points[0].id, 8);
        expect(scope.points).toHaveLength(1);
        expect(scope.points[0]).toMatchObject({step: 8, section: {name: 'Marker'}, tempo: {bpm: 160}});
    });

    it('supports keyboard nudging, beat nudging, start clamping, and keyboard editing after drag', () => {
        const {scope, actions} = fixture(true);
        actions.markerKey(keyboard('ArrowLeft'), scope.points[0]);
        expect(scope.touch).not.toHaveBeenCalled();
        actions.markerKey(keyboard('ArrowRight', true), scope.points[0]);
        expect(scope.points[0].step).toBe(2);
        actions.markerKey(keyboard('ArrowRight'), scope.points[0]);
        expect(scope.points[0].step).toBe(3);
        scope.suppressClick = true;
        actions.clickMarker(click(0), scope.points[0].id);
        expect(scope.show).toBe(true);
        expect(scope.$songCursor).toBe(19.3);
    });

    it.each(['$playing', '$rendering'] as const)('blocks mutations if %s changes during editing/dragging', lock => {
        const {p, scope, actions} = fixture(true);
        const point = scope.points[0];
        actions.editMarker(point.id);
        actions.startDrag(pointer(300), point);
        actions.updateDrag(pointer(600));
        const before = JSON.stringify(p);
        scope[lock] = true;
        actions.finishDrag(pointer(600));
        scope.tempoBpm = 200;
        actions.saveMarker();
        actions.deleteMarker();
        actions.newMarker(80);
        actions.movePoint(point.id, 20);
        actions.startDrag(pointer(300), point);
        expect(scope.drag).toBeNull();
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('opens existing markers read-only while playing, but not while exporting', () => {
        const {scope, actions} = fixture(true);
        scope.$playing = true;
        actions.editMarker(scope.points[0].id);
        expect(scope.show).toBe(true);
        actions.closeDialog();
        scope.$rendering = true;
        actions.editMarker(scope.points[0].id);
        expect(scope.show).toBe(false);
        expect(scope.$songCursor).toBe(19.3);
    });

    it.each(['deleted', 'replaced'] as const)('does not resurrect stale markers when the project is %s', change => {
        const {p, scope, actions} = fixture(true);
        const point = scope.points[0];
        actions.editMarker(point.id);
        actions.startDrag(pointer(300), point);
        if (change === 'deleted') {
            p.conductor = {sections: [], tempos: [], meters: []};
        } else {
            scope.$project = structuredClone(p);
        }
        const before = JSON.stringify(scope.$project);
        actions.saveMarker();
        actions.deleteMarker();
        actions.finishDrag(pointer(600));
        expect(scope.error).toContain('changed');
        expect(JSON.stringify(scope.$project)).toBe(before);
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('traps focus, filters hidden/disabled controls and shields input from app shortcuts', () => {
        const {scope, actions} = fixture();
        const control = (disabled = false, visible = true) => ({
            focus: vi.fn(),
            matches: () => disabled,
            getClientRects: () => visible ? [{}] : []
        });
        const first = control(), last = control();
        const dialog = {querySelectorAll: () => [first, control(true), control(false, false), last], focus: vi.fn()};
        scope.document.activeElement = last;
        const forward = keyboard('Tab');
        actions.handleDialogKey(forward, dialog as unknown as HTMLElement);
        expect(first.focus).toHaveBeenCalledTimes(1);
        expect(forward.preventDefault).toHaveBeenCalled();
        scope.document.activeElement = first;
        actions.handleDialogKey(keyboard('Tab', true), dialog as unknown as HTMLElement);
        expect(last.focus).toHaveBeenCalledTimes(1);
        for (const key of [' ', 'Delete', 'Backspace', 'z', 'Enter']) {
            const event = keyboard(key);
            actions.handleDialogKey(event, dialog as unknown as HTMLElement);
            expect(event.stopPropagation).toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
    });

    it('closes on Escape with focus restoration and removes dialog listeners', async () => {
        const {scope, actions} = fixture();
        const dialog = {addEventListener: vi.fn(), removeEventListener: vi.fn()};
        const action = actions.dialogKeyboard({closest: () => dialog} as unknown as HTMLElement);
        expect(dialog.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        scope.show = true;
        actions.handleDialogKey(keyboard('Escape'), dialog as unknown as HTMLElement);
        expect(scope.show).toBe(false);
        await tick();
        expect(scope.opener.focus).toHaveBeenCalledTimes(1);
        action.destroy();
        expect(dialog.removeEventListener).toHaveBeenCalledWith('keydown', dialog.addEventListener.mock.calls[0][1]);
    });

    it('retains actual mixed-meter bar boundaries and useful position labels', () => {
        const {p, scope, actions} = fixture(true);
        expect(actions.markerLabel(scope.points[0])).toBe('Rain · 90 BPM ↗ · 7/8');
        expect(actions.positionLabel(14)).toBe('Bar 2 · beat 1');
        expect(actions.positionLabel(17)).toBe('Bar 2 · beat 2 + 1 step');
        actions.movePoint(scope.points[0].id, 10);
        expect(barsInRange(p, 0, 39).map(bar => [bar.bar, bar.start, bar.end])).toEqual([
            [1, 0, 10], [2, 10, 24], [3, 24, 38], [4, 38, 52]
        ]);
        expect(playlist).toContain('barsInRange($project, scrollLeft / cellWidth,');
        expect(playlist).toContain('barAt($project!, clip.start).bar');
        expect(playlist).toContain('class="bar-line"');
        expect(playlist).not.toContain('calc(var(--cell-width) * 16)');
    });
});
