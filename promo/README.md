# pinky promo video

A ~50 second trailer for pinky, rendered entirely from code:

- **Soundtrack** — the DAW's own _Pinky Promo_ demo song
  (`src/lib/promo-demo.ts`), bounced through the real audio engine.
  `promo/bounce.mjs` starts Vite, opens the DAW in a headless Chromium-based
  browser and renders the project into an `OfflineAudioContext` exactly like
  the WAV export does — so every sound in the video really is pink noise
  through peaking EQ, made by the same code you hear in the app.
- **Picture** — 1080p motion graphics drawn frame by frame with NumPy/Pillow
  in the DAW's own palette (`#141416` / `#f06f73`), audio-reactive scope,
  kinetic typography, grain, vignette, chromatic aberration on the hits. The
  hits, note rolls and scope overlays are cut to the score file the bounce
  writes next to the WAV (`out/pinky-promo.score.json`).
- **Encode** — frames are piped to the ffmpeg binary that ships with
  `imageio-ffmpeg` (no system ffmpeg needed) and muxed with the soundtrack.

## Render

```sh
npm install                           # in the repo root: the DAW + playwright-core
cd promo
poetry install
poetry run python -m promo            # bounces the soundtrack if needed, then 1920x1080 @ 30 fps -> out/pinky-promo.mp4
poetry run python -m promo --preview  # quick 640x360 @ 15 fps draft
poetry run python -m promo --audio-only   # just (re-)bounce out/pinky-promo.wav + out/pinky-promo.score.json
poetry run python -m promo --frame 12.4 --png out/still.png   # one still at t = 12.4 s
```

Options: `--width`, `--fps`, `--url` (footer link), `--out`, `--bounce`
(re-render the soundtrack even if it exists).

The bounce needs Node and an installed Chrome or Edge (`playwright-core` only
drives a browser, it does not download one); point `PINKY_BROWSER` at a
Chromium executable otherwise. `npm run promo:audio` runs the bounce on its
own, `node promo/bounce.mjs --measure` prints every part's solo level, which
is how the demo's faders were set to the mix balance of the original score.
