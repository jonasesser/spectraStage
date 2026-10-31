import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';

async function createShow(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 860 },
    hasTouch: true,
    locale: 'de-DE',
  });
  const phone = await ctx.newPage();
  await phone.goto('/');
  await phone.getByRole('button', { name: /Show erstellen|Create show/ }).click();
  await phone.waitForURL(/\/c/);
  // recovery key sheet appears for new owners
  await phone.getByRole('button', { name: /Erledigt|Done/ }).click();
  await phone
    .getByRole('button', { name: /Beamer|Projectors/ })
    .first()
    .click();
  const code = (await phone.locator('.code-big').first().innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return { phone, code };
}

async function openDisplay(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto('/display');
  await page.locator('input.code-input').fill(code);
  await page.getByPlaceholder(/Garage/).fill(name);
  await page.getByRole('button', { name: /Verbindung anfragen|Request connection/ }).click();
  await expect(page.getByText(/Warte auf Freigabe|Waiting for approval/)).toBeVisible();
  return page;
}

async function approve(phone: Page, name: string, kind?: 'Wand' | 'Boden') {
  const item = phone.locator('.list-item.pending', { hasText: name });
  await item.getByRole('button', { name: /Freigeben|Approve/ }).click();
  const sheet = phone.locator('.sheet');
  if (kind) {
    // new projector on a new surface (otherwise the dialog pre-selects an uncovered starter surface)
    await sheet.getByLabel(/Neuer Beamer auf neuer Fläche/).check();
    await sheet.getByRole('button', { name: kind, exact: true }).click();
  }
  await sheet.getByRole('button', { name: /Gerät freigeben|Approve device/ }).click();
}

test('anonymous show: pair two projectors, play scenes, effects, creatures, blackout', async ({
  browser,
}) => {
  const { phone, code } = await createShow(browser);
  const garage = await openDisplay(browser, code, 'Garage');
  const wall = await openDisplay(browser, code, 'Hauswand');
  await approve(phone, 'Garage'); // attaches to the planned projector of the main wall
  await approve(phone, 'Hauswand', 'Wand');
  await expect(garage.getByText(/Warte auf Freigabe/)).toBeHidden({ timeout: 10_000 });
  await expect(phone.locator('section.panel h2', { hasText: '📽 Beamer Vorne' })).toBeVisible();
  await expect(phone.locator('section.panel h2', { hasText: '📽 Hauswand' })).toBeVisible();

  // turn the test pattern of the new projector off and let scenes play
  // (planned projectors start without test pattern)
  const offButtons = phone.getByRole('button', { name: /Testbild aus/ });
  await expect(offButtons).toHaveCount(1);
  await offButtons.first().click();
  await expect(offButtons).toHaveCount(0);
  await phone.getByRole('button', { name: /Live/ }).first().click();
  await expect(phone.locator('.stage-map svg')).toBeVisible();
  await phone.waitForTimeout(2500);
  await garage.screenshot({ path: 'test-results/garage-scene.png' });
  await wall.screenshot({ path: 'test-results/wall-scene.png' });

  // effect + creature run garage -> wall
  await phone.locator('.tile', { hasText: /Buh!/ }).click();
  await phone.locator('label', { hasText: /^Von/ }).locator('select').selectOption({ label: 'Garage' });
  await phone.locator('label', { hasText: /^Nach/ }).locator('select').selectOption({ label: 'Hauswand' });
  await phone.getByRole('button', { name: 'Losschicken: Spinne' }).click();
  await phone.waitForTimeout(1200);
  await garage.screenshot({ path: 'test-results/garage-effect.png' });
  await phone.screenshot({ path: 'test-results/phone-live.png', fullPage: true });

  // global blackout -> renderer reports blackout
  await phone.locator('.blackout-btn').click();
  await expect(phone.locator('.blackout-banner')).toBeVisible();
  await garage.waitForTimeout(500);
  await expect
    .poll(() =>
      garage.evaluate(
        () =>
          (
            window as unknown as { __spectrastage: { stats: () => { blackout: boolean } } }
          ).__spectrastage.stats().blackout,
      ),
    )
    .toBe(true);
});

test('a second show is isolated and cannot see the first show’s devices', async ({ browser }) => {
  const a = await createShow(browser);
  const b = await createShow(browser);
  await openDisplay(browser, a.code, 'A-Garage');
  await expect(a.phone.locator('.list-item.pending', { hasText: 'A-Garage' })).toBeVisible();
  await expect(b.phone.locator('.list-item.pending')).toHaveCount(0);
});

test('projector calibration: place the garage door and a lamp with the cross', async ({ browser }) => {
  const { phone, code } = await createShow(browser);
  const garage = await openDisplay(browser, code, 'Garage');
  await approve(phone, 'Garage');
  await expect(garage.getByText(/Warte auf Freigabe/)).toBeHidden({ timeout: 10_000 });
  const errors: string[] = [];
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone
    .getByRole('button', { name: /Kalibrieren|Einmessen/ })
    .first()
    .click();
  await phone.getByRole('button', { name: /Platzieren/ }).click();
  await expect(phone.getByText(/oranges Kreuz/)).toBeVisible();
  // the cross starts in the middle of the picture: take it as the top left of the door,
  // move it right and down, take it as the bottom right
  await phone.getByRole('button', { name: /Oben links am Tor/ }).click();
  for (let i = 0; i < 8; i++) await phone.getByRole('button', { name: 'rechts', exact: true }).click();
  for (let i = 0; i < 8; i++) await phone.getByRole('button', { name: 'runter', exact: true }).click();
  await phone.getByRole('button', { name: /Unten rechts am Tor/ }).click();
  await phone.getByRole('button', { name: /^💡 Strahler$/ }).click();
  await phone.getByRole('button', { name: /Strahler am Kreuz/ }).click();
  await expect(phone.getByText(/💡 1:/)).toBeVisible();
  await phone.getByRole('button', { name: /Kürbisse & Dinge/ }).click();
  await phone.getByRole('button', { name: /Dunkel lassen/ }).click();
  await phone.getByRole('button', { name: /Neuer dunkler Bereich/ }).click();
  for (let i = 0; i < 3; i++) {
    await phone.getByRole('button', { name: /Ecke hier/ }).click();
    await phone.getByRole('button', { name: 'rechts', exact: true }).click();
    await phone.getByRole('button', { name: 'runter', exact: true }).click();
  }
  await phone
    .getByRole('button', { name: /^✓ Fertig$/ })
    .first()
    .click();
  await expect(phone.getByText(/Dunkler Bereich 1/)).toBeVisible();
  await garage.waitForTimeout(800);
  await garage.screenshot({ path: 'test-results/garage-place.png' });
  await phone.screenshot({ path: 'test-results/phone-place.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('a video (e.g. Kling) is uploaded and played in once on the main wall', async ({ browser }) => {
  const { phone, code } = await createShow(browser);
  const garage = await openDisplay(browser, code, 'Garage');
  await approve(phone, 'Garage');
  await expect(garage.getByText(/Warte auf Freigabe/)).toBeHidden({ timeout: 10_000 });
  const errors: string[] = [];
  garage.on('pageerror', (e) => errors.push(e.message));
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone
    .getByRole('button', { name: /Szenen/ })
    .first()
    .click();
  await phone
    .locator('input[type=file][accept*="video"]')
    .setInputFiles('tests/e2e/fixtures/kling-test.webm');
  const tile = phone.locator('.tile', { hasText: /kling-test/ });
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();
  await phone.getByRole('button', { name: /Jetzt einspielen/ }).click();
  await expect
    .poll(
      () => garage.evaluate(() => (globalThis as { __ssVideo?: { ready: number } }).__ssVideo?.ready ?? -1),
      {
        timeout: 30_000,
      },
    )
    .toBeGreaterThanOrEqual(2);
  await garage.waitForTimeout(800);
  await garage.screenshot({ path: 'test-results/garage-video.png' });
  expect(errors).toEqual([]);
});

test('test area: a scene and a projector picture render on this PC only', async ({ browser }) => {
  const { phone } = await createShow(browser);
  const errors: string[] = [];
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.getByRole('button', { name: /Test/ }).first().click();
  // a light scene (the 3D shows are too slow for the software graphics of the test browser)
  const v = await phone.locator('select option', { hasText: 'Spukhaus' }).first().getAttribute('value');
  await phone.locator('select').first().selectOption(v!);
  await phone.getByRole('button', { name: /Starten/ }).click();
  await expect(phone.getByText(/\d+ fps ·/)).toBeVisible({ timeout: 20_000 });
  await phone.getByRole('button', { name: /Live-Bild eines Beamers/ }).click();
  await phone.getByRole('button', { name: /Starten/ }).click();
  await expect(phone.getByText(/\d+ fps ·/)).toBeVisible({ timeout: 20_000 });
  // a 3D show: the models load with their textures (no blocked requests)
  const csp: string[] = [];
  phone.on('console', (m) => m.text().includes('Content Security Policy') && csp.push(m.text()));
  await phone.getByRole('button', { name: /Szene ausprobieren/ }).click();
  const mummy = await phone
    .locator('select option', { hasText: 'Mumie kommt heraus' })
    .first()
    .getAttribute('value');
  await phone.locator('select').first().selectOption(mummy!);
  await phone.getByRole('button', { name: /Starten/ }).click();
  await phone.waitForTimeout(6000);
  expect(csp).toEqual([]);
  // every sound on its own, annoying ones marked
  await phone.getByRole('button', { name: /Alle Klänge/ }).click();
  await expect(phone.getByText('Grollen')).toBeVisible();
  await expect(phone.getByText(/Buh!/)).toBeVisible({ timeout: 10_000 });
  await phone.locator('.row', { hasText: 'Grollen' }).getByRole('button', { name: '▶' }).click();
  // marked sounds are off until chosen; a real recording is picked, an own file uploaded
  const ooh = phone.getByLabel('Klang für Geister-Uuuh', { exact: true });
  await expect(ooh).toHaveValue('off');
  await ooh.selectOption('lib:ghost-ghost-wav');
  await expect(ooh).toHaveValue('lib:ghost-ghost-wav');
  const pop = phone.getByLabel('Klang für Plopp', { exact: true });
  await phone.locator('.row', { has: pop }).getByRole('button', { name: /eigene Datei/ }).click();
  await phone.locator('input[type=file][accept="audio/*"]').setInputFiles({
    name: 'mein-plopp.mp3',
    mimeType: 'audio/mpeg',
    buffer: readFileSync('apps/web/public/sounds/lib/pop-pop-ogg.mp3'),
  });
  await expect(pop).toHaveValue(/^up:/);
  await expect(phone.locator('span', { hasText: 'mein-plopp' })).toBeVisible();
  expect(errors).toEqual([]);
});
