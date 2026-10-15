with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

pos = 0
found = []
target = b"consumerOAuth"
while True:
    p = data.find(target, pos)
    if p == -1: break
    found.append(p)
    pos = p + len(target)

print(f"Found {len(found)} occurrences of consumerOAuth:")
for p in found:
    snippet = data[max(0, p-50):min(len(data), p+200)]
    printable = "".join(chr(b) if 32 <= b < 127 else " " for b in snippet)
    print(printable)
