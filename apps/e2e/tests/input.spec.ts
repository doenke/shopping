import { expect, test } from '@playwright/test';
import { login, tile, phone, newList } from './helpers';

/** Keyboard and mouse on the desktop. */
test('keyboard: arrows, space and delete with undo on a shopping list', async ({ page }, info) => {
  test.skip(phone(page), 'keyboard on the desktop');
  await login(page, `Gerd ${info.project.name}`);
  await page.goto('/');
  await newList(page, 'Tastatur');
  const input = page.getByRole('searchbox', { name: 'Artikel hinzufügen' });
  await input.fill('Milch; Brot; Käse');
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
  // H shows the shortcuts (the hint at the bottom says so).
  await expect(page.locator('.kbd-hint')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByRole('heading', { name: 'Tastenkürzel' })).toBeVisible();
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
