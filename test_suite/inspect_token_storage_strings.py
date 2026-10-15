with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    d = f.read()

target = b"Using file-based token storage because no D-Bus session bus detected"
pos = d.find(target)
print("pos:", hex(pos))
if pos != -1:
    snippet = d[max(0, pos-400):min(len(d), pos+800)]
    printable = "".join(chr(b) if 32 <= b < 127 else "\n" for b in snippet)
    print("STRINGS:")
    for l in printable.split("\n"):
        if l.strip():
            print("  ", l.strip())
