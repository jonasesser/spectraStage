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

async function approve(phone: Page, name: string, kind: 'Wand' | 'Boden' = 'Wand') {
  const item = phone.locator('.list-item.pending', { hasText: name });
  await item.getByRole('button', { name: /Freigeben|Approve/ }).click();
  await phone.locator('.sheet').getByRole('button', { name: kind, exact: true }).click();
  await phone.getByRole('button', { name: /Gerät freigeben|Approve device/ }).click();
}

test('anonymous show: pair two projectors, play scenes, effects, creatures, blackout', async ({
  browser,
}) => {
  const { phone, code } = await createShow(browser);
  const garage = await openDisplay(browser, code, 'Garage');
  const wall = await openDisplay(browser, code, 'Hauswand');
  await approve(phone, 'Garage');
  await approve(phone, 'Hauswand');
  await expect(garage.getByText(/Warte auf Freigabe/)).toBeHidden({ timeout: 10_000 });
  await expect(phone.locator('section.panel h2', { hasText: '📽 Garage' })).toBeVisible();
  await expect(phone.locator('section.panel h2', { hasText: '📽 Hauswand' })).toBeVisible();

  // turn test pattern off on both outputs and let scenes play
  const offButtons = phone.getByRole('button', { name: /Testbild aus/ });
  await expect(offButtons).toHaveCount(2);
  await offButtons.first().click();
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
