import struct

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    f.seek(0x0137cdb0)
    hdr = f.read(128)
    nfunc = struct.unpack_from("<Q", hdr, 8)[0]
    base = 0x0137cdb0

    f.seek(base + 72) # funcnametab
    # Let's find target string offset relative to base + 72
    target = b"google3/third_party/jetski/cli/backend/auth/auth.CLITokenFilePath\x00"
    f.seek(0)
    data = f.read()
    str_pos = data.find(target)
    target_name_off = str_pos - (base + 72)
    print(f"target_name_off: {hex(target_name_off)}")

    # In Go 1.20, functab starts at base + pclnOffset
    pclnOffset = struct.unpack_from("<Q", hdr, 8 + 7*8)[0]
    functab_start = base + pclnOffset
    print(f"functab_start: {hex(functab_start)}")

    # In Go 1.20: functab is an array of (entryOff uint32, funcOff uint32)
    # Total entries: nfunc + 1
    f.seek(functab_start)
    for i in range(nfunc):
        entryOff, funcOff = struct.unpack("<II", f.read(8))
        # func struct is at functab_start + funcOff
        pos = f.tell()
        f.seek(functab_start + funcOff)
        func_struct = f.read(16)
        f.seek(pos)
        if len(func_struct) >= 8:
            _, nameOff = struct.unpack("<Ii", func_struct[:8])
            if nameOff == target_name_off:
                text_addr = 0x06642000 + entryOff
                print(f"FOUND! i={i}, entryOff={hex(entryOff)}, text_addr={hex(text_addr)}")
                break
