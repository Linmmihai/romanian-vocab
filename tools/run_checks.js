const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const checks = fs.readdirSync(__dirname)
  .filter(file => /^verify_.*\.js$/.test(file))
  .sort();

for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check)], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`all ${checks.length} verification scripts passed`);
