const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const MIN_PREVIEW_OCTAVE = 3;
export const MAX_PREVIEW_OCTAVE = 7;

export const COMPUTER_KEY_BINDINGS = [
    {code: 'KeyZ', character: 'z', semitone: 0}, {code: 'KeyS', character: 's', semitone: 1},
    {code: 'KeyX', character: 'x', semitone: 2}, {code: 'KeyD', character: 'd', semitone: 3},
    {code: 'KeyC', character: 'c', semitone: 4}, {code: 'KeyV', character: 'v', semitone: 5},
    {code: 'KeyG', character: 'g', semitone: 6}, {code: 'KeyB', character: 'b', semitone: 7},
    {code: 'KeyH', character: 'h', semitone: 8}, {code: 'KeyN', character: 'n', semitone: 9},
    {code: 'KeyJ', character: 'j', semitone: 10}, {code: 'KeyM', character: 'm', semitone: 11},
    {code: 'KeyQ', character: 'q', semitone: 12}, {code: 'Digit2', character: '2', semitone: 13},
    {code: 'KeyW', character: 'w', semitone: 14}, {code: 'Digit3', character: '3', semitone: 15},
    {code: 'KeyE', character: 'e', semitone: 16}, {code: 'KeyR', character: 'r', semitone: 17},
    {code: 'Digit5', character: '5', semitone: 18}, {code: 'KeyT', character: 't', semitone: 19},
    {code: 'Digit6', character: '6', semitone: 20}, {code: 'KeyY', character: 'y', semitone: 21},
    {code: 'Digit7', character: '7', semitone: 22}, {code: 'KeyU', character: 'u', semitone: 23}
] as const;

const bindingByCode = new Map<string, (typeof COMPUTER_KEY_BINDINGS)[number]>(
    COMPUTER_KEY_BINDINGS.map(binding => [binding.code, binding])
);

export interface ComputerKeyBinding {
    code: string;
    character: string;
    note: string;
}

export interface HeldVoice {
    instrumentId: string;
    note: string;
}

export function normalizeComputerKey(key: string): string {
    return key.length === 1 ? key.toLowerCase() : '';
}

export function computerKeySource(key: string, code: string): string {
    return 'key:' + (code || normalizeComputerKey(key));
}

export function bindingForCode(code: string, octave: number): ComputerKeyBinding | null {
    const binding = bindingByCode.get(code);
    if (!binding) {
        return null;
    }
    return {
        code: binding.code,
        character: binding.character,
        note: NOTE_NAMES[binding.semitone % 12] + (octave + Math.floor(binding.semitone / 12))
    };
}

export function learnKeyboardLabel(labels: Map<string, string>, code: string, key: string): void {
    const character = normalizeComputerKey(key);
    if (!character || !bindingByCode.has(code) || labels.get(code) === character) {
        return;
    }
    const previous = labels.get(code) ?? bindingByCode.get(code)?.character ?? '';
    for (const [otherCode, label] of labels) {
        if (otherCode !== code && label === character) {
            labels.set(otherCode, previous);
            break;
        }
    }
    labels.set(code, character);
}

interface NavigatorKeyboard {
    getLayoutMap?: () => Promise<Map<string, string>>;
}

export async function loadKeyboardLayout(labels: Map<string, string>): Promise<void> {
    const keyboard = (globalThis.navigator as Navigator & { keyboard?: NavigatorKeyboard }).keyboard;
    if (!keyboard?.getLayoutMap) {
        return;
    }
    try {
        const layout = await keyboard.getLayoutMap();
        for (const binding of COMPUTER_KEY_BINDINGS) {
            const character = normalizeComputerKey(layout.get(binding.code) ?? '');
            if (character) {
                labels.set(binding.code, character);
            }
        }
    } catch {
        // Firefox has no layout-map API; key events teach us the labels as they arrive.
    }
}

function sameVoice(a: HeldVoice, b: HeldVoice): boolean {
    return a.instrumentId === b.instrumentId && a.note === b.note;
}

export class HeldNoteSources {
    private readonly bySource = new Map<string, HeldVoice>();

    activeNotes(): string[] {
        return [...new Set([...this.bySource.values()].map(voice => voice.note))];
    }

    drain(): HeldVoice[] {
        const voices: HeldVoice[] = [];
        for (const voice of this.bySource.values()) {
            if (!voices.some(existing => sameVoice(existing, voice))) {
                voices.push(voice);
            }
        }
        this.bySource.clear();
        return voices;
    }

    hasSource(source: string): boolean {
        return this.bySource.has(source);
    }

    hold(source: string, voice: HeldVoice): boolean {
        if (this.bySource.has(source)) {
            return false;
        }
        const alreadyHeld = [...this.bySource.values()].some(existing => sameVoice(existing, voice));
        this.bySource.set(source, voice);
        return !alreadyHeld;
    }

    release(source: string): HeldVoice | null {
        const voice = this.bySource.get(source);
        if (!voice) {
            return null;
        }
        this.bySource.delete(source);
        return [...this.bySource.values()].some(existing => sameVoice(existing, voice)) ? null : voice;
    }
}