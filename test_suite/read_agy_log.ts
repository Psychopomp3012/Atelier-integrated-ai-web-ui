import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  const logRes = await sandbox.commands.run('sudo tail -n 100 $(ls -t /home/agent-runner/.gemini/antigravity-cli/log/cli-*.log | head -n 1)');
  console.log('--- AGY LOG ---');
  console.log(logRes.stdout);
  console.log('--- END LOG ---');
}

main();
