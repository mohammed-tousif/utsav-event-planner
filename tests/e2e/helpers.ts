import { expect, type Page } from '@playwright/test';

export function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fills the intake for a wedding and lands on the generated plan. */
export async function createWeddingPlan(page: Page, { guests = '250', budget = '1500000', date = isoFromToday(120) } = {}) {
  await page.goto('/');
  await page.getByRole('link', { name: /Wedding/ }).click();
  await page.getByLabel('Event name (optional)').fill('Asha and Rohan’s wedding');
  await page.getByLabel('Event date').fill(date);
  await page.getByLabel('Number of guests').fill(guests);
  await page.getByLabel('City or area').fill('Hubballi, Karnataka');
  await page.getByText('Shortlisted, not booked').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Total budget').fill(budget);
  await page.getByText('Food and drinks').click();
  await page.getByText('Photos and video').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByText('Mehendi', { exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Style or theme').fill('Pastel garden with marigold accents');
  await page.getByText('Jain', { exact: true }).click();
  await page.getByText('Many elderly guests').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Create my wedding plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Asha and Rohan’s wedding' })).toBeVisible();
}
