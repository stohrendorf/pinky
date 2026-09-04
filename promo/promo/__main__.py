"""python -m promo — render the pinky promo video.

    python -m promo                       # 1920×1080 @ 30 fps → out/pinky-promo.mp4
    python -m promo --preview             # 640×360 @ 15 fps draft
    python -m promo --audio-only          # just the soundtrack (out/pinky-promo.wav)
    python -m promo --frame 12.4 --png x.png   # a single still
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from . import score, synth
from .analysis import Analysis
from .scenes import render_frame

DEFAULT_URL = 'stohrendorf.github.io/pinky'


def log(msg: str) -> None:
    print(msg, flush=True)


def load_wav(path: Path) -> np.ndarray:
    from scipy.io import wavfile
    sr, pcm = wavfile.read(str(path))
    if sr != synth.SR:
        raise SystemExit(f'{path}: expected {synth.SR} Hz, got {sr}')
    return (pcm.astype(np.float32) / 32767).T


def soundtrack(out: Path, reuse: bool) -> tuple[score.Song, np.ndarray]:
    song = score.compose()
    wav = out / 'pinky-promo.wav'
    gains = out / 'pinky-promo.gains.json'
    if reuse and wav.exists() and gains.exists():
        log(f'soundtrack: reusing {wav}')
        song.bus_gain = json.loads(gains.read_text())
        return song, load_wav(wav)
    log(f'soundtrack: {len(song.notes)} notes, {song.length:.1f} s — synthesising pink noise through EQ ...')
    t = time.time()
    audio = score.render(song, log)
    synth.write_wav(wav, audio)
    gains.write_text(json.dumps(song.bus_gain, indent=1))
    log(f'soundtrack: {wav} ({time.time() - t:.1f} s)')
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
    ap.add_argument('--audio-only', action='store_true')
    ap.add_argument('--reuse-audio', action='store_true', help='skip synthesis if out/pinky-promo.wav exists')
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

    song, audio = soundtrack(out, args.reuse_audio or args.frame is not None)
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
        synth.write_wav(wav, audio[:, int(args.start * synth.SR):int(end * synth.SR)])
    encode((render_frame(i / fps, w, h, an, args.url) for i in range(first, last)), w, h, fps, wav, mp4, total)
    log(f'done: {mp4} ({time.time() - t0:.0f} s, {total / max(1e-9, time.time() - t0):.1f} fps)')


if __name__ == '__main__':
    sys.exit(main())
