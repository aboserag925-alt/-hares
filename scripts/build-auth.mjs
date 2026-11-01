import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDirectory = resolve(root, 'app');
const vendorDirectory = resolve(appDirectory, 'vendor');
const localConfig = resolve(appDirectory, 'supabase-config.js');

await mkdir(vendorDirectory, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src', 'auth-client.js')],
  outfile: resolve(appDirectory, 'auth-client.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  legalComments: 'eof'
});

try {
  await access(localConfig);
} catch {
  await copyFile(
    resolve(root, 'src', 'supabase-config.example.js'),
    localConfig
  );
}

await copyFile(
  resolve(root, 'node_modules', '@supabase', 'supabase-js', 'LICENSE'),
  resolve(vendorDirectory, 'SUPABASE-LICENSE.txt')
);
