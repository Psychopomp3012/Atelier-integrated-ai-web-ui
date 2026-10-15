import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  
  const cmd = `sudo su - agent-runner -c 'script -q -c "agy -p \\"Hi\\" --dangerously-skip-permissions --output-format stream-json" /dev/null'`;
  const res = await sandbox.commands.run(cmd, { timeoutMs: 30000 });

  const lines = res.stdout.split('\n');
  for (const l of lines) {
    if (l.trim()) {
      try {
        const parsed = JSON.parse(l.trim());
        if (parsed.event === 'step_update' || parsed.event === 'result') {
          console.log(`=== ${parsed.event} ===\n`, JSON.stringify(parsed, null, 2));
        }
      } catch {}
    }
  }
}

main().catch(console.error);
