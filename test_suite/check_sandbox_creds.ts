import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  const check = await sandbox.commands.run('sudo cat /home/agent-runner/.gemini/oauth_creds.json');
  console.log('oauth_creds.json stdout length:', check.stdout.length);
  try {
    const c = JSON.parse(check.stdout);
    console.log('Keys in microVM oauth_creds:', Object.keys(c));
    console.log('Scopes in microVM oauth_creds:', c.scope);
    console.log('Expiry:', new Date(c.expiry_date));
  } catch (err: any) {
    console.log('Failed to parse microVM oauth_creds:', err.message);
  }

  const checkAgyCreds = await sandbox.commands.run('sudo cat /home/agent-runner/.gemini/antigravity-cli/oauth_creds.json');
  console.log('antigravity-cli oauth_creds.json stdout length:', checkAgyCreds.stdout.length);

  // Also check settings.json
  const checkSettings = await sandbox.commands.run('sudo cat /home/agent-runner/.gemini/settings.json');
  console.log('settings.json:', checkSettings.stdout);
}

main();
