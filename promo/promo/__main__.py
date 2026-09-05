"""python -m promo — render the pinky promo video.

    python -m promo                       # 1920×1080 @ 30 fps → out/pinky-promo.mp4
    python -m promo --preview             # 640×360 @ 15 fps draft
    python -m promo --audio-only          # just the soundtrack (out/pinky-promo.wav)
    python -m promo --frame 12.4 --png x.png   # a single still

The soundtrack is not synthesised here: it is the DAW's "Pinky Promo" demo
song, bounced through the real engine by `node promo/bounce.mjs` (run on
demand, or with --bounce) into out/pinky-promo.wav plus the score file the
picture is cut to.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np
from PIL import Image

from . import score
from .analysis import Analysis
from .response import SR
from .scenes import render_frame

DEFAULT_URL = 'stohrendorf.github.io/pinky'
ROOT = Path(__file__).resolve().parent.parent.parent  # the pinky checkout


def log(msg: str) -> None:
    print(msg, flush=True)


def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        if w.getframerate() != SR or w.getsampwidth() != 2:
            raise SystemExit(f'{path}: expected 16-bit {SR} Hz, got {w.getsampwidth() * 8}-bit {w.getframerate()} Hz')
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, w.getnchannels())
    return (pcm.astype(np.float32) / 32767).T


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = (np.clip(x.T, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def bounce(out: Path) -> None:
    """Render the demo song with the DAW's engine (headless browser, see bounce.mjs)."""
    node = shutil.which('node')
    if not node:
        raise SystemExit('node is required to bounce the soundtrack (npm install in the pinky checkout first)')
    log('soundtrack: bouncing the Pinky Promo demo through the engine ...')
    t = time.time()
    rc = subprocess.call([node, str(ROOT / 'promo' / 'bounce.mjs'), str(out)], cwd=ROOT)
    if rc != 0:
        raise SystemExit(f'bounce failed with exit code {rc}')
    log(f'soundtrack: bounced in {time.time() - t:.0f} s')


def soundtrack(out: Path, rebounce: bool) -> tuple[score.Song, np.ndarray]:
    wav = out / 'pinky-promo.wav'
    sheet = out / 'pinky-promo.score.json'
    if rebounce or not (wav.exists() and sheet.exists()):
        bounce(out)
    song = score.load(sheet)
    audio = load_wav(wav)
    if abs(audio.shape[1] / SR - song.length) > 0.05:
        raise SystemExit(f'{wav} is {audio.shape[1] / SR:.2f} s but the score says {song.length:.2f} s — re-run with --bounce')
    log(f'soundtrack: {wav} — {len(song.notes)} notes, {song.length:.1f} s')
    return song, audio


def encode(frames, w: int, h: int, fps: int, wav: Path, out: Path, total: int) -> None:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ffmpeg, '-y', '-loglevel', 'error',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(fps), '-i', 'pipe:0',
           '-i', str(wav),
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
           '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    try:
        for i, frame in enumerate(frames):
            proc.stdin.write(frame.tobytes())
            if i % 60 == 0 and i:
                el = time.time() - t0
                log(f'  frame {i}/{total}  {el:5.0f}s elapsed, ~{el / i * (total - i):4.0f}s left')
    finally:
        proc.stdin.close()
        rc = proc.wait()
    if rc != 0:
        raise SystemExit(f'ffmpeg failed with exit code {rc}')


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description='render the pinky promo video')
    ap.add_argument('--width', type=int, default=1920)
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--preview', action='store_true', help='640×360 @ 15 fps draft')
    ap.add_argument('--audio-only', action='store_true', help='just bounce the soundtrack')
    ap.add_argument('--bounce', action='store_true', help='re-bounce the soundtrack even if out/pinky-promo.wav exists')
    ap.add_argument('--frame', type=float, help='render one still at this time (s) instead of the video')
    ap.add_argument('--png', type=Path, help='where to write the still (with --frame)')
    ap.add_argument('--url', default=DEFAULT_URL, help='link shown at the end')
    ap.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'out')
    ap.add_argument('--start', type=float, default=0.0, help='render from this time (s) — for spot checks')
    ap.add_argument('--end', type=float, help='render until this time (s)')
    args = ap.parse_args(argv)

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    w = 640 if args.preview else args.width
    fps = 15 if args.preview else args.fps
    h = int(round(w * 9 / 16 / 2)) * 2

    song, audio = soundtrack(out, args.bounce or args.audio_only)
    if args.audio_only:
        return
    log('analysis: spectrum, loudness, hits ...')
    an = Analysis(audio, song, fps, log)

    if args.frame is not None:
        png = args.png or out / f'still-{args.frame:05.2f}.png'
        Image.fromarray(render_frame(args.frame, w, h, an, args.url)).save(png)
        log(f'still: {png}')
        return

    end = min(song.length, args.end) if args.end else song.length
    first, last = int(args.start * fps), int(end * fps)
    total = last - first
    mp4 = out / ('pinky-promo-preview.mp4' if args.preview else 'pinky-promo.mp4')
    log(f'video: {w}x{h} @ {fps} fps, {total} frames -> {mp4}')
    t0 = time.time()
    wav = out / 'pinky-promo.wav'
    if args.start > 0:  # trim the soundtrack to match a partial render
        wav = out / 'pinky-promo-part.wav'
        write_wav(wav, audio[:, int(args.start * SR):int(end * SR)])
    encode((render_frame(i / fps, w, h, an, args.url) for i in range(first, last)), w, h, fps, wav, mp4, total)
    log(f'done: {mp4} ({time.time() - t0:.0f} s, {total / max(1e-9, time.time() - t0):.1f} fps)')


if __name__ == '__main__':
    sys.exit(main())
