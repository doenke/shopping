import { expect, test, type Page } from '@playwright/test';
import { login, tile } from './helpers';

/** The own Photon server, as the app's server would answer (the e2e server has none). */
async function fakePlaces(page: Page) {
  await page.route('**/api/v1/places/search?**', (r) =>
    r.fulfill({ json: { places: [{ name: 'Hornbach', address: 'Bahnhofstraße 3, 22767 Hamburg', lat: 53.56, lon: 9.93 }] } }),
  );
  await page.route('**/api/v1/places/reverse?**', (r) => {
    const url = new URL(r.request().url());
    return r.fulfill({
      json: { name: 'Parkhaus Mitte', address: '22767 Hamburg', lat: Number(url.searchParams.get('lat')), lon: Number(url.searchParams.get('lon')) },
    });
  });
}

test('attachments: a button without any, a place found by name, a second link – and removed again', async ({ page }, info) => {
  await login(page, `Greta ${info.project.name}`);
  await fakePlaces(page);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Erledigen', type: 'memo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { text: 'Fliesen' } });
  await page.goto(`/#/list/${list.id}`);
  await tile(page, 'Fliesen').click({ button: 'right' });
  const dialog = page.locator('dialog[open]');
  // Nothing attached: just the button.
  await expect(dialog.locator('.attachment')).toHaveCount(0);
  await dialog.getByRole('button', { name: '📎 Anhang' }).click();
  await dialog.getByRole('button', { name: '📍 Ort' }).click();
  await dialog.getByRole('searchbox', { name: 'Ort suchen' }).fill('Hornbach');
  await dialog.getByRole('option', { name: /Hornbach/ }).click();
  await expect(dialog.locator('.attachment--place')).toContainText('Bahnhofstraße 3');
  // More: "+ Anhang".
  await dialog.getByRole('button', { name: '+ Anhang' }).click();
  await dialog.getByRole('button', { name: '🔗 Link' }).click();
  await dialog.getByRole('textbox', { name: 'Link' }).fill('example.org/fliesen');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog.locator('.attachment')).toHaveCount(2);
  // The tile shows both, the server has both.
  await page.keyboard.press('Escape');
  await expect(tile(page, 'Fliesen').locator('.tile__link')).toHaveCount(2);
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/lists/${list.id}`)).json()).items[0].attachments.map((a: { type: string }) => a.type))
    .toEqual(['link', 'place']);
  // Removed again: back to the button.
  await tile(page, 'Fliesen').click({ button: 'right' });
  await dialog.getByRole('button', { name: /Anhang entfernen: Hornbach/ }).click();
  await dialog.getByRole('button', { name: /Anhang entfernen: .*fliesen/ }).click();
  await expect(dialog.locator('.attachment')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '📎 Anhang' })).toBeVisible();
});

test('"*" attaches the current location, with the address', async ({ page, context }, info) => {
  await login(page, `Hanno ${info.project.name}`);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 53.5511, longitude: 9.9937 });
  await fakePlaces(page);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Merken', type: 'memo' } })).json();
  await page.goto(`/#/list/${list.id}`);
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('Auto geparkt *');
  await input.press('Enter');
  await expect(tile(page, 'Auto geparkt').locator('.tile__link--place')).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/lists/${list.id}`)).json()).items[0]?.attachments)
    .toEqual([expect.objectContaining({ type: 'place', name: 'Parkhaus Mitte', lat: 53.5511, lon: 9.9937 })]);
  // Just "*": an entry of its own, named after the place.
  await input.fill('*');
  await input.press('Enter');
  await expect(tile(page, 'Parkhaus Mitte')).toBeVisible();
  await expect(tile(page, 'Parkhaus Mitte').locator('.tile__link--place')).toBeVisible();
});

test('a ToDo list as main list; "Standort merken" (app shortcut) puts the location there', async ({ page, context }, info) => {
  await login(page, `Ines ${info.project.name}`);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 53.5511, longitude: 9.9937 });
  await fakePlaces(page);
  await page.request.post('/api/v1/lists', { data: { name: 'Einkauf', type: 'shopping' } });
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Erledigen', type: 'todo' } })).json();
  await page.goto(`/#/list/${list.id}`);
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Als Hauptliste festlegen/ }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/lists/${list.id}`)).json()).isMain).toBe(true);

  await page.goto('/?action=here');
  await expect(page).toHaveURL(new RegExp(`#/list/${list.id}$`));
  await expect(page.locator('.work-row', { hasText: 'Parkhaus Mitte' })).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/lists/${list.id}`)).json()).items[0]?.attachments)
    .toEqual([expect.objectContaining({ type: 'place', name: 'Parkhaus Mitte', lat: 53.5511, lon: 9.9937 })]);
  // Taken once: reloading does not save it again.
  await page.reload();
  await expect(page.locator('.work-row', { hasText: 'Parkhaus Mitte' })).toHaveCount(1);
});
