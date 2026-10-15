import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  const cmd = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy -p "echo hello" --dangerously-skip-permissions --output-format stream-json`;
  console.log('Running cmd:', cmd);

  const res = await sandbox.commands.run(cmd, {
    onStdout: (c) => console.log('[STDOUT]', c),
    onStderr: (c) => console.log('[STDERR]', c),
    timeoutMs: 15000,
  }).catch((err: any) => {
    console.log('Command run rejected:', err);
    return null;
  });

  if (res) {
    console.log('exitCode:', res.exitCode);
    console.log('stdout:', res.stdout);
    console.log('stderr:', res.stderr);
  }
}

main();
