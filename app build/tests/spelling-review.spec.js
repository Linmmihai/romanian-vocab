const { test, expect } = require('@playwright/test');

test('a dictation partial persists per account and clears only after accurate unaided dictation', async ({ page }) => {
  await page.addInitScript(() => {
    window.SpeechSynthesisUtterance = class {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.cancel = () => {};
    speechSynthesis.speak = utterance => utterance.onstart();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await page.waitForFunction(() => !!getCurrentFlashWord());
  await page.locator('.nav-tab[data-page="quiz"]').click();
  // Fix the sampled word while keeping playback, input and scoring on their normal paths.
  const target = await page.evaluate(() => {
    configureQuiz({ mode: 'dictation', scope: 'all' }, { start: true });
    const word = getQuizEligiblePool().find(w => /[ăâîșț]/i.test(w.ro));
    qList = [word];
    renderQuiz();
    return word.ro;
  });
  await page.locator('#quiz-play-btn').click();
  await page.locator('#quiz-dictation-input').fill(target.normalize('NFD').replace(/\p{M}/gu, ''));
  await page.locator('#quiz-dictation-submit').click();
  await expect(page.locator('#qfb')).toContainText('已加入本机拼写待复习');
  expect(await page.evaluate(() => qRoundResults[0].points)).toBe(0.5);
  const download = page.waitForEvent('download');
  await page.evaluate(() => exportProgressBackup());
  const backup = JSON.parse(await require('fs/promises').readFile(await (await download).path(), 'utf8'));
  expect(backup.spellingReview).toEqual([target.toLocaleLowerCase('ro')]);
  await page.evaluate(async keys => {
    const minimal = { app: 'romanian-vocab', progress: {} };
    await importProgressBackup(new Blob([JSON.stringify(minimal)]));
    if (getPendingSpellingKeys().size !== 1) throw new Error('Legacy backup removed a pending spelling');
    const [key] = keys;
    localStorage.removeItem(spellingReviewPrefix() + key);
    await importProgressBackup(new Blob([JSON.stringify({ ...minimal, spellingReview: [key, key] })]));
  }, backup.spellingReview);
  expect(await page.evaluate(() => {
    const user = currentUser;
    try {
      currentUser = { id: 'other-account' };
      return getPendingSpellingWords(W).length;
    } finally {
      currentUser = user;
    }
  })).toBe(0);
  await page.reload();
  await page.waitForFunction(() => !!getCurrentFlashWord());
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await page.getByRole('button', { name: '复习拼写（本机 · 1 词）' }).click();
  await expect(page.locator('#quiz-dictation-input')).toHaveValue('');
  await expect(page.locator('#quiz-dictation-input')).toBeDisabled();
  expect(await page.locator('#quiz-area').innerText()).not.toContain(target);
  await page.evaluate(() => { speechSynthesis.getVoices = () => []; });
  await page.locator('#quiz-play-btn').click();
  await page.getByRole('button', { name: '跳过音频题，继续本轮' }).click();
  await expect(page.locator('.result-score')).toHaveText('未测');
  await page.getByRole('button', { name: '复习拼写（本机 · 1 词）' }).click();
  await page.evaluate(() => { speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }]; });
  await page.locator('#quiz-play-btn').click();
  await page.locator('#quiz-dictation-input').fill(target);
  await page.locator('#quiz-dictation-submit').click();
  await expect(page.locator('#qfb')).toContainText('正确');
  await page.locator('#qnxt').click();
  await expect(page.locator('#spelling-review-action')).toBeHidden();
  expect(await page.evaluate(() => getPendingSpellingWords(W).length)).toBe(0);
});
