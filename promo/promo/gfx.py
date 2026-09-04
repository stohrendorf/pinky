"""Drawing toolkit: a float RGB canvas, RGBA layers drawn with Pillow, glow,
letter-spaced typography, easing, and the film-look post chain."""
from __future__ import annotations

import os
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---- the DAW's palette (src/app.css) ----
BG = '#141416'
SURFACE = '#1c1c20'
RAISED = '#242429'
HOVER = '#303037'
CANVAS = '#101012'
DEEP = '#0c0c0e'
BORDER = '#39383f'
BORDER_SUBTLE = '#29292f'
GRID = '#17171a'
ACCENT = '#f06f73'
ACCENT_MUTED = '#a5a2a7'
TEXT = '#f0eef1'
MUTED = '#aaa7ac'
SUBTLE = '#85828a'
FAINT = '#64616a'
WARNING = '#e7bb67'
PLAYHEAD = '#ffffff'


def rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip('#')
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def rgba(color: str, a: float) -> tuple[int, int, int, int]:
    return (*rgb(color), int(round(255 * max(0.0, min(1.0, a)))))


def rgbf(color: str) -> np.ndarray:
    return np.array(rgb(color), np.float32) / 255


def mix_color(a: str, b: str, t: float) -> str:
    ca, cb = np.array(rgb(a), float), np.array(rgb(b), float)
    c = np.clip(ca + (cb - ca) * max(0.0, min(1.0, t)), 0, 255).astype(int)
    return '#%02x%02x%02x' % tuple(c)


# ---- easing ----
def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def seg(t: float, t0: float, t1: float) -> float:
    """0..1 progress of t through [t0, t1]."""
    return clamp01((t - t0) / (t1 - t0)) if t1 > t0 else float(t >= t0)


def ease_out_expo(x: float) -> float:
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * clamp01(x))


def ease_in_out(x: float) -> float:
    x = clamp01(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease_out_back(x: float, s: float = 1.4) -> float:
    x = clamp01(x)
    return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2


def ease_out_cubic(x: float) -> float:
    return 1 - (1 - clamp01(x)) ** 3


def smoothstep(x: float) -> float:
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def fade(t: float, t0: float, t1: float, t2: float, t3: float) -> float:
    """Fade in over [t0,t1], hold, fade out over [t2,t3]."""
    return smoothstep(seg(t, t0, t1)) * (1 - smoothstep(seg(t, t2, t3)))


# ---- fonts ----
_FONT_DIRS = [os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts'), '/usr/share/fonts', '/Library/Fonts']
_FACES = {
    'light': ['segoeuil.ttf', 'Inter-Light.ttf', 'DejaVuSans-ExtraLight.ttf'],
    'regular': ['segoeui.ttf', 'Inter-Regular.ttf', 'DejaVuSans.ttf'],
    'semibold': ['seguisb.ttf', 'Inter-SemiBold.ttf', 'DejaVuSans-Bold.ttf'],
    'bold': ['segoeuib.ttf', 'Inter-Bold.ttf', 'DejaVuSans-Bold.ttf'],
    'black': ['seguibl.ttf', 'Inter-Black.ttf', 'DejaVuSans-Bold.ttf'],
    'mono': ['consola.ttf', 'JetBrainsMono-Regular.ttf', 'DejaVuSansMono.ttf'],
}


def _find_face(weight: str) -> str | None:
    for name in _FACES[weight]:
        for d in _FONT_DIRS:
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p
    return None


@lru_cache(maxsize=None)
def font(weight: str, size: float) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = _find_face(weight)
    size = max(1, int(round(size)))
    if path:
        return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def text_width(s: str, f, tracking: float = 0.0) -> float:
    if not s:
        return 0.0
    return sum(f.getlength(ch) for ch in s) + tracking * (len(s) - 1)


def draw_text(d: ImageDraw.ImageDraw, xy: tuple[float, float], s: str, f, fill, align: str = 'left',
              tracking: float = 0.0, anchor_v: str = 'm') -> float:
    """Letter-spaced text. `tracking` is extra px between glyphs; `align` is
    left/center/right around xy[0]; `anchor_v` is Pillow's vertical anchor."""
    w = text_width(s, f, tracking)
    x, y = xy
    if align == 'center':
        x -= w / 2
    elif align == 'right':
        x -= w
    if tracking == 0:
        d.text((x, y), s, font=f, fill=fill, anchor='l' + anchor_v)
        return w
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill, anchor='l' + anchor_v)
        x += f.getlength(ch) + tracking
    return w


# ---- canvas ----
class Canvas:
    def __init__(self, w: int, h: int, bg: str = BG):
        self.w, self.h = w, h
        self.img = np.empty((h, w, 3), np.float32)
        self.img[:] = rgbf(bg)
        self.s = w / 1920  # design scale: everything is laid out for 1920×1080

    def px(self, v: float) -> float:
        return v * self.s

    def layer(self) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        return im, ImageDraw.Draw(im)

    def composite(self, layer: Image.Image, opacity: float = 1.0, glow: float = 0.0, glow_gain: float = 1.0,
                  add: bool = False) -> None:
        """Alpha-blend `layer` onto the canvas (or add it). `glow` > 0 adds a
        blurred copy underneath — the cheap trick that makes UI look lit."""
        if opacity <= 0:
            return
        bbox = layer.getbbox()
        if not bbox:
            return
        if glow > 0:
            pad = int(glow * 3)
            gb = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(self.w, bbox[2] + pad), min(self.h, bbox[3] + pad))
            blurred = layer.crop(gb).filter(ImageFilter.GaussianBlur(glow))
            self._blend(blurred, gb, opacity * glow_gain, add=True)
        self._blend(layer.crop(bbox), bbox, opacity, add)

    def _blend(self, im: Image.Image, box, opacity: float, add: bool) -> None:
        arr = np.asarray(im, np.float32) / 255
        a = arr[..., 3:4] * opacity
        col = arr[..., :3]
        x0, y0, x1, y1 = box
        dst = self.img[y0:y1, x0:x1]
        if add:
            dst += col * a
        else:
            dst *= (1 - a)
            dst += col * a

    def fill(self, color: str, alpha: float = 1.0) -> None:
        if alpha >= 1:
            self.img[:] = rgbf(color)
        elif alpha > 0:
            self.img *= (1 - alpha)
            self.img += rgbf(color) * alpha

    def radial_glow(self, cx: float, cy: float, radius: float, color: str, strength: float) -> None:
        """Soft additive light source — computed at quarter resolution."""
        if strength <= 0:
            return
        q = 4
        ys = (np.arange(0, self.h, q) - cy) / radius
        xs = (np.arange(0, self.w, q) - cx) / radius
        d2 = xs[None, :] ** 2 + ys[:, None] ** 2
        m = np.exp(-d2 * 2.2).astype(np.float32) * strength
        small = m[..., None] * rgbf(color)
        big = np.asarray(Image.fromarray((np.clip(small, 0, 1) * 255).astype(np.uint8)).resize((self.w, self.h), Image.BILINEAR),
                         np.float32) / 255
        self.img += big

    def to_uint8(self) -> np.ndarray:
        return (np.clip(self.img, 0, 1) * 255 + 0.5).astype(np.uint8)


# ---- post chain ----
@lru_cache(maxsize=4)
def _vignette_mask(w: int, h: int, strength: float) -> np.ndarray:
    ys = (np.arange(h) - h / 2) / (h / 2)
    xs = (np.arange(w) - w / 2) / (w / 2)
    r2 = (xs[None, :] ** 2) * 0.72 + (ys[:, None] ** 2)
    return (1 - strength * np.clip(r2 - 0.25, 0, None) ** 1.1).astype(np.float32)[..., None]


def vignette(img: np.ndarray, strength: float = 0.5) -> None:
    img *= _vignette_mask(img.shape[1], img.shape[0], round(strength, 3))


def grain(img: np.ndarray, amount: float, rng: np.random.Generator) -> None:
    if amount <= 0:
        return
    h, w = img.shape[:2]
    # coarse grain (film) — generated at half resolution
    g = rng.standard_normal((h // 2 + 1, w // 2 + 1)).astype(np.float32)
    g = np.repeat(np.repeat(g, 2, axis=0), 2, axis=1)[:h, :w]
    img += (g * amount)[..., None]


def chromatic(u8: np.ndarray, shift: int) -> np.ndarray:
    if shift <= 0:
        return u8
    out = u8.copy()
    out[:, shift:, 0] = u8[:, :-shift, 0]
    out[:, :-shift, 2] = u8[:, shift:, 2]
    return out


def punch(u8: np.ndarray, zoom: float, dx: float = 0.0, dy: float = 0.0) -> np.ndarray:
    """Camera punch-in + shake: crop the centre and scale back up."""
    if zoom <= 1.0005 and abs(dx) < 0.5 and abs(dy) < 0.5:
        return u8
    h, w = u8.shape[:2]
    cw, ch = int(w / zoom), int(h / zoom)
    x0 = int(np.clip((w - cw) / 2 + dx, 0, w - cw))
    y0 = int(np.clip((h - ch) / 2 + dy, 0, h - ch))
    im = Image.fromarray(u8).crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.BILINEAR)
    return np.asarray(im)


# ---- shared drawing bits ----
def panel(d: ImageDraw.ImageDraw, box, s: float, fill: str = SURFACE, border: str = BORDER_SUBTLE, radius: float = 8,
          alpha: float = 1.0) -> None:
    d.rounded_rectangle(box, radius=radius * s, fill=rgba(fill, alpha), outline=rgba(border, alpha), width=max(1, int(s)))


FMIN = 30.0


def freq_to_x(f: np.ndarray | float, w: float, fmax: float = 12000.0, fmin: float = FMIN):
    """Logarithmic frequency axis, fmin..fmax across w pixels. (The DAW's scope
    uses a quadratic axis; log spreads the musical range better on a screen
    that isn't interactive.)"""
    f = np.maximum(np.asarray(f, float), 1e-3)
    return w * np.log(f / fmin) / np.log(fmax / fmin)


def x_to_freq(x: np.ndarray | float, w: float, fmax: float = 12000.0, fmin: float = FMIN):
    return fmin * (fmax / fmin) ** (np.asarray(x, float) / w)
