import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const homedir = os.homedir();
const agyTokenPaths = [
  path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
  path.join(homedir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
  path.join(homedir, '.gemini', 'antigravity-cli', 'cache', 'antigravity-oauth-token'),
  path.join(homedir, 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token'),
];

console.log('--- Checking Host Token Files ---');
for (const p of agyTokenPaths) {
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    console.log(`FOUND: ${p} (size: ${stat.size} bytes, modified: ${stat.mtime})`);
  } else {
    console.log(`NOT FOUND: ${p}`);
  }
}
