import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  
  await sandbox.files.write('/tmp/test_stdout.py', `
with open('/dev/stdout', 'w') as f:
    f.write('IT WORKS PERFECTLY!\\n')
`);

  const res1 = await sandbox.commands.run(`sudo su - agent-runner -c 'script -q -c "python3 /tmp/test_stdout.py" /dev/null'`);
  console.log('SCRIPT OUTPUT:\n', res1.stdout, res1.stderr);
}

main().catch(console.error);
