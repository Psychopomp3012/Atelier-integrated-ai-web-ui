import subprocess

cmd = ["strings", "/snap/antigravity-cli/current/bin/agy"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, errors="replace")

keywords = ["CLITokenFilePath", "oauth_creds", "token_storage", "credentials.json", "tokens.json", "cliFileTokenStorage"]
matches = {k: [] for k in keywords}

for line in proc.stdout:
    line = line.strip()
    for k in keywords:
        if k.lower() in line.lower():
            if len(matches[k]) < 20 and line not in matches[k]:
                matches[k].append(line)

proc.terminate()

for k, lines in matches.items():
    print(f"=== {k} ===")
    for l in lines:
        print("  ", l)
