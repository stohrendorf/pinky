import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./history', () => ({ redo: vi.fn(), undo: vi.fn() }));
vi.mock('./noteops', () => ({}));
vi.mock('./project', async () => {
    const { writable } = await import('svelte/store');
    return { playing: writable(false), saveProject: vi.fn() };
});
vi.mock('./render', () => ({ exportWav: vi.fn() }));
vi.mock('./transport', () => ({
    playPattern: vi.fn(),
    playSong: vi.fn(),
    seekSong: vi.fn(),
    stopTransport: vi.fn(),
}));

import { playing, saveProject } from './project';
import { handleShortcut } from './shortcuts';
import { playPattern, playSong, stopTransport } from './transport';

function key(key: string, tagName: string, modifiers: Partial<KeyboardEvent> = {}) {
    return {
        key,
        target: { tagName },
        preventDefault: vi.fn(),
        ...modifiers,
    } as unknown as Omit<KeyboardEvent, 'preventDefault'> & {
        preventDefault: () => void;
    };
}

describe('keyboard activation of toolbar controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playing.set(false);
    });

    it('leaves Space on a focused button to native activation instead of starting playback', () => {
        const event = key(' ', 'BUTTON');
        handleShortcut(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(playSong).not.toHaveBeenCalled();
        expect(playPattern).not.toHaveBeenCalled();
        expect(stopTransport).not.toHaveBeenCalled();
    });

    it('still plays and stops with Space from the workspace', () => {
        handleShortcut(key(' ', 'DIV'));
        expect(playSong).toHaveBeenCalledOnce();
        handleShortcut(key(' ', 'DIV', { shiftKey: true }));
        expect(playPattern).toHaveBeenCalledOnce();
        playing.set(true);
        handleShortcut(key(' ', 'DIV'));
        expect(stopTransport).toHaveBeenCalledOnce();
    });

    it('keeps save and media shortcuts available with a focused button', () => {
        handleShortcut(key('s', 'BUTTON', { ctrlKey: true }));
        expect(saveProject).toHaveBeenCalledOnce();
        handleShortcut(key('MediaPlay', 'BUTTON'));
        expect(playSong).toHaveBeenCalledOnce();
    });

    it.each(['INPUT', 'SELECT', 'TEXTAREA'])('leaves Space in %s alone', tag => {
        const event = key(' ', tag);
        handleShortcut(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(playSong).not.toHaveBeenCalled();
    });
});
