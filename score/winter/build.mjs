/* Turns the Mutopia MIDI of Vivaldi's "Winter" into src/lib/winter-score.ts.
 *
 *     node score/winter/build.mjs
 *
 * The three files next to this script are the note data of the concerto,
 * one per movement, five tracks each (solo, violin I, violin II, viola,
 * bass). The score module gets every note quantised to the DAW's step grid
 * (a 32nd in the Allegros, a 64th in the Largo) and packed into a short
 * string per part; src/lib/winter-demo.ts decodes them and turns the notes
 * into a performance. Nothing musical is decided here — this is a format
 * change, so it can be re-run whenever the edition or the grid changes. */
import {
    readFileSync, writeFileSync
} from 'node:fs';
import {
    dirname, join, resolve
} from 'node:path';
import {
    fileURLToPath
} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', '..', 'src', 'lib', 'winter-score.ts');

// LilyPond writes 384 ticks per quarter; a DAW step is a 32nd (48 ticks) in the
// Allegros and a 64th (24 ticks) in the Largo, whose quarter is twice as long —
// see the movement table (stepsPerBar = ticks per bar / ticksPerStep).
const MOVEMENTS = [
    {file: 'winter1.mid', title: 'I. Allegro non molto', bars: 63, ticksPerStep: 48, stepsPerBar: 32},
    {file: 'winter2.mid', title: 'II. Largo', bars: 18, ticksPerStep: 24, stepsPerBar: 64},
    {file: 'winter3.mid', title: 'III. Allegro', bars: 153, ticksPerStep: 48, stepsPerBar: 12}
];
const PART_OF_TRACK = {solo: 'solo', violinone: 'vn1', violintwo: 'vn2', viola: 'vla', cello: 'vc'};

/* ---- a standard MIDI file, just far enough for note data ---- */
function parseMidi(bytes) {
    let pos = 0;
    const u32 = () => (bytes[pos++] << 24 | bytes[pos++] << 16 | bytes[pos++] << 8 | bytes[pos++]) >>> 0;
    const u16 = () => bytes[pos++] << 8 | bytes[pos++];
    const chunk = () => ({type: String.fromCharCode(...bytes.subarray(pos, pos += 4)), len: u32()});
    const header = chunk();
    if (header.type !== 'MThd') {throw new Error('not a MIDI file');}
    pos += 2; // format
    const nTracks = u16();
    const division = u16();
    const tracks = [];
    for (let t = 0; t < nTracks; t++) {
        const {type, len} = chunk();
        const end = pos + len;
        if (type !== 'MTrk') {
            pos = end;
            continue;
        }
        const track = {name: '', notes: []};
        const open = new Map(); // key → {tick, vel}
        let tick = 0, status = 0;
        const vlq = () => {
            let v = 0, b;
            do {
                b = bytes[pos++];
                v = v << 7 | b & 0x7f;
            } while (b & 0x80);
            return v;
        };
        const noteOff = (key) => {
            const on = open.get(key);
            if (!on) {return;}
            open.delete(key);
            track.notes.push({tick: on.tick, dur: tick - on.tick, midi: key});
        };
        while (pos < end) {
            tick += vlq();
            if (bytes[pos] & 0x80) {status = bytes[pos++];} // else: running status
            if (status === 0xff) {
                const meta = bytes[pos++];
                const len = vlq();
                if (meta === 0x03) {track.name = String.fromCharCode(...bytes.subarray(pos, pos + len));}
                pos += len;
            } else if (status === 0xf0 || status === 0xf7) {
                pos += vlq();
            } else {
                const kind = status & 0xf0;
                const d1 = bytes[pos++];
                const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[pos++];
                if (kind === 0x90 && d2 > 0) {
                    noteOff(d1); // a re-struck key ends the old note
                    open.set(d1, {tick, vel: d2});
                } else if (kind === 0x80 || kind === 0x90) {
                    noteOff(d1);
                }
            }
        }
        for (const key of [...open.keys()]) {noteOff(key);}
        tracks.push(track);
    }
    return {division, tracks};
}

/* ---- the packing ----
 * A part is its notes in playing order, each note three fields: the distance
 * in steps from the previous note's start, the length in steps, the MIDI
 * number minus 30 (the concerto spans 36..91). One character each in a
 * 64-symbol alphabet; a value of 63 or more is written as '_' followed by two
 * characters. The DAW names its notes so that a MIDI number *is* the index
 * into its note table, which is why MIDI numbers can be stored as they are. */
export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const PITCH_BASE = 30;

function packValue(v) {
    if (v < 0 || v >= 4096 || v !== Math.floor(v)) {throw new Error(`cannot pack ${v}`);}
    return v < 63 ? ALPHABET[v] : `_${ALPHABET[v >> 6]}${ALPHABET[v & 63]}`;
}

function packPart(notes) {
    let last = 0, s = '';
    for (const n of notes) {
        s += packValue(n.start - last) + packValue(n.len) + packValue(n.midi - PITCH_BASE);
        last = n.start;
    }
    return s;
}

/* ---- quantise one movement ---- */
function convert(movement) {
    const midi = parseMidi(readFileSync(join(here, movement.file)));
    if (midi.division !== 384) {throw new Error(`${movement.file}: expected 384 ticks per quarter, got ${midi.division}`);}
    const parts = {};
    const stats = [];
    for (const track of midi.tracks) {
        const part = PART_OF_TRACK[track.name];
        if (!part) {continue;}
        const byKey = new Map();
        let offGrid = 0;
        for (const raw of track.notes) {
            const start = Math.round(raw.tick / movement.ticksPerStep);
            const len = Math.max(1, Math.round(raw.dur / movement.ticksPerStep));
            if (raw.tick % movement.ticksPerStep || raw.dur % movement.ticksPerStep) {offGrid++;}
            const key = `${start}/${raw.midi}`;
            const seen = byKey.get(key);
            if (seen) {seen.len = Math.max(seen.len, len);}
            else {byKey.set(key, {start, len, midi: raw.midi});}
        }
        const notes = [...byKey.values()].sort((a, b) => a.start - b.start || a.midi - b.midi);
        const lastStep = Math.max(...notes.map(n => n.start + n.len));
        if (lastStep > movement.bars * movement.stepsPerBar) {
            throw new Error(`${movement.file}/${part}: ends at step ${lastStep}, past bar ${movement.bars}`);
        }
        parts[part] = packPart(notes);
        stats.push(`${part} ${notes.length} notes${offGrid ? ` (${offGrid} quantised)` : ''}`);
    }
    for (const part of Object.values(PART_OF_TRACK)) {
        if (!parts[part]) {throw new Error(`${movement.file}: no track for ${part}`);}
    }
    return {parts, stats};
}

const movements = MOVEMENTS.map(m => ({...m, ...convert(m)}));
const lines = [
    '/* Generated by score/winter/build.mjs from the Mutopia Project edition of',
    ' * Vivaldi\'s "L\'Inverno", Op. 8 No. 4, RV 297 (score/winter/*.mid) — do not',
    ' * edit by hand. Every note of the concerto, quantised to the DAW\'s grid and',
    ' * packed three characters per note; see `decodeWinterPart`. */',
    '',
    'export type WinterPart = \'solo\' | \'vn1\' | \'vn2\' | \'vla\' | \'vc\';',
    '',
    'export interface WinterMovementData {',
    '    title: string;',
    '    bars: number;',
    '    /** steps per bar — 32nds in the Allegros (4/4 = 32, 3/8 = 12), 64ths in the Largo (4/4 = 64) */',
    '    stepsPerBar: number;',
    '    parts: Record<WinterPart, string>;',
    '}',
    '',
    `export const WINTER_ALPHABET = '${ALPHABET}';`,
    `export const WINTER_PITCH_BASE = ${PITCH_BASE};`,
    '',
    'export const WINTER_SCORE: WinterMovementData[] = ['
];
movements.forEach((m, i) => {
    lines.push(`    // ${m.title}: ${m.stats.join(', ')}`);
    lines.push('    {');
    lines.push(`        title: '${m.title}',`);
    lines.push(`        bars: ${m.bars},`);
    lines.push(`        stepsPerBar: ${m.stepsPerBar},`);
    lines.push('        parts: {');
    const keys = Object.keys(m.parts);
    keys.forEach((part, k) => {
        // wrapped so the file stays diffable
        const s = m.parts[part];
        const rows = s.match(/.{1,96}/g) || [''];
        lines.push(`            ${part}: ${rows.map((r, j) => `${j ? '                + ' : ''}'${r}'`).join('\n')}${k < keys.length - 1 ? ',' : ''}`);
    });
    lines.push('        }');
    lines.push(`    }${i < movements.length - 1 ? ',' : ''}`);
});
lines.push('];', '');
writeFileSync(out, lines.join('\n'));
for (const m of movements) {console.log(`${m.title}: ${m.stats.join(', ')}`);}
console.log(`-> ${out}`);
