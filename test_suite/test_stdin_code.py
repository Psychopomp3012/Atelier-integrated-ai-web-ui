import subprocess, time

cmd = ["agy", "-p", "init"]
proc = subprocess.Popen(
    cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    env={"PATH": "/usr/local/bin:/usr/bin:/bin:/snap/bin", "HOME": "/home/psychopomp3012", "DBUS_SESSION_BUS_ADDRESS": ""}
)

# Read until we see URL or Enter
stderr_lines = []
while True:
    line = proc.stderr.readline()
    if not line: break
    print("[STDERR]", line.strip())
    if "paste the authorization code" in line.lower() or "enter:" in line.lower():
        break

print("Sending dummy code to stdin...")
proc.stdin.write("dummy_code_12345\n")
proc.stdin.flush()

out, err = proc.communicate(timeout=10)
print("[COMMUNICATE OUT]:", out)
print("[COMMUNICATE ERR]:", err)
