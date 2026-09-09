import type { Project } from './types';

import { createId, isProjectId } from './types';

export interface MixerCompressor {
    enabled: boolean;
    threshold: number;
    ratio: number;
}

export interface MixerSend {
    busId: string;
    level: number;
}

export interface MixerChannel {
    volume: number;
    pan: number;
    mute: boolean;
    solo: boolean;
    output: string;
    reverb: number;
    highpass: number;
    tilt: number;
    compressor: MixerCompressor;
    sends: MixerSend[];
}

export interface MixerBus extends MixerChannel {
    id: string;
    name: string;
    effect: 'none' | 'delay';
    delayTime: number;
    feedback: number;
}

export interface MixerMaster {
    vol: number;
    rev: number;
    tilt: number;
    limiter: boolean;
    driveDb: number;
    ceilingDb: number;
    release: number;
}

export interface MixerState {
    channels: Record<string, MixerChannel>;
    buses: MixerBus[];
    master: MixerMaster;
}

export const MAX_MIXER_BUSES = 16;

export function defaultChannel(): MixerChannel {
    return {
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        output: 'master',
        reverb: 1,
        highpass: 20,
        tilt: 0,
        compressor: { enabled: false, threshold: -18, ratio: 3 },
        sends: [],
    };
}

export function createMixer(ids: string[], protect = true): MixerState {
    return {
        channels: Object.fromEntries(ids.map(id => [id, defaultChannel()])),
        buses: [],
        master: {
            vol: 0.8,
            rev: 0.18,
            tilt: 0,
            limiter: protect,
            driveDb: 0,
            ceilingDb: -1,
            release: 0.12,
        },
    };
}

/** Missing mixer data means an unchanged legacy mix, not automatic mastering. */
export function resolveMixer(mixer: MixerState | undefined, ids: string[]): MixerState {
    if (!mixer) {
        return createMixer(ids, false);
    }
    return {
        ...mixer,
        channels: Object.fromEntries(ids.map(id => [id, mixer.channels[id] || defaultChannel()])),
    };
}

export function ensureMixer(p: Project): MixerState {
    p.mixer = resolveMixer(
        p.mixer,
        p.instruments.map(inst => inst.id),
    );
    return p.mixer;
}

export function addMixerBus(
    mixer: MixerState,
    effect: MixerBus['effect'] = 'none',
): MixerBus | null {
    if (mixer.buses.length >= MAX_MIXER_BUSES) {
        return null;
    }
    const bus: MixerBus = {
        ...defaultChannel(),
        id: createId(),
        name: effect === 'delay' ? 'Echo return' : 'Group',
        reverb: 0,
        effect,
        delayTime: 0.25,
        feedback: 0.3,
    };
    mixer.buses.push(bus);
    return bus;
}

const nodesOf = (mixer: MixerState): [string, MixerChannel][] => [
    ...Object.entries(mixer.channels),
    ...mixer.buses.map(bus => [bus.id, bus] as [string, MixerChannel]),
];

const destinations = (channel: MixerChannel): string[] => [
    channel.output,
    ...channel.sends.map(send => send.busId),
];

/** Both output and send edges count, including sends currently turned down. */
export function canRoute(mixer: MixerState, source: string, target: string): boolean {
    if (!nodesOf(mixer).some(([id]) => id === source)) {
        return false;
    }
    if (target === 'master') {
        return true;
    }
    const buses = new Map(mixer.buses.map(bus => [bus.id, bus]));
    if (!buses.has(target)) {
        return false;
    }
    const visited = new Set<string>();
    const reachesSource = (id: string): boolean => {
        if (id === source) {
            return true;
        }
        if (visited.has(id)) {
            return false;
        }
        visited.add(id);
        const bus = buses.get(id);
        return !!bus && destinations(bus).some(reachesSource);
    };
    return !reachesSource(target);
}

export function removeMixerBus(mixer: MixerState, id: string): void {
    mixer.buses = mixer.buses.filter(bus => bus.id !== id);
    for (const [, channel] of nodesOf(mixer)) {
        if (channel.output === id) {
            channel.output = 'master';
        }
        channel.sends = channel.sends.filter(send => send.busId !== id);
    }
}

/** Additional time for every reachable delay path to decay below -60 dB.
 * Serial returns add their tails; parallel returns need only the longest. */
export function mixerTailSeconds(mixer: MixerState | undefined): number {
    if (!mixer) {
        return 0;
    }
    const buses = new Map(mixer.buses.map(bus => [bus.id, bus]));
    const tails = new Map<string, number>();
    const tail = (id: string, visited: Set<string>): number => {
        if (tails.has(id)) {
            return tails.get(id)!;
        }
        const bus = buses.get(id);
        if (!bus || bus.mute || visited.has(id)) {
            return 0;
        }
        const seen = new Set([...visited, id]);
        const repeats = bus.feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(bus.feedback)) : 0;
        const own = bus.effect === 'delay' ? bus.delayTime * (1 + repeats) : 0;
        const next = [
            bus.output,
            ...bus.sends.filter(send => send.level > 0).map(send => send.busId),
        ];
        const result = own + Math.max(0, ...next.map(target => tail(target, seen)));
        tails.set(id, result);
        return result;
    };
    const audible = audibleMixerIds(mixer);
    return Math.max(
        0,
        ...Object.entries(mixer.channels)
            .filter(([id]) => audible.has(id))
            .flatMap(([, channel]) =>
                [
                    channel.output,
                    ...channel.sends.filter(send => send.level > 0).map(send => send.busId),
                ].map(id => tail(id, new Set())),
            ),
    );
}

/** Solo-in-place: include contributing sources and their downstream groups/returns.
 * A muted strip always wins over solo; existing effect tails may still decay. */
export function audibleMixerIds(mixer: MixerState): Set<string> {
    const nodes = new Map(nodesOf(mixer));
    // Muting a group also gates its contributors' sends, rather than leaving
    // a ghost orchestra sounding through the shared hall.
    const outputMuted = (id: string, seen = new Set<string>()): boolean => {
        if (seen.has(id)) {
            return true;
        }
        seen.add(id);
        const channel = nodes.get(id);
        return !!channel && (channel.mute || outputMuted(channel.output, seen));
    };
    const solos = [...nodes].filter(([, channel]) => channel.solo).map(([id]) => id);
    if (!solos.length) {
        return new Set([...nodes.keys()].filter(id => !outputMuted(id)));
    }
    const selected = new Set(solos.filter(id => !outputMuted(id)));
    const visitUpstream = (id: string): void => {
        for (const [candidate, channel] of nodes) {
            if (
                outputMuted(candidate) ||
                selected.has(candidate) ||
                !destinations(channel).includes(id)
            ) {
                continue;
            }
            selected.add(candidate);
            visitUpstream(candidate);
        }
    };
    [...selected].forEach(visitUpstream);
    const visited = new Set<string>();
    const visitDownstream = (id: string): void => {
        if (visited.has(id)) {
            return;
        }
        visited.add(id);
        const channel = nodes.get(id);
        if (!channel || outputMuted(id)) {
            return;
        }
        selected.add(id);
        destinations(channel).forEach(visitDownstream);
    };
    [...selected].forEach(visitDownstream);
    return selected;
}

const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
const range = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function isMixerState(value: unknown): value is MixerState {
    if (
        !object(value) ||
        !object(value.channels) ||
        !Array.isArray(value.buses) ||
        !object(value.master)
    ) {
        return false;
    }
    if (Object.keys(value.channels).length > 256 || value.buses.length > MAX_MIXER_BUSES) {
        return false;
    }
    const master = value.master;
    if (!(
        range(master.vol, 0, 1) &&
        range(master.rev, 0, 1) &&
        range(master.tilt, -12, 12) &&
        typeof master.limiter === 'boolean' &&
        range(master.driveDb, 0, 18) &&
        range(master.ceilingDb, -12, 0) &&
        range(master.release, 0.02, 1)
    )) {
        return false;
    }
    const ids = new Set<string>();
    for (const bus of value.buses) {
        if (
            !object(bus) ||
            !isProjectId(bus.id) ||
            ids.has(bus.id) ||
            Object.hasOwn(value.channels, bus.id) ||
            typeof bus.name !== 'string' ||
            !bus.name.trim() ||
            bus.name.length > 80 ||
            (bus.effect !== 'none' && bus.effect !== 'delay') ||
            !range(bus.delayTime, 0.02, 2) ||
            !range(bus.feedback, 0, 0.8)
        ) {
            return false;
        }
        ids.add(bus.id);
    }
    if (!Object.keys(value.channels).every(isProjectId)) {
        return false;
    }
    const strips: unknown[] = [...Object.values(value.channels), ...(value.buses as unknown[])];
    for (const channel of strips) {
        if (
            !object(channel) ||
            !range(channel.volume, 0, 2) ||
            !range(channel.pan, -1, 1) ||
            typeof channel.mute !== 'boolean' ||
            typeof channel.solo !== 'boolean' ||
            typeof channel.output !== 'string' ||
            (channel.output !== 'master' && !ids.has(channel.output)) ||
            !range(channel.reverb, 0, 1) ||
            !range(channel.highpass, 20, 1000) ||
            !range(channel.tilt, -12, 12) ||
            !object(channel.compressor) ||
            typeof channel.compressor.enabled !== 'boolean' ||
            !range(channel.compressor.threshold, -60, 0) ||
            !range(channel.compressor.ratio, 1, 20) ||
            !Array.isArray(channel.sends) ||
            channel.sends.length > MAX_MIXER_BUSES
        ) {
            return false;
        }
        const sent = new Set<string>();
        for (const send of channel.sends) {
            if (
                !object(send) ||
                typeof send.busId !== 'string' ||
                !ids.has(send.busId) ||
                sent.has(send.busId) ||
                !range(send.level, 0, 1)
            ) {
                return false;
            }
            sent.add(send.busId);
        }
    }
    const mixer = value as unknown as MixerState;
    return nodesOf(mixer).every(([id, channel]) =>
        destinations(channel).every(target => canRoute(mixer, id, target)),
    );
}
