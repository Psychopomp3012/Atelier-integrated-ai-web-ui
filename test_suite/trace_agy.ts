import { execSync } from 'child_process';

try {
  const out = execSync(
    'strace -f -e trace=openat /snap/antigravity-cli/current/bin/agy -p "hi" 2>&1 | grep -E "openat.*(oauth|\.gemini|\.config|\.cache)" | grep -v "ENOENT"',
    {
      encoding: 'utf8',
      env: {
        HOME: '/home/psychopomp3012',
        PATH: '/snap/antigravity-cli/current/bin:/usr/bin:/bin',
      },
    }
  );
  console.log('Opened files:\n', out);
} catch (err: any) {
  console.log('Error/Output:\n', err.stdout || err.message);
}
