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
    MixerChannel, MixerMaster
} from '../lib/mixer';
import type {
    Project
} from '../lib/types';

import {
    createInstrument, MASTER_SLIDERS
} from '../lib/instruments';
import {
    addMixerBus, canRoute, ensureMixer, MAX_MIXER_BUSES, removeMixerBus, resolveMixer
} from '../lib/mixer';

const source = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}.svelte`, import.meta.url)), 'utf8');
const mixer = source('Mixer');
const strip = source('MixerStrip');
const toolbar = source('TopBar');

interface MixerActions {
    editChannel: (id: string, change: (channel: MixerChannel) => void) => void;
    masterNumber: (key: Exclude<keyof MixerMaster, 'limiter'>, value: number) => void;
    addBus: (effect: 'none' | 'delay') => void;
    deleteBus: (id: string) => void;
    renameBus: (id: string, input: {value: string}) => void;
    route: (id: string, target: string) => void;
    addSend: (id: string, target: string) => void;
    numeric: (input: {valueAsNumber: number}, min: number, max: number, change: (value: number) => void) => void;
    db: (value: number) => string;
}

// Exercise the component's actual handlers without booting the unrelated audio engine.
function handlers<T>(component: string, scope: object, names: string[]): T {
    const script = component.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const parsed = createSourceFile('component.ts', script, ScriptTarget.Latest, true);
    const functions = parsed.statements.filter(isFunctionDeclaration).map(node => node.getText(parsed)).join('\n');
    const js = transpileModule(functions, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    return runInNewContext(`${js}\n({${names.join(',')}})`, scope) as T;
}

function fixture() {
    const p: Project = {
        formatVersion: 1, instruments: [createInstrument('Bass')], patterns: [], arrangement: [], tracks: [], bpm: 120,
        zoom: {seq: {width: 1, height: 1}, arr: {width: 1, height: 1}}
    };
    const scope = {
        $project: p as Project | null, $rendering: false,
        get mixer() {return resolveMixer(p.mixer, p.instruments.map(inst => inst.id));},
        touch: vi.fn(), ensureMixer, addMixerBus, removeMixerBus, canRoute, tick, selectedId: 'master', details: undefined,
        MASTER_SLIDERS
    };
    const actions = handlers<MixerActions>(mixer, scope, [
        'editChannel', 'masterNumber', 'addBus', 'deleteBus', 'renameBus', 'route', 'addSend', 'numeric', 'db'
    ]);
    return {p, scope, actions, id: p.instruments[0].id};
}

describe('Mixer component controls', () => {
    it.each(['Mixer', 'MixerStrip', 'TopBar'])('compiles %s without accessibility diagnostics', name => {
        const result = compile(source(name), {filename: `${name}.svelte`, generate: 'client'});
        expect(result.js.code.length).toBeGreaterThan(0);
        expect(result.warnings.filter(warning => warning.code.startsWith('a11y'))).toEqual([]);
    });

    it('opens independently of Studio and mounts meters only while the dialog is open', () => {
        expect(toolbar.indexOf('className="mixer-toggle"')).toBeLessThan(toolbar.indexOf('{#if utilityExpanded}'));
        expect(toolbar).toMatch(/<Dialog[^>]*title="Mixer"[^>]*bind:show=\{showMixer\}>\s*\{#if showMixer\}\s*<Mixer\/>/);
        expect(toolbar).toContain('width="1180px"');
        expect(mixer).toMatch(/onMount\(\(\) => \{[\s\S]*setInterval[\s\S]*1000 \/ 15/);
        expect(mixer).toContain('clearInterval(timer)');
        expect(mixer).toContain('$rendering ? silence : mixerMeters()');
        expect(mixer).toContain("removeEventListener('keydown', trapFocus)");
    });

    it('keeps controls labelled, scrollable and keyboard accessible', () => {
        expect(mixer).toContain('overflow-x: auto');
        expect(mixer).toContain("event.key !== 'Tab'");
        expect(mixer).toContain("el.matches(':disabled')");
        expect(mixer).toContain('details?.focus()');
        expect(strip).toContain('aria-pressed={channel.mute}');
        expect(strip).toContain('aria-pressed={channel.solo}');
        expect(strip).toContain('aria-label={`${name} output`}');
        expect(strip).toContain('let {channel, name, kind, selected, outputs, peak, rms');
        expect(mixer).toContain('$derived(structuredClone(resolveMixer(');
        expect(mixer + strip).not.toContain('e.target');
    });

    it('persists mixer-only edits and keeps legacy limiter protection off', () => {
        const {p, scope, actions, id} = fixture();
        const patch = structuredClone(p.instruments[0].params);
        expect(p.mixer).toBeUndefined();
        actions.editChannel(id, channel => {
            channel.volume = 0.4;
            channel.pan = -0.3;
            channel.mute = true;
            channel.solo = true;
            channel.reverb = 0.2;
        });
        expect(p.mixer?.channels[id]).toMatchObject({volume: 0.4, pan: -0.3, mute: true, solo: true, reverb: 0.2});
        expect(p.instruments[0].params).toEqual(patch);
        expect(p.instruments[0].mute).toBeUndefined();
        expect(p.mixer?.master.limiter).toBe(false);
        expect(scope.touch).toHaveBeenCalledOnce();
    });

    it('rejects all mixer writes while rendering or without a project', () => {
        const {p, scope, actions, id} = fixture();
        scope.$rendering = true;
        actions.editChannel(id, channel => channel.volume = 0.2);
        actions.masterNumber('driveDb', 8);
        actions.addBus('delay');
        expect(p.mixer).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
        scope.$rendering = false;
        scope.$project = null;
        actions.addBus('none');
        expect(scope.touch).not.toHaveBeenCalled();
        expect(mixer).toContain('disabled={$rendering || !$project}');
        expect(toolbar).toContain('disabled={$rendering || !$project}');
    });

    it('clamps numbers, rejecting blank and non-finite inputs', () => {
        const {actions} = fixture();
        const change = vi.fn();
        for (const valueAsNumber of [NaN, Infinity, -Infinity]) {
            actions.numeric({valueAsNumber}, -12, 0, change);
        }
        expect(change).not.toHaveBeenCalled();
        actions.numeric({valueAsNumber: -20}, -12, 0, change);
        actions.numeric({valueAsNumber: 7}, -12, 0, change);
        expect(change.mock.calls).toEqual([[-12], [0]]);
        const channel = resolveMixer(undefined, ['test']).channels.test;
        const stripActions = handlers<{changeNumber: (input: {valueAsNumber: number}, key: string) => void}>(strip, {
            onedit: (edit: (value: MixerChannel) => void) => edit(channel)
        }, ['changeNumber']);
        stripActions.changeNumber({valueAsNumber: 8}, 'volume');
        stripActions.changeNumber({valueAsNumber: -2}, 'pan');
        stripActions.changeNumber({valueAsNumber: NaN}, 'reverb');
        expect(channel).toMatchObject({volume: 2, pan: -1, reverb: 1});
    });

    it('supports nested routes but rejects output and send feedback, including muted zero sends', () => {
        const {p, actions, id} = fixture();
        actions.addBus('none');
        actions.addBus('delay');
        const [group, delay] = p.mixer!.buses;
        actions.route(id, group.id);
        actions.route(group.id, delay.id);
        actions.route(delay.id, group.id);
        actions.addSend(delay.id, group.id);
        expect(group.output).toBe(delay.id);
        expect(delay.output).toBe('master');
        expect(delay.sends).toEqual([]);
        actions.route(group.id, 'master');
        actions.addSend(group.id, delay.id);
        actions.editChannel(group.id, channel => {channel.mute = true; channel.sends[0].level = 0;});
        actions.route(delay.id, group.id);
        expect(delay.output).toBe('master');
        actions.addSend(id, delay.id);
        actions.addSend(id, delay.id);
        actions.addSend(id, 'master');
        expect(p.mixer!.channels[id].sends).toEqual([{busId: delay.id, level: 0.25}]);
        expect(mixer).toContain('mixer.buses.filter(bus => canRoute(mixer, strip.id, bus.id))');
        expect(mixer).toContain('canRoute(mixer, selected.id, bus.id)');
    });

    it('caps buses, validates names and gracefully removes bus routes and sends', () => {
        const {p, actions, id} = fixture();
        for (let i = 0; i < MAX_MIXER_BUSES + 1; i++) {actions.addBus('none');}
        expect(p.mixer!.buses).toHaveLength(MAX_MIXER_BUSES);
        const bus = p.mixer!.buses[0];
        actions.renameBus(bus.id, {value: '  Drums  '});
        expect(bus.name).toBe('Drums');
        const blank = {value: '   '};
        actions.renameBus(bus.id, blank);
        expect(blank.value).toBe('Drums');
        actions.renameBus(bus.id, {value: 'a'.repeat(100)});
        expect(bus.name).toHaveLength(80);
        actions.route(id, bus.id);
        actions.addSend(id, bus.id);
        actions.deleteBus(bus.id);
        expect(p.mixer!.channels[id]).toMatchObject({output: 'master', sends: []});
        expect(p.mixer!.buses).toHaveLength(MAX_MIXER_BUSES - 1);
    });

    it('makes TopBar master controls project-backed, bounded and rendering-safe', () => {
        const {p, scope} = fixture();
        const actions = handlers<{setMaster: (key: string, value: number) => void}>(toolbar, scope, ['setMaster']);
        actions.setMaster('vol', 5);
        expect(p.mixer!.master.vol).toBe(1);
        expect(scope.touch).toHaveBeenCalledOnce();
        scope.$rendering = true;
        actions.setMaster('vol', 0.3);
        expect(p.mixer!.master.vol).toBe(1);
        expect(scope.touch).toHaveBeenCalledOnce();
        expect(toolbar).toContain('$derived({...($project?.mixer?.master ?? legacyMaster)})');
        expect(toolbar).not.toContain('applyMaster');
        expect(toolbar).not.toContain('$state({...master})');
        expect(toolbar).toContain('{#each MASTER_SLIDERS as s (s.id)}');
    });

    it('shows correctly converted sample-peak/RMS meters and honest protection semantics', () => {
        const {actions} = fixture();
        expect(actions.db(0)).toBe('−∞');
        expect(actions.db(1)).toBe('0.0');
        expect(actions.db(0.5)).toBe('-6.0');
        expect(mixer).toContain("['L', 'R']");
        expect(mixer).toContain('meters.master.rms[i]');
        expect(mixer).toContain('Math.max(0, meters.master.reduction)');
        expect(mixer).toContain('5ms lookahead');
        expect(mixer).not.toMatch(/LUFS|dBTP|true[- ]peak/i);
        expect(mixer).toContain('Post-fader only');
        expect(mixer).toContain('Wet-only delay return');
        expect(mixer).toContain('Solo-in-place preserves contributing sources and their sends');
    });
});