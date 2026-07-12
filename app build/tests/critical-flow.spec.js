const { test, expect } = require('@playwright/test');

async function enterOfflineApp(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#fc-zh')).not.toHaveText('');
}

test('offline study answer persists and advances the fixed daily goal', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await enterOfflineApp(page);

  await expect(page.locator('#review-new-count')).toHaveText('0/20');
  await page.locator('#main-card').click();
  await expect(page.locator('#mark-known-btn')).toBeVisible();
  await page.locator('#mark-known-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('1/20');

  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('progress:local-offline-user');
    return raw ? Object.keys(JSON.parse(raw)).length : 0;
  }), { timeout: 5_000 }).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#review-new-count')).toHaveText('1/20');
  expect(pageErrors).toEqual([]);
});

test('failed new cards stay in Anki learning steps instead of becoming reinforcement', async ({ page }) => {
  await enterOfflineApp(page);

  await expect(page.locator('.today-step-label')).toHaveText(['先学习中', '再到期复习', '最后学新词']);
  await page.locator('#main-card').click();
  const wordRo = (await page.locator('#fc-ro').innerText()).trim();
  await page.locator('#mark-unknown-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('0/20');

  await page.locator('.nav-tab[data-page="list"]').click();
  await page.locator('#search-input').fill(wordRo);
  const row = page.locator('.word-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('学习中');
  await expect(row).not.toContainText('需加强');
});

test('primary navigation remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterOfflineApp(page);

  for (const [name, pageId] of [['测验', 'quiz'], ['词汇', 'list'], ['统计', 'stats'], ['需加强', 'wrongbook'], ['学习', 'flash']]) {
    await page.locator(`.nav-tab[data-page="${pageId}"]`).click();
    await expect(page.locator(`#page-${pageId}`)).toHaveClass(/active/);
  }
});
