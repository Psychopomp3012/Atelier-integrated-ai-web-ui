with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

idx = 0
found = []
target = b"google3/third_party/jetski/cli/backend/auth"
while True:
    pos = data.find(target, idx)
    if pos == -1:
        break
    found.append(pos)
    idx = pos + len(target)

print(f"Found {len(found)} occurrences of auth package path:")
for p in found:
    snippet = data[max(0, p-50):min(len(data), p+200)]
    # filter printable
    printable = "".join(chr(b) if 32 <= b < 127 else f"\\x{b:02x}" for b in snippet)
    print(f"Offset {p}: {printable[:160]}")
