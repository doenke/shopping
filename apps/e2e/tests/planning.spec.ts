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

test('Gantt: bars, arrows, moving and stretching a bar', async ({ page }, info) => {
  test.skip(phone(page), 'the Gantt chart is for the desktop');
  await login(page, `Gerd ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Umzug', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Kartons packen', 'Transporter fahren', 'Einzug'] } });
  await page.goto(`/#/list/${list.id}`);
  // No project planning: no Gantt.
  await expect(page.getByRole('button', { name: 'Gantt' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('checkbox', { name: /Projektplanung/ }).check();
  await dialog.getByLabel('Projektbeginn (leer = heute)').fill('2030-01-07');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  const detail = await openTask(page, 'Transporter fahren');
  await detail.locator('.pm summary').click();
  await detail.getByRole('spinbutton', { name: 'Dauer in Tagen' }).fill('2');
  await detail.getByRole('spinbutton', { name: 'Dauer in Tagen' }).press('Enter');
  await detail.getByRole('combobox', { name: 'Vorgänger hinzufügen' }).selectOption({ label: 'Kartons packen' });
  await (await openTask(page, 'Einzug')).locator('.pm summary').click();
  await page.locator('.work-detail').getByRole('checkbox', { name: 'Meilenstein' }).click();
  await page.locator('.work-detail').getByRole('combobox', { name: 'Vorgänger hinzufügen' }).selectOption({ label: 'Transporter fahren' });

  await page.getByRole('button', { name: 'Gantt' }).click();
  const gantt = page.locator('.gantt');
  await expect(gantt.getByRole('img', { name: /^Kartons packen: Mo\., 7\.1\.2030 bis Mo\., 7\.1\.2030$/ })).toBeVisible();
  await expect(gantt.getByRole('img', { name: /^Transporter fahren: Di\., 8\.1\.2030 bis Mi\., 9\.1\.2030$/ })).toBeVisible();
  await expect(gantt.getByRole('img', { name: /^Einzug: Meilenstein Mi\., 9\.1\.2030$/ })).toBeVisible();
  await expect(gantt.locator('.gantt__arrow')).toHaveCount(2);

  // Two days to the right: a given start; the milestone follows.
  const bar = gantt.getByRole('img', { name: /^Transporter fahren/ });
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + 2 * 28, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(gantt.getByRole('img', { name: /^Transporter fahren: Do\., 10\.1\.2030 bis Fr\., 11\.1\.2030$/ })).toBeVisible();
  await expect(gantt.getByRole('img', { name: /^Einzug: Meilenstein Fr\., 11\.1\.2030$/ })).toBeVisible();

  // Its right edge one working day further (over the weekend): three days, until Monday.
  const moved = (await gantt.getByRole('img', { name: /^Transporter fahren/ }).boundingBox())!;
  await page.mouse.move(moved.x + moved.width - 3, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width - 3 + 3 * 28, moved.y + moved.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(gantt.getByRole('img', { name: /^Transporter fahren: Do\., 10\.1\.2030 bis Mo\., 14\.1\.2030$/ })).toBeVisible();

  // A double click opens the details; Esc closes them.
  await gantt.getByRole('button', { name: 'Transporter fahren' }).dblclick();
  await expect(page.locator('.work-detail')).toBeVisible();
  await expect(page.locator('.work-detail .pm summary')).toContainText('3 Tage');
});

test('Planning automation: resource levelling and writing the computed dates', async ({ page }, info) => {
  test.skip(phone(page), 'the Gantt chart is for the desktop');
  await login(page, `Ulla ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Renovierung', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Wände streichen @Ulla', 'Boden legen @Ulla', 'Lampen kaufen @Tom'] } });
  await page.goto(`/#/list/${list.id}`);
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('checkbox', { name: /Projektplanung/ }).check();
  await dialog.getByLabel('Projektbeginn (leer = heute)').fill('2030-01-07');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Gantt' }).click();
  const gantt = page.locator('.gantt');
  // Without levelling everything starts on the Monday.
  await expect(gantt.getByRole('img', { name: /^Boden legen: Mo\., 7\.1\.2030/ })).toBeVisible();

  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  await dialog.getByRole('checkbox', { name: /Ressourcenabgleich/ }).check();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // Ulla does one after the other, Tom is free.
  await expect(gantt.getByRole('img', { name: /^Wände streichen: Mo\., 7\.1\.2030/ })).toBeVisible();
  await expect(gantt.getByRole('img', { name: /^Boden legen: Di\., 8\.1\.2030 bis Di\., 8\.1\.2030$/ })).toHaveAttribute('title', /später, weil Ulla/);
  await expect(gantt.getByRole('img', { name: /^Lampen kaufen: Mo\., 7\.1\.2030/ })).toBeVisible();

  // Writing the dates: afterwards there is nothing left to write.
  const fix = page.getByRole('button', { name: /Termine festschreiben/ });
  await expect(fix).toHaveText(/\(3\)/);
  await fix.click();
  await expect(page.getByText('Termine für 3 Aufgaben festgeschrieben')).toBeVisible();
  await expect(fix).toBeDisabled();
  await gantt.getByRole('button', { name: 'Boden legen' }).dblclick();
  const pm = page.locator('.work-detail .pm');
  await pm.locator('summary').click();
  // Still calculated (grey), not a given date.
  await expect(pm.locator('input[type=date]').first()).toHaveValue('2030-01-08');
  await expect(pm.locator('input[type=date]').first()).toHaveClass(/pm-calc/);
});
