with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

# Let's search for "CLITokenFilePath" in pclntab to get its function address
# In Go pclntab:
# The header starts at some position with magic
# Let's search for 0xfffffff0..0xfffffffb
for m in [b"\xf0\xff\xff\xff", b"\xf1\xff\xff\xff", b"\xfa\xff\xff\xff", b"\xfb\xff\xff\xff"]:
    p = 0
    while True:
        pos = data.find(m, p)
        if pos == -1: break
        print(f"Magic {m} at {hex(pos)}")
        p = pos + 1
