import type { MixerState } from './mixer';
import type { Project } from './types';

/** Document changes (including undo/import) update the graph, but not playhead
 * changes. Never touch the temporarily swapped graph during an offline bounce. */
export function mixerController(configure: (mixer: MixerState | undefined, ids: string[]) => void) {
    let current: Project | null = null;
    let suspended = false;
    let previous = '';
    const sync = () => {
        if (suspended || !current) {
            return;
        }
        const ids = current.instruments.map(instrument => instrument.id);
        const key = JSON.stringify([current.mixer, ids]);
        if (previous === key) {
            return;
        }
        configure(current.mixer, ids);
        previous = key;
    };
    return {
        project(p: Project | null): void {
            if (p !== current) {
                previous = '';
            }
            current = p;
            sync();
        },
        rendering(active: boolean): void {
            suspended = active;
            if (!active) {
                sync();
            }
        },
    };
}
