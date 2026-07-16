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

  await expect(page.locator('#review-new-count')).toHaveText('0/200');
  await page.locator('#main-card').click();
  await expect(page.locator('#mark-known-btn')).toBeVisible();
  await page.locator('#mark-known-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('1/200');

  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('progress:local-offline-user');
    return raw ? Object.keys(JSON.parse(raw)).length : 0;
  }), { timeout: 5_000 }).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#review-new-count')).toHaveText('1/200');
  expect(pageErrors).toEqual([]);
});

test('failed new cards stay in Anki learning steps instead of becoming reinforcement', async ({ page }) => {
  await enterOfflineApp(page);

  await expect(page.locator('#today-focus-meta')).toContainText('复习优先');
  await page.locator('#main-card').click();
  const wordRo = (await page.locator('#fc-ro').innerText()).trim();
  await page.locator('#mark-unknown-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('0/200');

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

  await expect(page.getByRole('button', { name: '打开学习指南' })).toHaveText('指南');
  await expect(page.locator('.topbar-guide-icon')).toHaveCount(0);

  for (const [name, pageId] of [['测验', 'quiz'], ['词汇', 'list'], ['统计', 'stats'], ['语法', 'grammar'], ['学习', 'flash']]) {
    await page.locator(`.nav-tab[data-page="${pageId}"]`).click();
    await expect(page.locator(`#page-${pageId}`)).toHaveClass(/active/);
  }
});

test('grammar tab supports grammar-system browsing, summaries, and search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterOfflineApp(page);

  await page.locator('.nav-tab[data-page="grammar"]').click();
  await expect(page.locator('#page-grammar')).toHaveClass(/active/);
  await expect(page.locator('#grammar-course-total')).toHaveText('86 个专题');
  await expect(page.locator('#grammar-module-total')).toHaveText('8 个模块');
  await expect(page.locator('.grammar-module')).toHaveCount(8);
  await expect(page.locator('.grammar-course')).toHaveCount(86);
  await expect(page.locator('#grammar-scope-label')).toHaveText('按词法与句法编排');
  await expect(page.locator('[data-grammar-filter]')).toHaveCount(0);

  await page.locator('.grammar-guide-link').click();
  await expect(page.locator('#page-guide')).toHaveClass(/active/);
  await expect(page.locator('#guide-pronunciation')).toBeVisible();
  await expect(page.locator('.guide-video-link')).toHaveCount(3);
  await expect(page.locator('.guide-video-link').nth(0)).toHaveAttribute('href', 'https://www.bilibili.com/video/BV1tx4y1d77H/');
  await expect(page.locator('.guide-video-link').nth(1)).toHaveAttribute('href', 'https://www.bilibili.com/video/BV1yk4y1U7mN/');
  await expect(page.locator('.guide-video-link').nth(2)).toHaveAttribute('href', 'https://www.bilibili.com/video/BV1yk4y1U7Xm/');

  await page.locator('.nav-tab[data-page="grammar"]').click();
  await expect(page.locator('#page-grammar')).toHaveClass(/active/);

  const firstTopic = page.locator('[data-grammar-topic="grammar-001"]');
  await firstTopic.locator(':scope > summary').click();
  await expect(firstTopic).toHaveAttribute('open', '');
  await expect(firstTopic.getByText('先看结论')).toBeVisible();
  await expect(firstTopic.getByText('罗马尼亚语的词会根据功能分成可变词类和不变词类')).toBeVisible();
  await expect(firstTopic.getByText('核心规则')).toBeVisible();
  await expect(firstTopic.getByText('放进句子里')).toBeVisible();
  await expect(firstTopic.getByText('Fata citește repede.')).toBeVisible();

  const search = page.locator('#grammar-search-input');
  await search.fill('conjunctivul');
  await expect(page.locator('.grammar-course')).toHaveCount(2);
  await expect(page.locator('#grammar-visible-count')).toHaveText('找到 2 / 86 个专题');
  await expect(page.locator('.grammar-module')).toHaveCount(1);
  await expect(page.locator('.grammar-course-title')).toContainText(['虚拟式现在时 conjunctivul prezent', '虚拟式完成时 conjunctivul perfect']);

  await search.fill('-asem');
  await expect(page.locator('.grammar-course')).toHaveCount(1);
  const conjugationTopic = page.locator('[data-grammar-topic="grammar-042"]');
  await conjugationTopic.locator(':scope > summary').click();
  await expect(conjugationTopic.locator('.grammar-paradigm-table')).toBeVisible();
  await expect(conjugationTopic.locator('.grammar-paradigm-table')).toContainText('eu');
  await expect(conjugationTopic.locator('.grammar-paradigm-table')).toContainText('-asem');
  await expect(conjugationTopic.locator('.grammar-paradigm-table')).toContainText('eu lucrasem');

  await search.fill('第二变位法');
  await expect(page.locator('.grammar-course')).toHaveCount(1);
  const verbClassesTopic = page.locator('[data-grammar-topic="grammar-037"]');
  await verbClassesTopic.locator(':scope > summary').click();
  await expect(verbClassesTopic.locator('.grammar-watch')).toHaveCount(4);
  await expect(verbClassesTopic.getByText('【上外罗马尼亚语教学】第十二课-动词第二变位法')).toBeVisible();
  await expect(verbClassesTopic.locator('.grammar-watch').nth(1)).toHaveAttribute('href', 'https://www.bilibili.com/video/BV1B14y1v76s/');

  await page.locator('#grammar-search-clear').click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.grammar-course')).toHaveCount(86);
  await expect(page.locator('#grammar-visible-count')).toHaveText('共 86 个专题');
  await expect(page.locator('.grammar-watch')).toHaveCount(34);
  await expect(page.locator('[data-grammar-topic="grammar-001"] .grammar-watch')).toHaveCount(2);
  await expect(page.locator('[data-grammar-topic="grammar-002"] .grammar-watch')).toHaveCount(0);
  await expect(page.getByText('链接待补充')).toHaveCount(0);

  await page.locator('.nav-tab[data-page="flash"]').click();
  await expect(page.locator('#page-flash')).toHaveClass(/active/);
  await expect(page.locator('.nav-tab[data-page="flash"]')).toHaveClass(/active/);
});
