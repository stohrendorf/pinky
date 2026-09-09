import {
    describe, expect, it
} from 'vitest';

import {
    componentMarkup, componentSource, elements, hasAttribute, textContent
} from '../test/svelte-semantics';

const picker = componentSource(new URL('./AutomationPicker.svelte', import.meta.url));
const playlist = componentSource(new URL('./Playlist.svelte', import.meta.url));

describe('automation lane chooser', () => {
    it('uses accessible target tabs and the shared slash-name tree visual', () => {
        const tabs = elements(componentMarkup(picker), 'button').filter(tab => hasAttribute(tab, 'role', 'tab'));

        expect(tabs.map(textContent)).toEqual(['Instruments', 'Mixer', 'Global FX']);
        expect(picker).toContain("import TreeView from './ui/TreeView.svelte'");
        expect(picker).toContain('<TreeView items={project.instruments}');
        expect(picker).toContain('title="Channels and buses"');
    });

    it('keeps instrument controls in editor panel groups and names encoded mixer targets', () => {
        expect(picker).toContain('INSTRUMENT_AUTO_GROUPS');
        expect(picker).toContain("mixerTarget('channel', instrument.id)");
        expect(picker).toContain("mixerTarget('bus', bus.id)");
        expect(picker).toContain('{#each parameterGroups as group');
    });

    it('prevents duplicate lanes and replaces the old explanatory form with concise copy', () => {
        expect(picker).toContain('lane.target === target && lane.param === param');
        expect(picker).toContain('disabled={!param || !!duplicate}');
        expect(picker).toContain('This lane already exists.');
        expect(playlist).toContain('<AutomationPicker onadd={addAutoLane} project={$project}/>');
        expect(playlist).not.toContain('<select bind:value={addTarget}>');
        expect(playlist).not.toContain("The lane starts at the parameter's current value");
    });
});