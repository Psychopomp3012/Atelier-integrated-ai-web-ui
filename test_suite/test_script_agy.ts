import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Run agy via script wrapper
  const cmd = `sudo su - agent-runner -c 'script -q -c "agy -p \\"echo hello\\" --dangerously-skip-permissions" /dev/null'`;

  const res = await sandbox.commands.run(cmd, {
    timeoutMs: 15000,
    onStdout: (c) => console.log('[STDOUT CHUNK]:', c),
    onStderr: (c) => console.log('[STDERR CHUNK]:', c),
  }).catch((err) => err.result || err);

  console.log('Final exitCode:', res.exitCode);
  console.log('Final stdout:\n', res.stdout);
  console.log('Final stderr:\n', res.stderr);
}

main().catch(console.error);
