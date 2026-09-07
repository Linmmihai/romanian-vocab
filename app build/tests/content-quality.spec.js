const { test, expect } = require('@playwright/test');

async function enterOfflineApp(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
}

test('trusted content scope persists and keeps progressed pending words', async ({ page }) => {
  await enterOfflineApp(page);

  const scope = page.locator('#learning-content-scope-select');
  await expect(scope).toHaveValue('all');
  await expect(page.locator('#learning-content-scope-summary')).toContainText('已核对 153/1789 个');

  const result = await page.evaluate(async () => {
    const pending = W.find(word =>
      word.learning_track === 'news_core' &&
      word.content_status === 'active' &&
      !isTrustedWord(word)
    );
    setProgress(pending.ro, {
      seen: true,
      level: 'learning',
      qt: 1,
      qr: 0,
      cardState: 'learning',
      dueAt: new Date(Date.now() - 60_000).toISOString()
    });
    await setLearningContentScope('trusted');
    const scoped = getLearningCollectionWords(W);
    return {
      pendingRo: pending.ro,
      pendingRetained: scoped.some(word => word.ro === pending.ro),
      hasUntrustedUnseen: scoped.some(word => !isTrustedWord(word) && isUnseenWord(word)),
      dueRetained: getRemainingDueReviewWords(W).some(word => word.ro === pending.ro)
    };
  });

  expect(result.pendingRetained).toBe(true);
  expect(result.hasUntrustedUnseen).toBe(false);
  expect(result.dueRetained).toBe(true);
  await expect(scope).toHaveValue('trusted');
  await expect(page.locator('#learning-content-scope-summary')).toContainText('已有进度');

  await page.reload();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#learning-content-scope-select')).toHaveValue('trusted');
});

test('word detail separates evidence from unrecorded reviewer metadata', async ({ page }) => {
  await enterOfflineApp(page);
  await page.evaluate(() => {
    const word = W.find(item => item.source && item.corpus_snapshot && !item.reviewed_by && !item.reviewed_at);
    openWordDetail(word.ro);
  });

  const quality = page.locator('.content-quality-detail');
  await expect(quality).toBeVisible();
  await expect(quality).toContainText('词义');
  await expect(quality).toContainText('语法');
  await expect(quality).toContainText('重音');
  await expect(quality).toContainText('例句');
  await expect(quality).toContainText('自然度');
  await expect(quality).toContainText('内容来源');
  await expect(quality.getByText('审阅人')).toBeVisible();
  await expect(quality.getByText('审阅时间')).toBeVisible();
  await expect(quality.getByText('未记录', { exact: true })).toHaveCount(2);
});

test('quiz and study use one trusted-word predicate', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(() => ({
    samePredicate: RomanianVocabQuizEngine.isAssessmentEligible === RomanianVocabContentQuality.isTrustedWord,
    trustedTotal: W.filter(isTrustedWord).length,
    trustedCore: W.filter(word => word.learning_track === 'news_core' && word.content_status === 'active' && isTrustedWord(word)).length
  }));
  expect(result).toEqual({ samePredicate: true, trustedTotal: 283, trustedCore: 153 });
});
