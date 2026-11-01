import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = resolve(root, 'app', 'vendor');

await mkdir(vendorDirectory, { recursive: true });
await copyFile(
  resolve(root, 'node_modules', 'adhan', 'lib', 'bundles', 'adhan.umd.min.js'),
  resolve(vendorDirectory, 'adhan.umd.min.js'),
);

const license = await readFile(
  resolve(root, 'node_modules', 'adhan', 'LICENSE'),
  'utf8',
);
await writeFile(resolve(vendorDirectory, 'ADHAN-LICENSE.txt'), license);
