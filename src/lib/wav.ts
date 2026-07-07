/* Minimal WAV writer: 16-bit PCM, interleaved, one `data` chunk, no metadata —
 * everything a rendered AudioBuffer needs to leave the app as a file. */

// Accepts anything AudioBuffer-shaped (that's all the encoder reads)
export interface PcmSource {
    numberOfChannels: number;
    length: number;
    sampleRate: number;

    getChannelData(ch: number): Float32Array;
}

export function encodeWav(buf: PcmSource): Blob {
    const chans = Math.max(1, Math.min(2, buf.numberOfChannels));
    const frames = buf.length;
    const bytes = 44 + frames * chans * 2;
    const out = new DataView(new ArrayBuffer(bytes));
    let o = 0;
    const str = (s: string) => {
        for (let i = 0; i < s.length; i++) {out.setUint8(o++, s.charCodeAt(i));}
    };
    const u32 = (v: number) => {
        out.setUint32(o, v, true);
        o += 4;
    };
    const u16 = (v: number) => {
        out.setUint16(o, v, true);
        o += 2;
    };
    str('RIFF');
    u32(bytes - 8);
    str('WAVE');
    str('fmt ');
    u32(16);
    u16(1);
    u16(chans);
    u32(buf.sampleRate);
    u32(buf.sampleRate * chans * 2);
    u16(chans * 2);
    u16(16); // byte rate, block align, bit depth
    str('data');
    u32(frames * chans * 2);
    const data: Float32Array[] = [];
    for (let c = 0; c < chans; c++) {data.push(buf.getChannelData(c));}
    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < chans; c++) {
            const s = Math.max(-1, Math.min(1, data[c][i]));
            out.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
            o += 2;
        }
    }
    return new Blob([out.buffer], {type: 'audio/wav'});
}
