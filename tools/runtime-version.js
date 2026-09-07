const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const appVersionMatch = index.match(/window\.ROMANIAN_VOCAB_APP_VERSION='([^']+)'/);
const cacheNameMatch = serviceWorker.match(/const CACHE_NAME = '([^']+)'/);
if (!appVersionMatch || !cacheNameMatch) throw new Error('runtime version entrypoints are missing');

module.exports = {
  appVersion: appVersionMatch[1],
  cacheName: cacheNameMatch[1],
  script: (name) => `${name}?v=${appVersionMatch[1]}`
};
