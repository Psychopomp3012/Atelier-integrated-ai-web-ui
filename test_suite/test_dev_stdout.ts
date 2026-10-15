import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  const res = await sandbox.commands.run(`
    echo "test from user" > /dev/stdout
    agy --help | head -n 3
  `).catch(err => err.result || err);

  console.log('STDOUT:\n', res.stdout);
  console.log('STDERR:\n', res.stderr);
}

main().catch(console.error);
