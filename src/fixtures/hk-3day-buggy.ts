import type { Artifact } from '../predicates/types.js';

/**
 * 香港 3 天 buggy 版本(Day 1 上午)。
 * P1 重做:bug 贴近 q-traveller §7 真实场景。
 *
 * Bug 1 (continuity): 节点 0(dining) → 节点 1(core_experience),
 *   缺 transit/switch。对应"早餐后→地铁缺切换"。
 *
 * Bug 2 (state_mutex): 节点 0 持有 luggage_drop,节点 1 持有 depart_from_hotel,
 *   相邻节点互斥,中间无 clearing。对应"寄存行李与从酒店出发互斥重复"(P1 升级:真实场景)。
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
      // Bug 2: 持有 luggage_drop(相邻节点 1 持有 depart_from_hotel → 互斥)
      // Bug 3: 持有 at_hotel(节点 1 也持有 → 重复)
      state: ['at_hotel', 'luggage_drop'],
    },
    {
      // Bug 1: dining 直接接 core_experience,中间无 transit/switch
      // Bug 2: 持有 depart_from_hotel(与节点 0 的 luggage_drop 相邻互斥)
      // Bug 3: 持有 at_hotel(与节点 0 重复)
      time_block: '08:30-11:30',
      action: '龙脊徒步精华段',
      route: '土地湾 → 大潭峡',
      duration_min: 180,
      node_type: 'core_experience',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'dhk_dragonback_zh.html',
      source_trust: 0.95,
      state: ['at_hotel', 'depart_from_hotel', 'hiking'],
    },
  ],
};
