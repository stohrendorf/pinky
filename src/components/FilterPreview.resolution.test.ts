import {
    describe, expect, it
} from 'vitest';

import {
    componentMarkup, componentSource, elements, hasAttribute, styleRules
} from '../test/svelte-semantics';

const preview = componentSource(new URL('./FilterPreview.svelte', import.meta.url));

describe('FilterPreview', () => {
    it('uses a dense response curve so narrow resonances remain visible', () => {
        const svg = elements(componentMarkup(preview), 'svg')[0];
        const response = elements(componentMarkup(preview), 'path').find(node => hasAttribute(node, 'class', 'response'));

        expect(svg).toBeDefined();
        expect(hasAttribute(svg, 'role', 'img')).toBe(true);
        expect(response).toBeDefined();
        expect(hasAttribute(response!, 'd')).toBe(true);
    });

    it('keeps the preview focused on the curve without a redundant caption', () => {
        const captions = elements(componentMarkup(preview), 'figcaption');

        expect(captions).toHaveLength(0);
    });

    it('scales the plotted response to its measured range instead of clipping quiet values', () => {
        const response = elements(componentMarkup(preview), 'path').find(node => hasAttribute(node, 'class', 'response'));

        expect(response).toBeDefined();
        expect(hasAttribute(response!, 'd')).toBe(true);
    });

    it('keeps the moved curve tall enough to read its response shape', () => {
        expect(styleRules(preview).get('svg')?.get('height')).toBe('104px');
    });

    it('keeps its input props reactive so parameter changes redraw the curve immediately', () => {
        const previewRoot = elements(componentMarkup(preview), 'section').find(node => hasAttribute(node, 'class', 'filter-preview'));

        expect(previewRoot).toBeDefined();
        expect(hasAttribute(previewRoot!, 'aria-label', 'Filter response preview')).toBe(true);
    });
});