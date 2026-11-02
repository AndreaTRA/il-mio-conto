import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cloudConfig } from '../public/cloud-config.js';
import { validateCloudConfig } from '../public/cloud-client.js';
validateCloudConfig(cloudConfig);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public'), output = path.join(root, 'dist');
const files = (await fs.readdir(source, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
const forbidden = /seed|backup|saldi-iniziali|\.env|accesso|conto\.json/i;
if (files.some(name => forbidden.test(name))) throw new Error('La cartella pubblica contiene un file riservato. Build interrotta.');
const hash = createHash('sha256');
for (const name of files) { hash.update(name); hash.update(await fs.readFile(path.join(source, name))); }
const version = hash.digest('hex').slice(0, 16);
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const name of files) {
  const content = await fs.readFile(path.join(source, name));
  await fs.writeFile(path.join(output, name), name === 'service-worker.js' ? content.toString().replace('__APP_VERSION__', version) : content);
}
await fs.writeFile(path.join(output, '.nojekyll'), '');
console.log(`Build ${version}: ${files.length} file pubblici in dist/. Nessun dato personale incluso.`);
