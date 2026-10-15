import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  // Install strace if not installed, or run python to see agy files
  await sandbox.commands.run('sudo apt-get update -qq && sudo apt-get install -y -qq strace').catch(() => {});

  const straceCmd = `sudo -u agent-runner -H env HOME=/home/agent-runner DBUS_SESSION_BUS_ADDRESS="" timeout 2 strace -f -e trace=open,openat agy -p "echo" 2>&1 | grep -v "/usr/" | grep -v "/lib/" | grep -v "/etc/" | head -n 60`;
  const res = await sandbox.commands.run(straceCmd);
  console.log('Strace openat for gemini:');
  console.log(res.stdout);
}

main();
