# pinky promo video

A ~50 second trailer for pinky, rendered entirely from code:

- **Soundtrack** — synthesised exactly the way pinky does it: one pink-noise
  source, serial RBJ peaking bands at the partials, `chain(noise) − noise`
  cancellation, ADSR, pitch-drop percussion, formants, unison, reverb.
  Every sound in the video really is pink noise.
- **Picture** — 1080p motion graphics drawn frame by frame with NumPy/Pillow
  in the DAW's own palette (`#141416` / `#f06f73`), audio-reactive scope,
  kinetic typography, grain, vignette, chromatic aberration on the hits.
- **Encode** — frames are piped to the ffmpeg binary that ships with
  `imageio-ffmpeg` (no system ffmpeg needed) and muxed with the soundtrack.

## Render

```sh
cd promo
poetry install
poetry run python -m promo            # full 1920x1080 @ 30 fps -> out/pinky-promo.mp4
poetry run python -m promo --preview  # quick 640x360 @ 15 fps draft
poetry run python -m promo --audio-only
poetry run python -m promo --frame 12.4 --png out/still.png   # one still at t = 12.4 s
```

Options: `--width`, `--fps`, `--url` (footer link), `--out`.
