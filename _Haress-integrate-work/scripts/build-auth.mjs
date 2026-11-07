import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDirectory = resolve(root, 'app');
const vendorDirectory = resolve(appDirectory, 'vendor');
const localConfig = resolve(appDirectory, 'supabase-config.js');
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured together.');
}

if (supabaseUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTP(S) origin.');
  }

  if (
    !['https:', 'http:'].includes(parsedUrl.protocol) ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error('SUPABASE_URL must be an HTTP(S) origin without credentials or a path.');
  }
}

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

if (supabaseUrl) {
  const config = { url: new URL(supabaseUrl).origin, anonKey: supabaseAnonKey };
  await writeFile(
    localConfig,
    `window.AHL_SUPABASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
    'utf8'
  );
} else {
  try {
    await access(localConfig);
  } catch {
    await copyFile(
      resolve(root, 'src', 'supabase-config.example.js'),
      localConfig
    );
  }
}

await copyFile(
  resolve(root, 'node_modules', '@supabase', 'supabase-js', 'LICENSE'),
  resolve(vendorDirectory, 'SUPABASE-LICENSE.txt')
);
