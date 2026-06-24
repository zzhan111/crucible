import type { Artifact } from '../predicates/types.js';

/**
 * 香港 3 天 buggy 版本(Day 1 上午)。
 * 基于 hk3dayGolden,故意注入 3 个真实 bug(对应 q-traveller §7 三段式 demo):
 *
 * Bug 1 (continuity): 节点 0(dining) → 节点 1(core_experience),
 *   两个都不是 bridge,缺 transit/switch。对应"早餐后→地铁缺切换"。
 *
 * Bug 2 (state_mutex): 节点 0 同时持有 luggage_drop 和 depart_from_hotel。
 *   对应"寄存行李与从酒店出发状态互斥重复"。
 *
 * Bug 3 (no_duplicate_state): 节点 0 和节点 1 都持有 at_hotel,中间无 clearing。
 *   对应"状态重复"。
 *
 * 共 3 个 hard violation(1 continuity + 1 mutex + 1 duplicate)。
 */
export const hk3dayBuggy: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 960,
    budget: { min: 0, max: 800 },
  },
  nodes: [
    {
      time_block: '08:00-08:30',
      action: '早餐 茶餐厅 + 寄存行李',
      route: '酒店 → 油麻地茶餐厅',
      duration_min: 30,
      node_type: 'dining',
      elasticity: 'compressible',
      cost: 50,
      source: '小红书 v1 笔记',
      source_trust: 0.85,
      state: ['at_hotel', 'luggage_drop', 'depart_from_hotel'], // Bug 2: mutex 同节点 + Bug 3 起点
    },
    {
      // Bug 1: dining 直接接 core_experience,中间无 transit/switch
      // Bug 3: at_hotel 与节点 0 重复,无 clearing transition
      time_block: '08:30-11:30',
      action: '龙脊徒步精华段',
      route: '土地湾 → 大潭峡',
      duration_min: 180,
      node_type: 'core_experience',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'dhk_dragonback_zh.html',
      source_trust: 0.95,
      state: ['at_hotel', 'hiking'],
    },
  ],
};
