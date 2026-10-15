import * as fs from 'fs';

const fd = fs.openSync('/snap/antigravity-cli/current/bin/agy', 'r');
const buf = Buffer.alloc(200);
// 0x5cd2e3d is a virtual address. Let's find its file offset using readelf/objdump
