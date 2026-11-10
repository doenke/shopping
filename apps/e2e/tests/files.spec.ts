import { expect, test, type Page } from '@playwright/test';
import { login, tile } from './helpers';

/** A tiny red PNG (8×8). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD///9BHTQRAAAAEklEQVR4nGP4z8DwnwEOGBgYADvEA/1W2pmsAAAAAElFTkSuQmCC',
  'base64',
);

const filesOf = async (page: Page, listId: string) =>
  (
    (await (await page.request.get(`/api/v1/lists/${listId}`)).json()).items as {
      name: string;
      attachments?: { type: string; name: string; fileId: string }[];
    }[]
  ).map((i) => [i.name, (i.attachments ?? []).filter((a) => a.type === 'file').map((a) => a.name)]);

test('a photo is attached in the details (also offline), shown as preview and large', async ({ page, context }, info) => {
  await login(page, `Frieda ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Bad', type: 'memo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { text: 'Fliesen' } });
  await page.goto(`/#/list/${list.id}`);
  await tile(page, 'Fliesen').click({ button: 'right' });
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: '📎 Anhang' }).click();

  // Offline: the picture is there at once (local copy), the upload waits.
  await context.setOffline(true);
  await dialog.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'muster.png', mimeType: 'image/png', buffer: PNG });
  const picture = dialog.locator('.attachment-picture');
  await expect(picture).toHaveCount(1);
  await expect(picture).toHaveClass(/is-pending/);
  await context.setOffline(false);
  await expect(picture).not.toHaveClass(/is-pending/, { timeout: 20_000 });
  await expect.poll(() => filesOf(page, list.id), { timeout: 15_000 }).toEqual([['Fliesen', ['muster.png']]]);
  const fileId = (await (await page.request.get(`/api/v1/lists/${list.id}`)).json()).items[0].attachments[0].fileId;
  const served = await page.request.get(`/api/v1/files/${fileId}`);
  expect(served.status()).toBe(200);
  expect((await served.body()).equals(PNG)).toBe(true);

  // Large, and closed again with Esc (the details stay open).
  await picture.getByRole('button', { name: /Bild ansehen/ }).click();
  await expect(page.locator('.picture-view img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.picture-view')).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test('files dropped onto the list: onto an entry it is attached, onto free space a new entry', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Ziehen gibt es am Rechner');
  await login(page, `Gustav ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Büro', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { text: 'Steuer' } });
  await page.goto(`/#/list/${list.id}`);
  await expect(page.getByText('Steuer', { exact: true })).toBeVisible();
  const drop = async (selector: string, name: string) => {
    const dt = await page.evaluateHandle((n) => {
      const d = new DataTransfer();
      d.items.add(new File(['a;b\n1;2\n'], n, { type: 'application/vnd.ms-excel' }));
      return d;
    }, name);
    await page.locator(selector).first().dispatchEvent('dragover', { dataTransfer: dt });
    await page.locator(selector).first().dispatchEvent('drop', { dataTransfer: dt });
  };
  await drop('[data-item-id]', 'Bescheid.xls');
  await drop('.work-tasks, section.listview', 'WflSearch.xls');
  await expect
    .poll(() => filesOf(page, list.id), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        ['Steuer', ['Bescheid.xls']],
        ['WflSearch', ['WflSearch.xls']],
      ]),
    );
});
