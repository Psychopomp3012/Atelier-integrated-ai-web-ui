import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Check agent-runner permissions, /home/agent-runner/.gemini, etc.
  const setupCmd = `
    mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
    chown -R agent-runner:agent-runner /home/agent-runner/.gemini
    ls -la /home/agent-runner/.gemini/antigravity-cli
  `;
  const setupRes = await sandbox.commands.run(setupCmd);
  console.log('Setup output:\n', setupRes.stdout, setupRes.stderr);

  // Check what happens when agy runs
  const agyRes = await sandbox.commands.run(`su - agent-runner -c 'agy --help'`, {
    timeoutMs: 10000,
  });
  console.log('agy --help exit code:', agyRes.exitCode);
  console.log('agy --help stdout:\n', agyRes.stdout.slice(0, 200));
}

main().catch(console.error);
