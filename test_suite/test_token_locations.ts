import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Copy oauth_creds.json to all potential token candidate locations
  const script = `sudo bash -c '
    SRC="/home/agent-runner/.gemini/oauth_creds.json"
    if [ -f "$SRC" ]; then
      mkdir -p /home/agent-runner/.gemini/antigravity-cli/cache
      mkdir -p /home/agent-runner/.antigravity/cache
      mkdir -p /home/agent-runner/.config/antigravity

      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/antigravity-oauth-token
      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable
      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/cache/antigravity-oauth-token
      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable-oauth-token

      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/jetski-oauth-token
      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/cache/jetski-keyring-unavailable
      cp "$SRC" /home/agent-runner/.gemini/antigravity-cli/cache/jetski-oauth-token

      cp "$SRC" /home/agent-runner/.gemini/antigravity-oauth-token
      cp "$SRC" /home/agent-runner/.antigravity/antigravity-oauth-token
      cp "$SRC" /home/agent-runner/.antigravity/oauth_creds.json

      chown -R agent-runner:agent-runner /home/agent-runner
      chmod -R 700 /home/agent-runner
      echo "Copied to all candidate locations!"
    else
      echo "SRC does not exist!"
    fi
  '`;
  const copyRes = await sandbox.commands.run(script);
  console.log(copyRes.stdout);

  // Now run agy -p "echo hello"
  const cmd = `sudo -u agent-runner -H env HOME=/home/agent-runner PATH="/home/agent-runner/.local/bin:/usr/local/bin:$PATH" DBUS_SESSION_BUS_ADDRESS="" agy -p "echo hello" --dangerously-skip-permissions --output-format stream-json`;
  console.log('Running test command...');
  const runRes = await sandbox.commands.run(cmd, {
    timeoutMs: 15000,
    onStdout: (c) => console.log('[STDOUT]', c),
    onStderr: (c) => console.log('[STDERR]', c),
  }).catch((err: any) => {
    console.log('Execution catch:', err.message);
    return null;
  });

  if (runRes) {
    console.log('Exit code:', runRes.exitCode);
    console.log('Final stdout:', runRes.stdout);
    console.log('Final stderr:', runRes.stderr);
  }
}

main();
