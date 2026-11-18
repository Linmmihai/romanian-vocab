const { test, expect } = require('@playwright/test');

async function startWithoutRomanianVoice(page, mode, size) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#flash-content')).toBeVisible();
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await page.evaluate(({ mode, size }) => {
    speechSynthesis.getVoices = () => [{ lang: 'en-US' }];
    configureQuiz({ mode, size }, { start: true });
  }, { mode, size });
}

async function skipAfterFailure(page) {
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-play-btn')).toHaveText('重试播放');
  await page.getByRole('button', { name: '跳过音频题，继续本轮' }).click();
}

test('unavailable diagnostic audio leaves the remaining items and their scores intact', async ({ page }) => {
  await startWithoutRomanianVoice(page, 'diagnostic', 3);
  const coverage = await page.evaluate(() => {
    const words = getLearningCollectionWords(W);
    return { total: words.length, eligible: words.filter(isAssessmentEligible).length };
  });
  const before = await page.evaluate(() => qList.slice(0, 2).map(({ word }) => getProgress(word.ro)?.qt || 0));
  await skipAfterFailure(page);
  await skipAfterFailure(page);
  await page.evaluate(() => {
    const answer = getCurrentQuizWord().ro;
    [...document.querySelectorAll('#quiz-area .opt')].find(button => button.dataset.optionRo === answer).click();
  });
  await page.locator('#qnxt').click();
  await expect(page.locator('.result-score')).toHaveText('100%');
  await expect(page.locator('#quiz-area')).toContainText('本轮得分 1/1');
  await expect(page.locator('#quiz-area')).toContainText('音频未测 2 题');
  await expect(page.locator('#quiz-area')).toContainText('本轮实测 1 个词');
  await expect(page.locator('#quiz-area')).toContainText(`共 ${coverage.total} 个词，已核对或已修订且可出题 ${coverage.eligible} 个`);
  expect(await page.evaluate(() => qList.slice(0, 2).map(({ word }) => getProgress(word.ro)?.qt || 0))).toEqual(before);
});

test('a fully skipped audio round is unscored and the next round can recover on retry', async ({ page }) => {
  await startWithoutRomanianVoice(page, 'dictation', 1);
  await skipAfterFailure(page);
  await expect(page.locator('.result-score')).toHaveText('未测');
  await expect(page.locator('#quiz-area')).toContainText('音频未测 1 题');
  await page.evaluate(() => startQuiz());
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-skip-audio')).toBeVisible();
  await page.evaluate(() => {
    window.SpeechSynthesisUtterance = class {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = utterance => utterance.onstart();
  });
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-skip-audio')).toBeHidden();
  await expect(page.locator('#quiz-dictation-input')).toBeEnabled();
  await page.locator('#quiz-dictation-input').fill('xxx');
  await page.locator('#quiz-dictation-submit').click();
  await page.locator('#qnxt').click();
  await expect(page.locator('.result-score')).toHaveText('0%');
  await expect(page.locator('#quiz-area')).toContainText('本轮得分 0/1');
  await expect(page.locator('#quiz-area')).not.toContainText('音频未测');
});
