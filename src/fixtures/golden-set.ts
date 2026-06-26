import type { Artifact } from '../predicates/types.js';

/**
 * P1 冻结黄金集(§2.3):8 个工件,覆盖 3 区域 + 3 质量梯度。
 *
 * 来源:q-traveller 种子(香港 3 + 云南 3 + 防城港 2),综合提炼。
 * 黄金集永不进 few-shot,只用于 judge 校准回归(P1 §2.4 Kendall τ)。
 *
 * 质量梯度设计(供人类排序参考):
 * - high: 零硬违规 + 高 source_trust + 时间/预算合理 + 动线流畅
 * - mid:  零硬违规但 source_trust 偏低 / 时间偏紧 / 动线有小折返
 * - low:  有 1 个软性问题(如节点过少/餐饮缺失/来源单一),但无硬违规
 *
 * 注:黄金集工件本身无硬违规(否则不能当校准基线)。
 * 质量差异体现在 judge 维度(routing/memorability/dining_fit)上,
 * 这样 judge 校准才有意义——区分"无硬违规"工件间的细微优劣。
 */

// ─── 香港 3 天(3 个)──────────────────────────────────────────

/** HK-A:高质量。完整动线,来源多元,时间充裕。 */
export const hkA: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    {
      time_block: '08:00-08:30', action: '早餐 茶餐厅', route: '酒店 → 油麻地茶餐厅',
      duration_min: 30, node_type: 'dining', elasticity: 'compressible',
      cost: 50, source: '小红书 v1 笔记', source_trust: 0.85, state: ['at_hotel'],
    },
    {
      time_block: '08:30-09:00', action: '港铁至筲箕湾', route: '油麻地 → 筲箕湾站 A2',
      duration_min: 30, node_type: 'transit', elasticity: 'non_compressible',
      cost: 15, source: 'MTR 官方', source_trust: 1.0, state: [],
    },
    {
      time_block: '09:00-09:15', action: '站 A2 出口 → 9 号巴士总站', route: '筲箕湾站 A2 → 巴士总站',
      duration_min: 15, node_type: 'switch', elasticity: 'non_compressible',
      cost: 0, source: 'hkbus9.html', source_trust: 0.9, state: [],
    },
    {
      time_block: '09:15-09:30', action: '9 号巴士至土地湾', route: '筲箕湾巴士总站 → 土地湾',
      duration_min: 15, node_type: 'transit', elasticity: 'non_compressible',
      cost: 6, source: 'hkbus9.html', source_trust: 0.9, state: [],
    },
    {
      time_block: '09:30-11:30', action: '龙脊徒步精华段', route: '土地湾 → 大潭峡',
      duration_min: 120, node_type: 'core_experience', elasticity: 'non_compressible',
      cost: 0, source: 'dhk_dragonback_zh.html', source_trust: 0.95, state: ['hiking'],
    },
  ],
};

/** HK-B:中等质量。无硬违规,但 source_trust 普遍偏低(来源单一)。 */
export const hkB: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    {
      time_block: '09:00-09:30', action: '早餐 便利店', route: '酒店 → 7-11',
      duration_min: 30, node_type: 'dining', elasticity: 'compressible',
      cost: 30, source: '网友推荐', source_trust: 0.4, state: ['at_hotel'],
    },
    {
      time_block: '09:30-10:00', action: '打车至土地湾', route: '酒店 → 土地湾',
      duration_min: 30, node_type: 'transit', elasticity: 'non_compressible',
      cost: 200, source: '网友推荐', source_trust: 0.4, state: [],
    },
    {
      time_block: '10:00-12:00', action: '龙脊徒步', route: '土地湾 → 大潭峡',
      duration_min: 120, node_type: 'core_experience', elasticity: 'non_compressible',
      cost: 0, source: '网友推荐', source_trust: 0.4, state: ['hiking'],
    },
  ],
};

/** HK-C:低质量。无硬违规但动线折返(先东后西),记忆点弱,餐饮缺失。 */
export const hkC: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    {
      time_block: '08:00-09:00', action: '打车去大澳渔村(西)', route: '酒店 → 大澳',
      duration_min: 60, node_type: 'transit', elasticity: 'non_compressible',
      cost: 350, source: '随机攻略', source_trust: 0.3, state: ['at_hotel'],
    },
    {
      time_block: '09:00-11:00', action: '大澳闲逛', route: '大澳村内',
      duration_min: 120, node_type: 'core_experience', elasticity: 'replaceable',
      cost: 0, source: '随机攻略', source_trust: 0.3, state: [],
    },
    {
      time_block: '11:00-12:30', action: '打车回筲箕湾(东)', route: '大澳 → 筲箕湾',
      duration_min: 90, node_type: 'transit', elasticity: 'non_compressible',
      cost: 400, source: '随机攻略', source_trust: 0.3, state: [],
    },
    {
      time_block: '12:30-14:00', action: '龙脊徒步', route: '土地湾 → 大潭峡',
      duration_min: 90, node_type: 'core_experience', elasticity: 'non_compressible',
      cost: 0, source: '随机攻略', source_trust: 0.3, state: ['hiking'],
    },
  ],
};

// ─── 云南(3 个)─────────────────────────────────────────────

/** YN-A:高质量。大理古城 + 苍山,来源多元,动线顺。 */
export const ynA: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 600 } },
  nodes: [
    {
      time_block: '08:00-08:40', action: '早餐 喜洲粑粑', route: '客栈 → 喜洲早市',
      duration_min: 40, node_type: 'dining', elasticity: 'compressible',
      cost: 15, source: '大理本地攻略 v2', source_trust: 0.8, state: ['at_hotel'],
    },
    {
      time_block: '08:40-09:30', action: '中巴至苍山感通索道', route: '喜洲 → 感通索道',
      duration_min: 50, node_type: 'transit', elasticity: 'non_compressible',
      cost: 20, source: '大理交通官方', source_trust: 0.9, state: [],
    },
    {
      time_block: '09:30-09:45', action: '索道换乘', route: '感通索道站 → 入口',
      duration_min: 15, node_type: 'switch', elasticity: 'non_compressible',
      cost: 0, source: '苍山景区官方', source_trust: 0.95, state: [],
    },
    {
      time_block: '09:45-13:00', action: '苍山玉带云游路徒步', route: '感通 → 七龙女池',
      duration_min: 195, node_type: 'core_experience', elasticity: 'non_compressible',
      cost: 30, source: '苍山景区官方', source_trust: 0.95, state: ['hiking'],
    },
  ],
};

/** YN-B:中等质量。丽江古镇,无硬违规但餐饮少 + 时间偏松。 */
export const ynB: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 600 } },
  nodes: [
    {
      time_block: '10:00-10:30', action: '客栈出发至古镇', route: '客栈 → 丽江大研古城',
      duration_min: 30, node_type: 'transit', elasticity: 'non_compressible',
      cost: 10, source: '客栈老板', source_trust: 0.5, state: ['at_hotel'],
    },
    {
      time_block: '10:30-14:00', action: '古城闲逛 + 木府', route: '古城内',
      duration_min: 210, node_type: 'core_experience', elasticity: 'compressible',
      cost: 60, source: '客栈老板', source_trust: 0.5, state: [],
    },
  ],
};

/** YN-C:低质量。香格里拉,无硬违规但单点停留过久,动线单调。 */
export const ynC: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 600 } },
  nodes: [
    {
      time_block: '09:00-09:30', action: '早餐 客栈', route: '客栈',
      duration_min: 30, node_type: 'dining', elasticity: 'compressible',
      cost: 20, source: '某游记', source_trust: 0.35, state: ['at_hotel'],
    },
    {
      time_block: '09:30-10:00', action: '步行至松赞林寺', route: '客栈 → 松赞林寺',
      duration_min: 30, node_type: 'transit', elasticity: 'non_compressible',
      cost: 0, source: '某游记', source_trust: 0.35, state: [],
    },
    {
      time_block: '10:00-16:00', action: '松赞林寺 + 周边闲坐', route: '松赞林寺',
      duration_min: 360, node_type: 'core_experience', elasticity: 'replaceable',
      cost: 115, source: '某游记', source_trust: 0.35, state: [],
    },
  ],
};

// ─── 防城港(2 个)──────────────────────────────────────────

/** FC-A:高质量。海滩动线,来源较好。 */
export const fcA: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 500 } },
  nodes: [
    {
      time_block: '08:00-08:30', action: '早餐 海鲜粉', route: '酒店 → 白龙市场',
      duration_min: 30, node_type: 'dining', elasticity: 'compressible',
      cost: 25, source: '防城港攻略 v3', source_trust: 0.75, state: ['at_hotel'],
    },
    {
      time_block: '08:30-09:00', action: '中巴至白龙半岛', route: '市区 → 白龙半岛',
      duration_min: 30, node_type: 'transit', elasticity: 'non_compressible',
      cost: 15, source: '防城港交通', source_trust: 0.8, state: [],
    },
    {
      time_block: '09:00-12:00', action: '白龙半岛海滩漫步 + 礁石赶海', route: '白龙半岛海岸',
      duration_min: 180, node_type: 'core_experience', elasticity: 'compressible',
      cost: 0, source: '防城港攻略 v3', source_trust: 0.75, state: ['beach'],
    },
  ],
};

/** FC-B:低质量。无硬违规但来源单一 + 餐饮缺失 + 时间过短。 */
export const fcB: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 500 } },
  nodes: [
    {
      time_block: '10:00-10:20', action: '打车去怪石滩', route: '酒店 → 怪石滩',
      duration_min: 20, node_type: 'transit', elasticity: 'non_compressible',
      cost: 80, source: '朋友圈', source_trust: 0.25, state: ['at_hotel'],
    },
    {
      time_block: '10:20-11:20', action: '怪石滩拍照', route: '怪石滩',
      duration_min: 60, node_type: 'core_experience', elasticity: 'replaceable',
      cost: 0, source: '朋友圈', source_trust: 0.25, state: ['beach'],
    },
  ],
};

/** 黄金集全部工件(带 ID + 质量梯度),共 8 个。 */
export const GOLDEN_ARTIFACTS = [
  { id: 'hk-a', region: 'hongkong' as const, quality_tier: 'high' as const, artifact: hkA },
  { id: 'hk-b', region: 'hongkong' as const, quality_tier: 'mid' as const, artifact: hkB },
  { id: 'hk-c', region: 'hongkong' as const, quality_tier: 'low' as const, artifact: hkC },
  { id: 'yn-a', region: 'yunnan' as const, quality_tier: 'high' as const, artifact: ynA },
  { id: 'yn-b', region: 'yunnan' as const, quality_tier: 'mid' as const, artifact: ynB },
  { id: 'yn-c', region: 'yunnan' as const, quality_tier: 'low' as const, artifact: ynC },
  { id: 'fc-a', region: 'fangchenggang' as const, quality_tier: 'high' as const, artifact: fcA },
  { id: 'fc-b', region: 'fangchenggang' as const, quality_tier: 'low' as const, artifact: fcB },
];
