import struct

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

# Go 1.20+ pclntab magic: 0xFFFFFFFA or 0xFFFFFFFB
magics = [b"\xfa\xff\xff\xff\x00\x00", b"\xfb\xff\xff\xff\x00\x00"]
pcln_pos = -1
for m in magics:
    pos = data.find(m)
    if pos != -1:
        pcln_pos = pos
        print(f"Found pclntab magic at offset: {hex(pos)}")
        break

if pcln_pos != -1:
    # Go 1.20 pcHeader structure:
    # magic 4 bytes, pad 2 bytes, minLC 1 byte, ptrSize 1 byte, nfunc (ptrSize or 4/8 bytes)...
    ptrSize = data[pcln_pos + 7]
    print(f"ptrSize: {ptrSize}")
    # Let's search for the func name string offset in the funcnametab
    target = b"google3/third_party/jetski/cli/backend/auth/auth.CLITokenFilePath\x00"
    target_pos = data.find(target)
    print(f"Target string found at: {hex(target_pos)}")
