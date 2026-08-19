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
  }), { timeout: 10_000 }).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#review-new-count')).toHaveText('1/200');
  expect(pageErrors).toEqual([]);
});

test('failed new cards stay in Anki learning steps instead of becoming reinforcement', async ({ page }) => {
  await enterOfflineApp(page);

  await expect(page.locator('#today-focus-meta')).toContainText('严格先做已到点内容');
  await page.locator('#main-card').click();
  const wordRo = (await page.locator('#fc-ro').innerText()).trim();
  await page.locator('#mark-unknown-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('0/200');

  await page.locator('.nav-tab[data-page="list"]').click();
  await page.locator('#search-input').fill(wordRo);
  const exactWord = page.locator('.word-ro').filter({
    hasText: new RegExp(`^${wordRo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  });
  await expect(exactWord).toHaveCount(1);
  const row = exactWord.locator('../..');
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

test('scientific diagnostic uses a trusted, non-repeating blueprint with listening majority', async ({ page }) => {
  await enterOfflineApp(page);
  await page.locator('.nav-tab[data-page="quiz"]').click();

  await expect(page.getByText('70% 为听力题')).toBeVisible();
  await expect(page.getByText(/当前题库没有已核对真人录音/)).toBeVisible();
  await expect(page.getByText(/不是 CEFR 定级/)).toBeVisible();
  await page.getByRole('button', { name: '开始词汇能力诊断' }).click();

  const blueprint = await page.evaluate(() => ({
    total: qList.length,
    unique: new Set(qList.map(item => item.word.ro)).size,
    trusted: qList.every(item => ['verified', 'revised'].includes(item.word.naturalness_status)),
    types: qList.reduce((counts, item) => {
      counts[item.type] = (counts[item.type] || 0) + 1;
      return counts;
    }, {})
  }));
  expect(blueprint).toEqual({
    total: 20,
    unique: 20,
    trusted: true,
    types: { listening: 7, dictation: 7, translation: 6 }
  });

  await expect(page.getByText('听音选择中文')).toBeVisible();
  await expect(page.locator('.opt[data-quiz-action="answer"]')).toHaveCount(4);
  await expect(page.locator('.opt[data-quiz-action="answer"]:enabled')).toHaveCount(0);
  expect(await page.evaluate(() => qRoundTotal)).toBe(0);

  await page.evaluate(() => {
    speechSynthesis.cancel = () => {};
    speechSynthesis.speak = () => {};
    speechSynthesis.getVoices = () => [];
  });
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('.opt[data-quiz-action="answer"]:enabled')).toHaveCount(4);
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-play-btn')).toBeDisabled();
  await expect(page.locator('#quiz-audio-meta')).toHaveText(/设备合成音 · 2\/2 次/);

  const queueBeforeAnswer = await page.evaluate(() => ({
    wordRo: getCurrentQuizWord().ro,
    completed: todayQueueCompleted.size
  }));
  await page.evaluate(() => {
    const answer = getCurrentQuizWord();
    const button = [...document.querySelectorAll('.opt[data-quiz-action="answer"]')]
      .find(option => roKey(option.dataset.optionRo || '') === roKey(answer.ro));
    button.click();
  });
  await expect(page.locator('#qfb')).toContainText('正确');
  const listeningEvidence = await page.evaluate((wordRo) => ({
    result: qRoundResults[0],
    progress: getProgress(wordRo),
    completed: todayQueueCompleted.size
  }), queueBeforeAnswer.wordRo);
  expect(listeningEvidence.result.type).toBe('listening');
  expect(listeningEvidence.result.replayCount).toBe(2);
  expect(listeningEvidence.result.audioSource).toBe('tts');
  expect(listeningEvidence.progress.seenViaCard).toBe(false);
  expect(listeningEvidence.completed).toBe(queueBeforeAnswer.completed);
});

test('dictation separates sound recognition from Romanian diacritic spelling', async ({ page }) => {
  await enterOfflineApp(page);
  await page.locator('.nav-tab[data-page="quiz"]').click();

  const target = await page.evaluate(() => {
    const word = W.find(item =>
      ['verified', 'revised'].includes(item.naturalness_status) &&
      /[ăâîșț]/i.test(item.ro)
    );
    qExerciseMode = 'dictation';
    qDifficulty = 'standard';
    qList = [word];
    qIdx = 0;
    qStarted = true;
    qRoundRight = 0;
    qRoundTotal = 0;
    qRoundWrong = 0;
    qRoundResults = [];
    renderQuiz();
    return { ro: word.ro, withoutDiacritics: window.RomanianVocabQuizEngine.stripRomanianDiacritics(word.ro) };
  });

  await expect(page.locator('#quiz-dictation-input')).toBeDisabled();
  await page.evaluate(() => {
    speechSynthesis.cancel = () => {};
    speechSynthesis.speak = () => {};
    speechSynthesis.getVoices = () => [];
  });
  await page.locator('#quiz-play-btn').click();
  await page.locator('#quiz-dictation-input').fill(target.withoutDiacritics);
  await page.locator('#quiz-dictation-submit').click();

  await expect(page.locator('#qfb')).toContainText('听辨正确，拼写部分得分');
  await expect(page.locator('#qfb')).toContainText(target.ro);
  const evidence = await page.evaluate(() => ({ result: qRoundResults[0], right: qRoundRight, total: qRoundTotal }));
  expect(evidence.result.points).toBe(0.5);
  expect(evidence.result.exact).toBe(false);
  expect(evidence.right).toBe(0);
  expect(evidence.total).toBe(1);

  await page.locator('#qnxt').click();
  await expect(page.locator('.result-score')).toHaveText('50%');
  await expect(page.locator('.quiz-result-metric')).toContainText('听写解码');
  await expect(page.locator('.quiz-validity-note')).toContainText('不是 CEFR 定级');
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

test('offline account panel explains that today is saved only on this device', async ({ page }) => {
  await enterOfflineApp(page);
  await page.locator('#account-menu-wrap > button').click();
  await page.getByRole('button', { name: '账号与提醒' }).click();

  await expect(page.locator('#account-sync-status')).toHaveText('仅保存在本机');
  await expect(page.locator('#account-sync-summary')).toContainText('今日已通过 0/200 · 新词 0/30');
  await expect(page.locator('#manual-sync-btn')).toBeDisabled();
  await expect(page.locator('#manual-sync-btn')).toHaveText('离线模式');
  await expect(page.locator('#sync-badge-text')).toHaveText('本机保存');
});

test('two tabs retain independent daily and progress outbox events', async ({ page, context }) => {
  await enterOfflineApp(page);
  const secondPage = await context.newPage();
  await secondPage.goto('/');
  await expect(secondPage.locator('#app-screen')).toBeVisible();

  await page.evaluate(() => {
    const prefixes = ['daily_state_event:cross-tab-e2e:', 'progress_pending_event:cross-tab-e2e:'];
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean);
    keys.filter(key => prefixes.some(prefix => key.startsWith(prefix))).forEach(key => localStorage.removeItem(key));
  });

  const createEvent = async (targetPage, wordId, wordRo) => targetPage.evaluate(({ wordId, wordRo }) => {
    const queueBase = {
      goal: 30,
      word_id: [1, 2],
      word_ro: ['unu', 'doi'],
      completed_word_id: [],
      completed_word_ro: [],
      introduced_word_id: [],
      introduced_word_ro: [],
      completed: false
    };
    const queueTarget = {
      ...queueBase,
      word_id: queueBase.word_id.filter(id => id !== wordId),
      word_ro: queueBase.word_ro.filter(ro => ro !== wordRo),
      completed_word_id: [wordId],
      completed_word_ro: [wordRo]
    };
    const daily = createDailyStateEvent('cross-tab-e2e', getLocalDateKey(), 'queue', queueBase, queueTarget);
    const progressEvent = {
      eventId: `progress-cross-tab-${wordId}`,
      occurredAt: new Date().toISOString(),
      correction: false,
      base: { qt: 0, qr: 0 },
      target: { qt: 1, qr: 1 }
    };
    const progress = writeProgressEventJournal('cross-tab-e2e', wordId, wordRo, progressEvent, { qt: 1, qr: 1 });
    return { dailyOk: daily.ok, progressOk: progress.ok, clientId: daily.event?.clientId };
  }, { wordId, wordRo });

  const first = await createEvent(page, 1, 'unu');
  const second = await createEvent(secondPage, 2, 'doi');
  const counts = await page.evaluate(() => ({
    daily: readPendingDailyEvents('cross-tab-e2e').length,
    progress: readProgressEventJournal('cross-tab-e2e').length
  }));

  expect(first.dailyOk && first.progressOk && second.dailyOk && second.progressOk).toBe(true);
  expect(first.clientId).not.toBe(second.clientId);
  expect(counts).toEqual({ daily: 2, progress: 2 });
  await secondPage.close();
});

test('manual sync is serialized and only succeeds after cloud verification', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(async () => {
    localStorage.removeItem('offline-mode');
    currentUser = { id: 'sync-test-user', email: 'sync@example.com' };
    userRole = 'user';
    progressMap = {};
    fastProgressQueue.clear();
    todayQueue = [];
    todayQueueCompleted = new Set();
    todayNewWords = 7;
    dailyGoal = 200;
    defaultDailyGoal = 200;
    window.__manualSyncCalls = 0;
    window.apiGetPendingSyncSummary = () => ({ progressCount: 0, dailyCount: 0, totalCount: 0, lastError: '' });
    window.triggerCloudProgressBackup = async () => {
      window.__manualSyncCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 60));
      return { attempted: 1, saved: 1, failed: 0, remaining: 0, dailyRemaining: 0 };
    };
    window.apiVerifyTodayState = async () => ({
      ok: true,
      logOk: true,
      queueOk: true,
      verifiedAt: new Date().toISOString()
    });
    window.apiLoadProgress = async () => ({});
    window.apiVerifyProgressState = async () => ({
      ok: true,
      expectedCount: 0,
      cloudCount: 0,
      mismatchCount: 0,
      verifiedAt: new Date().toISOString()
    });
    const first = manualSyncToday();
    const second = manualSyncToday();
    const samePromise = first === second;
    const values = await Promise.all([first, second]);
    return { calls: window.__manualSyncCalls, samePromise, ok: values.every(value => value.ok) };
  });

  expect(result).toEqual({ calls: 1, samePromise: true, ok: true });
  await page.waitForTimeout(2_200);
  await expect(page.locator('#sync-badge-text')).toContainText('已同步');
  await page.locator('#sync-badge').click();
  await expect(page.locator('#account-sync-status')).toHaveText('已同步到云端');
  await expect(page.locator('#account-sync-summary')).toContainText('今日已通过 7/200');
  await expect(page.locator('#manual-sync-btn')).toBeEnabled();
});

test('manual sync never reports success while a newer local write remains pending', async ({ page }) => {
  await enterOfflineApp(page);
  const calls = await page.evaluate(async () => {
    localStorage.removeItem('offline-mode');
    currentUser = { id: 'sync-race-user', email: 'race@example.com' };
    userRole = 'user';
    progressMap = {};
    fastProgressQueue.clear();
    todayQueue = [];
    todayQueueCompleted = new Set();
    window.__raceSyncCalls = 0;
    window.apiGetPendingSyncSummary = () => ({ progressCount: 1, dailyCount: 0, totalCount: 1, lastError: '' });
    window.triggerCloudProgressBackup = async () => {
      window.__raceSyncCalls += 1;
      return { attempted: 1, saved: 1, failed: 0, remaining: 1, dailyRemaining: 0 };
    };
    window.apiVerifyTodayState = async () => ({ ok: true, logOk: true, queueOk: true });
    const result = await manualSyncToday();
    return { calls: window.__raceSyncCalls, ok: result.ok };
  });

  expect(calls).toEqual({ calls: 2, ok: false });
  await page.locator('#sync-badge').click();
  await expect(page.locator('#account-sync-status')).toHaveText('有 1 项待同步');
  await expect(page.locator('#manual-sync-btn')).toHaveText('重新同步');
  await expect(page.locator('#account-sync-status')).not.toHaveText('已同步到云端');
});

test('manual sync stays unconfirmed when cloud read-back does not match today state', async ({ page }) => {
  await enterOfflineApp(page);
  const ok = await page.evaluate(async () => {
    localStorage.removeItem('offline-mode');
    currentUser = { id: 'sync-verify-user', email: 'verify@example.com' };
    userRole = 'user';
    progressMap = {};
    fastProgressQueue.clear();
    todayQueue = [];
    todayQueueCompleted = new Set();
    window.apiGetPendingSyncSummary = () => ({ progressCount: 0, dailyCount: 0, totalCount: 0, lastError: '' });
    window.triggerCloudProgressBackup = async () => ({ attempted: 1, saved: 1, failed: 0, remaining: 0, dailyRemaining: 0 });
    window.apiLoadProgress = async () => ({});
    window.apiVerifyProgressState = async () => ({ ok: true, expectedCount: 0, cloudCount: 0, mismatchCount: 0 });
    window.apiVerifyTodayState = async () => ({ ok: false, logOk: true, queueOk: false });
    return (await manualSyncToday()).ok;
  });

  expect(ok).toBe(false);
  await page.locator('#sync-badge').click();
  await expect(page.locator('#account-sync-status')).toHaveText('云端同步尚未确认');
  await expect(page.locator('#account-sync-detail')).toContainText('每日队列尚未通过云端回读确认');
  await expect(page.locator('#manual-sync-btn')).toHaveText('重新同步');
});

test('manual sync stays unconfirmed when any progress row differs from cloud', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(async () => {
    localStorage.removeItem('offline-mode');
    currentUser = { id: '00000000-0000-4000-8000-000000000123', email: 'progress-verify@example.com' };
    userRole = 'user';
    progressMap = { 1: { word_id: 1, word_ro: 'test', seen: true, known: true, qr: 1, qt: 1, level: 'learning' } };
    fastProgressQueue.clear();
    todayQueue = [];
    todayQueueCompleted = new Set();
    window.apiGetPendingSyncSummary = () => ({ progressCount: 0, dailyCount: 0, totalCount: 0, lastError: '' });
    window.triggerCloudProgressBackup = async () => ({ attempted: 1, saved: 1, failed: 0, remaining: 0, dailyRemaining: 0 });
    window.apiLoadProgress = async () => ({ ...progressMap });
    window.apiVerifyTodayState = async () => ({ ok: true, logOk: true, queueOk: true });
    window.apiVerifyProgressState = async () => ({ ok: false, expectedCount: 1, cloudCount: 1, mismatchCount: 1 });
    return await manualSyncToday();
  });

  expect(result.ok).toBe(false);
  await page.locator('#sync-badge').click();
  await expect(page.locator('#account-sync-status')).toHaveText('云端同步尚未确认');
  await expect(page.locator('#account-sync-detail')).toContainText('学习进度尚未通过云端回读确认');
});

test('cloud progress loading paginates beyond one thousand rows', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(async () => {
    localStorage.removeItem('offline-mode');
    currentUser = { id: '00000000-0000-4000-8000-000000000456', email: 'pagination@example.com' };
    const allRows = Array.from({ length: 1010 }, (_, index) => ({
      word_id: index + 1,
      word_ro: `word-${index + 1}`,
      seen: true,
      known: true,
      quiz_right: 1,
      quiz_total: 1,
      level: 'learning',
      review_stage: 1,
      card_state: 'learning',
      recent_results: []
    }));
    const ranges = [];
    const originalFrom = sb.from;
    sb.from = (table) => {
      if (table !== 'progress') return originalFrom.call(sb, table);
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        range(from, to) {
          ranges.push([from, to]);
          return Promise.resolve({ data: allRows.slice(from, to + 1), error: null });
        }
      };
      return query;
    };
    try {
      const loaded = await apiLoadProgress(currentUser.id);
      return { count: Object.keys(loaded).length, ranges };
    } finally {
      sb.from = originalFrom;
    }
  });

  expect(result).toEqual({
    count: 1010,
    ranges: [[0, 499], [500, 999], [1000, 1499]]
  });
});

test('daily completion goal and new-card cap remain separate', async ({ page }) => {
  await enterOfflineApp(page);

  await expect(page.locator('#review-new-count')).toHaveText('0/200');
  await expect(page.locator('#review-new-remaining')).toHaveText('0/30');
  await expect(page.locator('#goal-input')).toHaveValue('200');
  await expect(page.locator('#new-limit-input')).toHaveValue('30');
  const state = await page.evaluate(() => ({
    totalGoal: dailyGoal,
    newLimit: dailyNewLimit,
    queuedNew: todayQueue
      .map(ref => getWordByRo(ref))
      .filter(Boolean)
      .filter(isUnseenWord)
      .length
  }));
  expect(state).toEqual({ totalGoal: 200, newLimit: 30, queuedNew: 30 });
});

test('a 30-card target can continue through remaining reviews before new cards', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(async () => {
    const collectionWords = getLearningCollectionWords(W);
    const completedWords = collectionWords.slice(0, 30);
    const remainingReviewWords = collectionWords.slice(30, 200);
    const pastDueAt = new Date(Date.now() - 60_000).toISOString();
    const futureDueAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    progressMap = {};
    progressVersion++;
    dailyQueueLoaded = true;
    progressLoaded = true;
    defaultDailyGoal = 30;
    dailyGoal = 30;
    dailyNewLimit = 30;
    todayNewWords = 30;
    todayQueue = [];
    todayQueueCompleted = new Set(completedWords.map(word => word.ro));
    todaySeenWords = new Set(completedWords.map(word => word.ro));
    todayIntroducedWords = new Set();
    todayLog = {
      log_date: getDateKeyFor(new Date()),
      new_words: 30,
      goal: 30,
      completed: false
    };
    flashMode = 'today';
    curCat = '全部';

    completedWords.forEach(word => setProgress(word.ro, {
      seen: true,
      known: true,
      level: 'mastered',
      cardState: 'mastered',
      reviewStage: 2,
      reps: 2,
      dueAt: futureDueAt,
      nextReviewAt: futureDueAt
    }, { replace: true, source: 'e2e-goal-completed' }));
    remainingReviewWords.forEach(word => setProgress(word.ro, {
      seen: true,
      known: true,
      level: 'mastered',
      cardState: 'mastered',
      reviewStage: 2,
      reps: 2,
      dueAt: pastDueAt,
      nextReviewAt: pastDueAt
    }, { replace: true, source: 'e2e-goal-review-due' }));

    const reviewsBefore = getRemainingFormalReviewWords(W).length;
    await continueRemainingReviewsToday();
    const queueWords = todayQueue.map(ref => getWordByRo(ref)).filter(Boolean);
    return {
      reviewsBefore,
      totalGoal: dailyGoal,
      fixedGoal: defaultDailyGoal,
      effectiveNewLimit: getEffectiveDailyNewLimit(),
      queuedReviews: queueWords.filter(isDueGraduatedReviewWord).length,
      queuedNew: queueWords.filter(isUnseenWord).length,
      firstNewIndex: queueWords.findIndex(isUnseenWord),
      checkedIn: isDailyCheckinDone()
    };
  });

  expect(state).toEqual({
    reviewsBefore: 170,
    totalGoal: 230,
    fixedGoal: 30,
    effectiveNewLimit: 30,
    queuedReviews: 170,
    queuedNew: 30,
    firstNewIndex: 170,
    checkedIn: true
  });
});

test('temporary goal extension does not increase the fixed new-card cap', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(() => {
    const waitingWords = W.slice(0, 8);
    const introducedWords = W.slice(0, 33);
    progressMap = {};
    progressVersion++;
    todayQueueCompleted = new Set();
    todaySeenWords = new Set(introducedWords.map(word => word.ro));
    todayIntroducedWords = new Set(introducedWords.map(word => word.ro));
    todayNewWords = 77;
    todayLog = {
      log_date: getDateKeyFor(new Date()),
      new_words: 77,
      goal: 90,
      completed: true
    };
    defaultDailyGoal = 30;
    dailyGoal = 90;
    dailyNewLimit = 30;
    dailyQueueLoaded = true;
    progressLoaded = true;
    flashMode = 'today';
    curCat = '全部';

    waitingWords.forEach((word, index) => {
      setProgress(word.ro, {
        seen: true,
        known: false,
        qt: 1,
        qr: 0,
        level: 'learning',
        cardState: 'learning',
        reps: 1,
        dueAt: new Date(Date.now() + (index + 1) * 60_000).toISOString(),
        nextReviewAt: new Date(Date.now() + (index + 1) * 60_000).toISOString()
      }, { replace: true, source: 'e2e-temporary-goal-waiting' });
    });

    todayQueue = waitingWords.map(word => dailyWordKey(word.ro));
    todayQueue = buildOpenTodayQueue(dailyGoal);
    const cards = getDailyWordList(W, {
      skipRepair: true,
      allowBeforeQueueLoaded: true,
      limit: dailyGoal
    });
    applyFilters();
    renderReviewPanel();
    renderCard();

    return {
      effectiveNewLimit: getEffectiveDailyNewLimit(),
      cardCount: cards.length,
      phases: cards.map(getStudyQueuePhase),
      waitingCount: todayQueue
        .map(ref => getWordByRo(ref))
        .filter(Boolean)
        .filter(isRetryDeferred)
        .length,
      queueSize: todayQueue.length,
      visibleNewProgress: document.getElementById('review-new-remaining')?.textContent || '',
      visibleCard: document.getElementById('fc-zh')?.textContent || ''
    };
  });

  expect(state.effectiveNewLimit).toBe(30);
  expect(state.cardCount).toBe(0);
  expect(state.phases).toEqual([]);
  expect(state.waitingCount).toBe(8);
  expect(state.queueSize).toBe(8);
  expect(state.visibleNewProgress).toBe('33/30');
  expect(state.visibleCard).toBe('今日队列等待复习');
});

test('due work strictly blocks new cards in today mode', async ({ page }) => {
  await enterOfflineApp(page);
  const state = await page.evaluate(() => {
    const dueWord = W[0];
    const newWord = W.find(word => word.id !== dueWord.id);
    progressMap = {};
    progressVersion++;
    todayQueue = [dailyWordKey(newWord.ro)];
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 0;
    dailyQueueLoaded = true;
    progressLoaded = true;
    flashMode = 'today';
    curCat = '全部';
    setProgress(dueWord.ro, {
      seen: true,
      known: true,
      qt: 2,
      qr: 2,
      level: 'learning',
      cardState: 'review',
      reps: 2,
      intervalDays: 1,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      nextReviewAt: new Date(Date.now() - 60_000).toISOString()
    }, { replace: true, source: 'e2e-due-gate' });
    const cards = getDailyWordList(W, { skipRepair: true, allowBeforeQueueLoaded: true, limit: 10 });
    return {
      dueRo: dueWord.ro,
      newRo: newWord.ro,
      shown: cards.map(word => word.ro),
      phases: cards.map(getStudyQueuePhase)
    };
  });
  expect(state.shown).toContain(state.dueRo);
  expect(state.shown).not.toContain(state.newRo);
  expect(state.phases.every(phase => ['learning-due', 'relearning-due', 'review-due'].includes(phase))).toBe(true);
});

test('formal reviews reduce the backlog and learning steps cannot consume the review goal', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(async () => {
    const formalReview = W[0];
    const learningStep = W[1];
    const unseen = W[2];
    const pastDueAt = new Date(Date.now() - 60_000).toISOString();

    progressMap = {};
    progressVersion++;
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 0;
    defaultDailyGoal = 30;
    dailyGoal = 30;
    dailyQueueLoaded = true;
    progressLoaded = true;
    flashMode = 'today';
    curCat = '全部';
    idx = 0;
    flashOverrideRo = null;
    todayLog = {
      log_date: getDateKeyFor(new Date()),
      new_words: 0,
      goal: 30,
      completed: false
    };

    setProgress(formalReview.ro, {
      seen: true,
      known: true,
      qr: 5,
      qt: 6,
      level: 'learning',
      cardState: 'review',
      reviewStage: 2,
      reviewCount: 2,
      reps: 6,
      intervalDays: 3,
      dueAt: pastDueAt,
      nextReviewAt: pastDueAt,
      lastReviewedAt: new Date(Date.now() - 3 * 86_400_000).toISOString()
    }, { replace: true, source: 'e2e-formal-review-first' });
    setProgress(learningStep.ro, {
      seen: true,
      known: false,
      qr: 0,
      qt: 1,
      level: 'learning',
      cardState: 'learning',
      reviewStage: 0,
      reviewCount: 0,
      reps: 1,
      intervalDays: 0,
      dueAt: pastDueAt,
      nextReviewAt: pastDueAt,
      lastReviewedAt: new Date(Date.now() - 15 * 60_000).toISOString()
    }, { replace: true, source: 'e2e-initial-learning-step' });

    todayQueue = [dailyWordKey(learningStep.ro), dailyWordKey(unseen.ro)];
    applyFilters();
    const firstPhase = getStudyQueuePhase(getCurrentFlashWord());
    const formalBefore = getRemainingFormalReviewWords(W).length;

    // Adversarially force the lower-priority learning card to be answered
    // while a formal review remains. It must not consume the 30-review goal.
    filtered = [learningStep];
    idx = 0;
    markCard('known');
    const afterLearning = {
      goalCount: todayNewWords,
      formalRemaining: getRemainingFormalReviewWords(W).length,
      learningStillCompleted: setHasRo(todayQueueCompleted, learningStep.ro),
      visibleTotalDue: document.getElementById('review-due-count')?.textContent || ''
    };

    // Also cover a globally blocking review that is not part of the persisted
    // daily queue. Its due classification must be captured before dueAt moves.
    todayQueue = roListWithout(todayQueue, formalReview.ro);
    const formalWasOpen = roListIncludes(todayQueue, formalReview.ro);
    filtered = [formalReview];
    idx = 0;
    flashOverrideRo = null;
    markCard('known');
    upStats();
    const afterFormal = {
      goalCount: todayNewWords,
      formalRemaining: getRemainingFormalReviewWords(W).length,
      formalCompleted: setHasRo(todayQueueCompleted, formalReview.ro),
      visibleFormalRemaining: document.getElementById('s-wrong')?.textContent || ''
    };
    await undoLastCardAnswer();
    upStats();
    const afterUndo = {
      goalCount: todayNewWords,
      formalRemaining: getRemainingFormalReviewWords(W).length,
      formalCompleted: setHasRo(todayQueueCompleted, formalReview.ro),
      visibleFormalRemaining: document.getElementById('s-wrong')?.textContent || ''
    };

    // A missed formal review is deferred, not completed. It must not advance
    // the goal and must return to the formal backlog when its retry is due.
    filtered = [formalReview];
    idx = 0;
    markCard('unknown');
    const afterUnknown = {
      goalCount: todayNewWords,
      formalRemaining: getRemainingFormalReviewWords(W).length,
      phase: getStudyQueuePhase(formalReview)
    };
    const deferredProgress = getProgress(formalReview.ro);
    setProgress(formalReview.ro, {
      ...deferredProgress,
      dueAt: pastDueAt,
      nextReviewAt: pastDueAt
    }, { replace: true, source: 'e2e-relearning-becomes-due' });
    upStats();
    const afterRetryDue = {
      goalCount: todayNewWords,
      formalRemaining: getRemainingFormalReviewWords(W).length,
      phase: getStudyQueuePhase(formalReview),
      visibleFormalRemaining: document.getElementById('s-wrong')?.textContent || ''
    };

    return {
      firstPhase,
      formalBefore,
      formalWasOpen,
      afterLearning,
      afterFormal,
      afterUndo,
      afterUnknown,
      afterRetryDue
    };
  });

  expect(state.firstPhase).toBe('review-due');
  expect(state.formalBefore).toBe(1);
  expect(state.formalWasOpen).toBe(false);
  expect(state.afterLearning).toEqual({
    goalCount: 0,
    formalRemaining: 1,
    learningStillCompleted: false,
    visibleTotalDue: '1'
  });
  expect(state.afterFormal).toEqual({
    goalCount: 1,
    formalRemaining: 0,
    formalCompleted: true,
    visibleFormalRemaining: '0'
  });
  expect(state.afterUndo).toEqual({
    goalCount: 0,
    formalRemaining: 1,
    formalCompleted: false,
    visibleFormalRemaining: '1'
  });
  expect(state.afterUnknown).toEqual({
    goalCount: 0,
    formalRemaining: 0,
    phase: 'relearning-waiting'
  });
  expect(state.afterRetryDue).toEqual({
    goalCount: 0,
    formalRemaining: 1,
    phase: 'relearning-due',
    visibleFormalRemaining: '1'
  });
});

test('history is read-only and undo restores the entire last answer', async ({ page }) => {
  await enterOfflineApp(page);
  const originalChinese = (await page.locator('#fc-zh').innerText()).trim();

  await page.locator('#main-card').click();
  await page.locator('#mark-known-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('1/200');
  await expect(page.locator('#review-new-remaining')).toHaveText('1/30');

  await page.locator('#history-nav-btn').click();
  await expect(page.locator('#main-card')).toHaveClass(/history-view/);
  await expect(page.locator('#fc-history-note')).toBeVisible();
  await expect(page.locator('.card-answer-row')).not.toBeVisible();
  const beforeBlockedAnswer = await page.evaluate(() => todayNewWords);
  await page.evaluate(() => markCard('known'));
  await expect(page.getByText('历史卡片仅供回看，不会重复计分')).toBeVisible();
  expect(await page.evaluate(() => todayNewWords)).toBe(beforeBlockedAnswer);

  await page.locator('#undo-last-answer-btn').click();
  await expect(page.locator('#review-new-count')).toHaveText('0/200');
  await expect(page.locator('#review-new-remaining')).toHaveText('0/30');
  await expect(page.locator('#fc-zh')).toHaveText(originalChinese);
  await expect(page.locator('#undo-last-answer-btn')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('progress:local-offline-user');
    return raw ? Object.keys(JSON.parse(raw)).length : 0;
  })).toBe(0);
  const correctionState = await page.evaluate(() => {
    const progressCorrections = Object.values(readPendingProgress(currentUser.id));
    const dailyEvents = readPendingDailyEvents(currentUser.id)
      .filter(event => event.date === getLocalDateKey());
    const queueUndo = [...dailyEvents].reverse().find(event => event.target?.queue);
    const logUndo = [...dailyEvents].reverse().find(event => event.target?.log);
    return {
      avoidsDuplicateCorrection: progressCorrections.length === 0,
      queueCompletionDelta:
        (queueUndo?.target?.queue?.completed_word_id?.length || 0) -
        (queueUndo?.base?.queue?.completed_word_id?.length || 0),
      logCountDelta:
        Number(logUndo?.target?.log?.new_words || 0) -
        Number(logUndo?.base?.log?.new_words || 0)
    };
  });
  expect(correctionState).toEqual({
    avoidsDuplicateCorrection: true,
    // The answer was still buffered, so undo collapses to a no-op daily event
    // instead of sending an unnecessary destructive replacement.
    queueCompletionDelta: 0,
    logCountDelta: 0
  });
});

test('a rapid duplicate click records only one answer', async ({ page }) => {
  await enterOfflineApp(page);
  await page.locator('#main-card').click();
  const result = await page.evaluate(() => {
    const button = document.getElementById('mark-known-btn');
    button.click();
    button.click();
    return {
      completed: todayNewWords,
      progressRows: Object.values(progressMap).map(progress => Number(progress.qt || 0))
    };
  });
  expect(result.completed).toBe(1);
  expect(result.progressRows.reduce((sum, value) => sum + value, 0)).toBe(1);
});

test('card front uses a real Chinese cloze and exposes answer consequences', async ({ page }) => {
  await enterOfflineApp(page);
  await page.evaluate(() => {
    filtered = [getWordByRo('fizică')];
    idx = 0;
    flashOverrideRo = null;
    flipped = false;
    renderCard();
  });

  await expect(page.locator('#fc-pos')).toHaveText('阴性名词');
  await expect(page.locator('#fc-front-example')).toContainText('____解释物体运动的方式');
  await expect(page.locator('#fc-front-example')).not.toContainText('物理');
  await page.locator('#main-card').click();
  await expect(page.locator('#fc-example')).toContainText('Fizica explică');
  await expect(page.locator('#mark-unknown-btn')).toHaveText('✕ 不认识 · 10分');
  await expect(page.locator('#mark-fuzzy-btn')).toHaveText('≈ 模糊 · 1天');
  await expect(page.locator('#mark-known-btn')).toHaveText('✓ 准确回忆 · 1天');
  await expect(page.locator('#mark-known-btn')).toHaveAttribute('aria-label', '✓ 准确回忆，1天后，通过今日任务');
});

test('answer buttons stay on one line at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await enterOfflineApp(page);
  await page.locator('#main-card').click();

  const buttonMetrics = await page.locator('.card-answer-row > button').evaluateAll(buttons => buttons.map(button => ({
    whiteSpace: getComputedStyle(button).whiteSpace,
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth
  })));

  expect(buttonMetrics).toHaveLength(3);
  buttonMetrics.forEach(metric => {
    expect(metric.whiteSpace).toBe('nowrap');
    expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth);
  });
});

test('card information uses independent taxonomy fields and hides empty learning metadata', async ({ page }) => {
  await enterOfflineApp(page);
  await page.evaluate(() => {
    const target = wordIdIndex.get('6191');
    filtered = [target];
    idx = 0;
    flashOverrideRo = null;
    flipped = false;
    renderCard();
  });

  await expect(page.locator('#fc-cat')).toHaveText('教育与语言');
  await expect(page.locator('#fc-pos')).toHaveText('阴性名词');
  await page.locator('#main-card').click();
  await expect(page.locator('#fc-cat2')).toContainText('教育与语言 · 名词 · 术语');
  await expect(page.getByText('重音标记', { exact: true }).first()).toBeVisible();

  await page.evaluate(() => openWordDetail('limba română'));
  const detail = page.locator('#word-detail-body');
  await expect(detail).toContainText('主题');
  await expect(detail).toContainText('教育与语言');
  await expect(detail).toContainText('词性');
  await expect(detail).toContainText('阴性名词');
  await expect(detail).toContainText('词汇单位');
  await expect(detail).toContainText('术语');
  await expect(detail).toContainText('尚未开始学习');
  await expect(detail).not.toContainText('未安排');
  await expect(detail).not.toContainText('阶段 0');
  await expect(detail).not.toContainText('辅助标签');
});

test('verb phrases and ordinary collocations show distinct classification labels', async ({ page }) => {
  await enterOfflineApp(page);
  await page.evaluate(() => {
    filtered = [getWordByRo('a da banii înapoi')];
    idx = 0;
    flashOverrideRo = null;
    flipped = false;
    renderCard();
  });

  await page.locator('#main-card').click();
  await expect(page.locator('#fc-cat2')).toContainText('日常与个人生活 · 动词短语');
  await expect(page.locator('#fc-cat2')).not.toContainText('动词 · 动词短语');

  await page.evaluate(() => {
    filtered = [getWordByRo('a lipi eticheta')];
    idx = 0;
    flipped = false;
    renderCard();
  });
  await page.locator('#main-card').click();
  await expect(page.locator('#fc-cat2')).toContainText('日常与个人生活 · 动词 · 搭配');
});

test('reviewed core phrases are prioritized ahead of unreviewed frequency cards', async ({ page }) => {
  await enterOfflineApp(page);
  const priorities = await page.evaluate(() => {
    const core = getWordByRo('Mi se pare că...');
    const firstWords = getUnseenWords(W).slice(0, 40);
    return {
      core: getDailyPhasePriority(core),
      coreQuality: core?.grammar_data?.phrase_quality,
      coreVerification: core?.verification_status,
      firstAreReviewedCore: firstWords.every(word =>
        word.verification_status === 'verified' && word.grammar_data?.phrase_quality === 'core')
    };
  });

  expect(priorities.coreQuality).toBe('core');
  expect(priorities.coreVerification).toBe('verified');
  expect(priorities.firstAreReviewedCore).toBe(true);
});

test('default study uses the news core and specialist books stay opt-in', async ({ page }) => {
  await enterOfflineApp(page);
  await expect(page.locator('#learning-collection-select')).toHaveValue('news_core');
  await expect(page.locator('#learning-collection-note')).toContainText('默认课程');

  const coreState = await page.evaluate(() => ({
    collection: learningCollectionId,
    count: getLearningCollectionWords(W).length,
    hasPrincipiu: getLearningCollectionWords(W).some(word => word.ro === 'principiu'),
    hasTokamak: getLearningCollectionWords(W).some(word => word.ro === 'tokamak'),
    invalidQueueCards: todayQueue.filter(ro => {
      const word = getWordByRo(ro);
      return !word || !wordMatchesLearningCollection(word, learningCollectionId);
    }).length
  }));
  expect(coreState).toEqual({
    collection: 'news_core',
    count: 1789,
    hasPrincipiu: true,
    hasTokamak: false,
    invalidQueueCards: 0
  });

  await page.locator('details.flash-controls > summary').click();
  await expect(page.locator('#learning-collection-select')).toBeVisible();
  await page.locator('#learning-collection-select').selectOption('specialist_science_technology');
  await expect(page.locator('#learning-collection-select')).toHaveValue('specialist_science_technology');
  await expect(page.locator('#learning-collection-note')).toContainText('科学、工程、AI 和网络技术');
  const specialistState = await page.evaluate(() => ({
    collection: learningCollectionId,
    count: getLearningCollectionWords(W).length,
    hasTokamak: getLearningCollectionWords(W).some(word => word.ro === 'tokamak'),
    invalidQueueCards: todayQueue.filter(ro => {
      const word = getWordByRo(ro);
      return !word || !wordMatchesLearningCollection(word, learningCollectionId);
    }).length
  }));
  expect(specialistState).toEqual({
    collection: 'specialist_science_technology',
    count: 424,
    hasTokamak: true,
    invalidQueueCards: 0
  });
});

test('collection switch invalidates undo from the previous book', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(async () => {
    const coreWord = getWordByRo('principiu');
    lastCardAnswerSnapshot = captureCardAnswerSnapshot(coreWord, null, 'new');
    await setLearningCollection('specialist_science_technology');
    await undoLastCardAnswer();
    return {
      snapshotCleared: lastCardAnswerSnapshot === null,
      collection: learningCollectionId,
      invalidQueueCards: todayQueue.filter(ro => {
        const word = getWordByRo(ro);
        return !word || !wordMatchesLearningCollection(word, learningCollectionId);
      }).length
    };
  });
  expect(result).toEqual({ snapshotCleared: true, collection: 'specialist_science_technology', invalidQueueCards: 0 });
});

test('manual sync snapshot preserves the selected collection', async ({ page }) => {
  await enterOfflineApp(page);
  const snapshot = await page.evaluate(async () => {
    await setLearningCollection('specialist_science_technology');
    return buildTodaySyncSnapshot();
  });
  expect(snapshot.queue.collection_id).toBe('specialist_science_technology');
});

test('vocabulary list filters topic and part of speech independently', async ({ page }) => {
  await enterOfflineApp(page);
  await page.locator('.nav-tab[data-page="list"]').click();
  await page.locator('#list-topic-filter').selectOption('history_culture_arts');
  await page.locator('#list-pos-filter').selectOption('noun');
  await page.locator('#search-input').fill('工业革命');

  await expect(page.locator('.word-row')).toHaveCount(1);
  await expect(page.locator('.word-row')).toContainText('历史、文化与艺术');
  await expect(page.locator('.word-row')).toContainText('名词');
  await expect(page.locator('.word-row')).toContainText('revoluție industrială');
});

test('admin import form rejects template rows before any write', async ({ page }) => {
  await enterOfflineApp(page);
  await page.evaluate(() => {
    userRole = 'admin';
    openAddWordModal();
  });
  await expect(page.locator('#aw-topic')).toHaveValue('daily_life');
  await expect(page.locator('#aw-pos')).toHaveValue('noun');
  await expect(page.locator('#aw-unit')).toHaveValue('word');
  await page.locator('#aw-zh').fill('# 格式：中文');
  await page.locator('#aw-ro').fill('罗马尼亚语');
  await page.locator('#aw-ipa').fill('重音标记');
  await page.locator('#aw-hint').fill('语法信息');
  await page.locator('#aw-submit').click();
  await expect(page.locator('#aw-result')).toContainText('检测到表头或模板内容');
});

test('speech failure is visible instead of silent', async ({ page }) => {
  await enterOfflineApp(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
    return speak(1);
  });
  await expect(page.getByText('当前浏览器不支持发音播放')).toBeVisible();
});

test('global due reviews block new cards even when another topic is selected', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(() => {
    progressMap = {};
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 0;
    dailyQueueLoaded = true;
    progressLoaded = true;
    idx = 0;
    flashOverrideRo = null;

    const dueWord = W[0];
    const newWord = W.find(word => word.cat !== dueWord.cat);
    const dueAt = new Date(Date.now() - 60_000).toISOString();
    setProgress(dueWord.ro, {
      seen: true,
      known: true,
      qr: 2,
      qt: 2,
      level: 'learning',
      cardState: 'review',
      dueAt,
      nextReviewAt: dueAt,
      intervalDays: 1,
      reps: 2
    }, { source: 'e2e-global-due-gate', replace: true });
    todayQueue = [newWord.ro];
    curCat = newWord.cat;

    applyFilters();
    renderCard();
    return {
      dueRo: dueWord.ro,
      currentRo: getCurrentFlashWord()?.ro,
      category: curCat,
      allDue: filtered.every(isDueReviewWord)
    };
  });

  expect(state.currentRo).toBe(state.dueRo);
  expect(state.category).toBe('全部');
  expect(state.allDue).toBe(true);
});

test('a review becoming due mid-session preempts the cached new-card pool', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(() => {
    progressMap = {};
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 0;
    dailyQueueLoaded = true;
    progressLoaded = true;
    curCat = '全部';
    idx = 0;
    flashOverrideRo = null;

    const waitingWord = W[0];
    const newWords = W.slice(1, 4);
    const futureDueAt = new Date(Date.now() + 10 * 60_000).toISOString();
    setProgress(waitingWord.ro, {
      seen: true,
      known: false,
      qr: 0,
      qt: 1,
      level: 'learning',
      cardState: 'learning',
      dueAt: futureDueAt,
      nextReviewAt: futureDueAt,
      reps: 1
    }, { source: 'e2e-mid-session-waiting', replace: true });
    todayQueue = [waitingWord.ro, ...newWords.map(word => word.ro)];
    applyFilters();
    const answeredRo = getCurrentFlashWord()?.ro;
    const pastDueAt = new Date(Date.now() - 60_000).toISOString();
    setProgress(waitingWord.ro, {
      ...getProgress(waitingWord.ro),
      dueAt: pastDueAt,
      nextReviewAt: pastDueAt
    }, { source: 'e2e-mid-session-due', replace: true });

    advanceFlashcardAfterAnswer(answeredRo, { incrementalToday: true });
    return {
      waitingRo: waitingWord.ro,
      currentRo: getCurrentFlashWord()?.ro,
      currentIsDue: isDueReviewWord(getCurrentFlashWord())
    };
  });

  expect(state.currentRo).toBe(state.waitingRo);
  expect(state.currentIsDue).toBe(true);
});

test('manual next navigation cannot leave the current unanswered card', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(() => {
    progressMap = {};
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 0;
    dailyQueueLoaded = true;
    progressLoaded = true;
    curCat = '全部';
    idx = 0;
    flashOverrideRo = null;

    const waitingWord = W[0];
    const newWords = W.slice(1, 4);
    const futureDueAt = new Date(Date.now() + 10 * 60_000).toISOString();
    setProgress(waitingWord.ro, {
      seen: true,
      known: false,
      qt: 1,
      qr: 0,
      level: 'learning',
      cardState: 'learning',
      dueAt: futureDueAt,
      nextReviewAt: futureDueAt,
      reps: 1
    }, { source: 'e2e-manual-next-waiting', replace: true });
    todayQueue = [waitingWord.ro, ...newWords.map(word => word.ro)];
    applyFilters();
    const currentBeforeRo = getCurrentFlashWord()?.ro;

    const pastDueAt = new Date(Date.now() - 60_000).toISOString();
    setProgress(waitingWord.ro, {
      ...getProgress(waitingWord.ro),
      dueAt: pastDueAt,
      nextReviewAt: pastDueAt
    }, { source: 'e2e-manual-next-due', replace: true });
    nextCard();

    return {
      waitingRo: waitingWord.ro,
      currentBeforeRo,
      currentRo: getCurrentFlashWord()?.ro,
      currentIsDue: isDueReviewWord(getCurrentFlashWord())
    };
  });

  expect(state.currentRo).toBe(state.currentBeforeRo);
  expect(state.currentRo).not.toBe(state.waitingRo);
  expect(state.currentIsDue).toBe(false);
});

test('a completed daily card that lapses becomes blocking again without recounting', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(() => {
    progressMap = {};
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 1;
    dailyQueueLoaded = true;
    progressLoaded = true;
    curCat = '全部';
    idx = 0;
    flashOverrideRo = null;

    const lapsedWord = W[0];
    const newWord = W[1];
    const dueAt = new Date(Date.now() - 60_000).toISOString();
    setProgress(lapsedWord.ro, {
      seen: true,
      known: false,
      qt: 3,
      qr: 2,
      level: 'learning',
      cardState: 'learning',
      dueAt,
      nextReviewAt: dueAt,
      reps: 3,
      lapses: 1
    }, { source: 'e2e-completed-card-lapse', replace: true });
    todayQueueCompleted = new Set([lapsedWord.ro]);
    todayQueue = [newWord.ro];

    applyFilters();
    return {
      lapsedRo: lapsedWord.ro,
      currentRo: getCurrentFlashWord()?.ro,
      completedCount: todayQueueCompleted.size,
      todayCount: todayNewWords,
      currentIsDue: isDueReviewWord(getCurrentFlashWord())
    };
  });

  expect(state.currentRo).toBe(state.lapsedRo);
  expect(state.currentIsDue).toBe(true);
  expect(state.completedCount).toBe(1);
  expect(state.todayCount).toBe(1);
});

test('cross-day undo is rejected without mutating the answered progress', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(async () => {
    const word = getCurrentFlashWord();
    markCard('known');
    const progressAfterAnswer = cloneCardState(getProgress(word.ro));
    const todayCountAfterAnswer = todayNewWords;
    lastCardAnswerSnapshot.dailyDateKey = '2000-01-01';

    await undoLastCardAnswer();
    const progressAfterUndoAttempt = getProgress(word.ro);
    return {
      qtAfterAnswer: progressAfterAnswer.qt,
      qtAfterUndoAttempt: progressAfterUndoAttempt.qt,
      todayCountAfterAnswer,
      todayCountAfterUndoAttempt: todayNewWords,
      snapshotCleared: lastCardAnswerSnapshot === null
    };
  });

  expect(state.qtAfterUndoAttempt).toBe(state.qtAfterAnswer);
  expect(state.todayCountAfterUndoAttempt).toBe(state.todayCountAfterAnswer);
  expect(state.snapshotCleared).toBe(true);
});

test('pending accuracy is flushed to the previous date during rollover', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(() => {
    const previousDate = '2030-01-01';
    const nextDate = '2030-01-02';
    localStorage.removeItem(todayAccuracyKey(previousDate));
    localStorage.removeItem(todayAccuracyKey(nextDate));
    activeDailyDateKey = previousDate;
    pendingTodayAccuracyStats = { correct: 1, total: 1 };

    resetDailyRuntimeState(nextDate);
    return {
      previous: readTodayAccuracyStats(previousDate),
      next: readTodayAccuracyStats(nextDate),
      pending: { ...pendingTodayAccuracyStats },
      activeDate: activeDailyDateKey
    };
  });

  expect(state.previous).toEqual({ correct: 1, total: 1 });
  expect(state.next).toEqual({ correct: 0, total: 0 });
  expect(state.pending).toEqual({ correct: 0, total: 0 });
  expect(state.activeDate).toBe('2030-01-02');
});

test('an async today-log response is discarded when midnight passes in flight', async ({ page }) => {
  await enterOfflineApp(page);

  const state = await page.evaluate(async () => {
    const NativeDate = Date;
    const dayMs = 24 * 60 * 60 * 1000;
    let fakeNow = new NativeDate('2030-01-01T23:59:59').getTime();
    const originalApiGetTodayLog = apiGetTodayLog;
    let calls = 0;

    window.Date = class extends NativeDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(fakeNow);
      }
      static now() {
        return fakeNow;
      }
    };
    apiGetTodayLog = async () => {
      calls += 1;
      const requestedDate = getDateKeyFor(new Date());
      if (calls === 1) fakeNow += dayMs;
      return {
        user_id: currentUser.id,
        log_date: requestedDate,
        new_words: calls,
        goal: 200,
        completed: false
      };
    };

    await loadTodayLog();
    const result = {
      calls,
      activeDate: activeDailyDateKey,
      logDate: todayLog.log_date,
      todayCount: todayNewWords
    };
    apiGetTodayLog = originalApiGetTodayLog;
    window.Date = NativeDate;
    return result;
  });

  expect(state.calls).toBe(2);
  expect(state.activeDate).toBe('2030-01-02');
  expect(state.logDate).toBe('2030-01-02');
  expect(state.todayCount).toBe(2);
});

test('review mode does not auto-start new cards when the new-card limit is zero', async ({ page }) => {
  await enterOfflineApp(page);

  const shouldStart = await page.evaluate(() => {
    progressMap = {};
    progressVersion++;
    todayQueue = [];
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayIntroducedWords = new Set();
    todayNewWords = 0;
    dailyQueueLoaded = true;
    flashMode = 'review';
    dailyNewLimit = 0;
    return shouldAutoStartTodayAfterReview();
  });

  expect(shouldStart).toBe(false);
});
