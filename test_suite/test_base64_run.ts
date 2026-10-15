import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  const prompt = `Check ram rom and vCPUs of current directory. Also echo 'single quotes' and "double quotes"!`;
  
  await sandbox.files.write('/tmp/run_agent_prompt.txt', prompt);
  await sandbox.commands.run('chmod 666 /tmp/run_agent_prompt.txt');

  const cmd = `sudo su - agent-runner -c 'script -q -c "agy --dangerously-skip-permissions" /dev/null < /tmp/run_agent_prompt.txt'`;

  const res = await sandbox.commands.run(cmd, { timeoutMs: 30000 });
  console.log('EXIT:', res.exitCode);
  console.log('STDOUT:\n', res.stdout);
}

main().catch(console.error);
