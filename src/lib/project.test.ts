import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from './instruments';
import { importProject, initProject, project, selInstId, selPatId } from './project';
import { isProjectId, PROJECT_FORMAT_VERSION } from './types';

describe('project import', () => {
    it('initializes a complete default demo when no saved project is available', () => {
        initProject();

        const initial = get(project);
        expect(initial).not.toBeNull();
        expect(initial!.instruments.length).toBeGreaterThan(0);
        expect(initial!.patterns.length).toBeGreaterThan(0);
        expect(initial!.formatVersion).toBe(PROJECT_FORMAT_VERSION);
        expect(initial!.instruments.every(instrument => isProjectId(instrument.id))).toBe(true);
        expect(initial!.patterns.every(pattern => isProjectId(pattern.id))).toBe(true);
        expect(
            initial!.arrangement.every(clip => isProjectId(clip.id) && isProjectId(clip.patternId)),
        ).toBe(true);
        expect(get(selInstId)).toBe(initial!.instruments[0].id);
        expect(get(selPatId)).toBe(initial!.patterns[0].id);
    });

    it('rejects an incomplete current-version project', () => {
        const params = { ...DEFAULT_PARAMS };
        delete (params as Partial<typeof DEFAULT_PARAMS>).q;
        const incomplete = {
            formatVersion: PROJECT_FORMAT_VERSION,
            instruments: [{ id: 'i1', name: 'Lead', color: '#53d8fb', params }],
            patterns: [],
            arrangement: [],
            tracks: [],
            bpm: 120,
            zoom: { seq: { width: 24, height: 14 }, arr: { width: 24, height: 32 } },
        };

        expect(importProject(JSON.stringify(incomplete))).toBe(false);
    });

    it('rejects a project from another format instead of migrating it implicitly', () => {
        const current = get(project)!;
        expect(
            importProject(
                JSON.stringify({ ...current, formatVersion: PROJECT_FORMAT_VERSION - 1 }),
            ),
        ).toBe(false);
    });
});
