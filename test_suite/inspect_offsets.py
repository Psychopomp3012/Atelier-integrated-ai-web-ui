import subprocess

# Let's run gdb or objdump or strings with offset
cmd = ["strings", "-a", "-t", "d", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")

target_offset = None
offsets = []
for line in proc.stdout:
    parts = line.strip().split(maxsplit=1)
    if len(parts) == 2:
        offset, s = parts
        if "CLITokenFilePath" in s:
            offsets.append((int(offset), s))
            print(f"Found: {offset} -> {s}")

proc.terminate()
