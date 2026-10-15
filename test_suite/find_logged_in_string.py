import subprocess

cmd = ["strings", "-a", "-t", "d", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")

for line in proc.stdout:
    if "You are not logged into Antigravity" in line:
        print(line.strip())

proc.terminate()
