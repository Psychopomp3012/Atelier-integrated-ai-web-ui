import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Run agy via script with background: true and stdin: true
  const cmd = `sudo su - agent-runner -c 'script -q -c "agy -p \\"echo hello\\" --dangerously-skip-permissions" /dev/null'`;

  let authUrl = '';

  const handle = await sandbox.commands.run(cmd, {
    background: true,
    stdin: true,
    onStdout: (c) => {
      console.log('[STDOUT]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('=== CAPTURED AUTH URL ===\n', authUrl);
      }
    },
    onStderr: (c) => {
      console.log('[STDERR]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('=== CAPTURED AUTH URL ===\n', authUrl);
      }
    },
  });

  console.log('Started agy handle PID:', handle.pid);

  for (let i = 0; i < 30; i++) {
    if (authUrl) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (authUrl) {
    console.log('SUCCESS! Auth URL captured successfully!');
  } else {
    console.log('Failed to capture auth URL.');
  }

  await handle.kill().catch(() => {});
  console.log('Done!');
}

main().catch(console.error);
