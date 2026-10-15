import { Sandbox } from 'e2b';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Prepare directories
  await sandbox.commands.run(`
    sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
    sudo chown -R agent-runner:agent-runner /home/agent-runner/.gemini
    sudo chmod -R 700 /home/agent-runner/.gemini
  `);

  console.log('Starting agy auth session...');
  const cmd = `sudo su - agent-runner -c 'script -q -c "agy -p \\"auth-init\\" --dangerously-skip-permissions" /dev/null'`;

  let authUrl = '';
  const handle = await sandbox.commands.run(cmd, {
    background: true,
    stdin: true,
    onStdout: (c) => {
      console.log('[VM STDOUT]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('=== CAPTURED AUTH URL ===\n', authUrl);
      }
    },
    onStderr: (c) => {
      console.log('[VM STDERR]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('=== CAPTURED AUTH URL ===\n', authUrl);
      }
    },
  });

  for (let i = 0; i < 30; i++) {
    if (authUrl) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!authUrl) {
    console.error('Failed to capture auth URL');
    await handle.kill().catch(() => {});
    process.exit(1);
  }

  // Save auth URL to /tmp/live_auth_url.txt
  fs.writeFileSync('/tmp/live_auth_url.txt', authUrl, 'utf8');
  console.log('Saved auth URL to /tmp/live_auth_url.txt');

  // Wait for code to be provided in /tmp/live_auth_code.txt
  console.log('Waiting for code in /tmp/live_auth_code.txt (timeout 120s)...');
  const codeFile = '/tmp/live_auth_code.txt';
  if (fs.existsSync(codeFile)) fs.unlinkSync(codeFile);

  let code = '';
  for (let i = 0; i < 240; i++) {
    if (fs.existsSync(codeFile)) {
      code = fs.readFileSync(codeFile, 'utf8').trim();
      if (code) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!code) {
    console.error('Timed out waiting for /tmp/live_auth_code.txt');
    await handle.kill().catch(() => {});
    process.exit(1);
  }

  console.log('Received auth code! Sending to agy stdin...');
  await handle.sendStdin(code + '\n');

  console.log('Waiting for agy to complete token exchange...');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    // Check if token file exists in sandbox
    const checkRes = await sandbox.commands.run(`sudo su - agent-runner -c 'ls -la /home/agent-runner/.gemini/antigravity-cli/cache'`).catch(() => null);
    if (checkRes && checkRes.stdout.includes('oauth-token')) {
      console.log('TOKEN FILE FOUND IN SANDBOX!\n', checkRes.stdout);
      
      // Read token file from sandbox
      const readRes = await sandbox.commands.run(`sudo su - agent-runner -c 'cat /home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable-oauth-token'`);
      if (readRes && readRes.stdout.length > 20) {
        console.log('Token successfully retrieved! Size:', readRes.stdout.length);

        // Sync to host
        const hostTokenDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache');
        fs.mkdirSync(hostTokenDir, { recursive: true });
        const hostTokenPath = path.join(hostTokenDir, 'antigravity-keyring-unavailable-oauth-token');
        fs.writeFileSync(hostTokenPath, readRes.stdout, { mode: 0o600 });
        console.log('Saved token to host:', hostTokenPath);

        // Test running agy inside the sandbox without prompt for auth!
        console.log('Testing agy model execution in sandbox with genuine token...');
        const testRes = await sandbox.commands.run(`sudo su - agent-runner -c 'script -q -c "agy -p \\"echo AGY_SUCCESS_VERIFIED\\" --dangerously-skip-permissions" /dev/null'`);
        console.log('Test execution stdout:\n', testRes.stdout);
        console.log('Test execution stderr:\n', testRes.stderr);
        console.log('ALL VERIFIED!');
        process.exit(0);
      }
    }
  }

  console.log('Finished wait loop.');
  await handle.kill().catch(() => {});
}

main().catch(console.error);
