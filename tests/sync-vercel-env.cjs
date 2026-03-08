const fs = require('fs');
const { spawnSync } = require('child_process');

function loadEnvFile(path, envMap) {
  if (!fs.existsSync(path)) return;
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    envMap.set(key, rawValue.replace(/^"|"$/g, ''));
  }
}

const envMap = new Map();
loadEnvFile('.env', envMap);
loadEnvFile('.env.local', envMap);

const names = [...envMap.keys()].sort();
if (names.length === 0) {
  throw new Error('No env vars found');
}

for (const name of names) {
  const value = envMap.get(name) ?? '';
  process.stdout.write(`ADDING ${name}\n`);
  const result = spawnSync('npx', ['vercel', 'env', 'add', name, 'production'], {
    input: `${value}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`Failed adding ${name}`);
  }
}

console.log('VERCEL_ENV_SYNC_OK');
