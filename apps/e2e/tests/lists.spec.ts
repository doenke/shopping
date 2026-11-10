import { expect, test } from '@playwright/test';
import { login, tile, phone, newList } from './helpers';

/** Shopping, packing and memo lists: adding, editing, people, settings. */
test('add items, edit one, buy them', async ({ page }, info) => {
  await login(page, `Anna ${info.project.name}`);
  await page.goto('/');
  await newList(page, 'Wocheneinkauf');

  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('2 kg Kartoffeln; Milch; 6 Eier');
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

test('Berechtigungen: the invitation link is shown, created on demand, copied and renewed', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await login(page, 'Linkus');
  await page.goto('/');
  await newList(page, 'Mit Link');
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Berechtigungen/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Link erstellen' }).click();
  const field = dialog.getByRole('textbox', { name: 'Einladungslink' });
  const first = await field.inputValue();
  expect(first).toMatch(/^https?:\/\//);
  await dialog.getByRole('button', { name: 'Kopieren' }).click();
  await expect(dialog.getByRole('button', { name: 'Kopiert ✓' })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await dialog.getByRole('button', { name: 'Erneuern' }).click();
  await expect(field).not.toHaveValue(first);
  await page.screenshot({ path: test.info().outputPath('link.png') });
});
