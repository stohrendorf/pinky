import {
    describe, expect, it, vi
} from 'vitest';

import {
    mixerController
} from './mixer-controller';
import {
    newEmptyProject
} from './project';

describe('mixer document synchronization', () => {
    it('updates edits and restored documents, not unrelated view changes', () => {
        const configure = vi.fn(), controller = mixerController(configure);
        const p = newEmptyProject();
        controller.project(p);
        expect(configure).toHaveBeenCalledExactlyOnceWith(p.mixer, [p.instruments[0].id]);
        p.zoom.arr.width++;
        controller.project(p);
        expect(configure).toHaveBeenCalledTimes(1);
        p.mixer!.master.vol = 0.5;
        controller.project(p);
        expect(configure).toHaveBeenCalledTimes(2);
        controller.project(JSON.parse(JSON.stringify(p)) as typeof p);
        expect(configure).toHaveBeenCalledTimes(3);
    });

    it('defers edits while bouncing and applies the final document when finished', () => {
        const configure = vi.fn(), controller = mixerController(configure);
        const p = newEmptyProject();
        controller.project(p);
        controller.rendering(true);
        p.mixer!.master.ceilingDb = -3;
        controller.project(p);
        controller.project(newEmptyProject());
        expect(configure).toHaveBeenCalledTimes(1);
        controller.rendering(false);
        expect(configure).toHaveBeenCalledTimes(2);
        controller.project(null);
        expect(configure).toHaveBeenCalledTimes(2);
    });
});
