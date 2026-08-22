#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect-sources.py — 新疆旅游信源采集（Layer 1 raw collector，cron no_agent 模式）。

双通道:
  1. 小红书: bb-browser mcporter site_run xiaohongshu/search + xiaohongshu/note
  2. 网络:   DuckDuckGo HTML 搜索 + 直接抓取攻略页文本

输出:
  data/archive/<ts>_xhs.jsonl     小红书笔记（raw）
  data/archive/<ts>_web.jsonl     网络页面（raw）
  data/sources-master.jsonl       去重合并的统一信源库（引擎 Task 4 消费）
  data/seen_ids.json              全局去重 set

退出码: 0=ok  1=通道不可用/无新数据  2=rate-limited(下 tick 重试)  3=其他错误
用法:   python scripts/collect-sources.py
"""
import json, os, sys, re, time, html, shutil, subprocess, tempfile, urllib.request, urllib.parse, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ARCHIVE = os.path.join(DATA, 'archive')
SEEN = os.path.join(DATA, 'seen_ids.json')
MASTER = os.path.join(DATA, 'sources-master.jsonl')

KEYWORDS = ['喀纳斯 旅游攻略', '禾木 攻略', '布尔津 五彩滩', '乌尔禾 魔鬼城', '可可托海 攻略', '北疆 喀纳斯 环线', '阿勒泰 旅游']
MIN_LIKES = 200          # 小红书高赞门槛
MAX_NOTES = 8            # 每 tick 最多拉详情的笔记数
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
MAX_TEXT = 6000          # 网络页面文本截取上限


def log(msg):
    print(msg, flush=True)


def load_seen():
    if os.path.exists(SEEN):
        with open(SEEN, encoding='utf-8') as f:
            return set(json.load(f))
    return set()


def save_seen(seen):
    os.makedirs(DATA, exist_ok=True)
    with open(SEEN, 'w', encoding='utf-8') as f:
        json.dump(sorted(seen), f, ensure_ascii=False)


def append_master(records, seen):
    """去重追加到 sources-master.jsonl，返回新增数。"""
    added = 0
    with open(MASTER, 'a', encoding='utf-8') as f:
        for rec in records:
            key = rec.get('id') or rec.get('url')
            if not key or key in seen:
                continue
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            seen.add(key)
            added += 1
    return added


def xhs_trust(likes):
    """小红书笔记 source_trust：按赞数分级 0.6-0.85。
    注意：note 详情返回 likes 可能是中文格式（'3.7万'），需解析。"""
    try:
        n = float(likes)
    except (TypeError, ValueError):
        s = str(likes or '').strip()
        try:
            if '万' in s:
                n = float(s.replace('万', '')) * 10000
            else:
                n = float(s)
        except ValueError:
            return 0.6
    if n >= 5000:
        return 0.85
    if n >= 500:
        return 0.80
    if n >= 200:
        return 0.75
    if n >= 50:
        return 0.70
    return 0.60


def mcporter_site_run(name, named_args):
    """调 mcporter → bb-browser.site_run。
    Pitfall（2026-08-01 实测）: mcporter --args 直传含 URL 的大 JSON 会被截断
    （Unterminated string at position 175）。正确姿势：写临时文件 + bash $(cat) 展开。
    """
    npx = shutil.which('npx')
    # Pitfall（2026-08-02 cron 实测）: cron 环境 PATH 可能解析到非 git-bash 的 bash
    # （WSL bash 不认 C:/... 路径 → cat No such file）。显式优先 git-bash 绝对路径。
    BASH_CANDIDATES = [
        r'Z:\Git\usr\bin\bash.EXE',
        r'C:\Program Files\Git\bin\bash.exe',
        r'C:\Program Files\Git\usr\bin\bash.exe',
        r'C:\Program Files\Git\bin\bash.EXE',
    ]
    bash = next((b for b in BASH_CANDIDATES if os.path.exists(b)), None) or shutil.which('bash')
    if not npx or not bash:
        raise RuntimeError(f'npx/bash not found (npx={npx}, bash={bash})')
    args_json = json.dumps({'name': name, 'namedArgs': named_args}, ensure_ascii=False)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
            f.write(args_json)
            tmp = f.name
        # Pitfall（2026-08-02 cron 实测）: cron 环境的 bash 不认 Windows 反斜杠路径
        # （cat 'C:\Users\...\tmp.json' → No such file）。转正斜杠 C:/Users/... 两种 bash 通吃。
        tmp_posix = tmp.replace('\\', '/')
        cmd = f'npx -y mcporter call bb-browser.site_run --args "$(cat \'{tmp_posix}\')"'
        proc = subprocess.run([bash, '-lc', cmd], capture_output=True, timeout=120)
        out = proc.stdout.decode('utf-8', 'ignore') + proc.stderr.decode('utf-8', 'ignore')
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)
    m = re.search(r'(\{.*\}|\[.*\])', out, re.S)
    if not m:
        raise RuntimeError(f'mcporter no JSON: {out[:300]}')
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        raise RuntimeError(f'mcporter bad JSON: {out[:300]}')


def collect_xhs():
    """小红书通道：关键词矩阵搜索 → 高赞笔记 → 详情。返回 (records, rate_limited)。"""
    records, seen, rate_limited = [], set(), False
    note_ids = {}
    for kw in KEYWORDS:
        try:
            res = mcporter_site_run('xiaohongshu/search', {'keyword': kw})
        except RuntimeError as e:
            if 'rate' in str(e).lower() or '风控' in str(e) or 'frequently' in str(e).lower():
                rate_limited = True
            log(f'  [warn] search "{kw}" 失败: {str(e)[:120]}')
            continue
        if not isinstance(res, dict) or 'notes' not in res:
            log(f'  [warn] search "{kw}" 无 notes: {str(res)[:150]}')
            continue
        for n in res['notes']:
            nid = n.get('note_id')
            if not nid:
                continue
            likes = n.get('likes') or '0'
            title = n.get('title') or ''
            hot = title and any(k in title for k in ('攻略', '避坑', '预算', '路线', '环线'))
            try:
                like_n = int(likes)
            except ValueError:
                like_n = 0
            if like_n >= MIN_LIKES or (like_n >= 50 and hot):
                note_ids.setdefault(nid, {'title': title, 'author': n.get('author', ''),
                                          'likes': likes, 'url': n.get('url', ''),
                                          'token': n.get('xsec_token', '')})
    log(f'  高赞候选: {len(note_ids)} 篇')

    # 拉详情（最多 MAX_NOTES 篇，按赞数排序取前 N）
    for nid in sorted(note_ids, key=lambda k: -int(note_ids[k]['likes'] or 0))[:MAX_NOTES]:
        meta = note_ids[nid]
        try:
            # 完整 URL 含 xsec_token，note adapter 要求
            full_url = meta['url']
            if not full_url and meta['token']:
                full_url = f"https://www.xiaohongshu.com/explore/{nid}?xsec_token={urllib.parse.quote(meta['token'])}"
            if not full_url:
                continue
            det = mcporter_site_run('xiaohongshu/note', {'note_id': full_url})
        except RuntimeError as e:
            log(f'  [warn] note {nid} 详情失败: {str(e)[:120]}')
            continue
        if not isinstance(det, dict) or not det.get('title'):
            continue
        rec = {
            'id': nid,
            'kind': 'xhs',
            'source': f"小红书 @{det.get('author', meta['author'])}",
            'source_trust': xhs_trust(det.get('likes') or meta['likes']),
            'url': det.get('url') or meta['url'],
            'title': det.get('title', ''),
            'desc': (det.get('desc') or '')[:2000],
            'tags': det.get('tags', []),
            'likes': det.get('likes') or meta['likes'],
            'comments': det.get('comments', ''),
            'collects': det.get('collects', ''),
            'author': det.get('author', ''),
            'collected_at': datetime.datetime.now().isoformat(timespec='seconds'),
        }
        records.append(rec)
        log(f'  ✓ {rec["source"]} | {rec["likes"]}赞 | {rec["title"][:40]}')
        time.sleep(1.5)  # 详情调用间隔，防风控
    return records, rate_limited


def so_search(q, max_results=5):
    """360 搜索（so.com）。2026-08-01 实测：DDG html 端在国内被重定向、Bing 区域乱跳，
    so.com 是国内可用且结果精准的 HTML 搜索端。返回 [(最终URL, title)]，跳转链自动解。
    """
    url = 'https://www.so.com/s?q=' + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        page = r.read().decode('utf-8', 'ignore')
    out = []
    for m in re.finditer(r'<h3[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*?data-mdurl="([^"]*)"[^>]*>(.*?)</a>', page, re.S):
        link, mdurl, title_html = m.group(1), m.group(2), m.group(3)
        u = mdurl or html.unescape(link)
        t = re.sub(r'<[^>]+>', '', title_html)
        if u.startswith('/s?'):  # 相关搜索链接，跳过
            continue
        final = u
        if 'so.com/link' in u:  # 无 data-mdurl 时才解跳转（通常 400，直接降级保留原链）
            try:
                req2 = urllib.request.Request(u, headers={'User-Agent': UA})
                with urllib.request.urlopen(req2, timeout=15) as r2:
                    final = r2.geturl()
            except Exception:
                pass
        out.append((final, html.unescape(t).strip()))
        if len(out) >= max_results:
            break
    return out


def web_trust(url):
    """网络信源 source_trust：官方 1.0 / 平台攻略 0.8 / 其他 0.6。"""
    u = url.lower()
    if any(x in u for x in ('.gov.cn', 'gov.cn')):
        return 1.0
    if any(x in u for x in ('mafengwo', 'ctrip', 'qyer', 'sina', '163.com', 'zhihu')):
        return 0.8
    return 0.6


def collect_web():
    """网络通道：360 搜索 + 抓页面文本。返回 records。"""
    records, seen = [], set()
    queries = ['喀纳斯 门票 区间车 价格', '禾木 门票 区间车', '五彩滩 门票 布尔津',
               '乌尔禾魔鬼城 门票 开放时间', '可可托海 门票 攻略', '北疆 喀纳斯 7天 环线 攻略']
    for q in queries:
        try:
            hits = so_search(q, 3)
        except Exception as e:
            log(f'  [warn] so.com "{q}" 失败: {str(e)[:100]}')
            continue
        for u, t in hits:
            if u in seen or not u.startswith('http'):
                continue
            seen.add(u)
            try:
                req = urllib.request.Request(u, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=20) as r:
                    raw = r.read().decode('utf-8', 'ignore')
                text = re.sub(r'<script[^>]*>.*?</script>', ' ', raw, flags=re.S)
                text = re.sub(r'<style[^>]*>.*?</style>', ' ', text, flags=re.S)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = html.unescape(re.sub(r'\s+', ' ', text)).strip()[:MAX_TEXT]
            except Exception as e:
                log(f'  [warn] 抓取 {u[:60]} 失败: {str(e)[:80]}')
                continue
            rec = {
                'id': u,
                'kind': 'web',
                'source': u,
                'source_trust': web_trust(u),
                'url': u,
                'title': t[:200],
                'text': text,
                'query': q,
                'collected_at': datetime.datetime.now().isoformat(timespec='seconds'),
            }
            records.append(rec)
            log(f'  ✓ web | trust={rec["source_trust"]} | {t[:50]}')
    return records


def main():
    os.makedirs(ARCHIVE, exist_ok=True)
    os.makedirs(DATA, exist_ok=True)
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    seen = load_seen()
    rate_limited = False

    log('=== 小红书通道 ===')
    xhs_records = []
    try:
        xhs_records, rate_limited = collect_xhs()
    except RuntimeError as e:
        log(f'[error] 小红书通道整体失败: {str(e)[:200]}')
        # 通道失败不算致命（网络通道可能成功），但若完全无数据则退出码 1

    log('=== 网络通道 ===')
    web_records = []
    try:
        web_records = collect_web()
    except Exception as e:
        log(f'[error] 网络通道失败: {str(e)[:200]}')

    # 落盘 archive
    if xhs_records:
        with open(os.path.join(ARCHIVE, f'{ts}_xhs.jsonl'), 'w', encoding='utf-8') as f:
            for r in xhs_records:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
    if web_records:
        with open(os.path.join(ARCHIVE, f'{ts}_web.jsonl'), 'w', encoding='utf-8') as f:
            for r in web_records:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')

    # 去重合并 master
    added = append_master(xhs_records + web_records, seen)
    save_seen(seen)

    log(f'=== 汇总: xhs={len(xhs_records)} web={len(web_records)} 新增={added} master总计={os.path.getsize(MASTER) if os.path.exists(MASTER) else 0}B ===')
    if rate_limited:
        log('[rate-limited] 小红书风控，下个 tick 自动重试')
        return 2
    if added == 0 and not xhs_records and not web_records:
        log('[no-data] 本 tick 无新数据（通道不可用）')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
