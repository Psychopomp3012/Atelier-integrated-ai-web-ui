import subprocess, re

cmd = ["strings", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")

matches = set()
for line in proc.stdout:
    line = line.strip()
    if ".json" in line:
        # extract candidate json filenames
        tokens = re.findall(r'[a-zA-Z0-9_\-\.\/]+\.json', line)
        for t in tokens:
            if not t.startswith("http") and len(t) < 80:
                matches.add(t)

proc.terminate()

for m in sorted(matches):
    if any(k in m for k in ["token", "cred", "auth", "account", "gemini", "antigravity", "jetski", "user"]):
        print(m)
