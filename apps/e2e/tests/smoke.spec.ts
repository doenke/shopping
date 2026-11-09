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

test('keyboard: arrows, space and delete with undo on a shopping list', async ({ page }, info) => {
  test.skip(phone(page), 'keyboard on the desktop');
  await login(page, `Gerd ${info.project.name}`);
  await page.goto('/');
  await newList(page, 'Tastatur');
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('Milch, Brot, Käse');
  await input.press('Enter');
  await expect(tile(page, 'Käse')).toBeVisible();
  await input.blur();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveAttribute('data-item-id', /.+/);
  const first = (await page.locator(':focus .tile__name').textContent())!;
  await page.keyboard.press(' ');
  await expect(page.getByText(/Zuletzt verwendet \(1\)/)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const next = (await page.locator(':focus .tile__name').textContent())!;
  expect(next).not.toBe(first);
  await page.keyboard.press('Delete');
  await expect(tile(page, next)).toHaveCount(0);
  await page.locator('.snackbar--toast').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(tile(page, next)).toBeVisible();
});

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

test('mouse: double click opens an entry; the Arbeitsmodus is called To-Do', async ({ page }, info) => {
  test.skip(phone(page), 'mouse on the desktop');
  await login(page, `Ida ${info.project.name}`);
  const memo = await (await page.request.post('/api/v1/lists', { data: { name: 'Filme', type: 'memo' } })).json();
  await page.request.post(`/api/v1/lists/${memo.id}/items`, { data: { text: 'Dune' } });
  await page.goto(`/#/list/${memo.id}`);
  await tile(page, 'Dune').dblclick();
  await expect(page.locator('dialog[open]').getByRole('textbox', { name: 'Name' })).toHaveValue('Dune');
  await page.keyboard.press('Escape');
  // Not ticked off by the two clicks.
  await expect(tile(page, 'Dune')).not.toHaveClass(/tile--done/);
  await expect(page.locator('.sidebar__head')).toContainText('Shopping');
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('.sidebar__head')).toContainText('To-Do');
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
  await page.locator('.work-row', { hasText: 'Konzept' }).click();
  await page.locator('.work-detail').getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Neu' });

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
  await page.getByRole('button', { name: 'Kanban' }).click();
  // Without statuses: "Offen" and "Erledigt", and a way to the settings.
  await expect(page.locator('.kanban-col__title')).toHaveText(['Offen 2', 'Erledigt 0']);
  await page.getByRole('button', { name: /Status in den Listeneinstellungen/ }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /übernehmen/ })
    .click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Speichern' }).click();
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
