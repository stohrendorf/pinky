/* Bounces the promo soundtrack with the real engine.
 *
 *     npm run promo:audio              -> promo/out/pinky-promo.wav + pinky-promo.score.json
 *     node promo/bounce.mjs <outdir>
 *     node promo/bounce.mjs --measure  -> per-part levels, for calibrating the demo's faders
 *
 * Nothing is re-implemented here: Vite's dev server serves the DAW, a headless
 * Chromium-based browser (Chrome, Edge — or $PINKY_BROWSER) opens it, and
 * `src/lib/promo-bounce.ts` renders the Pinky Promo demo through the engine's
 * own OfflineAudioContext export path. The Python video renderer reads both
 * files and never touches the audio. */
import {
    mkdirSync, writeFileSync
} from 'node:fs';
import {
    dirname, join, resolve
} from 'node:path';
import {
    fileURLToPath
} from 'node:url';
import {
    chromium
} from 'playwright-core';
import {
    createServer
} from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const measure = args.includes('--measure');
const out = resolve(args.find(a => !a.startsWith('--')) || join(root, 'promo', 'out'));
const SAMPLE_RATE = 48000;

async function launchBrowser() {
    if (process.env.PINKY_BROWSER) {return chromium.launch({executablePath: process.env.PINKY_BROWSER});}
    const errors = [];
    for (const channel of ['chrome', 'msedge', 'chromium']) {
        try {
            return await chromium.launch({channel});
        } catch (e) {
            errors.push(`  ${channel}: ${String(e.message || e).split('\n')[0]}`);
        }
    }
    throw new Error('no Chromium-based browser found — install Chrome or Edge, or set PINKY_BROWSER to an executable\n' + errors.join('\n'));
}

const t0 = Date.now();
const server = await createServer({
    root, configFile: join(root, 'vite.config.js'), logLevel: 'error', server: {host: '127.0.0.1', strictPort: false}
});
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`bounce: DAW at ${url}`);
let browser;
try {
    browser = await launchBrowser();
    console.log(`bounce: ${browser.browserType().name()} ${browser.version()}`);
    const page = await browser.newPage();
    page.on('console', m => {
        if (m.type() === 'error' || m.type() === 'warning') {console.error(`  [browser] ${m.text()}`);}
    });
    page.on('pageerror', e => console.error(`  [browser] ${e.message}`));
    await page.goto(url, {waitUntil: 'load'});
    if (measure) {
        const levels = await page.evaluate(async rate => {
            const mod = await import('/src/lib/promo-bounce.ts');
            return mod.measurePromoParts(rate);
        }, SAMPLE_RATE);
        console.log('part      gain   ref dBFS  peak dBFS');
        for (const l of levels) {
            console.log(`${l.part.padEnd(8)} ${l.gain.toFixed(2).padStart(5)} ${l.refDb.toFixed(1).padStart(9)} ${l.peakDb.toFixed(1).padStart(10)}`);
        }
    } else {
        const result = await page.evaluate(async rate => {
            const mod = await import('/src/lib/promo-bounce.ts');
            return mod.bouncePromo(rate);
        }, SAMPLE_RATE);
        mkdirSync(out, {recursive: true});
        const wav = join(out, 'pinky-promo.wav');
        const score = join(out, 'pinky-promo.score.json');
        writeFileSync(wav, Buffer.from(result.wav, 'base64'));
        writeFileSync(score, JSON.stringify(result.score, null, 1));
        console.log(`bounce: ${result.score.notes.length} notes, ${result.score.length.toFixed(1)} s, true peak ${result.peakDb.toFixed(1)} dBFS -> ${wav}`);
        if (result.peakDb > 0) {console.warn('bounce: the render clips — lower the demo\'s master volume lane');}
        console.log(`bounce: bar peaks ${result.barPeaksDb.map((v, i) => `${i}:${v.toFixed(1)}`).join(' ')}`);
        console.log(`bounce: ${score}`);
    }
    console.log(`bounce: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
    await browser?.close();
    await server.close();
}
