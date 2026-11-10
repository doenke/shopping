import { expect, test } from '@playwright/test';
import { login, phone, takeSuggestedStatuses } from './helpers';

/** ToDo lists on the desktop: Arbeitsmodus, table, statuses, Kanban. */
test('Arbeitsmodus hides lists; ToDo lists on the desktop are a table', async ({ page }, info) => {
  test.skip(phone(page), 'the table is for the desktop');
  await login(page, `Hanna ${info.project.name}`);
  const work = await (await page.request.post('/api/v1/lists', { data: { name: 'Projekt X', type: 'todo', group: 'Arbeit' } })).json();
  const home = await (await page.request.post('/api/v1/lists', { data: { name: 'Haus', type: 'todo' } })).json();
  await page.request.post('/api/v1/lists', { data: { name: 'Wocheneinkauf' } });
  await page.request.post(`/api/v1/lists/${work.id}/items`, { data: { items: ['Angebot schicken'] } });
  // Any ToDo list gets the table – no mode needed.
  await page.goto(`/#/list/${home.id}`);
  await expect(page.locator('.work-table, .work-empty').first()).toBeVisible();
  await page.goto(`/#/list/${work.id}`);
  await page.keyboard.press('n');
  await page.keyboard.type('Vertrag senden !morgen');
  await page.keyboard.press('Enter');
  const row = page.locator('.work-row', { hasText: 'Vertrag senden' });
  await expect(row).toContainText('Morgen');
  await row.click();
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Vertrag senden');
  await page.keyboard.press(' ');
  await expect(page.locator('.work-table')).toContainText('Erledigt (1)');
  // The Arbeitsmodus only hides the other lists.
  await page.getByRole('button', { name: /Arbeitsmodus/ }).click();
  await expect(page.locator('.sidebar')).toContainText('Projekt X');
  await expect(page.locator('.sidebar')).not.toContainText('Wocheneinkauf');
  await expect(page.locator('.sidebar')).not.toContainText('Haus');
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('.sidebar')).toContainText('Wocheneinkauf');
});

test('a ToDo list gets statuses; tasks get one', async ({ page }, info) => {
  test.skip(phone(page), 'table and details on the desktop');
  await login(page, `Jan ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Projekt', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Konzept'] } });
  await page.goto(`/#/list/${list.id}`);
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: /übernehmen/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Status 2' })).toHaveValue('In Arbeit');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.work-table th', { hasText: 'Status' })).toBeVisible();
  await page.locator('.work-row', { hasText: 'Konzept' }).click();
  await page.locator('.work-detail').getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Wartet' });
  await expect(page.locator('.work-row', { hasText: 'Konzept' })).toContainText('Wartet');
  // In the table: click the status pill, pick from the pills underneath.
  await page
    .locator('.work-row', { hasText: 'Konzept' })
    .getByRole('button', { name: /Status: Wartet/ })
    .click();
  await page.getByRole('listbox', { name: 'Status wählen' }).getByRole('option', { name: 'Neu' }).click();
  await expect(page.getByRole('listbox', { name: 'Status wählen' })).toHaveCount(0);

  // Default "In Arbeit": new entries get it, existing ones keep theirs.
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  await page.locator('dialog[open]').getByRole('radio', { name: 'In Arbeit als Standard' }).check();
  await page.locator('dialog[open]').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.keyboard.press('n');
  await page.keyboard.type('Umsetzung');
  await page.keyboard.press('Enter');
  await expect(page.locator('.work-row', { hasText: 'Umsetzung' })).toContainText('In Arbeit');
  await expect(page.locator('.work-row', { hasText: 'Konzept' })).toContainText('Neu');
});

test('Kanban: cards move between status columns and to Erledigt', async ({ page }, info) => {
  test.skip(phone(page), 'the board is for the desktop');
  await login(page, `Kim ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Board', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Konzept', 'Rechnung'] } });
  await page.goto(`/#/list/${list.id}`);
  // Without statuses there is no Kanban (it needs columns): no switch.
  await expect(page.getByRole('button', { name: 'Kanban' })).toHaveCount(0);
  await takeSuggestedStatuses(page, { doneColumn: true });
  await page.getByRole('button', { name: 'Kanban' }).click();
  await expect(page.locator('.kanban-col__title')).toHaveText(['Neu 2', 'In Arbeit 0', 'Wartet 0', 'Erledigt 0']);
  const col = (name: string) => page.locator('.kanban-col', { has: page.locator('.kanban-col__title', { hasText: name }) });
  await page.locator('.kanban-card', { hasText: 'Konzept' }).dragTo(col('In Arbeit').locator('.kanban-col__cards'));
  await expect(col('In Arbeit')).toContainText('Konzept');
  await page.locator('.kanban-card', { hasText: 'Rechnung' }).dragTo(col('Erledigt').locator('.kanban-col__cards'));
  await expect(col('Erledigt')).toContainText('Rechnung');
  // And back: open again, in the column it was dropped on.
  await page.locator('.kanban-card', { hasText: 'Rechnung' }).dragTo(col('Wartet').locator('.kanban-col__cards'));
  await expect(col('Wartet')).toContainText('Rechnung');
  const items = (await (await page.request.get(`/api/v1/lists/${list.id}?items=all`)).json()).items as { name: string; status: string; checked: boolean }[];
  expect(items.find((i) => i.name === 'Rechnung')).toMatchObject({ status: 'Wartet', checked: false });
});

test('Kanban: the order within a column is set by hand', async ({ page }, info) => {
  test.skip(phone(page), 'the board is for the desktop');
  await login(page, `Lea ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Reihenfolge', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Erstens', 'Zweitens', 'Drittens'] } });
  await page.goto(`/#/list/${list.id}`);
  await takeSuggestedStatuses(page);
  await page.getByRole('button', { name: 'Kanban' }).click();
  const titles = page.locator('.kanban-col').first().locator('.kanban-card__title');
  await expect(titles).toHaveText(['Erstens', 'Zweitens', 'Drittens']);
  // "Drittens" onto the upper half of "Erstens": it goes first.
  await page.locator('.kanban-card', { hasText: 'Drittens' }).dragTo(page.locator('.kanban-card', { hasText: 'Erstens' }), { targetPosition: { x: 20, y: 4 } });
  await expect(titles).toHaveText(['Drittens', 'Erstens', 'Zweitens']);
  // Kept after a reload (it is synced).
  await page.reload();
  await expect(page.locator('.kanban-col').first().locator('.kanban-card__title')).toHaveText(['Drittens', 'Erstens', 'Zweitens']);
  // A click only selects; the details open on double click.
  await page.locator('.kanban-card', { hasText: 'Erstens' }).click();
  await expect(page.locator('.work-detail')).toHaveCount(0);
  await page.locator('.kanban-card', { hasText: 'Erstens' }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Erstens');
});

test('Kanban by keyboard: Alt + arrows move a card', async ({ page }, info) => {
  test.skip(phone(page), 'the board is for the desktop');
  await login(page, `Mo ${info.project.name}`);
  const list = await (await page.request.post('/api/v1/lists', { data: { name: 'Tastatur-Board', type: 'todo' } })).json();
  await page.request.post(`/api/v1/lists/${list.id}/items`, { data: { items: ['Eins', 'Zwei'] } });
  await page.goto(`/#/list/${list.id}`);
  await takeSuggestedStatuses(page);
  await page.getByRole('button', { name: 'Kanban' }).click();
  const col = (name: string) => page.locator('.kanban-col', { has: page.locator('.kanban-col__title', { hasText: name }) });
  await page.locator('.kanban-card', { hasText: 'Zwei' }).focus();
  // Up one place, then one column to the right – the card keeps the focus.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(col('Neu').locator('.kanban-card__title')).toHaveText(['Zwei', 'Eins']);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(col('In Arbeit')).toContainText('Zwei');
  await expect(page.locator('.kanban-card:focus')).toContainText('Zwei');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(col('Wartet')).toContainText('Zwei');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(col('In Arbeit')).toContainText('Zwei');
});
