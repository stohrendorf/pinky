import { describe, expect, it } from 'vitest';

import {
    componentMarkup,
    componentSource,
    components,
    elements,
    hasAttribute,
    textContent,
} from '../test/svelte-semantics';

const picker = componentSource(new URL('./AutomationPicker.svelte', import.meta.url));
const playlist = componentSource(new URL('./Playlist.svelte', import.meta.url));

describe('automation lane chooser', () => {
    it('uses accessible target tabs and the shared slash-name tree visual', () => {
        const tabs = elements(componentMarkup(picker), 'button').filter(tab =>
            hasAttribute(tab, 'role', 'tab'),
        );

        expect(tabs.map(textContent)).toEqual(['Instruments', 'Mixer', 'Global FX']);
        expect(picker).toContain("import TreeView from './ui/TreeView.svelte'");
        const tree = components(componentMarkup(picker), 'TreeView').find(node =>
            hasAttribute(node, 'title', 'Channels and buses'),
        );

        expect(tree).toBeDefined();
        expect(hasAttribute(tree!, 'items')).toBe(true);
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
        const automationPicker = components(componentMarkup(playlist), 'AutomationPicker')[0];

        expect(automationPicker).toBeDefined();
        expect(hasAttribute(automationPicker, 'onadd')).toBe(true);
        expect(hasAttribute(automationPicker, 'project')).toBe(true);
        expect(playlist).not.toContain('<select bind:value={addTarget}>');
        expect(playlist).not.toContain("The lane starts at the parameter's current value");
    });
});
