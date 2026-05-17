import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const appRoot = process.cwd();
const webRoot = existsSync(path.join(appRoot, '..', 'romanian_vocab_code', 'index.html'))
  ? path.join(appRoot, '..', 'romanian_vocab_code')
  : appRoot;
const dataRoot = existsSync(path.join(webRoot, 'data', 'vocab.json')) ? webRoot : appRoot;
const root = appRoot;
const out = path.join(root, 'www');

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'icons'), { recursive: true });
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

const files = ['api.js', 'auth.js', 'app.js', 'manifest.webmanifest', 'sw.js'];
for (const file of files) {
  await copyFile(path.join(webRoot, file), path.join(out, file));
}

for (const icon of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
  const iconPath = path.join(webRoot, 'icons', icon);
  if (existsSync(iconPath)) await copyFile(iconPath, path.join(out, 'icons', icon));
}

await copyFile(path.join(dataRoot, 'data', 'vocab.json'), path.join(out, 'data', 'vocab.json'));
const examplesPath = path.join(dataRoot, 'data', 'examples.json');
if (existsSync(examplesPath)) {
  await copyFile(examplesPath, path.join(out, 'data', 'examples.json'));
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
html = html.replace(
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
);
await writeFile(path.join(out, 'index.html'), html);
