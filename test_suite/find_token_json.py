import struct

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

# The string offset in funcnametab
# In Go pclntab, funcnametab offset is relative to the start of funcnametab
# Let's search for the 4-byte or 8-byte pointer to 0x236261f or relative offset
print(f"File size: {len(data)}")

# Let's search for "CLITokenFilePath" in the text or rodata
# Where does token_storage.go build the path?
# What strings are nearby in the source code of token_storage.go?
# Let's look for "token" around the string table
idx = 0
matches = []
while True:
    p = data.find(b"token", idx)
    if p == -1: break
    # check if it's a json filename
    if data[p:p+20].endswith(b".json") or data[p-10:p+20].find(b".json") != -1:
        snippet = data[max(0, p-30):min(len(data), p+50)]
        matches.append((p, snippet))
    idx = p + 1

print(f"JSON matches with token: {len(matches)}")
for p, s in matches[:30]:
    print(p, s)
