import { expect, type Page } from '@playwright/test';

/** Dev login with a fresh name per test, so tests do not see each other's lists. */
export async function login(page: Page, name: string) {
  const res = await page.request.post('/auth/dev', { data: { name, household: name } });
  expect(res.ok()).toBeTruthy();
}

/** A tile of the list itself (not the catalog column on laptops), by its exact name. */
export const tile = (page: Page, name: string) => page.locator('.listview .tile', { has: page.locator('.tile__name', { hasText: new RegExp(`^${name}$`) }) });

export const phone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** The "+ Neu" button lives in the sidebar (the drawer on phones). */
export async function newList(page: Page, name: string) {
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

/** ToDo list settings: take over the suggested statuses (Neu · In Arbeit · Wartet), optionally "Erledigt" as a Kanban column. */
export async function takeSuggestedStatuses(page: Page, opts: { doneColumn?: boolean } = {}) {
  await page.getByRole('button', { name: 'Listenmenü' }).click();
  await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: /übernehmen/ }).click();
  if (opts.doneColumn) await dialog.getByRole('checkbox', { name: /Erledigte als Spalte/ }).check();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
