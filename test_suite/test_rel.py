import struct

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    f.seek(0x0137cdb0)
    hdr = f.read(128)
    nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset = struct.unpack_from("<8Q", hdr, 8)
    base = 0x0137cdb0

    f.seek(base + pclnOffset)
    found = False
    for i in range(nfunc):
        chunk = f.read(8)
        if len(chunk) < 8: break
        entryOff, funcOff = struct.unpack("<II", chunk)
        pos = f.tell()
        # funcOff is relative to base + pclnOffset? Or relative to base? Or relative to what?
        # Let's test relative to base + pclnOffset vs base:
        f.seek(base + pclnOffset + funcOff)
        fdata = f.read(8)
        f.seek(pos)
        if len(fdata) == 8:
            _, nameOff = struct.unpack("<Ii", fdata)
            if nameOff == 0xfe5827:
                print(f"Match with pclnOffset! i={i}, entryOff={hex(entryOff)}")
                found = True
                break
    if not found:
        print("Not found relative to base+pclnOffset, checking relative to base...")
        f.seek(base + pclnOffset)
        for i in range(nfunc):
            chunk = f.read(8)
            if len(chunk) < 8: break
            entryOff, funcOff = struct.unpack("<II", chunk)
            pos = f.tell()
            f.seek(base + funcOff)
            fdata = f.read(8)
            f.seek(pos)
            if len(fdata) == 8:
                _, nameOff = struct.unpack("<Ii", fdata)
                if nameOff == 0xfe5827:
                    print(f"Match with base! i={i}, entryOff={hex(entryOff)}")
                    found = True
                    break
