with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

target = b"oauth-callback"
pos = data.find(target)
print("pos:", hex(pos))
if pos != -1:
    snippet = data[max(0, pos-200):min(len(data), pos+400)]
    printable = "".join(chr(b) if 32 <= b < 127 else " " for b in snippet)
    print(printable)
