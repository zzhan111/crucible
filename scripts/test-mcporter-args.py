#!/usr/bin/env python3
"""Minimal repro: mcporter --args via tempfile + bash $(cat)."""
import json, os, subprocess, shutil, tempfile

args = {"name": "xiaohongshu/note",
        "namedArgs": {"note_id": "https://www.xiaohongshu.com/explore/6a4f0668000000001003db36?xsec_token=ABYuNF_Y8air065dbM2l9NJ4QatnjMlGXVSNtfUT7CnnE%3D&xsec_source=pc_search"}}
args_json = json.dumps(args, ensure_ascii=False)

with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
    f.write(args_json)
    tmp = f.name
print('args len:', len(args_json))

bash = shutil.which('bash') or '/bin/bash'
cmd = f'npx -y mcporter call bb-browser.site_run --args "$(cat \'{tmp}\')"'
print('cmd:', cmd[:120], '...')
proc = subprocess.run([bash, '-lc', cmd], capture_output=True, timeout=120)
out = proc.stdout.decode('utf-8', 'ignore') + proc.stderr.decode('utf-8', 'ignore')
os.unlink(tmp)
print('OUT:', out[:1500])
