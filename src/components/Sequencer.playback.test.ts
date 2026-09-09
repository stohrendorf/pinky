import { describe, expect, it, vi } from 'vitest';

import {
    componentFunction,
    componentMarkup,
    componentSource,
    elements,
    hasAttribute,
    textContent,
} from '../test/svelte-semantics';

const source = componentSource(new URL('./Sequencer.svelte', import.meta.url));

describe('pattern auditioning', () => {
    it('places a named, icon-only toggle beside the piano roll', () => {
        const toolbar = elements(componentMarkup(source), 'div').find(node =>
            hasAttribute(node, 'class', 'editor-toolbar'),
        )!;
        const button = elements([toolbar], 'button').find(node =>
            hasAttribute(node, 'aria-label', 'Play pattern'),
        )!;
        expect(button).toBeDefined();
        expect(hasAttribute(button, 'aria-pressed')).toBe(true);
        expect(hasAttribute(button, 'title')).toBe(true);
        expect(hasAttribute(button, 'type', 'button')).toBe(true);
        expect(textContent(button)).toBe('');
    });

    it.each([
        [false, '', false],
        [true, 'song', false],
        [true, 'pattern', true],
    ])('toggles playback from playing=%s, mode=%s', ($playing, $playMode, stops) => {
        const scope = {
            $playing,
            $playMode,
            $rendering: false,
            $project: {},
            playPattern: vi.fn(),
            stopTransport: vi.fn(),
        };
        const toggle = componentFunction<() => void>(source, 'togglePatternPlayback', scope);
        toggle();
        expect(scope.stopTransport).toHaveBeenCalledTimes(stops ? 1 : 0);
        expect(scope.playPattern).toHaveBeenCalledTimes(stops ? 0 : 1);
    });

    it.each([
        { $project: {}, $rendering: true },
        { $project: null, $rendering: false },
    ])('does not audition without a project or while exporting (%j)', state => {
        const scope = { ...state, playPattern: vi.fn(), stopTransport: vi.fn() };
        componentFunction<() => void>(source, 'togglePatternPlayback', scope)();
        expect(scope.playPattern).not.toHaveBeenCalled();
        expect(scope.stopTransport).not.toHaveBeenCalled();
    });
});
