with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

# Let's search for "cliFileTokenStorage" in data
pos = 0
found = []
while True:
    p = data.find(b"cliFileTokenStorage", pos)
    if p == -1: break
    found.append(p)
    pos = p + 1

print(f"Found {len(found)} occurrences of cliFileTokenStorage:")
for p in found:
    snippet = data[max(0, p-100):min(len(data), p+200)]
    printable = "".join(chr(b) if 32 <= b < 127 else " " for b in snippet)
    print(f"[{p}] {printable}")
