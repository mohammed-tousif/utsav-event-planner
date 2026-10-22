import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createWeddingPlan, isoFromToday } from './helpers';

test('plans a wedding, revises it and keeps progress after reload', async ({ page }) => {
  await createWeddingPlan(page);

  await expect(page.getByText('Sample data: this plan was filled with fixed placeholder content, not AI.')).toBeVisible();
  const total = page.locator('.budget-table tfoot .amount');
  await expect(total).toHaveText('₹15,00,000');

  // AI revision flow (sample provider): exact 20% cut, recalculated in code.
  await page.getByRole('button', { name: 'Reduce the budget by 20%' }).click();
  await page.getByRole('button', { name: 'Apply change' }).click();
  await expect(page.getByText('Plan updated')).toBeVisible();
  await expect(total).toHaveText('₹12,00,000');
  await expect(page.getByText(/reduced by exactly 20%/).first()).toBeVisible();

  // Locking a category keeps it fixed through a direct edit.
  const venueAmount = page.locator('.budget-table tbody tr').first().locator('.amount');
  const venueBefore = await venueAmount.textContent();
  await page.getByLabel(/Keep Venue at/).check();
  await page.getByText('Edit guests or budget directly').click();
  await page.getByLabel('Total budget (INR)').fill('1000000');
  await page.getByRole('button', { name: 'Recalculate without AI' }).click();
  await expect(total).toHaveText('₹10,00,000');
  await expect(venueAmount).toHaveText(venueBefore!);

  // Timeline progress and vendor status persist.
  await page.getByRole('tab', { name: /Timeline/ }).click();
  const firstTask = page.locator('.task input[type=checkbox]').first();
  await firstTask.check();
  await page.getByRole('tab', { name: 'Vendors' }).click();
  await page.locator('.vendor select').first().selectOption('booked');

  await page.reload();
  await expect(total).toHaveText('₹10,00,000');
  await page.getByRole('tab', { name: /Timeline/ }).click();
  await expect(page.locator('.task input[type=checkbox]').first()).toBeChecked();
  await page.getByRole('tab', { name: 'Vendors' }).click();
  await expect(page.locator('.vendor select').first()).toHaveValue('booked');
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.history-entry')).toHaveCount(3);

  // Home lists the saved plan.
  await page.getByRole('link', { name: 'Utsav home' }).click();
  await expect(page.getByRole('link', { name: /Asha and Rohan’s wedding/ })).toBeVisible();
});

test('exports a plan file and calendar, and imports the plan file back', async ({ page }, testInfo) => {
  await createWeddingPlan(page);
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download plan file' }).click()]);
  expect(json.suggestedFilename()).toMatch(/^asha-and-rohan-s-wedding-\d{4}-\d{2}-\d{2}\.json$/);
  const jsonPath = testInfo.outputPath('plan.json');
  await json.saveAs(jsonPath);
  const saved = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(saved.schemaVersion).toBe(1);

  const [ics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Add tasks to a calendar' }).click()]);
  const icsText = await readFile((await ics.path())!, 'utf8');
  expect(icsText).toContain('BEGIN:VCALENDAR');

  // Import into a fresh browser context.
  const fresh = await page.context().browser()!.newContext();
  const other = await fresh.newPage();
  await other.goto('/');
  await other.locator('input[type=file]').setInputFiles(jsonPath);
  await expect(other.getByRole('heading', { level: 1, name: 'Asha and Rohan’s wedding' })).toBeVisible();
  await fresh.close();
});

test('print view contains the whole plan', async ({ page }) => {
  await createWeddingPlan(page);
  await page.emulateMedia({ media: 'print' });
  const print = page.locator('.print-plan');
  await expect(print).toBeVisible();
  for (const section of ['Budget', 'Timeline', 'Vendors', 'Ideas']) {
    await expect(print.locator('h2', { hasText: section })).toBeVisible();
  }
  await expect(page.locator('.plan-layout')).toBeHidden();
});

test('validates input and explains what to fix', async ({ page }) => {
  await page.goto('/#/new/birthday');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose the event date.')).toBeVisible();
  await expect(page.getByText('Enter the number of guests.')).toBeVisible();
  await expect(page.getByLabel('Event date')).toBeFocused();

  await page.getByLabel('Event date').fill(isoFromToday(-3));
  await page.getByLabel('Number of guests').fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That date has passed. Choose today or a later date.')).toBeVisible();
  await expect(page.getByText('There must be at least one guest.')).toBeVisible();

  await page.getByLabel('Event date').fill(isoFromToday(5));
  await page.getByLabel('Number of guests').fill('40');
  await page.getByLabel('City or area').fill('Dharwad');
  await page.getByText('Already booked').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Total budget').fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('The budget must be more than zero.')).toBeVisible();
  await expect(page.getByText('Pick at least one thing that matters most.')).toBeVisible();

  await page.getByLabel('Total budget').fill('8000');
  await page.getByText('Music and entertainment').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Follow-up questions specific to birthdays.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Tell us who the birthday is for and who is coming.').first()).toBeVisible();
  await page.getByText('Child (1–12)').click();
  await page.getByText('Mostly children').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Style or theme').fill('Jungle safari');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Plausibility checks shown before generating.
  await expect(page.getByText(/days away\. Tasks will be compressed/)).toBeVisible();
  await expect(page.getByText(/which is tight/)).toBeVisible();
  await page.getByRole('button', { name: 'Create my birthday plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Birthday party' })).toBeVisible();
  await page.getByRole('tab', { name: /Timeline/ }).click();
  await expect(page.getByText(/brought forward/).first()).toBeVisible();
});

test('shows a clear error and keeps the plan when the AI fails', async ({ page }) => {
  await createWeddingPlan(page);
  await page.route('**/api/plans/revise', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ai_unavailable', message: 'The AI service is having problems. Try again shortly.' } }),
    }),
  );
  await page.getByLabel('Describe the change').fill('Make the menu fully Jain');
  await page.getByRole('button', { name: 'Apply change' }).click();
  await expect(page.getByText('The change was not applied')).toBeVisible();
  await expect(page.getByText('Your plan is unchanged.')).toBeVisible();
  await expect(page.locator('.budget-table tfoot .amount')).toHaveText('₹15,00,000');
});

test('explains when a saved plan cannot be read', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('utsav.plan.broken-id', '{"not":"a plan"}'));
  await page.goto('/#/plan/broken-id');
  await expect(page.getByText('This saved plan could not be read. It may have been edited outside Utsav.')).toBeVisible();
});

test('supports keyboard-only use of the plan tabs', async ({ page }) => {
  await createWeddingPlan(page);
  const budgetTab = page.getByRole('tab', { name: 'Budget' });
  await budgetTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Timeline/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Changes/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(budgetTab).toBeFocused();
});

test('has no serious accessibility violations', async ({ page }) => {
  const scan = async () => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`);
  };
  await page.goto('/');
  expect(await scan()).toEqual([]);
  await page.goto('/#/new/wedding');
  expect(await scan()).toEqual([]);
  await createWeddingPlan(page);
  expect(await scan()).toEqual([]);
  for (const tab of [/Timeline/, 'Vendors', 'Ideas']) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await scan()).toEqual([]);
  }
});

test('fits a phone screen without sideways scrolling @mobile', async ({ page }) => {
  await createWeddingPlan(page);
  for (const tab of ['Budget', /Timeline/, 'Vendors', 'Ideas']) {
    await page.getByRole('tab', { name: tab }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  await page.getByRole('button', { name: 'Change the plan' }).click();
  await expect(page.getByLabel('Describe the change')).toBeFocused();
  await expect(page.getByLabel('Describe the change')).toBeInViewport();
});

test('never ships the API key name to the browser', async ({ page }) => {
  const bodies: string[] = [];
  page.on('response', async (res) => {
    if (/\.(js|css|html)$|\/$/.test(new URL(res.url()).pathname)) bodies.push(await res.text().catch(() => ''));
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(bodies.length).toBeGreaterThan(0);
  for (const text of bodies) {
    expect(text).not.toContain('GEMINI_API_KEY');
    expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
  }
});
