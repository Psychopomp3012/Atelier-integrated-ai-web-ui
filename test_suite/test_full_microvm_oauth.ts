import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Ensure directories exist
  await sandbox.commands.run(`
    sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
    sudo chown -R agent-runner:agent-runner /home/agent-runner/.gemini
    sudo chmod -R 700 /home/agent-runner/.gemini
  `);

  console.log('Starting agy in microVM...');
  const cmd = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy -p "echo hello" --dangerously-skip-permissions`;

  let authUrl = '';
  let cmdHandle: any = null;

  const urlPromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for auth URL')), 25000);

    sandbox.commands.run(cmd, {
      stdin: true,
      timeoutMs: 300000, // 5 minutes
      onStderr: (data) => {
        console.log('[STDERR]:', data);
        const match = data.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
        if (match && !authUrl) {
          authUrl = match[0];
          clearTimeout(timer);
          resolve(authUrl);
        }
      },
      onStdout: (data) => {
        console.log('[STDOUT]:', data);
      },
    }).then((res) => {
      console.log('Command finished with exitCode:', res.exitCode);
    }).catch((err) => {
      console.log('Command error:', err.message);
    });
  });

  authUrl = await urlPromise;
  console.log('CAPTURED_AUTH_URL:', authUrl);
}

main().catch(console.error);
