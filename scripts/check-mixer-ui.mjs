/* Mixer interaction checks in an isolated Firefox or Chromium profile. */
import assert from 'node:assert/strict';
import {
    dirname, join, resolve
} from 'node:path';
import {
    fileURLToPath
} from 'node:url';
import {
    chromium, firefox
} from 'playwright-core';
import {
    createServer
} from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserName = process.argv[2] ?? 'firefox';
assert.ok(['firefox', 'chromium'].includes(browserName));
const server = await createServer({root, logLevel: 'silent', server: {host: '127.0.0.1', port: 0}});
let browser;
try {
    await server.listen();
    if (browserName === 'firefox') {
        browser = await firefox.launch();
    } else if (process.env.PINKY_BROWSER) {
        browser = await chromium.launch({executablePath: process.env.PINKY_BROWSER, args: ['--mute-audio']});
    } else {
        for (const channel of ['chrome', 'msedge', 'chromium']) {
            try {browser = await chromium.launch({channel, args: ['--mute-audio']}); break;} catch { /* next installed browser */ }
        }
    }
    assert.ok(browser, 'Install a supported browser first');
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    const initial = await page.evaluate(async () => {
        const model = await import('/src/lib/project.ts');
        model.loadDemoProject('monsoon');
        model.project.subscribe(value => {window.mixerSong = value;});
        const p = window.mixerSong;
        return {name: p.instruments[0].name, id: p.instruments[0].id, volume: p.mixer.channels[p.instruments[0].id].volume,
            mixer: JSON.stringify(p.mixer), instruments: JSON.stringify(p.instruments)};
    });
    const opener = page.getByRole('button', {name: 'Mixer', exact: true});
    await opener.click();
    const dialog = page.getByRole('dialog', {name: 'Mixer', exact: true});
    assert.equal(await dialog.locator('#mixer-details').count(), 0, 'settings are closed initially');
    assert.equal(await dialog.locator('select').count(), 0, 'no routing dropdown repeated on every channel');
    assert.equal(await dialog.locator('input[type=number]').count(), 0, 'no spreadsheet of numbers');
    assert.equal(await page.evaluate(() => JSON.stringify(window.mixerSong.mixer)), initial.mixer, 'opening changes no sound');
    const initialBounds = await dialog.boundingBox();
    assert.ok(initialBounds.height < 600, 'compact mixer does not reserve a tall empty panel');
    if (process.argv.includes('--screenshot')) {await page.screenshot({path: join(root, 'mixer-simple-check.png')});}

    const fader = dialog.getByRole('slider', {name: `${initial.name} fader`, exact: true});
    const bounds = await fader.boundingBox();
    assert.ok(bounds.height > 4 * bounds.width, 'native fader is vertical');
    await fader.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    assert.equal(Number(await fader.inputValue()), 0.01, 'up raises the fader in this browser');
    await page.keyboard.press('End');
    assert.equal(Number(await fader.inputValue()), 2);
    assert.equal(await page.evaluate(id => window.mixerSong.mixer.channels[id].volume, initial.id), 2);
    await page.evaluate(async () => (await import('/src/lib/history.ts')).undo());
    assert.equal(Number(await fader.inputValue()), initial.volume, 'history restores fader UI');
    await page.evaluate(async () => (await import('/src/lib/history.ts')).redo());
    assert.equal(Number(await fader.inputValue()), 2, 'redo restores fader UI');
    await dialog.getByRole('button', {name: `Mute ${initial.name}`, exact: true}).click();
    await dialog.getByRole('button', {name: `Solo ${initial.name}`, exact: true}).click();
    assert.deepEqual(await page.evaluate(id => {
        const c = window.mixerSong.mixer.channels[id];
        return [c.mute, c.solo];
    }, initial.id), [true, true]);

    const heading = dialog.getByRole('button', {name: `${initial.name} settings`, exact: true});
    await heading.click();
    const panel = dialog.locator('#mixer-details');
    assert.equal(await panel.evaluate(el => el === document.activeElement), true, 'selected panel receives keyboard focus');
    const tone = panel.locator('summary', {hasText: 'Tone & dynamics'});
    assert.equal(await panel.getByRole('slider', {name: 'High-pass', exact: true}).isVisible(), false);
    await tone.click();
    const compressor = panel.getByRole('checkbox', {name: 'Compressor', exact: true});
    await compressor.uncheck();
    assert.equal(await panel.getByRole('slider', {name: 'Threshold', exact: true}).count(), 0);
    await compressor.check();
    await panel.getByRole('slider', {name: 'Threshold', exact: true}).press('Home');
    assert.equal(await page.evaluate(id => window.mixerSong.mixer.channels[id].compressor.threshold, initial.id), -60);
    await panel.getByRole('slider', {name: 'Reverb send', exact: true}).press('End');
    assert.equal(await page.evaluate(id => window.mixerSong.mixer.channels[id].reverb, initial.id), 1);
    await panel.getByRole('button', {name: 'Close channel settings', exact: true}).click();
    assert.equal(await heading.evaluate(el => el === document.activeElement), true, 'closing returns focus to its channel');

    await dialog.getByRole('button', {name: '+ Delay', exact: true}).click();
    await panel.getByRole('textbox', {name: 'Bus name', exact: true}).fill('Test echo');
    await page.keyboard.press('Tab');
    const bus = await page.evaluate(() => window.mixerSong.mixer.buses.at(-1).id);
    await panel.getByRole('slider', {name: 'Delay time', exact: true}).press('End');
    assert.equal(await page.evaluate(() => window.mixerSong.mixer.buses.at(-1).delayTime), 2);
    await heading.click();
    assert.equal(await panel.getByRole('slider', {name: 'High-pass', exact: true}).isVisible(), false, 'disclosures reset for a new selection');
    await panel.getByLabel('Add send', {exact: true}).selectOption(bus);
    await panel.getByRole('slider', {name: 'Send to Test echo', exact: true}).press('End');
    assert.equal(await page.evaluate(({id, bus}) => window.mixerSong.mixer.channels[id].sends.find(s => s.busId === bus).level,
        {id: initial.id, bus}), 1);
    await panel.getByLabel(`${initial.name} output`, {exact: true}).selectOption(bus);
    await dialog.getByRole('button', {name: 'Test echo settings', exact: true}).click();
    await panel.getByRole('button', {name: 'Delete bus', exact: true}).click();
    assert.deepEqual(await page.evaluate(({id, bus}) => {
        const c = window.mixerSong.mixer.channels[id];
        return {output: c.output, send: c.sends.some(s => s.busId === bus)};
    }, {id: initial.id, bus}), {output: 'master', send: false});

    await panel.locator('summary', {hasText: 'Limiter settings'}).click();
    await panel.getByRole('slider', {name: 'Ceiling', exact: true}).press('Home');
    assert.equal(await page.evaluate(() => window.mixerSong.mixer.master.ceilingDb), -12);
    await dialog.getByRole('button', {name: 'Limiter', exact: true}).click();
    assert.equal(await page.evaluate(() => window.mixerSong.mixer.master.limiter), false);
    await panel.getByRole('button', {name: 'Close channel settings', exact: true}).click();
    await dialog.getByRole('button', {name: 'Master settings', exact: true}).click();
    const summary = panel.locator('summary', {hasText: 'Limiter settings'});
    await summary.focus();
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', {name: 'Close dialog', exact: true}).evaluate(el => el === document.activeElement), true,
        'focus trap excludes controls inside closed disclosures');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await summary.evaluate(el => el === document.activeElement), true);
    await panel.getByRole('button', {name: 'Close channel settings', exact: true}).click();

    await page.setViewportSize({width: 390, height: 720});
    const mobileBounds = await dialog.boundingBox();
    assert.ok(mobileBounds.x >= 0 && mobileBounds.width <= 390);
    const master = dialog.getByRole('region', {name: 'Master strip', exact: true});
    const before = await master.boundingBox();
    await dialog.locator('.strips').evaluate(el => {el.scrollLeft = el.scrollWidth;});
    assert.deepEqual(await master.boundingBox(), before, 'master stays fixed while scrolling channels');
    assert.ok(before.x >= mobileBounds.x && before.x + before.width <= mobileBounds.x + mobileBounds.width);
    await dialog.getByRole('button', {name: 'Master settings', exact: true}).click();
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'settings do not overflow horizontally');
    if (process.argv.includes('--screenshot')) {await page.screenshot({path: join(root, 'mixer-mobile-check.png')});}
    assert.equal(await page.evaluate(() => JSON.stringify(window.mixerSong.instruments)), initial.instruments, 'no patch changes');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'hidden'});
    assert.equal(await opener.evaluate(el => el === document.activeElement), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({browser: browserName, version: browser.version(), initialHeight: initialBounds.height,
        checks: 'compact default, vertical faders, mute/solo, history, disclosure, sends, routing, delay, limiter, focus, mobile, unchanged patches'}));
} finally {
    await browser?.close();
    await server.close();
}