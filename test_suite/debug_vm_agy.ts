import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected!');

  const cmd = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy -p "hi"`;

  const res = await sandbox.commands.run(cmd, {
    timeoutMs: 10000,
    onStdout: (data) => console.log('[STDOUT STREAM]:', data),
    onStderr: (data) => console.log('[STDERR STREAM]:', data),
  }).catch((err) => {
    console.log('[CAUGHT]:', err.message);
  });
}

main().catch(console.error);
