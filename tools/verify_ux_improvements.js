const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const api = read('api.js');
const dailyPlan = read('daily-plan.js');

assert(app.includes('const DEFAULT_DAILY_GOAL = 200;'), 'app default processing goal must be 200');
assert(api.includes('const API_DEFAULT_DAILY_GOAL = 200;'), 'API/offline default processing goal must be 200');
assert(dailyPlan.includes('openSlots - deferred.length'), 'deferred retries must continue occupying fixed quota slots');
assert(html.includes('复习优先，不足目标的名额自动补入新词'), 'home must explain review-first quota composition once');
assert(!html.includes('id="today-step-learning"'), 'repeated daily-stage cards should be removed from the home page');

assert(html.includes('id="list-status-filter"'), 'vocabulary list needs a status filter');
assert(html.includes('id="list-category-filter"'), 'vocabulary list needs a category filter');
assert(html.includes('id="list-load-more"'), 'vocabulary list needs progressive loading');
assert(app.includes('let listVisibleLimit = 40;'), 'vocabulary list should render a small first page');
assert(app.includes('没有找到匹配的词汇'), 'vocabulary search needs a visible empty state');
assert(app.includes('scheduleRenderList'), 'vocabulary search should be debounced');

assert(app.includes('function endQuizEarly()'), 'quiz needs an explicit end-round action');
assert(app.includes('快捷键：1–4 选择 · Enter 下一题'), 'quiz should expose keyboard shortcuts');
assert(app.includes('本轮测验已结束'), 'leaving an active quiz should explain what happened');

assert(html.includes('role="button" tabindex="0" aria-expanded="false" aria-label="翻转查看答案"'), 'flashcards must be keyboard-accessible controls');
assert(html.includes('role="dialog" aria-modal="true"'), 'modals must expose dialog semantics');
assert(app.includes('function initAccessibleModals()'), 'modals need focus management');
assert(app.includes("tab.setAttribute('aria-selected'"), 'tab state must be announced accessibly');

assert(app.includes('班级排行需要登录后查看'), 'offline leaderboard must not show a misleading rank');
assert(html.includes('账号与提醒'), 'reminder settings should live in the account surface');
assert(app.includes("'Daily Life': '日常生活'"), 'user-facing category names should be localized');
assert(!app.includes('复习阶段 ${stage}'), 'internal scheduler stages must not leak into normal statistics');

console.log('UX improvement verification passed.');
