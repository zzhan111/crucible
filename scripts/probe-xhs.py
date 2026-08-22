#!/usr/bin/env python3
"""Probe bb-browser daemon xiaohongshu adapter (manual test, one keyword)."""
import json, http.client, sys, time

cfg = json.load(open(r'C:\Users\zhang\.bb-browser\daemon.json'))
token = open(r'C:\Users\zhang\.bb-browser\token').read().strip()

def cmd(action, **kw):
    body = json.dumps({'id': 'probe1', 'action': action, 'args': kw})
    conn = http.client.HTTPConnection(cfg['host'], cfg['port'], timeout=30)
    conn.request('POST', '/command', body=body, headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    r = conn.getresponse()
    data = json.loads(r.read().decode())
    conn.close()
    return data

if __name__ == '__main__':
    kw = sys.argv[1] if len(sys.argv) > 1 else '新疆旅游攻略'
    print(f'>>> search keyword={kw}', flush=True)
    t0 = time.time()
    res = cmd('xiaohongshu/search', keyword=kw)
    print(f'<<< {time.time()-t0:.1f}s', flush=True)
    print(json.dumps(res, ensure_ascii=False)[:3000], flush=True)
