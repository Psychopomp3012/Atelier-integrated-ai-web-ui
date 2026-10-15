import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Create FIFO
  await sandbox.commands.run(`
    sudo rm -f /tmp/agy_auth_fifo
    sudo mkfifo /tmp/agy_auth_fifo
    sudo chmod 666 /tmp/agy_auth_fifo
    # Make sure agent-runner owns gemini dir
    sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
    sudo chown -R agent-runner:agent-runner /home/agent-runner/.gemini
  `);

  console.log('Starting agy with FIFO input...');
  const cmd = `sudo su - agent-runner -c 'script -q -c "agy -p \\"auth-init\\" --dangerously-skip-permissions" /dev/null < /tmp/agy_auth_fifo'`;

  let authUrl = '';

  const handle = await sandbox.commands.run(cmd, {
    background: true,
    onStdout: (c) => {
      console.log('[VM STDOUT]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('=== CAPTURED URL ===\n', authUrl);
      }
    },
    onStderr: (c) => {
      console.log('[VM STDERR]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('=== CAPTURED URL ===\n', authUrl);
      }
    },
  });

  console.log('Agy running with PID:', handle.pid);

  // Wait for auth URL
  for (let i = 0; i < 40; i++) {
    if (authUrl) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!authUrl) {
    console.error('Failed to capture auth URL');
    await handle.kill().catch(() => {});
    return;
  }

  console.log('Auth URL is live and waiting for FIFO write!');
  console.log('URL:\n', authUrl);
}

main().catch(console.error);
