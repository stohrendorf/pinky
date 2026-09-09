import { describe, expect, it } from 'vitest';

import type { Note } from './types';

import { legatoTransition, portamentoReleasePitch } from './legato';

describe('legato transitions', () => {
    const source: Note = { pitch: 'C4', start: 0, len: 4, legatoTo: { pitch: 'D4', start: 4 } };

    it('starts at the source end and completes at the target start', () => {
        source.legatoTo = { pitch: 'D4', start: 8 };
        expect(legatoTransition(source, 8, 0.125)).toEqual({ time: 0.5, curve: 'linear' });
    });

    it('uses the selected curve across the note gap', () => {
        source.legatoTo = { pitch: 'D4', start: 8, curve: 'ease-out' };
        expect(legatoTransition(source, 8, 0.125)).toEqual({ time: 0.5, curve: 'ease-out' });
    });

    it('uses the instrument curve when the link does not override it', () => {
        source.legatoTo = { pitch: 'D4', start: 4 };
        expect(legatoTransition(source, 4, 0.125, 'smooth')).toEqual({
            time: 0.005,
            curve: 'smooth',
        });
    });

    it('releases the destination voice after a forward portamento link', () => {
        expect(portamentoReleasePitch(source.pitch, 'D4')).toBe('D4');
    });

    it('keeps the source voice when the portamento target is unavailable', () => {
        expect(portamentoReleasePitch(source.pitch)).toBe('C4');
    });
});
