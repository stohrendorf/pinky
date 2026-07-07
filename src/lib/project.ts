// Project model — instruments, pattern bank, song arrangement + persistence
import type {
    Writable
} from 'svelte/store';

import {
    get, writable
} from 'svelte/store';

import type {
    Instrument, Note, Pattern, Project, Track
} from './types';

import amberSongJson from '../../pinky-amber.json';
import axelFSongJson from '../../pinky-axelf.json';
import divaSongJson from '../../pinky-diva.json';
import ironSongJson from '../../pinky-iron.json';
import jazzSongJson from '../../pinky-jazz.json';
import noiseSongJson from '../../pinky-noise.json';
import suiteSongJson from '../../pinky-suite.json';
import toccataSongJson from '../../pinky-toccata.json';
import {
    createInstrument, PRESETS
} from './instruments';
import {
    STEPS
} from './notes';
import {
    buildBitHorizon, buildFarHorizon, buildPocketTheory, buildPrismCircuit, buildRelayDawn, buildVelvetSpurs
} from './original-demos';
import {
    createId, isProjectId, PROJECT_FORMAT_VERSION
} from './types';

export function createPattern(name: string, steps = STEPS): Pattern {
    const colors = ['#53d8fb', '#ff9f43', '#ee5253', '#10ac84', '#5f27cd', '#0abde3', '#ff6b6b', '#48dbfb'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return {id: createId(), name, steps, color, tracks: {}};
}

export function trackNotes(pattern: Pattern, instId: string): Note[] { // lazily created per instrument
    if (!pattern.tracks[instId]) {pattern.tracks[instId] = [];}
    return pattern.tracks[instId];
}

/* ---- stores ---- */
export const project: Writable<Project | null> = writable(null);
export const selInstId: Writable<string | null> = writable(null);
export const selPatId: Writable<string | null> = writable(null);
export const lastPlayedPitch: Writable<string> = writable('C4');
export const playing: Writable<boolean> = writable(false);
export const playMode: Writable<string> = writable('');      // '' | 'pattern' | 'song'
export const curStep: Writable<number> = writable(-1);
export const songPos: Writable<number> = writable(-1);
export const songLabel: Writable<string> = writable('');
export const songCursor: Writable<number> = writable(0); // where song playback starts (set by clicking the playlist timeline)
export const savedAt: Writable<number> = writable(0);   // timestamp of the last save (drives the toolbar feedback)

export const touch = () => project.update(p => p);

export function defaultZoom(): NonNullable<Project['zoom']> {
    return {
        seq: {width: 24, height: 14},
        arr: {width: 24, height: 32}
    };
}

export function selectedInstrument(): Instrument {
    const p = get(project);
    if (!p) {throw new Error('Project not initialized');}
    return p.instruments.find(i => i.id === get(selInstId)) || p.instruments[0];
}

/* ---- demo songs ---- */
// Demo metadata lives beside the loader registry so the picker and supported
// project IDs cannot drift apart. JSON demos can be updated by exporting them.
export const DEMO_LIBRARY = [
    {id: 'axelf', label: 'Axel F', icon: 'fa-headphones', title: 'Axel F (Pinky Mix) — F minor synth-funk'},
    {id: 'toccata', label: 'Toccata', icon: 'fa-landmark', title: 'Toccata & Fugue (Pinky Mix) — BWV 565 goes rock'},
    {id: 'noise', label: 'Out of Noise', icon: 'fa-wind', title: 'Out of Noise — music emerging from filtered noise'},
    {id: 'jazz', label: 'Smoke & Mirrors', icon: 'fa-martini-glass', title: 'Smoke & Mirrors — late-night jazz noir'},
    {
        id: 'iron',
        label: 'Iron Garden',
        icon: 'fa-gears',
        title: 'Iron Garden — a mechanical garden of tuned percussion, bell metal and breathing noise'
    },
    {
        id: 'suite',
        label: 'The Long Way Home',
        icon: 'fa-route',
        title: 'The Long Way Home — an orchestral suite in five movements'
    },
    {
        id: 'diva',
        label: 'Diva Machina',
        icon: 'fa-microphone-lines',
        title: 'Diva Machina — an operatic aria that turns into something no human could sing'
    },
    {
        id: 'relay',
        label: 'Relay Dawn',
        icon: 'fa-satellite-dish',
        title: 'Relay Dawn — an original cinematic space pulse'
    },
    {id: 'frontier', label: 'Far Horizon', icon: 'fa-flag', title: 'Far Horizon — an original resolute sci-fi march'},
    {
        id: 'pocket',
        label: 'Pocket Theory',
        icon: 'fa-record-vinyl',
        title: 'Pocket Theory — an original syncopated funk piece'
    },
    {id: 'amber', label: 'Amber Hours', icon: 'fa-mug-hot', title: 'Amber Hours — a lo-fi ambient coding companion'},
    {
        id: 'velvet',
        label: 'Velvet Spurs',
        icon: 'fa-hat-cowboy',
        title: 'Velvet Spurs — soul, blues and cinematic flamenco in a midnight chase'
    },
    {id: 'prism', label: 'Prism Circuit', icon: 'fa-gem', title: 'Prism Circuit — a progressive electronic showcase'},
    {id: 'chip', label: 'Bit Horizon', icon: 'fa-gamepad', title: 'Bit Horizon — an original chiptune adventure'}
] as const;
export type DemoSong = typeof DEMO_LIBRARY[number]['id'];
export const activeDemo: Writable<DemoSong | null> = writable(null);

const CURRENT_PARAM_KEYS = [
    'tone', 'q', 'harm', 'falloff', 'stretch', 'noise', 'noiseFreq',
    'formant', 'f1', 'f2', 'f3', 'formantQ', 'vib', 'vibRate', 'vibDelay',
    'pitchDrop', 'pitchTime', 'noiseBend', 'voices', 'detune', 'att', 'dec',
    'sus', 'rel', 'gain', 'pan'
] as const;

const projectJson = (value: unknown): Project => {
    if (!isProject(value)) {throw new Error('Bundled demo does not match the current project format');}
    return value;
};

const DEMO_SONGS: Record<DemoSong, Project> = {
    axelf: projectJson(axelFSongJson),
    toccata: projectJson(toccataSongJson),
    noise: projectJson(noiseSongJson),
    jazz: projectJson(jazzSongJson),
    iron: projectJson(ironSongJson),
    suite: projectJson(suiteSongJson),
    diva: projectJson(divaSongJson),
    relay: buildRelayDawn(),
    frontier: buildFarHorizon(),
    pocket: buildPocketTheory(),
    amber: projectJson(amberSongJson),
    velvet: buildVelvetSpurs(),
    prism: buildPrismCircuit(),
    chip: buildBitHorizon(),
};

export function isProject(value: unknown): value is Project {
    if (!value || typeof value !== 'object') {return false;}
    const candidate = value as Partial<Project>;
    return candidate.formatVersion === PROJECT_FORMAT_VERSION
        && Array.isArray(candidate.instruments) && Array.isArray(candidate.patterns) && Array.isArray(candidate.arrangement)
        && Array.isArray(candidate.tracks) && typeof candidate.bpm === 'number' && !!candidate.zoom
        && candidate.instruments.every(instrument => isProjectId(instrument?.id))
        && candidate.patterns.every(pattern => isProjectId(pattern?.id))
        && candidate.arrangement.every(clip => isProjectId(clip?.id) && isProjectId(clip.patternId))
        && (candidate.automation?.every(lane => isProjectId(lane?.id)) ?? true)
        && candidate.instruments.every(instrument => {
            const params = instrument?.params;
            return !!params && typeof params === 'object'
                && CURRENT_PARAM_KEYS.every(key => typeof params[key] === 'number')
                && typeof params.legatoCurve === 'string'
                && Array.isArray(params.partials) && params.partials.length > 0;
        });
}

export function buildDemoProject(song: DemoSong = 'axelf'): Project {
    const demo = JSON.parse(JSON.stringify(DEMO_SONGS[song])) as Project;
    return demo;
}

export function newEmptyProject(): Project {
    const lead = createInstrument('Pluck', PRESETS['Pluck']);
    const pat = createPattern('pattern 1');
    const tracks: Track[] = [{name: 'Track 1', color: '#53d8fb'}];
    return {
        formatVersion: PROJECT_FORMAT_VERSION,
        instruments: [lead],
        patterns: [pat],
        arrangement: [{id: createId(), patternId: pat.id, track: 0, start: 0, len: 32}],
        tracks,
        bpm: 112,
        zoom: defaultZoom()
    };
}

/* ---- persistence ---- */
const LS_KEY = 'pinky-project-v1';

export function saveProject(): void {
    const cur = get(project);
    if (!cur) {return;}
    localStorage.setItem(LS_KEY, JSON.stringify(cur));
    savedAt.set(Date.now());
}

export function loadSavedProject(): Project | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) {return null;}
        const saved: unknown = JSON.parse(raw) as unknown;
        return isProject(saved) ? saved : null;
    } catch {
        return null;
    }
}

/* ---- import / export ---- */
export function exportProject(): void {
    const cur = get(project);
    if (!cur) {return;}
    const blob = new Blob([JSON.stringify(cur, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pinky-song.json';
    a.click();
    URL.revokeObjectURL(url);
}

export function importProject(json: string): boolean { // returns true on success
    let p: unknown;
    try {
        p = JSON.parse(json) as unknown;
    } catch {
        return false;
    }
    if (!isProject(p)) {return false;}
    activeDemo.set(null);
    project.set(p);
    selInstId.set(p.instruments[0].id);
    selPatId.set(p.patterns[0].id);
    lastPlayedPitch.set('C4');
    songCursor.set(0); // a stale cursor from the previous song may sit past the new song's end
    return true;
}

/* ---- init ---- */
export function initProject(): void {
    const saved = loadSavedProject();
    const p = saved || buildDemoProject();
    activeDemo.set(saved ? null : 'axelf');
    project.set(p);
    selInstId.set(p.instruments[0].id);
    selPatId.set(p.patterns[0].id);
    lastPlayedPitch.set('C4');
}

export function loadDemoProject(song: DemoSong = 'axelf'): void {
    const p = buildDemoProject(song);
    activeDemo.set(song);
    project.set(p);
    selInstId.set(p.instruments[0].id);
    selPatId.set(p.patterns[0].id);
    lastPlayedPitch.set('C4');
    songCursor.set(0);
}
