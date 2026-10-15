with open("/snap/antigravity-cli/current/bin/agy", "rb") as f:
    data = f.read()

import re
matches = set(re.findall(rb'AUTH_MODE_[A-Z0-9_]+', data))
for m in sorted(matches):
    print(m.decode())
