import { spawn } from 'child_process';

const proc = spawn('/snap/antigravity-cli/current/bin/agy', [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: '',
  },
});

let out = '';
proc.stdout?.on('data', (d) => {
  out += d.toString();
  console.log('[STDOUT]:', d.toString());
});
proc.stderr?.on('data', (d) => {
  out += d.toString();
  console.log('[STDERR]:', d.toString());
});

setTimeout(() => {
  console.log('Sending Ctrl+C or kill');
  proc.kill('SIGINT');
}, 5000);

proc.on('close', (c) => console.log('EXIT:', c));
