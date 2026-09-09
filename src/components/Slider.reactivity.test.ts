import {
    render
} from 'svelte/server';
import {
    describe, expect, it
} from 'vitest';

import {
    componentMarkup, componentSource, elements, hasAttribute
} from '../test/svelte-semantics';
import Slider from './Slider.svelte';

const slider = componentSource(new URL('./Slider.svelte', import.meta.url));

describe('Slider', () => {
    it('keeps its value prop reactive for external updates', () => {
        const range = elements(componentMarkup(slider), 'input').find(node => hasAttribute(node, 'type', 'range'));

        expect(range).toBeDefined();
        expect(hasAttribute(range!, 'value')).toBe(true);
        expect(hasAttribute(range!, 'oninput')).toBe(true);

        const initial = render(Slider, {props: {label: 'Level', min: 0, max: 1, step: 0.01, value: 0.25}});
        const updated = render(Slider, {props: {label: 'Level', min: 0, max: 1, step: 0.01, value: 0.75}});

        expect(initial.body).toContain('value="0.25"');
        expect(updated.body).toContain('value="0.75"');
    });
});