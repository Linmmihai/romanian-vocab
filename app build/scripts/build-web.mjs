import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const appRoot = process.cwd();
const projectRoot = path.resolve(appRoot, '..');
const webRoot = existsSync(path.join(appRoot, '..', 'romanian_vocab_code', 'index.html'))
  ? path.join(appRoot, '..', 'romanian_vocab_code')
  : existsSync(path.join(projectRoot, 'index.html'))
    ? projectRoot
    : appRoot;
const dataRoot = existsSync(path.join(webRoot, 'data', 'vocab.json')) ? webRoot : appRoot;
const root = appRoot;
const out = path.join(root, 'www');

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'manifest'), { recursive: true });
await mkdir(path.join(out, 'vendor'), { recursive: true });
await mkdir(path.join(out, 'data'), { recursive: true });

await build({
  stdin: {
    contents: "import * as supabase from '@supabase/supabase-js'; window.supabase = supabase;",
    resolveDir: root,
    sourcefile: 'supabase-browser-entry.js',
    loader: 'js'
  },
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: path.join(out, 'vendor', 'supabase.js')
});

const files = ['scheduler.js', 'progress-model.js', 'daily-plan.js', 'taxonomy.js', 'romanian-text.js', 'quiz-engine.js', 'api.js', 'telemetry.js', 'auth.js', 'app.js', 'pwa.js', 'manifest.webmanifest', 'sw.js'];
for (const file of files) {
  await copyFile(path.join(webRoot, file), path.join(out, file));
}

for (const icon of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
  const iconPath = existsSync(path.join(webRoot, 'icons', icon))
    ? path.join(webRoot, 'icons', icon)
    : path.join(webRoot, 'manifest', icon);
  if (existsSync(iconPath)) await copyFile(iconPath, path.join(out, 'manifest', icon));
}

await copyFile(path.join(dataRoot, 'data', 'vocab.json'), path.join(out, 'data', 'vocab.json'));
const examplesPath = path.join(dataRoot, 'data', 'examples.json');
if (existsSync(examplesPath)) {
  await copyFile(examplesPath, path.join(out, 'data', 'examples.json'));
}
const grammarCoursesPath = path.join(dataRoot, 'data', 'grammar-courses.json');
if (existsSync(grammarCoursesPath)) {
  await copyFile(grammarCoursesPath, path.join(out, 'data', 'grammar-courses.json'));
}
const grammarContentPath = path.join(dataRoot, 'data', 'grammar-content.json');
if (existsSync(grammarContentPath)) {
  await copyFile(grammarContentPath, path.join(out, 'data', 'grammar-content.json'));
}

if (existsSync(path.join(webRoot, 'stress_grammar_patch.js'))) {
  await copyFile(path.join(webRoot, 'stress_grammar_patch.js'), path.join(out, 'stress_grammar_patch.js'));
} else {
  await writeFile(path.join(out, 'stress_grammar_patch.js'), 'window.STRESS_GRAMMAR_PATCH = window.STRESS_GRAMMAR_PATCH || [];\n');
}

let html = await readFile(path.join(webRoot, 'index.html'), 'utf8');
html = html.replace(
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="vendor/supabase.js"></script>'
);
await writeFile(path.join(out, 'index.html'), html);

const requiredFiles = [
  'index.html',
  'scheduler.js',
  'progress-model.js',
  'daily-plan.js',
  'taxonomy.js',
  'romanian-text.js',
  'quiz-engine.js',
  'api.js',
  'telemetry.js',
  'auth.js',
  'app.js',
  'pwa.js',
  'sw.js',
  'manifest.webmanifest',
  'data/vocab.json',
  'data/examples.json',
  'data/grammar-courses.json',
  'data/grammar-content.json',
  'vendor/supabase.js'
];

const manifest = JSON.parse(await readFile(path.join(out, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) requiredFiles.push(icon.src);

for (const file of requiredFiles) {
  try {
    await access(path.join(out, file));
  } catch {
    throw new Error(`Web build is incomplete: missing ${file}`);
  }
}
