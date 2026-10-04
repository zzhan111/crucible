#!/usr/bin/env python3
"""v0.2：把 CSV 数据 + src/*.js + src/style.css + src/v2.css 内联成单文件 index.html（无网络依赖，可离线双击打开）。
用法：python3 build.py   → 生成 ./index.html（同时写一份 dist/index.html）"""
import csv, json, pathlib
ROOT = pathlib.Path(__file__).parent
rows = list(csv.DictReader(open(ROOT / 'data/sparrow_599.csv', encoding='utf-8-sig')))
data = []
for r in rows:
    price = float(r['零售价（元）']) if r['零售价（元）'].strip() else None
    shelf = int(r['保质期（天）']) if r['保质期（天）'].strip() else None
    data.append([r['包装编码'], r['SKU编码'], r['商品名称'], r['包装名称'], price, r['条码'],
                 shelf, r['来源'], r['备注'], r['正面照'] == '有', r['侧面照'] == '有', r['背面照'] == '有'])
data_js = 'window.__DATA__=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';'
css = '\n'.join((ROOT / 'src' / f).read_text(encoding='utf-8') for f in ['style.css', 'v2.css'])
# 顺序：数据/模型/通用组件/原有屏 → v0.2 屏 → v0.2 外壳 → 事件与启动（main.js 最后，首次 render 时所有函数都已定义）
JS = ['data.js', 'model.js', 'ui.js', 'screens.js', 'screens_v2.js', 'shell.js', 'main.js']
js = '\n'.join((ROOT / 'src' / f).read_text(encoding='utf-8') for f in JS)
tpl = (ROOT / 'src/template.html').read_text(encoding='utf-8')
out = tpl.replace('/*CSS*/', css).replace('/*DATA*/', data_js).replace('/*APP*/', js.replace('</script', '<\\/script'))
(ROOT / 'index.html').write_text(out, encoding='utf-8')
(ROOT / 'dist').mkdir(exist_ok=True)
(ROOT / 'dist/index.html').write_text(out, encoding='utf-8')
print('wrote index.html', len(out.encode()), 'bytes;', len(data), 'rows')
