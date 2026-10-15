import re

with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    d = f.read()

matches = re.findall(rb'type:\.eq\.[a-zA-Z0-9_\.]*auth\.[a-zA-Z0-9_\.]*', d)
print("Auth types:", {m.decode(errors="replace") for m in matches})

matches2 = re.findall(rb'auth\.([a-zA-Z0-9_]+Token[a-zA-Z0-9_]*)', d)
print("Token types:", {m.decode(errors="replace") for m in matches2})
