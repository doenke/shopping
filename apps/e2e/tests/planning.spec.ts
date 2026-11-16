import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/** The details of a task: a full-screen page on phones, the right column on the desktop. */
async function openTask(page: Page, name: string) {
  await page.locator('.work-row', { hasText: name }).click();
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue(name);
  return page.locator('.work-detail');
}

async function closeTask(page: Page) {
  if (phone(page)) {
    await page.getByRole('button', { name: 'Details schließen' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
}

test('project planning is a second level: switched on per list, folded away in the details', async ({ page }, info) => {
  await login(page, `Paula ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Hausbau', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Fundament', 'Mauern', 'Richtfest'] } });
  await page.goto(`/#/list/${list.id}`);

  // Off by default: the details stay as they are.
  let detail = await openTask(page, 'Mauern');
  await expect(detail.locator('.pm')).toHaveCount(0);
  await closeTask(page);

  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('checkbox', { name: /Projektplanung/ }).check();
  // 7 January 2030 is a Monday; Saturday is a working day too.
  await dialog.getByLabel('Projektbeginn (leer = heute)').fill('2030-01-07');
  await dialog.locator('.chip--toggle', { hasText: 'Sa' }).click();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  detail = await openTask(page, 'Mauern');
  const pm = detail.locator('.pm');
  await expect(pm).not.toHaveAttribute('open');
  await pm.locator('summary').click();
  await pm.getByRole('spinbutton', { name: 'Dauer in Tagen' }).fill('5');
  await pm.getByRole('spinbutton', { name: 'Dauer in Tagen' }).press('Enter');
  await pm.getByRole('combobox', { name: 'Vorgänger hinzufügen' }).selectOption({ label: 'Fundament' });
  // Fundament takes the Monday; five days from Tuesday, Saturday included.
  await expect(pm.locator('input[type=date]').first()).toHaveValue('2030-01-08');
  await expect(pm.locator('input[type=date]').nth(1)).toHaveValue('2030-01-12');
  await expect(pm.locator('summary')).toContainText('5 Tage');
  await expect(pm.locator('.pm__dep')).toContainText('Fundament');
  await closeTask(page);

  // The link shows on the other side too; a milestone after it.
  detail = await openTask(page, 'Fundament');
  await detail.locator('.pm summary').click();
  await expect(detail.locator('.pm__deps', { hasText: 'Nachfolger' }).locator('.pm__dep')).toContainText('Mauern');
  await closeTask(page);
  detail = await openTask(page, 'Richtfest');
  await detail.locator('.pm summary').click();
  await detail.getByRole('checkbox', { name: 'Meilenstein' }).click();
  await expect(detail.getByRole('checkbox', { name: 'Meilenstein' })).toBeChecked();
  await detail.getByRole('combobox', { name: 'Vorgänger hinzufügen' }).selectOption({ label: 'Mauern' });
  await expect(detail.locator('.pm summary')).toContainText('◆');
  await expect(detail.locator('.pm input[type=date]').first()).toHaveValue('2030-01-12');
  // Circles are not offered: Fundament comes before, so it cannot come after.
  await expect(detail.getByRole('combobox', { name: 'Nachfolger hinzufügen' }).locator('option', { hasText: 'Fundament' })).toHaveCount(0);
});
