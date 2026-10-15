with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    d = f.read()

pos = 0
target = b"composite_token_storage.go"
while True:
    p = d.find(target, pos)
    if p == -1: break
    snippet = d[max(0, p-200):min(len(d), p+400)]
    printable = "".join(chr(b) if 32 <= b < 127 else " " for b in snippet)
    print(f"[{hex(p)}]: {printable}\n")
    pos = p + len(target)
