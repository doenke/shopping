import { expect, test, type Page } from '@playwright/test';

/** Dev login with a fresh name per test, so tests do not see each other's lists. */
async function login(page: Page, name: string) {
  const res = await page.request.post('/auth/dev', { data: { name, household: name } });
  expect(res.ok()).toBeTruthy();
}

/** A tile of the list itself (not the catalog column on laptops), by its exact name. */
const tile = (page: Page, name: string) => page.locator('.listview .tile', { has: page.locator('.tile__name', { hasText: new RegExp(`^${name}$`) }) });

const phone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** The "+ Neu" button lives in the sidebar (the drawer on phones). */
async function newList(page: Page, name: string) {
  if (phone(page)) await page.getByRole('button', { name: 'Listen' }).click();
  await page.locator('.sidebar__new').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  // Regression: the buttons at the bottom of dialogs were once hidden on phones.
  const submit = dialog.locator('button[type=submit]');
  await expect(submit).toBeInViewport();
  await submit.click();
  await expect(page.locator('.topbar__title')).toContainText(name);
}

test('add items, edit one, buy them', async ({ page }, info) => {
  await login(page, `Anna ${info.project.name}`);
  await page.goto('/');
  await newList(page, 'Wocheneinkauf');

  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('2 kg Kartoffeln, Milch, 6 Eier');
  await input.press('Enter');
  for (const name of ['Kartoffeln', 'Milch', 'Eier']) await expect(tile(page, name)).toBeVisible();
  await expect(tile(page, 'Kartoffeln')).toContainText('2 kg');

  // At home a tap opens the editor; saving is reachable without scrolling.
  await tile(page, 'Milch').click();
  const editor = page.locator('dialog[open]');
  await expect(editor).toBeVisible();
  const save = editor.getByRole('button', { name: 'Speichern' });
  await expect(save).toBeInViewport();
  await editor.getByRole('textbox', { name: 'Name' }).fill('Hafermilch');
  await save.click();
  await expect(editor).toBeHidden();
  await expect(tile(page, 'Hafermilch')).toBeVisible();

  // In the shop a tap checks off; bought items move to "Zuletzt verwendet".
  await page.getByRole('button', { name: 'Einkaufen starten' }).click();
  await tile(page, 'Eier').click();
  await expect(page.getByText(/Zuletzt verwendet \(1\)/)).toBeVisible();
  await page.getByRole('button', { name: /Einkauf beenden/ }).click();
});

test('settings and help open', async ({ page }, info) => {
  await login(page, `Ben ${info.project.name}`);
  await page.goto('/#/settings');
  await expect(page.locator('.topbar__title')).toHaveText('Einstellungen');
  await expect(page.getByText('Haushalt', { exact: true }).first()).toBeVisible();
  await page.goto('/#/help');
  await expect(page.getByRole('heading', { name: 'Die Kurzfassung' })).toBeVisible();
});

test('a packing list groups by person', async ({ page }, info) => {
  await login(page, `Carla ${info.project.name}`);
  await page.goto('/');
  if (phone(page)) await page.getByRole('button', { name: 'Listen' }).click();
  await page.locator('.sidebar__new').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: /Packliste/ }).click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Ostsee');
  await dialog.locator('button[type=submit]').click();
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('3 T-Shirts @Anna #Koffer');
  await input.press('Enter');
  await expect(tile(page, 'T-Shirts')).toBeVisible();
  await expect(page.getByText('0 von 1 eingepackt')).toBeVisible();
});

test('one item for two people is ticked off per person', async ({ page }, info) => {
  await login(page, `Dora ${info.project.name}`);
  await page.goto('/');
  await newList(page, 'Bäcker');
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('4 Brötchen @Anna @Ben');
  await input.press('Enter');
  await expect(tile(page, 'Brötchen')).toContainText('An');
  await page.getByRole('button', { name: 'Einkaufen starten' }).click();
  await tile(page, 'Brötchen').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByText('Für wen gekauft?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Anna' }).click();
  await expect(dialog.getByRole('button', { name: 'Anna' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Ben' }).click();
  // Everyone has it: the dialog closes and the item is bought.
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Einkauf fertig/)).toBeVisible();
});

test('a link on an entry opens from the tile', async ({ page, context }, info) => {
  await login(page, `Emil ${info.project.name}`);
  await context.route('https://example.org/**', (r) => r.fulfill({ body: 'ok' }));
  await page.goto('/');
  if (phone(page)) await page.getByRole('button', { name: 'Listen' }).click();
  await page.locator('.sidebar__new').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: /Merkliste/ }).click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Filme');
  await dialog.locator('button[type=submit]').click();
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('Dune https://example.org/dune @Ben');
  await input.press('Enter');
  await expect(tile(page, 'Dune')).toBeVisible();
  // The 🔗 opens the page – and does not tick the entry off.
  const [popup] = await Promise.all([context.waitForEvent('page'), tile(page, 'Dune').locator('.tile__link').click()]);
  expect(popup.url()).toBe('https://example.org/dune');
  await popup.close();
  await expect(tile(page, 'Dune')).not.toHaveClass(/tile--done/);
  await tile(page, 'Dune').click({ button: 'right' });
  await expect(page.locator('dialog[open]').getByRole('textbox', { name: 'Link' })).toHaveValue('https://example.org/dune');
});
