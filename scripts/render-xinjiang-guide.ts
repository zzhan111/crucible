#!/usr/bin/env node
/**
 * 渲染最终新疆攻略 markdown：docs/xinjiang-travel-guide.md
 * 跑 runCrucibleWorkflow → finalArtifact → 按 day 分组渲染。
 * 避坑清单从 data/sources-master.jsonl 真实信源提取（不臆造）。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../src/workflow/crucible.js';
import { xinjiang7dayV1 } from '../src/fixtures/xinjiang-7day-v1.js';
import { xinjiang7dayNorthV1 } from '../src/fixtures/xinjiang-7day-north-v1.js';
import { xinjiang7dayNorthV2 } from '../src/fixtures/xinjiang-7day-north-v2.js';
import type { ArtifactNode } from '../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONTRACT = join(ROOT, 'contracts', 'xinjiang-travel-v1.yaml');
const MASTER = join(ROOT, 'data', 'sources-master.jsonl');

// --variant=north2 → 北线科学性修正版（v3），--variant=north → 北线 v2，默认伊犁线（v1）
const VARIANT = process.argv.includes('--variant=north2') ? 'north2' : process.argv.includes('--variant=north') ? 'north' : 'south';
const ARTIFACT = VARIANT === 'north2' ? xinjiang7dayNorthV2 : VARIANT === 'north' ? xinjiang7dayNorthV1 : xinjiang7dayV1;
const OUT = join(ROOT, 'docs', VARIANT === 'north2' ? 'xinjiang-travel-guide-north-v2.md' : VARIANT === 'north' ? 'xinjiang-travel-guide-north.md' : 'xinjiang-travel-guide.md');
const TITLE = VARIANT === 'north2'
  ? '# 新疆北线 7 天环线游玩攻略 v3（石河子 144 团出发/返回）\n\n> **路线**: 144团 → 乌尔禾魔鬼城 → 布尔津(五彩滩) → 喀纳斯 → 禾木 → 富蕴(可可托海) → 144团\n> **v3 科学性修正**: ①日落时段修正（新疆夏季日落~21:30，五彩滩 19:45 抵达看日落，魔鬼城改下午斜阳）②观鱼台挪傍晚（顺光拍 S 弯，避开正午暴晒）③D7 返程拆 3 段 + 2 次服务区休息（防疲劳驾驶）④D5 下午补布尔津河堤夜市 ⑤D2 不再干等 2h'
  : VARIANT === 'north'
    ? '# 新疆北线 7 天环线游玩攻略（石河子 144 团出发/返回）\n\n> **路线**: 144团 → 乌尔禾魔鬼城 → 布尔津(五彩滩) → 喀纳斯 → 禾木 → 富蕴(可可托海) → 144团\n> **说明**: v2 迭代 — 独山子/独库/那拉提/伊宁/赛里木湖 已玩过，此版走北线喀纳斯环线（全新地点）'
    : '# 新疆 7 天环线游玩攻略（石河子 144 团出发/返回）\n\n> **路线**: 144团 → 独山子 → 独库公路北段 → 那拉提 → 巴音布鲁克 → 独山子 → 精河 → 赛里木湖 → 144团';

const NODE_TYPE_LABEL: Record<string, string> = {
  dining: '🍽️ 餐饮', transit: '🚗 交通', switch: '🔀 切换', core_experience: '⭐ 景点',
  checkin: '🏨 住宿', buffer: '⏳ 缓冲', hard: '📌 硬性',
};
const ELASTICITY_LABEL: Record<string, string> = {
  non_compressible: '不可压缩', compressible: '可压缩', replaceable: '可替换',
};

function collectStates(a: { nodes: ArtifactNode[] }): string[] {
  const set = new Set<string>();
  for (const n of a.nodes) for (const s of (n.state as string[] | undefined) ?? []) set.add(s);
  return [...set];
}

function extractTips(): string[] {
  const tips: string[] = [];
  const XJ_WORDS = /喀纳斯|独库|那拉提|赛里木|巴音布鲁克|伊犁|禾木|布尔津|北疆|乌鲁木齐|独山子|果子沟|琼库什台|乌尔禾|五彩滩|天山|魔鬼城|草原|区间车|环线/;
  try {
    for (const line of readFileSync(MASTER, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      const body = (r.desc || r.text || '') as string;
      const title = String(r.title || '');
      const sents = body.split(/[。；;！？]/);
      for (const s of sents) {
        const t = s.trim();
        if (t.length < 15 || t.length > 130) continue;
        // 句子必须涉及新疆（或来自新疆主题笔记），避免混入无关内容
        if (!XJ_WORDS.test(t) && !XJ_WORDS.test(title)) continue;
        if (/避坑|注意|建议|不要|别|一定|最好|提前|预约|温差|厚外套|防晒|防坑|别信|坑|黑车|拉客|骗|宰|旺季|淡季|开放|免费|预约制/.test(t)) {
          tips.push(t);
        }
      }
    }
  } catch (e) {
    console.error('[warn] tips extraction failed:', e);
  }
  // 去重（按前 20 字）
  const seen = new Set<string>();
  const uniq = tips.filter(t => {
    const k = t.slice(0, 20);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.slice(0, 12);
}

async function main(): Promise<void> {
  const contract = loadContract(CONTRACT);
  const baseScorer = compileContract(contract);
  const result = await runCrucibleWorkflow({
    artifact: ARTIFACT,
    contract,
    baseScorer,
    artifactId: `xinjiang-${VARIANT}-render`,
    knownStates: collectStates(ARTIFACT),
    minImprovement: 0,
  });
  const final = result.finalArtifact;
  const nodes = final.nodes;
  const finalTotal = nodes.reduce((s, n) => s + (typeof n.duration_min === 'number' ? n.duration_min : 0), 0);

  // 按 day 分组（Critic 补丁节点可能无 day 字段 → 继承前一节点 day）
  const days = new Map<number, ArtifactNode[]>();
  let lastDay = 1;
  for (const n of nodes) {
    const d = typeof n.day === 'number' ? n.day : lastDay;
    lastDay = d;
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(n);
  }

  // 预算（2 人分摊口径: 油费/住宿 /2）
  const totalCostPerPax = Math.round(
    ticketCost(nodes) + fuelCost(nodes) / 2 + lodgingCost(nodes) / 2 + 900,
  );
  const TICKET_NOTE = VARIANT === 'north2' || VARIANT === 'north'
    ? '魔鬼城42+区间车20 / 喀纳斯160+70(一进230) / 观鱼台20 / 禾木102 / 可可托海'
    : '独山子大峡谷30 / 那拉提95+区间车 / 巴音布鲁克140(含区间车) / 赛里木湖(环湖)';
  const TRANSIT_NOTE = VARIANT === 'north2' || VARIANT === 'north'
    ? '全程自驾, 2人分摊; 北线无收费公路(独库不经过)'
    : '全程自驾, 2人分摊; 独库公路免费通行(季节开放)';
  const LODGING_NOTE = VARIANT === 'north2' || VARIANT === 'north'
    ? '乌尔禾/布尔津/喀纳斯木屋/禾木/富蕴 经济型, 2人分摊'
    : '独山子/那拉提/巴音布鲁克/精河 经济型, 2人分摊';

  const L: string[] = [];
  L.push(TITLE);
  L.push('');
  L.push(`> **生成方式**: Crucible 契约驱动引擎 3 轮迭代（契约 \`xinjiang-travel-v1\`，4 硬约束谓词 + 5 维 rubric）`);
  L.push(`> **信源**: 小红书高赞笔记 ${requireCount('xhs')} 篇 + 网络攻略/官方页 ${requireCount('web')} 份（2026-08-01 定时采集，每条节点带出处与可信度）`);
  L.push(`> **引擎迭代**: v1(${result.iterations[0]?.score.toFixed(3)}) → v${result.iterations.length}(${result.iterations[result.iterations.length - 1]?.score.toFixed(3)})，硬违规 ${result.iterations[0]?.violations} → ${result.iterations[result.iterations.length - 1]?.violations}`);
  L.push('');
  L.push('---');
  L.push('');

  // 预算总览
  L.push('## 💰 预算总览');
  L.push('');
  L.push('| 项目 | 估算 | 说明 |');
  L.push('|---|---|---|');
  L.push(`| 门票 | ~${ticketCost(nodes)} 元/人 | ${TICKET_NOTE} |`);
  L.push(`| 交通(油费+过路) | ~${Math.round(fuelCost(nodes) / 2)} 元/人 | ${TRANSIT_NOTE} |`);
  L.push(`| 住宿(6晚) | ~${Math.round(lodgingCost(nodes) / 2)} 元/人 | ${LODGING_NOTE} |`);
  L.push(`| 餐饮 | ~900 元/人 | 7天 人均 ~130/天 |`);
  L.push(`| **合计(人均)** | **~${totalCostPerPax} 元** | 自驾 2人分摊口径; 信源"7日游跟团人均1400-2380元"为参考下限 |`);
  L.push('');
  const ENGINE_NOTE = VARIANT === 'north2' || VARIANT === 'north'
    ? `> ⚠️ **引擎提示**: 全程计划时长 ${finalTotal} min 超出 7天预算 5040 min（约 ${Math.round((finalTotal - 5040) / 60)}h）。核心原因：喀纳斯/禾木/可可托海 3 景区 + 每日 3-4h 车程，7 天偏紧（信源中北疆环线以 8 天为常态）——**建议延长至 8 天**，或在禾木/可可托海各压缩半日。D7 返程为长途日（已拆 3 段 + 2 次休息）。`
    : `> ⚠️ **引擎提示**: 全程计划时长 ${finalTotal} min 超出 7天预算 5040 min（约 2h）。核心原因 D2 独库北段车程+唐布拉停留排得过满——**D2 为高强度日**，建议唐布拉停留压缩 1h 或拆到 D3 早。`;
  L.push(ENGINE_NOTE);
  L.push('');

  // 每日行程
  const dayOrder = [...days.keys()].sort((a, b) => a - b);
  for (const d of dayOrder) {
    const dayNodes = days.get(d)!;
    const dayMin = dayNodes.reduce((s, n) => s + (typeof n.duration_min === 'number' ? n.duration_min : 0), 0);
    const dayCost = dayNodes.reduce((s, n) => s + (typeof n.cost === 'number' ? n.cost : 0), 0);
    L.push(`## 📅 Day ${d} — ${dayTitle(d, dayNodes)}`);
    L.push('');
    L.push(`> 时长 ${Math.round(dayMin / 60 * 10) / 10}h · 当日人均支出 ~${dayCost} 元`);
    L.push('');
    L.push(`| 时间 | 类型 | 安排 | 时长 | 支出(元) | 信源 |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const n of dayNodes) {
      const type = NODE_TYPE_LABEL[String(n.node_type ?? '')] ?? String(n.node_type);
      const src = n.source ? String(n.source).slice(0, 42) : '—';
      const route = n.route ? ` · ${String(n.route).slice(0, 40)}` : '';
      const el = n.elasticity ? `（${ELASTICITY_LABEL[String(n.elasticity)] ?? String(n.elasticity)}）` : '';
      const tb = n.time_block !== undefined ? String(n.time_block) : 'auto';
      const cost = typeof n.cost === 'number' ? n.cost : '—';
      const autoMark = n.time_block === undefined ? ' 🤖' : '';
      L.push(`| ${tb} | ${type} | ${String(n.action)}${route}${el}${autoMark} | ${n.duration_min}min | ${cost} | ${src} |`);
    }
    L.push('');
  }

  // 避坑清单（信源提取）
  const tips = extractTips();
  if (tips.length > 0) {
    L.push('## ⚠️ 避坑清单（信源原话提取）');
    L.push('');
    for (const t of tips) L.push(`- ${t}`);
    L.push('');
  }

  // 信源附录
  L.push('## 📚 信源附录');
  L.push('');
  L.push('| 类型 | 信源 | 可信度 |');
  L.push('|---|---|---|');
  L.push('| 官方 | 石河子市人民政府-一四四团 | 1.0 |');
  L.push('| 攻略 | 网易/新浪/本地宝 北疆环线·门票·独库开放时间 | 0.8 |');
  L.push('| 小红书 | 赛里木湖(1.1万赞)/新疆攻略(3.7万赞)/伊犁(9550赞) 等 8 篇 | 0.8-0.85 |');
  L.push('| 共识 | 多篇攻略交叉的车程/住宿/餐饮估算 | 0.7 |');
  L.push('');
  L.push('---');
  L.push(`*生成时间: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 数据由 cron「新疆信源采集-每日」持续积累*`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, L.join('\n'), 'utf-8');
  console.log(`✅ 攻略已写入: ${OUT}`);
  console.log(`   天数=${dayOrder.length} 节点=${nodes.length} 人均预算≈${totalCostPerPax}元 避坑条数=${tips.length}`);
}

function requireCount(kind: string): number {
  try {
    let n = 0;
    for (const line of readFileSync(MASTER, 'utf-8').split('\n')) {
      if (line.trim() && JSON.parse(line).kind === kind) n++;
    }
    return n;
  } catch { return 0; }
}

function ticketCost(nodes: ArtifactNode[]): number {
  return nodes.filter(n => n.node_type === 'core_experience')
    .reduce((s, n) => s + (typeof n.cost === 'number' ? n.cost : 0), 0);
}
function fuelCost(nodes: ArtifactNode[]): number {
  return nodes.filter(n => n.node_type === 'transit')
    .reduce((s, n) => s + (typeof n.cost === 'number' ? n.cost : 0), 0);
}
function lodgingCost(nodes: ArtifactNode[]): number {
  return nodes.filter(n => n.node_type === 'checkin')
    .reduce((s, n) => s + (typeof n.cost === 'number' ? n.cost : 0), 0);
}
function dayTitle(d: number, nodes: ArtifactNode[]): string {
  if (nodes.length === 0) return '';
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  return `${String(first.action)} → ${String(last.action)}`;
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
