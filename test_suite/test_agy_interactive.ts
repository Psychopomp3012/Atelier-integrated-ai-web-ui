import { spawn } from 'child_process';

const agyBin = '/snap/antigravity-cli/current/bin/agy';
console.log('Spawning agy -p init...');
const proc = spawn(agyBin, ['-p', 'init'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: '' }
});

proc.stdout?.on('data', (d) => {
  console.log('[STDOUT]:', d.toString());
});

proc.stderr?.on('data', (d) => {
  console.log('[STDERR]:', d.toString());
});

proc.on('close', (code, signal) => {
  console.log(`[CLOSE]: code=${code}, signal=${signal}`);
});

setTimeout(() => {
  console.log('Proc still running? pid=', proc.pid, 'killed=', proc.killed, 'exitCode=', proc.exitCode);
  proc.kill('SIGKILL');
}, 10000);
