import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { tick } from 'svelte';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { createSourceFile, isFunctionDeclaration, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { MixerChannel, MixerMaster } from '../lib/mixer';
import type { Project } from '../lib/types';

import { createInstrument, MASTER_SLIDERS } from '../lib/instruments';
import {
    addMixerBus,
    canRoute,
    ensureMixer,
    MAX_MIXER_BUSES,
    removeMixerBus,
    resolveMixer,
} from '../lib/mixer';
import MixerFader from './MixerFader.svelte';
import MixerStrip from './MixerStrip.svelte';

const source = (name: string) =>
    readFileSync(fileURLToPath(new URL(`./${name}.svelte`, import.meta.url)), 'utf8');
const mixer = source('Mixer');
const strip = source('MixerStrip');
const fader = source('MixerFader');
const toolbar = source('TopBar');

interface MixerActions {
    editChannel: (id: string, change: (channel: MixerChannel) => void) => void;
    masterNumber: (key: Exclude<keyof MixerMaster, 'limiter'>, value: number) => void;
    addBus: (effect: 'none' | 'delay') => void;
    deleteBus: (id: string) => void;
    renameBus: (id: string, input: { value: string }) => void;
    route: (id: string, target: string) => void;
    addSend: (id: string, target: string) => void;
    numeric: (
        input: { valueAsNumber: number },
        min: number,
        max: number,
        change: (value: number) => void,
    ) => void;
    db: (value: number) => string;
    toggleStrip: (id: string) => void;
    closeDetails: () => void;
}

// Exercise the component's actual handlers without booting the unrelated audio engine.
function handlers<T>(component: string, scope: object, names: string[]): T {
    const script = component.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const parsed = createSourceFile('component.ts', script, ScriptTarget.Latest, true);
    const functions = parsed.statements
        .filter(isFunctionDeclaration)
        .map(node => node.getText(parsed))
        .join('\n');
    const js = transpileModule(functions, {
        compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText;
    return runInNewContext(`${js}\n({${names.join(',')}})`, scope) as T;
}

function fixture() {
    const p: Project = {
        formatVersion: 1,
        instruments: [createInstrument('Bass')],
        patterns: [],
        arrangement: [],
        tracks: [],
        bpm: 120,
        zoom: { seq: { width: 1, height: 1 }, arr: { width: 1, height: 1 } },
    };
    const scope = {
        $project: p as Project | null,
        $rendering: false,
        get mixer() {
            return resolveMixer(
                p.mixer,
                p.instruments.map(inst => inst.id),
            );
        },
        touch: vi.fn(),
        ensureMixer,
        addMixerBus,
        removeMixerBus,
        canRoute,
        tick,
        selectedId: '',
        details: undefined,
        root: { querySelectorAll: () => [] },
        MASTER_SLIDERS,
    };
    const actions = handlers<MixerActions>(mixer, scope, [
        'editChannel',
        'masterNumber',
        'addBus',
        'deleteBus',
        'renameBus',
        'route',
        'addSend',
        'numeric',
        'db',
        'toggleStrip',
        'closeDetails',
    ]);
    return { p, scope, actions, id: p.instruments[0].id };
}

describe('Mixer component controls', () => {
    it.each(['Mixer', 'MixerStrip', 'MixerFader', 'TopBar'])(
        'compiles %s without accessibility diagnostics',
        name => {
            const result = compile(source(name), {
                filename: `${name}.svelte`,
                generate: 'client',
            });
            expect(result.js.code.length).toBeGreaterThan(0);
            expect(result.warnings.filter(warning => warning.code.startsWith('a11y'))).toEqual([]);
        },
    );

    it('opens independently of Studio and mounts meters only while the dialog is open', () => {
        expect(toolbar.indexOf('className="mixer-toggle"')).toBeLessThan(
            toolbar.indexOf('{#if utilityExpanded}'),
        );
        expect(toolbar).toMatch(
            /<Dialog[^>]*title="Mixer"[^>]*bind:show=\{showMixer}>\s*\{#if showMixer}[\s\S]*<Mixer\s*\/>/,
        );
        expect(toolbar).toContain('width="1180px"');
        expect(toolbar).not.toMatch(/<Dialog[^>]*height=[^>]*title="Mixer"/);
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
        expect(mixer).toContain('aria-label={`${selected.name} output`}');
        expect(strip).toMatch(
            /let\s+\{\s*channel,\s*name,\s*kind,\s*selected,\s*outputs,\s*peak,\s*rms/,
        );
        expect(mixer).toMatch(/\$derived\(\s*structuredClone\(\s*resolveMixer\(/);
        expect(mixer + strip).not.toContain('e.target');
    });

    it('makes channel roles, signal flow and the selected inspector immediately clear', () => {
        expect(mixer).toContain('Instruments');
        expect(mixer).toContain('Buses / FX');
        expect(mixer).toContain('Signal flows left to right into Master');
        expect(mixer).toContain('Group bus');
        expect(mixer).toContain('Delay return');
        expect(mixer).toContain('Channel inspector');
        expect(mixer).toContain('Select a strip to edit routing, sends and processing.');
        expect(mixer).toContain('position: sticky');
        expect(mixer).toContain('right: 0');
        expect(strip).toContain("kind !== 'Instrument'");
        expect(strip).toContain('Out →');
    });

    it('opens with only balance controls, discloses one channel at a time and never edits by selection', () => {
        const { p, scope, actions, id } = fixture();
        expect(mixer).toContain("let selectedId = $state('')");
        expect(mixer).toContain("{#if selected || selectedId === 'master'}");
        expect(mixer).toContain('{#key selectedId}');
        expect(mixer).toContain('{#if selected.channel.compressor.enabled}');
        expect(mixer).not.toContain('type="number"');
        actions.toggleStrip(id);
        expect(scope.selectedId).toBe(id);
        actions.toggleStrip('master');
        expect(scope.selectedId).toBe('master');
        actions.toggleStrip('master');
        expect(scope.selectedId).toBe('');
        expect(p.mixer).toBeUndefined();
        expect(scope.touch).not.toHaveBeenCalled();
    });

    it('shows compact labelled balance controls instead of a form on every strip', () => {
        const channel = resolveMixer(undefined, ['bass']).channels.bass;
        const html = render(MixerStrip, {
            props: {
                id: 'bass',
                name: 'Bass',
                color: '#abcdef',
                kind: 'Instrument',
                selected: false,
                channel,
                outputs: [],
                peak: 0.5,
                rms: 0.25,
                onselect: vi.fn(),
                onedit: vi.fn(),
            },
        }).body;
        expect(html).toContain('aria-label="Bass fader"');
        expect(html).toContain('aria-label="Bass pan"');
        expect(html).toContain('aria-label="Mute Bass"');
        expect(html).toContain('aria-label="Solo Bass"');
        expect(html).toContain('fa fa-volume-xmark');
        expect(html).toContain('fa fa-headphones');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('Out → Master');
        expect(html).not.toMatch(/>M<|>S</);
        expect(html).not.toContain('<select');
        expect(html).not.toContain('Reverb send');
        expect(html).not.toContain('Processing &amp; sends');
    });

    it('shares bounded vertical faders and stereo sample meters with Master', () => {
        const values: number[] = [];
        const actions = handlers<{ change: (input: { valueAsNumber: number }) => void }>(
            fader,
            { max: 1, onchange: (value: number) => values.push(value) },
            ['change'],
        );
        for (const valueAsNumber of [NaN, Infinity, -1, 0.75, 2]) {
            actions.change({ valueAsNumber });
        }
        expect(values).toEqual([0, 0.75, 1]);
        const html = render(MixerFader, {
            props: {
                name: 'Master',
                value: 0.5,
                max: 1,
                peaks: [0, 2],
                onchange: vi.fn(),
            },
        }).body;
        expect(html).toContain('aria-orientation="vertical"');
        expect(html).toContain('aria-valuetext="-6.0 dB"');
        expect(html).toContain('aria-label="Master L peak"');
        expect(html).toContain('aria-label="Master R peak"');
        expect(html).toContain('aria-valuenow="-60"');
        expect(html).toContain('aria-valuenow="6"');
        expect(html).not.toMatch(/NaN|Infinity/);
        expect(fader).toContain('writing-mode: vertical-lr');
        expect(fader).toContain('direction: rtl');
    });

    it('persists mixer-only edits and keeps legacy limiter protection off', () => {
        const { p, scope, actions, id } = fixture();
        const patch = structuredClone(p.instruments[0].params);
        expect(p.mixer).toBeUndefined();
        actions.editChannel(id, channel => {
            channel.volume = 0.4;
            channel.pan = -0.3;
            channel.mute = true;
            channel.solo = true;
            channel.reverb = 0.2;
        });
        expect(p.mixer?.channels[id]).toMatchObject({
            volume: 0.4,
            pan: -0.3,
            mute: true,
            solo: true,
            reverb: 0.2,
        });
        expect(p.instruments[0].params).toEqual(patch);
        expect(p.instruments[0].mute).toBeUndefined();
        expect(p.mixer?.master.limiter).toBe(false);
        expect(scope.touch).toHaveBeenCalledOnce();
    });

    it('rejects all mixer writes while rendering or without a project', () => {
        const { p, scope, actions, id } = fixture();
        scope.$rendering = true;
        actions.editChannel(id, channel => (channel.volume = 0.2));
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
        const { actions } = fixture();
        const change = vi.fn();
        for (const valueAsNumber of [NaN, Infinity, -Infinity]) {
            actions.numeric({ valueAsNumber }, -12, 0, change);
        }
        expect(change).not.toHaveBeenCalled();
        actions.numeric({ valueAsNumber: -20 }, -12, 0, change);
        actions.numeric({ valueAsNumber: 7 }, -12, 0, change);
        expect(change.mock.calls).toEqual([[-12], [0]]);
        const channel = resolveMixer(undefined, ['test']).channels.test;
        const stripActions = handlers<{
            changeNumber: (input: { valueAsNumber: number }, key: string) => void;
        }>(
            strip,
            {
                onedit: (edit: (value: MixerChannel) => void) => edit(channel),
            },
            ['changeNumber'],
        );
        stripActions.changeNumber({ valueAsNumber: 8 }, 'volume');
        stripActions.changeNumber({ valueAsNumber: -2 }, 'pan');
        stripActions.changeNumber({ valueAsNumber: NaN }, 'reverb');
        expect(channel).toMatchObject({ volume: 2, pan: -1, reverb: 1 });
    });

    it('supports nested routes but rejects output and send feedback, including muted zero sends', () => {
        const { p, actions, id } = fixture();
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
        actions.editChannel(group.id, channel => {
            channel.mute = true;
            channel.sends[0].level = 0;
        });
        actions.route(delay.id, group.id);
        expect(delay.output).toBe('master');
        actions.addSend(id, delay.id);
        actions.addSend(id, delay.id);
        actions.addSend(id, 'master');
        expect(p.mixer!.channels[id].sends).toEqual([{ busId: delay.id, level: 0.25 }]);
        expect(mixer).toMatch(
            /mixer\.buses\.filter\(\s*bus\s*=>\s*canRoute\(mixer, selected\.id, bus\.id\)\s*\)/,
        );
        expect(mixer).toContain('canRoute(mixer, selected.id, bus.id)');
    });

    it('caps buses, validates names and gracefully removes bus routes and sends', () => {
        const { p, actions, id } = fixture();
        for (let i = 0; i < MAX_MIXER_BUSES + 1; i++) {
            actions.addBus('none');
        }
        expect(p.mixer!.buses).toHaveLength(MAX_MIXER_BUSES);
        const bus = p.mixer!.buses[0];
        actions.renameBus(bus.id, { value: '  Drums  ' });
        expect(bus.name).toBe('Drums');
        const blank = { value: '   ' };
        actions.renameBus(bus.id, blank);
        expect(blank.value).toBe('Drums');
        actions.renameBus(bus.id, { value: 'a'.repeat(100) });
        expect(bus.name).toHaveLength(80);
        actions.route(id, bus.id);
        actions.addSend(id, bus.id);
        actions.deleteBus(bus.id);
        expect(p.mixer!.channels[id]).toMatchObject({ output: 'master', sends: [] });
        expect(p.mixer!.buses).toHaveLength(MAX_MIXER_BUSES - 1);
    });

    it('makes TopBar master controls project-backed, bounded and rendering-safe', () => {
        const { p, scope } = fixture();
        const actions = handlers<{ setMaster: (key: string, value: number) => void }>(
            toolbar,
            scope,
            ['setMaster'],
        );
        actions.setMaster('vol', 5);
        expect(p.mixer!.master.vol).toBe(1);
        expect(scope.touch).toHaveBeenCalledOnce();
        scope.$rendering = true;
        actions.setMaster('vol', 0.3);
        expect(p.mixer!.master.vol).toBe(1);
        expect(scope.touch).toHaveBeenCalledOnce();
        expect(toolbar).toMatch(
            /\$derived\(\s*\{\s*\.\.\.\(\$project\?\.mixer\?\.master\s*\?\?\s*legacyMaster\)\s*}\s*\)/,
        );
        expect(toolbar).not.toContain('applyMaster');
        expect(toolbar).not.toContain('$state({...master})');
        expect(toolbar).toContain('{#each MASTER_SLIDERS as s (s.id)}');
    });

    it('shows correctly converted sample-peak/RMS meters and honest protection semantics', () => {
        const { actions } = fixture();
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
        expect(strip).toContain('Solo — includes contributing sources and sends');
    });
});
