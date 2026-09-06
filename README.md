# pinky - an EQ-only DAW

A 100% vibe-coded browser-only DAW inspired by
[this song has no instruments in it (YouTube)](https://www.youtube.com/watch?v=_Rk-hmIMv6I) by Andy Brewer.

[Watch the Pinky promo video (MP4)](promo/out/pinky-promo.mp4) — its soundtrack is the
*Pinky Promo* demo song, bounced through the DAW's own engine (see [promo/README.md](promo/README.md)).

The *Winter* demo is Vivaldi's concerto RV 297, all three movements, note for note from the
[Mutopia Project](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=351) edition
(typeset by John Williams, CC BY-SA 3.0); see [score/winter/README.md](score/winter/README.md).

Human contributors are very welcome to improve this mess.

### Mixer

Open **Mixer** in the toolbar. Instrument strips are independent of the arranger
lanes: the same instrument in several patterns always feeds the same strip.
Its fader/pan are mix controls, separate from the instrument's synthesis gain/pan.

- **Groups:** add a group and choose it in a strip's Output menu. Groups can feed
  other groups. Group mute also cuts its contributors' sends; solo works in place,
  preserving contributing sources and their effect returns.
- **Sends:** every strip has a post-fader send to the shared reverb. The master
  Reverb control (and existing `rev` automation) sets that return's level. Keep
  bass dry and send more flute/strings to the hall. Groups default to zero reverb
  send so grouping instruments does not accidentally double their ambience.
- **Effect channels:** add an Echo return and send a little signal to it. Echo
  returns are wet-only, with time/feedback controls; routing can include nested
  groups and parallel sends, but feedback cycles are blocked. Removing a bus
  reroutes its outputs to Master and removes sends targeting it.
- **Processing:** select a strip for high-pass, tilt EQ and optional compression.
  Master has drive, limiter ceiling, release, bypass, stereo peak/RMS meters and
  gain reduction. The limiter is stereo-linked, 5 ms look-ahead **sample-peak**
  protection, not a true-peak limiter or a LUFS loudness normalizer. Start with
  0 dB drive and a −1 dBFS ceiling; bypass is not clipping-safe.

Mixer settings travel with project JSON and undo/redo. Playback and WAV export
use the same processing; export trims the limiter delay and the playhead accounts
for it. Old projects retain their original mix until edited; new projects start
with protection enabled. Automation still controls master volume/reverb/tilt;
Stop restores the saved manual settings. Mixer controls are not yet automatable.

Bronze Monsoon, Winter and Pocket Theory demonstrate selective ambience and
groups without changing their scores. Monsoon adds a quiet dotted-eighth temple
echo on kora/handpan; Pocket adds subtle slap echo and gentle drum compression.
The faithful promo and other demos are deliberately left unchanged.

This is a focused mixer, not a plug-in host: no external effects, sidechain input,
pre-fader sends or tempo/meter markers yet. Existing instrument and arranger
mute/solo controls still operate before the mixer.

Run `npm run test:audio` for isolated browser/UI and native audio routing/limiter
checks (requires installed Chrome/Edge, or `PINKY_BROWSER`). No dependencies are
downloaded and it does not modify saved projects.