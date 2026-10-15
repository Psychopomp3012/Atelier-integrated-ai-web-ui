import subprocess

cmd = ["strings", "-a", "-t", "d", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")

for line in proc.stdout:
    if "token source" in line.lower() or "token_source" in line.lower():
        print(line.strip())

proc.terminate()
