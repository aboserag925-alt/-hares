import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
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

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
if (supabaseUrl || supabaseAnonKey) {
  let parsedUrl;
  try { parsedUrl = new URL(supabaseUrl); } catch { throw new Error('SUPABASE_URL must be a valid HTTPS URL.'); }
  if (parsedUrl.protocol !== 'https:' || !supabaseAnonKey) {
    throw new Error('Set both SUPABASE_URL (HTTPS) and SUPABASE_ANON_KEY.');
  }
  await writeFile(localConfig, 'window.AHL_SUPABASE_CONFIG = ' + JSON.stringify({ url: supabaseUrl, anonKey: supabaseAnonKey }) + ';\\n', 'utf8');
} else {
  await copyFile(resolve(root, 'src', 'supabase-config.example.js'), localConfig);
}

await copyFile(
  resolve(root, 'node_modules', '@supabase', 'supabase-js', 'LICENSE'),
  resolve(vendorDirectory, 'SUPABASE-LICENSE.txt')
);
