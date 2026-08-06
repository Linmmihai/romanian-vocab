const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert(
  app.includes('flushTodayAccuracyStats(previousDateKey);'),
  'pending accuracy must be committed to the previous date before runtime rollover'
);
assert(
  app.includes('dailyDateKey: activeDailyDateKey'),
  'undo snapshots must record the date they belong to'
);
assert(
  app.includes("showToast('日期已切换，不能撤销前一天的作答');"),
  'cross-day undo must be rejected instead of overwriting the current day'
);
assert(
  app.includes('if (loadDateKey !== getDateKeyFor(new Date()))'),
  'daily async loads must discard a result when the local date changes in flight'
);
assert(
  app.includes('if (!getRemainingDailyNewSlots()) return false;'),
  'review completion must not auto-start new cards when the new-card limit is exhausted'
);

console.log('daily rollover adversarial verification passed');
