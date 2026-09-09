import { describe, expect, it } from 'vitest';

import { flattenNameTree } from './name-tree';

describe('flattenNameTree', () => {
    it('presents slash-separated names as nested folders with selectable leaves', () => {
        const entries = flattenNameTree([
            { id: 'kick', name: 'Drums/Kick' },
            { id: 'hat', name: 'Drums/Hat' },
            { id: 'lead', name: 'Synth/Lead' },
            { id: 'bass', name: 'Bass' },
        ]);

        expect(entries.map(({ kind, label, depth }) => ({ kind, label, depth }))).toEqual([
            { kind: 'folder', label: 'Drums', depth: 0 },
            { kind: 'item', label: 'Kick', depth: 1 },
            { kind: 'item', label: 'Hat', depth: 1 },
            { kind: 'folder', label: 'Synth', depth: 0 },
            { kind: 'item', label: 'Lead', depth: 1 },
            { kind: 'item', label: 'Bass', depth: 0 },
        ]);
        expect(
            entries.filter(entry => entry.kind === 'folder').map(entry => entry.itemCount),
        ).toEqual([2, 1]);
    });

    it('counts descendants recursively for nested folders', () => {
        const folders = flattenNameTree([
            { id: 'one', name: 'Drums/Kit/Kick' },
            { id: 'two', name: 'Drums/Kit/Snare' },
            { id: 'three', name: 'Drums/Hat' },
        ]).filter(entry => entry.kind === 'folder');

        expect(folders.map(({ path, itemCount }) => ({ path, itemCount }))).toEqual([
            { path: 'Drums', itemCount: 3 },
            { path: 'Drums/Kit', itemCount: 2 },
        ]);
    });

    it('keeps every item available when names contain empty slash segments', () => {
        const entries = flattenNameTree([
            { id: 'kick', name: '/Kick/' },
            { id: 'snare', name: 'Drums//Snare' },
            { id: 'untitled', name: '/' },
        ]).filter(entry => entry.kind === 'item');

        expect(entries.map(({ item, label, depth }) => ({ id: item.id, label, depth }))).toEqual([
            { id: 'snare', label: 'Snare', depth: 1 },
            { id: 'kick', label: 'Kick', depth: 0 },
            { id: 'untitled', label: 'Untitled', depth: 0 },
        ]);
    });
});
