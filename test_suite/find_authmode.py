with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

target = b"Auth mode is unspecified"
pos = data.find(target)
print("pos:", hex(pos))
if pos != -1:
    snippet = data[max(0, pos-100):min(len(data), pos+300)]
    printable = "".join(chr(b) if 32 <= b < 127 else " " for b in snippet)
    print(printable)
