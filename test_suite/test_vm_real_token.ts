import { Sandbox } from 'e2b';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const envPath = fs.existsSync(path.resolve(process.cwd(), '.env'))
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'backend/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

async function run() {
  const tokenPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache', 'antigravity-keyring-unavailable-oauth-token');
  if (!fs.existsSync(tokenPath)) {
    console.error('Token file does not exist at:', tokenPath);
    process.exit(1);
  }
  const tokenContent = fs.readFileSync(tokenPath, 'utf8');

  console.log('Connecting to sandbox microVM iyb69eqlm6s8zp285vkzp...');
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  } catch {
    console.log('Connecting failed, creating new sandbox...');
    sandbox = await Sandbox.create();
  }
  console.log('Sandbox connected:', sandbox.sandboxId);

  // Setup directories
  await sandbox.commands.run('sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache /home/agent-runner/.antigravity/cache');

  // Write token files
  await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable-oauth-token', tokenContent);
  await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/antigravity-oauth-token', tokenContent);
  await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/cache/antigravity-oauth-token', tokenContent);
  await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/cache/jetski-keyring-unavailable-oauth-token', tokenContent);
  await sandbox.files.write('/home/agent-runner/.gemini/antigravity-cli/jetski-oauth-token', tokenContent);

  // Fix permissions
  await sandbox.commands.run('sudo chown -R agent-runner:agent-runner /home/agent-runner/.gemini /home/agent-runner/.antigravity');
  await sandbox.commands.run('sudo chmod 700 /home/agent-runner/.gemini /home/agent-runner/.gemini/antigravity-cli /home/agent-runner/.gemini/antigravity-cli/cache');
  await sandbox.commands.run('sudo chmod 600 /home/agent-runner/.gemini/antigravity-cli/cache/* /home/agent-runner/.gemini/antigravity-cli/* || true');

  // Remove any conflicting oauth_creds.json in antigravity-cli directory
  await sandbox.commands.run('sudo rm -f /home/agent-runner/.gemini/antigravity-cli/oauth_creds.json');

  console.log('Token files written and permissions fixed. Running agy test in microVM...');
  const prompt = "Check ram rom and vCPUs of current directory";
  const cmd = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy -p "${prompt}" --model gemini-3.8-flash-low --output-format json`;

  const result = await sandbox.commands.run(cmd, {
    timeoutMs: 60000,
    onStdout: (data) => console.log('[STDOUT]:', data),
    onStderr: (data) => console.log('[STDERR]:', data),
  });

  console.log('Result Exit Code:', result.exitCode);
  console.log('Final Execution Result Completed Successfully!');
}

run().catch((err) => {
  console.error('Fatal error in VM test:', err);
  process.exit(1);
});
