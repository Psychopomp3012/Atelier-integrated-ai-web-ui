import struct, subprocess

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    f.seek(0x0137cdb0)
    hdr = f.read(128)
    magic, pad, minLC, ptrSize = struct.unpack_from("<4sHBB", hdr, 0)
    nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset = struct.unpack_from("<8Q", hdr, 8)
    base = 0x0137cdb0
    target_idx = 0xfe5827

    f.seek(base + pclnOffset)
    functab_data = f.read(nfunc * 8)

    found_entry = None
    for i in range(nfunc):
        entryOff, funcOff = struct.unpack_from("<II", functab_data, i * 8)
        f.seek(base + pclnOffset + funcOff)
        fdata = f.read(8)
        _, nameOff = struct.unpack("<Ii", fdata)
        if nameOff == target_idx:
            # text section starts at 0x06642000
            addr = 0x06642000 + entryOff
            print(f"FOUND CLITokenFilePath at addr: {hex(addr)}, entryOff: {hex(entryOff)}")
            found_entry = addr
            break

if found_entry:
    # Run objdump on that specific address range!
    cmd = [
        "objdump", "-d",
        f"--start-address={hex(found_entry)}",
        f"--stop-address={hex(found_entry + 0x120)}",
        "/snap/antigravity-cli/current/bin/agy"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print("=== DISASSEMBLY ===")
    print(res.stdout)
