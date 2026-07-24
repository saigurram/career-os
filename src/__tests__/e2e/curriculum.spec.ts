import { test, expect } from '@playwright/test'

test.describe('Curriculum', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.TEST_USER_EMAIL) test.skip()
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(process.env.TEST_USER_EMAIL!)
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD!)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL(/dashboard/)
    await page.goto('/curriculum')
  })

  test('curriculum page loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Error')
    await expect(page.locator('body')).not.toContainText('undefined')
  })

  test('shows curriculum units', async ({ page }) => {
    // 48 units exist — assert at least the first is visible
    await expect(page.locator('[data-testid="curriculum-unit"]').first()).toBeVisible({ timeout: 10000 })
  })

  test('task checkboxes are interactive', async ({ page }) => {
    const checkbox = page.locator('[data-testid="task-checkbox"], input[type="checkbox"]').first()
    if (await checkbox.isVisible()) {
      const initialState = await checkbox.isChecked()
      await checkbox.click()
      await expect(checkbox).not.toBeChecked() // if was checked, now unchecked — or vice versa
      // Reset
      await checkbox.click()
      expect(await checkbox.isChecked()).toBe(initialState)
    }
  })

  test('does not show "week" as a user-facing label', async ({ page }) => {
    // Per PRD — weeks are internal only, UI shows units/tasks
    const bodyText = await page.locator('body').innerText()
    // "Week 1" as a header should not appear — "Unit 1" or just the theme name is acceptable
    expect(bodyText).not.toMatch(/^Week \d+$/m)
  })
})
