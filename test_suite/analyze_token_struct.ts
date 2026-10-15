import { execSync } from 'child_process';

const bin = '/snap/antigravity-cli/current/bin/agy';
const out = execSync(`objdump -d --start-address=0x8d2d060 --stop-address=0x8d2d300 ${bin}`, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
console.log('SaveToken disassembly:\n', out);
