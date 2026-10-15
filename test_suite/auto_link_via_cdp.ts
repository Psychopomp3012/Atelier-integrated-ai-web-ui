import { Sandbox } from 'e2b';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Native Node 22 WebSocket CDP client
async function sendCdp(wsUrl: string, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Math.floor(Math.random() * 1000000);
    
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.addEventListener('message', (event: any) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.close();
          resolve(msg.result);
        }
      } catch (e) {
        ws.close();
        reject(e);
      }
    });

    ws.addEventListener('error', (err: any) => {
      ws.close();
      reject(err);
    });

    setTimeout(() => {
      ws.close();
      reject(new Error(`CDP command ${method} timed out`));
    }, 15000);
  });
}

async function evalInPage(wsUrl: string, expression: string): Promise<any> {
  const res = await sendCdp(wsUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res?.result?.value;
}

async function main() {
  // 1. Find browser tab WebSocket URL
  const tabsRes = await fetch('http://127.0.0.1:9222/json/list');
  const tabs: any = await tabsRes.json();
  const pageTab = tabs.find((t: any) => t.type === 'page' && !t.url.startsWith('chrome://'));
  if (!pageTab) {
    throw new Error('No active browser page tab found on port 9222');
  }
  const wsUrl = pageTab.webSocketDebuggerUrl;
  console.log('Using browser tab:', pageTab.title, wsUrl);

  // 2. Connect to Sandbox
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  await sandbox.commands.run(`
    sudo mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
    sudo chown -R agent-runner:agent-runner /home/agent-runner/.gemini
    sudo chmod -R 700 /home/agent-runner/.gemini
  `);

  console.log('Starting agy auth in microVM...');
  const cmd = `sudo su - agent-runner -c 'script -q -c "agy -p \\"auth-init\\" --dangerously-skip-permissions" /dev/null'`;

  let authUrl = '';
  const handle = await sandbox.commands.run(cmd, {
    background: true,
    stdin: true,
    onStdout: (c) => {
      console.log('[VM STDOUT]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('CAPTURED AUTH URL:\n', authUrl);
      }
    },
    onStderr: (c) => {
      console.log('[VM STDERR]:', c);
      const match = c.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\n\r"']+/);
      if (match && !authUrl) {
        authUrl = match[0];
        console.log('CAPTURED AUTH URL:\n', authUrl);
      }
    },
  });

  for (let i = 0; i < 30; i++) {
    if (authUrl) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!authUrl) {
    await handle.kill().catch(() => {});
    throw new Error('Failed to capture auth URL from agy');
  }

  // 3. Navigate Chrome tab to authUrl
  console.log('Navigating browser tab to authUrl...');
  await sendCdp(wsUrl, 'Page.navigate', { url: authUrl });

  // 4. Poll page state and interact
  let authCode = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const pageInfo = await evalInPage(wsUrl, `(() => {
        const text = document.body ? document.body.innerText : '';
        const url = window.location.href;
        
        // 1. Check if code is in page text
        const m = text.match(/4\\/[0-9A-Za-z_-]{40,}/);
        if (m) return { state: 'code_found', code: m[0] };

        // 2. Check if code is in URL
        const urlM = url.match(/[?&]code=([^&]+)/);
        if (urlM) return { state: 'code_found', code: decodeURIComponent(urlM[1]) };

        // 3. Check if Sign in button is visible (Make sure you downloaded this app from Google)
        const signinBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => /^(Sign in|Allow|Continue)$/i.test(b.innerText.trim()));
        if (signinBtn) {
          signinBtn.click();
          return { state: 'clicked_signin', buttonText: signinBtn.innerText.trim() };
        }

        // 4. Check if account chooser has Sachin Diwakar
        const accEl = document.querySelector('div[data-identifier="diwakar.sachin3012@gmail.com"]');
        if (accEl) {
          accEl.click();
          return { state: 'clicked_account' };
        }

        return { state: 'waiting', url: url.slice(0, 80) };
      })()`);

      console.log(`[Attempt ${attempt}] Page status:`, pageInfo);
      if (pageInfo && pageInfo.state === 'code_found' && pageInfo.code) {
        authCode = pageInfo.code;
        console.log('=== EXTRACTED AUTH CODE ===\n', authCode);
        break;
      }
    } catch (err: any) {
      console.log('Eval error:', err.message);
    }
  }

  if (!authCode) {
    await handle.kill().catch(() => {});
    throw new Error('Failed to retrieve auth code via browser automation');
  }

  // 5. Send code to agy stdin in microVM!
  console.log('Submitting code to agy stdin in microVM...');
  await handle.sendStdin(authCode + '\n');

  console.log('Waiting for agy to complete token exchange...');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const checkRes = await sandbox.commands.run(`sudo su - agent-runner -c 'ls -la /home/agent-runner/.gemini/antigravity-cli/cache'`).catch(() => null);
    if (checkRes && checkRes.stdout.includes('oauth-token')) {
      console.log('SUCCESS! Token file discovered in microVM!\n', checkRes.stdout);
      
      const readRes = await sandbox.commands.run(`sudo su - agent-runner -c 'cat /home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable-oauth-token'`);
      if (readRes && readRes.stdout.length > 20) {
        const hostTokenDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache');
        fs.mkdirSync(hostTokenDir, { recursive: true });
        const hostTokenPath = path.join(hostTokenDir, 'antigravity-keyring-unavailable-oauth-token');
        fs.writeFileSync(hostTokenPath, readRes.stdout, { mode: 0o600 });
        console.log('Saved token to host:', hostTokenPath);

        // Also save to other candidate paths so e2b and cliAuthService both see it
        const snapTokenDir = path.join(os.homedir(), 'snap', 'antigravity-cli', 'common', '.gemini', 'antigravity-cli', 'cache');
        fs.mkdirSync(snapTokenDir, { recursive: true });
        fs.writeFileSync(path.join(snapTokenDir, 'antigravity-keyring-unavailable-oauth-token'), readRes.stdout, { mode: 0o600 });

        // Test running agy with a real prompt in the microVM!
        console.log('Running prompt: "Check ram rom and vCPUs of current directory"...');
        const testRes = await sandbox.commands.run(`sudo su - agent-runner -c 'script -q -c "agy -p \\"Check ram rom and vCPUs of current directory\\" --dangerously-skip-permissions" /dev/null'`, {
          timeoutMs: 60000,
        });
        console.log('=== REAL MODEL EXECUTION RESULT IN MICROVM ===\n');
        console.log('exitCode:', testRes.exitCode);
        console.log('STDOUT:\n', testRes.stdout);
        console.log('STDERR:\n', testRes.stderr);
        console.log('=== FINISHED WITH COMPLETE SUCCESS ===');
        process.exit(0);
      }
    }
  }

  await handle.kill().catch(() => {});
}

main().catch(console.error);
