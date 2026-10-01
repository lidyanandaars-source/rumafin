import { expect, test } from '@playwright/test'

test('shows configuration guidance when Supabase env is absent', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Konfigurasi Supabase diperlukan')).toBeVisible()
})
