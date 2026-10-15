import struct

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    f.seek(0x0137cdb0)
    hdr = f.read(128)
    magic, pad, minLC, ptrSize = struct.unpack_from("<4sHBB", hdr, 0)
    nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset = struct.unpack_from("<8Q", hdr, 8)
    base = 0x0137cdb0

    f.seek(base + pclnOffset)
    for i in range(5):
        chunk = f.read(8)
        entryOff, funcOff = struct.unpack("<II", chunk)
        pos = f.tell()
        f.seek(base + pclnOffset + funcOff)
        fdata = f.read(16)
        f.seek(pos)
        print(f"[{i}] entryOff={hex(entryOff)}, funcOff={hex(funcOff)}, fdata={fdata.hex()}")
