import * as childProcess from 'child_process';

const agyBin = '/snap/antigravity-cli/current/bin/agy';
console.log('Spawning agy login --no-browser...');
const proc = childProcess.spawn(agyBin, ['login', '--no-browser'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: '' }
});

proc.stdout?.on('data', (d) => {
  console.log('[STDOUT]:', d.toString());
});

proc.stderr?.on('data', (d) => {
  console.log('[STDERR]:', d.toString());
});

proc.on('exit', (code, signal) => {
  console.log(`[EXIT]: code=${code}, signal=${signal}`);
});

setTimeout(() => {
  console.log('Proc still alive? pid=', proc.pid, 'killed=', proc.killed, 'exitCode=', proc.exitCode);
  proc.kill();
}, 15000);
