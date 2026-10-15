import struct

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

# Let's search for "auth.CLITokenFilePath" in pclntab
target = b"google3/third_party/jetski/cli/backend/auth/auth.CLITokenFilePath\x00"
str_offset = data.find(target)
print("str_offset:", hex(str_offset))

# In Go pclntab (Go 1.20+):
# pcHeader:
# 0: magic (4 bytes)
# 4: pad (2 bytes)
# 6: minLC (1 byte)
# 7: ptrSize (1 byte)
# 8: nfunc (ptrSize or uint32/uint64)
# ...
# funcnametab starts at some offset, and the string offset within funcnametab is stored in func tab.
# But even simpler: let's search for the bytes of the string offset or let's search for any references to str_offset!

# Let's search for 4-byte or 8-byte integers equal to str_offset or relative to funcnametab
print("Searching for pclntab header...")
for magic in [b"\xfb\xff\xff\xff\x00\x00", b"\xfa\xff\xff\xff\x00\x00"]:
    idx = 0
    while True:
        pos = data.find(magic, idx)
        if pos == -1: break
        idx = pos + 1
        # Check if valid header
        minLC = data[pos+6]
        ptrSize = data[pos+7]
        if minLC in [1, 2, 4] and ptrSize in [4, 8]:
            print(f"Candidate pclntab at {hex(pos)}: minLC={minLC}, ptrSize={ptrSize}")
            # Header fields (for Go 1.20):
            # uint32/64 nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset
            # Let's unpack with ptrSize=8 (64-bit)
            fields = struct.unpack_from("<8Q", data, pos + 8)
            nfunc, nfiles, textStart, funcnameOffset, cuOffset, filetabOffset, pctabOffset, pclnOffset = fields
            print(f"nfunc={nfunc}, textStart={hex(textStart)}, funcnameOffset={hex(funcnameOffset)}")
            # If funcnameOffset is within file:
            funcnametab = pos + funcnameOffset
            print(f"funcnametab at {hex(funcnametab)}")
            if funcnametab <= str_offset < funcnametab + 0x10000000:
                name_off = str_offset - funcnametab
                print(f"Found match! name_off = {hex(name_off)}")
                # Now scan functab: array of (entry, funcoff)
                # functab starts at pos + pclnOffset or after header
                # Let's find funcoff that points to func data with name_off
                break
