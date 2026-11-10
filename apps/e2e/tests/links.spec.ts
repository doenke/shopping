import { expect, test } from '@playwright/test';
import { login, tile, phone, newList } from './helpers';

/** Links on entries: typed, opened from the tile, dropped onto the list. */
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

test('links dropped onto an entry or onto free space', async ({ page }, info) => {
  await login(page, `Frieda ${info.project.name}`);
  await page.goto('/');
  await newList(page, 'Merken');
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('Kaffeemaschine');
  await input.press('Enter');
  await expect(tile(page, 'Kaffeemaschine')).toBeVisible();
  const drop = async (selector: string, url: string, html?: string) => {
    const dt = await page.evaluateHandle(
      ([u, h]) => {
        const d = new DataTransfer();
        d.setData('text/uri-list', u!);
        if (h) d.setData('text/html', h);
        return d;
      },
      [url, html],
    );
    await page.dispatchEvent(selector, 'dragover', { dataTransfer: dt });
    await page.dispatchEvent(selector, 'drop', { dataTransfer: dt });
  };
  await drop('.listview .tile[aria-label^="Kaffeemaschine"]', 'https://example.org/kaffee');
  await expect(tile(page, 'Kaffeemaschine').locator('.tile__link')).toBeVisible();
  await drop('section.listview', 'https://example.org/muehle', '<a href="https://example.org/muehle">Kaffeemühle</a>');
  await expect(tile(page, 'Kaffeemühle').locator('.tile__link')).toBeVisible();
});
