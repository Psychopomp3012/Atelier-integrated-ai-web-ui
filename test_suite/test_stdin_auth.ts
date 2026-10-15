import { Sandbox } from 'e2b';

let activeSandbox: Sandbox | null = null;
let activeCmd: any = null;

export async function startSandboxAgyAuth(): Promise<string> {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  activeSandbox = sandbox;

  // Ensure directories exist with proper permissions
  await sandbox.commands.run(`
    sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
    sudo chown -R agent-runner:agent-runner /home/agent-runner/.gemini
    sudo chmod -R 700 /home/agent-runner/.gemini
  `);

  const cmdStr = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy -p "hi" --dangerously-skip-permissions`;

  return new Promise(async (resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error('Timeout waiting for auth URL from agy'));
      }
    }, 20000);

    const handle = await sandbox.commands.run(cmdStr, {
      stdin: true,
      timeoutMs: 180000, // 3 minutes for user to complete login
      onStderr: (chunk: string) => {
        console.log('[VM STDERR]:', chunk);
        const match = chunk.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(match[0]);
        }
      },
      onStdout: (chunk: string) => {
        console.log('[VM STDOUT]:', chunk);
      },
    }).catch((err) => {
      console.log('[VM CMD FINISHED/FAILED]:', err.message);
    });

    activeCmd = handle;
  });
}

export async function submitAuthCode(code: string): Promise<boolean> {
  if (!activeCmd) {
    console.error('No activeCmd!');
    return false;
  }
  console.log('Sending code to agy stdin in microVM...');
  await activeCmd.sendStdin(code + '\n');
  return true;
}

async function main() {
  const url = await startSandboxAgyAuth();
  console.log('=== AUTH URL CAPTURED ===');
  console.log(url);
}

if (process.argv[1]?.endsWith('test_stdin_auth.ts')) {
  main().catch(console.error);
}
