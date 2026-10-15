import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  
  // Write the runner script
  await sandbox.files.write('/tmp/run_agy_safe.sh', `#!/bin/bash
PROMPT=$(cat "$1")
shift
exec agy -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json "$@"
`);
  await sandbox.commands.run('chmod +x /tmp/run_agy_safe.sh');

  const trickyPrompt = `Check ram rom and vCPUs of current directory. Include quotes: 'single' and "double", plus newlines!\n\nAlso test backticks \`echo test\`.`;
  await sandbox.files.write('/tmp/test_prompt.txt', trickyPrompt);
  await sandbox.commands.run('chmod 666 /tmp/test_prompt.txt');

  const cmd = `sudo su - agent-runner -c 'script -q -c "/tmp/run_agy_safe.sh /tmp/test_prompt.txt" /dev/null'`;
  const res = await sandbox.commands.run(cmd, { timeoutMs: 45000 });

  console.log('EXIT CODE:', res.exitCode);
  console.log('STDOUT:\n', res.stdout.slice(0, 500));
  console.log('STDERR:\n', res.stderr);
}

main().catch(console.error);
