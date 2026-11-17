const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  webServer: {
    // A page loads many scripts concurrently; multiple tabs exceed Python's
    // small default listen backlog and otherwise produce connection resets.
    command: `python3 -c "import functools; from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler; ThreadingHTTPServer.request_queue_size = 128; ThreadingHTTPServer(('127.0.0.1', 4173), functools.partial(SimpleHTTPRequestHandler, directory='www')).serve_forever()"`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
