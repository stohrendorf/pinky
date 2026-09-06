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
    MeterMarker, SectionMarker, TempoMarker
} from '../lib/timing';
import type {
    Project
} from '../lib/types';

import {
    barAt, barsInRange, createTimingMap, ensureConductor
} from '../lib/timing';

const source = readFileSync(fileURLToPath(new URL('./Conductor.svelte', import.meta.url)), 'utf8');
const playlist = readFileSync(fileURLToPath(new URL('./Playlist.svelte', import.meta.url)), 'utf8');
type Kind = 'tempo' | 'meter' | 'section';

interface Actions {
    newMarker: (kind?: Kind, at?: number) => void;
    addAtPointer: (event: MouseEvent) => void;
    closeDialog: () => void;
    positionLabel: (step: number) => string;
    timelineMarkers: () => {step: number; entries: {kind: Kind; marker: TempoMarker | MeterMarker | SectionMarker}[]}[];
    editMarker: (kind: Kind, id: string) => void;
    useCursor: () => void;
    saveMarker: () => void;
    deleteMarker: (kind: Kind, id: string) => void;
    handleDialogKey: (event: KeyboardEvent, dialog: HTMLElement) => void;
    dialogKeyboard: (node: HTMLElement) => {destroy: () => void};
}

// Exercise the actual component handlers without starting the audio engine.
function handlers(scope: object): Actions {
    const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const parsed = createSourceFile('component.ts', script, ScriptTarget.Latest, true);
    const functions = parsed.statements.filter(isFunctionDeclaration).map(node => node.getText(parsed)).join('\n');
    const js = transpileModule(functions, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    return runInNewContext(`${js}\n({newMarker, addAtPointer, closeDialog, positionLabel, timelineMarkers, editMarker, useCursor, saveMarker, deleteMarker, handleDialogKey, dialogKeyboard})`, scope) as Actions;
}

function fixture() {
    const p: Project = {
        formatVersion: 1, bpm: 120, instruments: [], patterns: [], tracks: [],
        arrangement: [{id: randomUUID(), patternId: 'polymeter', start: 0, len: 96, track: 0}],
        zoom: {seq: {width: 24, height: 32}, arr: {width: 24, height: 32}}
    };
    const scope = {
        $project: p as Project | null, $playing: false, $rendering: false, $songCursor: 19.3,
        get conductor() {return p.conductor ?? {tempos: [], meters: [], sections: []};},
        get groups() {
            return [
                {kind: 'section', markers: p.conductor?.sections ?? []},
                {kind: 'tempo', markers: p.conductor?.tempos ?? []},
                {kind: 'meter', markers: p.conductor?.meters ?? []}
            ];
        },
        cellWidth: 24,
        markerKind: 'tempo' as Kind, editingId: null as string | null, markerStep: 0 as number | undefined,
        tempoBpm: 120 as number | undefined, tempoCurve: 'hold' as TempoMarker['curve'],
        meterNumerator: 4 as number | undefined, meterDenominator: 4 as MeterMarker['denominator'],
        sectionName: '', error: '', show: false, positionOpen: false,
        opener: {focus: vi.fn(), isConnected: true},
        document: {activeElement: null as unknown, querySelector: vi.fn()}, HTMLElement: class {},
        touch: vi.fn(),
        ensureConductor, createTimingMap, barAt, tick, crypto: {randomUUID}
    };
    return {p, scope, actions: handlers(scope)};
}

function keyboard(key: string, shiftKey = false) {
    return {key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn()};
}

describe('Conductor component', () => {
    it('compiles native labelled controls without accessibility warnings', () => {
        const result = compile(source, {filename: 'Conductor.svelte', generate: 'client'});
        expect(result.js.code.length).toBeGreaterThan(0);
        expect(result.warnings.filter(warning => warning.code.startsWith('a11y'))).toEqual([]);
        expect(compile(playlist, {filename: 'Playlist.svelte', generate: 'client'}).js.code.length).toBeGreaterThan(0);
    });

    it('initializes at the rounded cursor without mutating legacy projects', () => {
        const {p, scope, actions} = fixture();
        actions.newMarker();
        expect(scope.markerStep).toBe(19);
        expect(scope.markerKind).toBe('section');
        expect(scope.positionOpen).toBe(false);
        expect(scope.tempoBpm).toBe(120);
        expect(scope.tempoCurve).toBe('hold');
        expect(scope.meterNumerator).toBe(4);
        expect(scope.meterDenominator).toBe(4);
        expect(scope.show).toBe(true);
        expect(p.conductor).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
        scope.$songCursor = 30.9;
        actions.useCursor();
        expect(scope.markerStep).toBe(31);
    });

    it('uses one compact strip and a single editor with optional exact positioning', () => {
        expect(playlist).toContain('grid-template-rows: 24px 28px minmax(0, 1fr)');
        expect(source).not.toContain('class="marker-lane"');
        expect(source).not.toContain('class="marker-lists"');
        expect(source).toContain('width="360px"');
        expect(source).toMatch(/<details bind:open=\{positionOpen}>[\s\S]*Exact step \(0-based\)[\s\S]*<\/details>/);
        expect(source).not.toContain('Find marker');
        expect(source).not.toContain('Jump here');
        expect(source).not.toContain('Loop section');
        expect(source).not.toContain('Clear loop');
        expect(source).not.toContain('class="nearby"');
        expect(source).not.toContain('class="empty-lane"');
        expect(source).toContain('onclick={() => editMarker(entry.kind, entry.marker.id)}');
        expect(source).toContain('aria-label="Marker type"');
        expect(source).not.toContain('<select aria-label="Type"');
    });

    it('adds at the clicked musical position, including a scrolled lane', () => {
        const {p, scope, actions} = fixture();
        actions.addAtPointer({clientX: 260, currentTarget: {getBoundingClientRect: () => ({left: -220})}} as unknown as MouseEvent);
        expect(scope.markerStep).toBe(20);
        expect(scope.markerKind).toBe('section');
        expect(scope.show).toBe(true);
        expect(p.conductor).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('groups coincident markers without losing their identity or off-screen markers', () => {
        const {p, actions} = fixture();
        p.conductor = {
            tempos: [{id: randomUUID(), step: 0, bpm: 90, curve: 'linear'}],
            meters: [{id: randomUUID(), step: 0, numerator: 7, denominator: 8}],
            sections: [{id: randomUUID(), step: 0, name: 'Rain'}, {id: randomUUID(), step: 1000000, name: 'Later'}]
        };
        const before = JSON.stringify(p);
        const points = actions.timelineMarkers();
        expect(points.map(point => point.step)).toEqual([0, 1000000]);
        expect(points[0].entries.map(entry => entry.kind)).toEqual(['section', 'tempo', 'meter']);
        expect(points[0].entries.map(entry => entry.marker.id)).toEqual([
            p.conductor.sections[0].id, p.conductor.tempos[0].id, p.conductor.meters[0].id
        ]);
        expect(JSON.stringify(p)).toBe(before);
        expect(actions.positionLabel(14)).toBe('Bar 2 · beat 1');
        expect(actions.positionLabel(17)).toBe('Bar 2 · beat 2 + 1 step');
    });

    it('closes after save, preserves fields on validation failure, and cancels without saving', () => {
        const {p, scope, actions} = fixture();
        actions.newMarker();
        actions.saveMarker();
        expect(scope.show).toBe(true);
        expect(scope.error).toContain('Section name');
        scope.sectionName = 'Rain';
        actions.saveMarker();
        expect(scope.show).toBe(false);
        expect(p.conductor?.sections[0].name).toBe('Rain');
        actions.editMarker('section', scope.editingId!);
        scope.sectionName = 'Not saved';
        actions.closeDialog();
        expect(p.conductor?.sections[0].name).toBe('Rain');
        expect(scope.touch).toHaveBeenCalledTimes(1);
    });

    it('defaults new tempo and meter fields to the timing at the cursor', () => {
        const {p, scope, actions} = fixture();
        p.conductor = {
            tempos: [{id: randomUUID(), step: 8, bpm: 90, curve: 'hold'}],
            meters: [{id: randomUUID(), step: 10, numerator: 7, denominator: 8}], sections: []
        };
        actions.newMarker('meter');
        expect(scope.tempoBpm).toBe(90);
        expect(scope.meterNumerator).toBe(7);
        expect(scope.meterDenominator).toBe(8);
    });

    it('adds sorted atomic markers, keeps UUIDs unique across types and leaves music untouched', () => {
        const {p, scope, actions} = fixture();
        const music = JSON.stringify({arrangement: p.arrangement, patterns: p.patterns, bpm: p.bpm});
        actions.newMarker('tempo');
        scope.markerStep = 32;
        scope.tempoBpm = 180;
        scope.tempoCurve = 'linear';
        actions.saveMarker();
        actions.newMarker('tempo');
        scope.markerStep = 0;
        scope.tempoBpm = 90;
        actions.saveMarker();
        actions.newMarker('meter');
        scope.markerStep = 0;
        scope.meterNumerator = 7;
        scope.meterDenominator = 8;
        actions.saveMarker();
        actions.newMarker('section');
        scope.markerStep = 0;
        scope.sectionName = '  Verse  ';
        actions.saveMarker();
        expect(p.conductor?.tempos.map(marker => marker.step)).toEqual([0, 32]);
        expect(p.conductor?.tempos[1]).toMatchObject({step: 32, bpm: 180, curve: 'linear'});
        expect(p.conductor?.meters[0]).toMatchObject({step: 0, numerator: 7, denominator: 8});
        expect(p.conductor?.sections[0].name).toBe('Verse');
        const markers = [...scope.conductor.tempos, ...scope.conductor.meters, ...scope.conductor.sections];
        expect(new Set(markers.map(marker => marker.id)).size).toBe(4);
        for (const marker of markers) {
            expect(marker.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
        }
        expect(Object.keys(scope.conductor.sections[0]).sort()).toEqual(['id', 'name', 'step']);
        expect(scope.touch).toHaveBeenCalledTimes(4);
        expect(JSON.stringify({arrangement: p.arrangement, patterns: p.patterns, bpm: p.bpm})).toBe(music);
    });

    it.each(['tempo', 'meter', 'section'] as const)('edits and deletes %s without duplicating its ID or touching clips', kind => {
        const {p, scope, actions} = fixture();
        const clips = JSON.stringify(p.arrangement);
        actions.newMarker(kind);
        scope.sectionName = 'Opening';
        actions.saveMarker();
        const id = scope.editingId!;
        actions.editMarker(kind, id);
        scope.markerStep = 6;
        scope.tempoBpm = 135;
        scope.tempoCurve = 'linear';
        scope.meterNumerator = 3;
        scope.meterDenominator = 8;
        scope.sectionName = 'Revised';
        actions.saveMarker();
        const data = scope.conductor;
        const list = kind === 'tempo' ? data.tempos : kind === 'meter' ? data.meters : data.sections;
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({id, step: 6});
        if (kind === 'tempo') {expect(data.tempos[0]).toMatchObject({bpm: 135, curve: 'linear'});}
        if (kind === 'meter') {expect(data.meters[0]).toMatchObject({numerator: 3, denominator: 8});}
        if (kind === 'section') {expect(data.sections[0].name).toBe('Revised');}
        actions.deleteMarker(kind, id);
        expect([...scope.conductor.tempos, ...scope.conductor.meters, ...scope.conductor.sections]).toEqual([]);
        expect(scope.touch).toHaveBeenCalledTimes(3);
        expect(JSON.stringify(p.arrangement)).toBe(clips);
    });

    it.each(['tempo', 'meter', 'section'] as const)('rejects duplicate %s steps for additions and edits atomically', kind => {
        const {p, scope, actions} = fixture();
        actions.newMarker(kind);
        scope.sectionName = 'A';
        scope.markerStep = 0;
        actions.saveMarker();
        actions.newMarker(kind);
        scope.sectionName = 'B';
        scope.markerStep = 16;
        actions.saveMarker();
        const before = JSON.stringify(p);
        scope.markerStep = 0;
        actions.saveMarker();
        expect(scope.error).toContain('already exists');
        expect(JSON.stringify(p)).toBe(before);
        actions.newMarker(kind);
        scope.sectionName = 'C';
        scope.markerStep = 0;
        actions.saveMarker();
        expect(scope.error).toContain('already exists');
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, NaN, Infinity, -1, 0.5, 1000001])('rejects invalid step %s without creating conductor data', step => {
        const {p, scope, actions} = fixture();
        scope.markerStep = step;
        actions.saveMarker();
        expect(scope.error).toContain('whole number');
        expect(p.conductor).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it.each([undefined, NaN, Infinity, 29, 301])('rejects invalid BPM %s', bpm => {
        const {p, scope, actions} = fixture();
        scope.tempoBpm = bpm;
        actions.saveMarker();
        expect(scope.error).toContain('30 to 300');
        expect(p.conductor).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it.each([undefined, 0, 1.5, 33, NaN])('rejects invalid meter numerator %s', numerator => {
        const {p, scope, actions} = fixture();
        scope.markerKind = 'meter';
        scope.meterNumerator = numerator;
        actions.saveMarker();
        expect(scope.error).toContain('Time signature');
        expect(p.conductor).toBeUndefined();
    });

    it('rejects unsupported meter units and tempo curves', () => {
        const {p, scope, actions} = fixture();
        Object.assign(scope, {markerKind: 'meter', meterDenominator: 3});
        actions.saveMarker();
        expect(scope.error).toContain('denominator');
        Object.assign(scope, {markerKind: 'tempo', tempoCurve: 'exponential'});
        actions.saveMarker();
        expect(scope.error).toContain('Linear ramp');
        expect(p.conductor).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it.each(['', '   ', 'x'.repeat(81)])('rejects invalid section name length %s', name => {
        const {p, scope, actions} = fixture();
        scope.markerKind = 'section';
        scope.sectionName = name;
        actions.saveMarker();
        expect(scope.error).toContain('1–80');
        expect(p.conductor).toBeUndefined();
    });

    it('accepts boundary values and keeps a far-away section from extending song length', () => {
        const {p, scope, actions} = fixture();
        for (const bpm of [30, 300]) {
            actions.newMarker('tempo');
            scope.markerStep = bpm;
            scope.tempoBpm = bpm;
            actions.saveMarker();
        }
        for (const denominator of [1, 2, 4, 8, 16] as const) {
            actions.newMarker('meter');
            scope.markerStep = denominator;
            scope.meterNumerator = denominator === 1 ? 1 : 32;
            scope.meterDenominator = denominator;
            actions.saveMarker();
        }
        actions.newMarker('section');
        scope.markerStep = 1000000;
        scope.sectionName = 'x'.repeat(80);
        actions.saveMarker();
        expect(scope.error).toBe('');
        expect(p.conductor?.sections[0].step).toBe(1000000);
        expect(Math.max(...p.arrangement.map(clip => clip.start + clip.len))).toBe(96);
        expect(scope.touch).toHaveBeenCalledTimes(8);
    });

    it.each(['$playing', '$rendering'] as const)('blocks every marker mutation when %s changes after opening', lock => {
        const {p, scope, actions} = fixture();
        actions.newMarker('tempo');
        actions.saveMarker();
        const id = scope.editingId!;
        const before = JSON.stringify(p);
        scope[lock] = true;
        scope.tempoBpm = 200;
        actions.saveMarker();
        actions.deleteMarker('tempo', id);
        actions.newMarker('section');
        expect(JSON.stringify(p)).toBe(before);
        expect(scope.touch).toHaveBeenCalledTimes(1);
    });

    it('opens existing markers read-only during playback without moving the cursor', () => {
        const {scope, actions} = fixture();
        actions.newMarker('tempo');
        actions.saveMarker();
        scope.$playing = true;
        actions.editMarker('tempo', scope.editingId!);
        expect(scope.show).toBe(true);
        expect(scope.markerKind).toBe('tempo');
        expect(scope.$songCursor).toBe(19.3);
    });

    it('ignores stale deleted markers rather than resurrecting them on save', () => {
        const {p, scope, actions} = fixture();
        scope.editingId = randomUUID();
        actions.saveMarker();
        expect(scope.error).toContain('no longer exists');
        expect(p.conductor).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('keeps marker editing independent of the ruler cursor and loop', () => {
        const {p, scope, actions} = fixture();
        const section = {id: randomUUID(), step: 0, name: 'Intro'};
        p.conductor = {tempos: [], meters: [], sections: [section]};
        p.loop = {start: 32, end: 64};
        actions.editMarker('section', section.id);
        scope.sectionName = 'Opening';
        actions.saveMarker();
        actions.deleteMarker('section', section.id);
        scope.$rendering = true;
        actions.newMarker('section');
        actions.addAtPointer({clientX: 480, currentTarget: {getBoundingClientRect: () => ({left: 0})}} as unknown as MouseEvent);
        expect(scope.show).toBe(false);
        expect(p.loop).toEqual({start: 32, end: 64});
        expect(scope.$songCursor).toBe(19.3);
        expect(scope.touch).toHaveBeenCalledTimes(2);
    });

    it('traps focus, ignores disabled or hidden controls, and shields input keys from app shortcuts', () => {
        const {scope, actions} = fixture();
        const control = (disabled = false, visible = true) => ({
            focus: vi.fn(), matches: () => disabled, getClientRects: () => visible ? [{}] : []
        });
        const first = control();
        const last = control();
        const dialog = {querySelectorAll: () => [first, control(true), control(false, false), last], focus: vi.fn()};
        scope.document.activeElement = last;
        const forward = keyboard('Tab');
        actions.handleDialogKey(forward as unknown as KeyboardEvent, dialog as unknown as HTMLElement);
        expect(first.focus).toHaveBeenCalledTimes(1);
        expect(forward.preventDefault).toHaveBeenCalled();
        scope.document.activeElement = first;
        const backward = keyboard('Tab', true);
        actions.handleDialogKey(backward as unknown as KeyboardEvent, dialog as unknown as HTMLElement);
        expect(last.focus).toHaveBeenCalledTimes(1);
        for (const key of [' ', 'Delete', 'Backspace', 'z', 'Enter']) {
            const event = keyboard(key);
            actions.handleDialogKey(event as unknown as KeyboardEvent, dialog as unknown as HTMLElement);
            expect(event.stopPropagation).toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
    });

    it('closes on Escape with focus restoration and removes dialog listeners on teardown', async () => {
        const {scope, actions} = fixture();
        const dialog = {addEventListener: vi.fn(), removeEventListener: vi.fn()};
        const action = actions.dialogKeyboard({closest: () => dialog} as unknown as HTMLElement);
        expect(dialog.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        scope.show = true;
        actions.handleDialogKey(keyboard('Escape') as unknown as KeyboardEvent, dialog as unknown as HTMLElement);
        expect(scope.show).toBe(false);
        await tick();
        expect(scope.opener.focus).toHaveBeenCalledTimes(1);
        action.destroy();
        expect(dialog.removeEventListener).toHaveBeenCalledWith('keydown', dialog.addEventListener.mock.calls[0][1]);
    });

    it('uses actual bar boundaries for mixed meters including a shortened preceding bar', () => {
        const {p, scope, actions} = fixture();
        actions.newMarker('meter');
        scope.markerStep = 10;
        scope.meterNumerator = 7;
        scope.meterDenominator = 8;
        actions.saveMarker();
        expect(barsInRange(p, 0, 39).map(bar => [bar.bar, bar.start, bar.end])).toEqual([
            [1, 0, 10], [2, 10, 24], [3, 24, 38], [4, 38, 52]
        ]);
        expect(barAt(p, 24).bar).toBe(3);
        expect(playlist).toContain('barsInRange($project, scrollLeft / cellWidth,');
        expect(playlist).toContain('barAt($project!, clip.start).bar');
        expect(playlist).toContain('class="bar-line"');
        expect(playlist).not.toContain('calc(var(--cell-width) * 16)');
    });
});