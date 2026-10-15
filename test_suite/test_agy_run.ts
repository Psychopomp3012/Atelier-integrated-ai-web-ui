import { spawn } from 'child_process';

const proc = spawn('/snap/antigravity-cli/current/bin/agy', ['-p', 'Say HELLO', '--dangerously-skip-permissions'], {
  env: {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: '',
  },
});

proc.stdout?.on('data', (d) => console.log('STDOUT:', d.toString()));
proc.stderr?.on('data', (d) => console.log('STDERR:', d.toString()));
proc.on('close', (c) => console.log('EXIT:', c));
