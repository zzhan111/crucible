import type { Artifact } from '../predicates/types.js';

/**
 * 香港 3 天黄金片段(Day 1 上午,简化版)。
 * 来源:q-traveller §6.3 节点 JSON 结构 + §7 主线"早餐→地铁→龙脊"。
 * 这版无 bug:每对相邻节点有 transit/switch,state 无互斥/重复,时间不超。
 */
export const hk3dayGolden: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 960,
    budget: { min: 0, max: 800 },
  },
  nodes: [
    {
      time_block: '08:00-08:30',
      action: '早餐 茶餐厅',
      route: '酒店 → 油麻地茶餐厅',
      duration_min: 30,
      node_type: 'dining',
      elasticity: 'compressible',
      cost: 50,
      source: '小红书 v1 笔记',
      source_trust: 0.85,
      state: ['at_hotel'],
    },
    {
      time_block: '08:30-09:00',
      action: '步行至油麻地地铁站 + 港铁至筲箕湾',
      route: '油麻地 → 筲箕湾站 A2',
      duration_min: 30,
      node_type: 'transit',
      elasticity: 'non_compressible',
      cost: 15,
      source: 'MTR 官方',
      source_trust: 1.0,
      state: [],
    },
    {
      time_block: '09:00-09:15',
      action: '筲箕湾站 A2 出口 → 9 号巴士总站',
      route: '筲箕湾站 A2 → 巴士总站',
      duration_min: 15,
      node_type: 'switch',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'hkbus9.html',
      source_trust: 0.9,
      state: [],
    },
    {
      time_block: '09:15-09:30',
      action: '9 号巴士至土地湾',
      route: '筲箕湾巴士总站 → 土地湾',
      duration_min: 15,
      node_type: 'transit',
      elasticity: 'non_compressible',
      cost: 6,
      source: 'hkbus9.html',
      source_trust: 0.9,
      state: [],
    },
    {
      time_block: '09:30-11:30',
      action: '龙脊徒步精华段',
      route: '土地湾 → 大潭峡',
      duration_min: 120,
      node_type: 'core_experience',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'dhk_dragonback_zh.html',
      source_trust: 0.95,
      state: ['hiking'],
    },
  ],
};
