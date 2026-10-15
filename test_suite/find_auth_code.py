import subprocess

cmd = ["strings", "-a", "-t", "d", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")

offset = None
for line in proc.stdout:
    if "You are not logged into Antigravity." in line:
        offset = int(line.split()[0])
        print(f"Error string at offset: {offset}")
        break
proc.terminate()

# Now find function symbols around this
cmd = ["strings", "-a", "-t", "d", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")
for line in proc.stdout:
    if "token_storage.go" in line or "auth.go" in line:
        print(line.strip())
proc.terminate()
