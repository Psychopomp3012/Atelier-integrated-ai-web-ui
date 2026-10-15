import { spawn } from 'child_process';

const agyBin = '/snap/antigravity-cli/current/bin/agy';
console.log('Testing agy -p init lifetime...');
const startTime = Date.now();

const proc = spawn(agyBin, ['-p', 'init'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: '',
  },
});

proc.stdout?.on('data', (d) => {
  console.log(`[STDOUT +${Date.now() - startTime}ms]: ${d.toString()}`);
});

proc.stderr?.on('data', (d) => {
  console.log(`[STDERR +${Date.now() - startTime}ms]: ${d.toString()}`);
});

proc.on('close', (code, signal) => {
  console.log(`[CLOSE +${Date.now() - startTime}ms]: code=${code}, signal=${signal}`);
});

proc.on('error', (err) => {
  console.log(`[ERROR +${Date.now() - startTime}ms]:`, err);
});
