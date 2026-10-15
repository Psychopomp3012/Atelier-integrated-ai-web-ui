import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected!');

  const cmd = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy`;

  let authUrl = '';

  const handle = await sandbox.commands.run(cmd, {
    background: true,
    stdin: true,
    pty: true, // run with pseudo-terminal!
    onStderr: (data) => {
      console.log('[STDERR CHUNK]:', data);
      const match = data.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('FOUND AUTH URL in stderr:', authUrl);
      }
    },
    onStdout: (data) => {
      console.log('[STDOUT CHUNK]:', data);
      const match = data.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('FOUND AUTH URL in stdout:', authUrl);
      }
    },
    onPty: (data) => {
      const text = Buffer.from(data).toString('utf8');
      console.log('[PTY CHUNK]:', text);
      const match = text.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('FOUND AUTH URL in pty:', authUrl);
      }
    },
  });

  console.log('Handle PID:', handle.pid);
  console.log('Waiting for auth URL...');
  for (let i = 0; i < 30; i++) {
    if (authUrl) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (authUrl) {
    console.log('SUCCESS! Auth URL is ready:', authUrl);
  } else {
    console.log('Auth URL not captured yet.');
  }

  // Kill the command so it does not hang
  await handle.kill().catch(() => {});
  console.log('Cleaned up command');
}

main().catch(console.error);
