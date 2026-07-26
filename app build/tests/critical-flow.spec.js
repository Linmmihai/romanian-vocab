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

  await expect(page.locator('#today-focus-meta')).toContainText('严格先做已到点内容');
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
    window.apiVerifyTodayState = async () => ({ ok: false, logOk: true, queueOk: false });
    return (await manualSyncToday()).ok;
  });

  expect(ok).toBe(false);
  await page.locator('#sync-badge').click();
  await expect(page.locator('#account-sync-status')).toHaveText('云端同步尚未确认');
  await expect(page.locator('#account-sync-detail')).toContainText('每日队列尚未通过云端回读确认');
  await expect(page.locator('#manual-sync-btn')).toHaveText('重新同步');
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
    const daily = readPendingDailyState(currentUser.id)[getLocalDateKey()] || {};
    return {
      deletesCreatedProgress: progressCorrections.some(progress => progress.pendingCorrection && progress.pendingDelete),
      queueForceReplace: daily.queue?.force_replace === true,
      logForceReplace: daily.log?.force_replace === true
    };
  });
  expect(correctionState).toEqual({
    deletesCreatedProgress: true,
    queueForceReplace: true,
    logForceReplace: true
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
  await expect(page.locator('#mark-unknown-btn')).toContainText('10分钟后 · 继续学习');
  await expect(page.locator('#mark-fuzzy-btn')).toContainText('1天后 · 继续学习');
  await expect(page.locator('#mark-known-btn')).toContainText('1天后 · 通过今日任务');
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
