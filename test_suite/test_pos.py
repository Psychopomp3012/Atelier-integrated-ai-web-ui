with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

target = b"google3/third_party/jetski/cli/backend/auth/auth.CLITokenFilePath"
pos = data.find(target)
print("pos:", hex(pos) if pos != -1 else "not found")
