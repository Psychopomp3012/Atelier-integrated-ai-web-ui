import struct, subprocess

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    f.seek(0x0137cdb0)
    hdr = f.read(128)

magic, pad, minLC, ptrSize = struct.unpack_from("<4sHBB", hdr, 0)
nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset = struct.unpack_from("<8Q", hdr, 8)

base = 0x0137cdb0
funcnametab = base + funcnameOffset
cuTab = base + cuOffset
filetab = base + filetabOffset
pctab = base + pctabOffset
pclntab = base + pclnOffset

print(f"Header: nfunc={nfunc}, textStart={hex(textStart)}")
print(f"funcnametab={hex(funcnametab)}, pclntab={hex(pclntab)}")

# functab starts at base + pclnOffset
# Each entry in functab is (entry_offset, funcoff)
# For Go 1.20, entry_offset is uint32 (or uint64?), relative to textStart!
# Let's inspect functab entries
target = b"google3/third_party/jetski/cli/backend/auth/auth.CLITokenFilePath\x00"

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    f.seek(funcnametab)
    names_data = f.read(cuOffset - funcnameOffset)
    target_idx = names_data.find(target)
    print(f"Target index in names_data: {hex(target_idx)}")

    # Scan functab
    # In Go 1.20, functab has nfunc entries + 1 (table end)
    # entry is uint32 or uint64? Let's check size
    f.seek(pclntab)
    # Let's read first few entries
    for i in range(min(nfunc, 150000)):
        # in Go 1.20 on 64-bit: (entryOff uint32, funcOff uint32)
        # entry address = textStart + entryOff
        # func data is at base + pclnOffset + funcOff
        chunk = f.read(8)
        if len(chunk) < 8: break
        entryOff, funcOff = struct.unpack("<II", chunk)
        # read nameOff from func struct
        # func struct in Go 1.20:
        # entryOff uint32 (or nothing? func data: entryOff uint32, nameOff int32, args int32, deferreturn uint32...)
        # Actually in Go 1.20:
        # func struct at (base + pclnOffset + funcOff):
        # entryOff uint32, nameOff int32, args int32, deferreturn uint32, pcsp uint32, pcfile uint32, pcline uint32, npcdata uint32, cuOffset uint32, startLine int32, funcID uint8, flag uint8, nfuncdata uint8...
        curr_pos = f.tell()
        f.seek(base + pclnOffset + funcOff)
        func_data = f.read(16)
        f.seek(curr_pos)
        if len(func_data) >= 8:
            _, nameOff = struct.unpack("<Ii", func_data[:8])
            if nameOff == target_idx:
                func_entry = textStart + entryOff
                print(f"FOUND FUNCTION! Entry: {hex(func_entry)}")
                break
