import {
    describe, expect, it
} from 'vitest';

import {
    buildDemoProject
} from './project';

const toccata = () => buildDemoProject('toccata');

describe('Toccata performance arc', () => {
    it('gives the two organ manuals a hard, dry attack', () => {
        const demo = toccata();
        const organ = demo.instruments.find(({name}) => name === 'Keys/Organ')!;
        const principal = demo.instruments.find(({name}) => name === 'Keys/Principal')!;

        expect(organ.params.att).toBeLessThanOrEqual(0.004);
        expect(principal.params.att).toBeLessThanOrEqual(0.004);
        expect(organ.params.rel).toBeLessThanOrEqual(0.2);
        expect(principal.params.rel).toBeLessThanOrEqual(0.2);
    });

    it('turns the finale spin into accented, two-manual hammering', () => {
        const demo = toccata();
        const organ = demo.instruments.find(({name}) => name === 'Keys/Organ')!;
        const principal = demo.instruments.find(({name}) => name === 'Keys/Principal')!;
        const finale = demo.patterns.find(({name}) => name.endsWith('/finale spin'))!;
        const spinningHand = finale.tracks[organ.id];
        const strikingHand = finale.tracks[principal.id];
        const velocities = spinningHand.map(({vel}) => vel ?? 1);

        expect(spinningHand.filter(({vel}) => vel !== undefined).length).toBeGreaterThanOrEqual(8);
        expect(Math.max(...velocities) - Math.min(...velocities)).toBeGreaterThanOrEqual(0.2);
        expect(spinningHand.filter(({start, vel}) => start % 4 === 0 && (vel ?? 1) >= 0.95).length)
            .toBeGreaterThanOrEqual(8);
        expect(strikingHand.length).toBeGreaterThanOrEqual(12);
        expect(new Set(strikingHand.map(({start}) => start)).size).toBeGreaterThanOrEqual(6);
    });

    it('breathes before short manual blows and the final major chord', () => {
        const demo = toccata();
        const organ = demo.instruments.find(({name}) => name === 'Keys/Organ')!;
        const cadence = demo.patterns.find(({name}) => name.endsWith('/final cadence'))!;
        const manual = cadence.tracks[organ.id];
        const firstAttack = Math.min(...Object.values(cadence.tracks).flat().map(({start}) => start));
        const blows = manual.filter(({start}) => start < 16);

        expect(firstAttack).toBeGreaterThanOrEqual(2);
        expect(blows.every(({len}) => len <= 4)).toBe(true);
        expect(manual.some(({pitch, start, len}) => pitch === 'F#4' && start >= 16 && len >= 12)).toBe(true);
    });

    it('adds mechanical bite and brightness only as the climax arrives', () => {
        const demo = toccata();
        const organ = demo.instruments.find(({name}) => name === 'Keys/Organ')!;
        const chiff = demo.automation!.find(({target, param}) => target === organ.id && param === 'noise')!;
        const bite = demo.automation!.find(({target, param}) => target === 'master' && param === 'tilt')!;

        expect(chiff.points.find(({step}) => step === 0)?.value).toBeLessThanOrEqual(0.02);
        expect(Math.max(...chiff.points.filter(({step}) => step >= 704).map(({value}) => value)))
            .toBeGreaterThanOrEqual(0.12);
        expect(bite.points.find(({step}) => step === 0)?.value).toBeLessThanOrEqual(0);
        expect(Math.max(...bite.points.filter(({step}) => step >= 640).map(({value}) => value)))
            .toBeGreaterThanOrEqual(2);
    });
});