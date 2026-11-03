import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(
    await readFile(new URL('./vendor-manifest.json', import.meta.url), 'utf8'),
);
for (const [file, expected] of Object.entries(manifest.files)) {
    if (!/^[\w./-]+$/.test(file) || file.includes('..')) throw new Error('Invalid vendor path');
    const bytes = await readFile(new URL(`../public/vendor/${file}`, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error(`Vendor integrity mismatch: ${file}`);
}
console.log('MindAR 1.2.5 and Draco 0.161.0 vendor hashes verified.');
