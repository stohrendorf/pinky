# Vivaldi — L'Inverno (Winter), Op. 8 No. 4, RV 297

The note data of the *Winter* demo song (`src/lib/winter-demo.ts`).

| file          | movement                 | bars | metre |
|---------------|--------------------------|------|-------|
| `winter1.mid` | I. Allegro non molto     | 63   | 4/4   |
| `winter2.mid` | II. Largo                | 18   | 4/4   |
| `winter3.mid` | III. Allegro             | 153  | 3/8   |

Five tracks each: `solo` (Violino Principale), `violinone`, `violintwo`, `viola`,
`cello` (Organo e Violoncello). 384 ticks per quarter, one tempo and one time
signature per file, no dynamics or ornaments — those are performed by the demo
builder, not stored here.

## Source and licence

The MIDI files are the ones the [Mutopia Project](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=351)
generates from its LilyPond engraving of the 1725 print (*Performers' Facsimiles*),
typeset by John Williams, 2010 (`Mutopia-2010/02/08-351`):

    https://www.mutopiaproject.org/ftp/VivaldiA/O8/winter/winter-mids.zip

The music is public domain; the engraving and these files are licensed
**Creative Commons Attribution-ShareAlike 3.0 Unported** — keep this notice when
redistributing.

## Rebuilding the score module

    node score/winter/build.mjs

writes `src/lib/winter-score.ts`: every note quantised to the DAW's grid (a 32nd in
the Allegros, a 64th in the Largo, whose quarter is twice as long) and packed three
characters per note. It is a pure format change; the musical decisions (trills,
dynamics, the pizzicato, the Lento and fermatas, the violone and harpsichord, the
winds and the singing soloist) live in `winter-demo.ts`.
