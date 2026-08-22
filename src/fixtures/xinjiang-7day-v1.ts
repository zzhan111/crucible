import type { Artifact } from '../predicates/types.js';

/**
 * 新疆 7 天环线 v1（buggy）— 石河子 144 团出发/返回闭环。
 *
 * 信源（2026-08-01 采集，data/sources-master.jsonl）:
 *   - 独库公路: 独山子→库车 561km, 季节开放（本地宝）trust 0.6
 *   - 独山子大峡谷 门票30元（网易攻略, 《飞驰人生》取景地）trust 0.8
 *   - 那拉提草原 门票95元（网易/携程）trust 0.8
 *   - 巴音布鲁克 门票140含区间车, 九曲日落留2h, 带厚外套（网易）trust 0.8
 *   - 赛里木湖（小红书 1.1万赞笔记 + 攻略车程）trust 0.85
 *   - 车程估算 = 攻略共识（高德/多篇攻略交叉）trust 0.7
 *
 * continuity 语义: 每对相邻节点必须有一方是 transit/switch（桥）。
 * 埋 3 个真实违规（引擎应抓出并 patch）:
 *   1. time_budget: 全程 sum=5100 > 5040（7天×12h 预算; D2 独库车程 6h 为低估）
 *   2. continuity: D4 九曲日落(core_experience) → 回酒店(checkin) 之间无桥
 *   3. no_duplicate_state: D5 连续两个 transit 节点都持 in_transit, 无 switch/buffer 清除
 */
export const xinjiang7dayV1: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 5040, // 7天 × 12h 合理预算
    budget: { min: 0, max: 8000 },
  },
  nodes: [
    // ── D1: 144团 → 独山子（715min）──
    { time_block: '07:00-08:00', action: '早餐 144团', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: ['at_144'] , day: 1},
    { time_block: '08:00-09:30', action: '自驾 S115/连霍 至独山子', route: '144团 → 独山子', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(车程约1.5h)', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '09:30-12:00', action: '独山子大峡谷 观景+悬崖秋千', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 80, source: '网易攻略: 门票30元, 悬崖秋千50元/次', source_trust: 0.8, state: [] , day: 1},
    { time_block: '12:00-12:30', action: '返回独山子城区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '12:30-13:30', action: '午餐 独山子', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: '13:30-13:45', action: '回酒店', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '13:45-14:45', action: '入住酒店 休整', duration_min: 60, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 1},
    { time_block: '14:45-15:15', action: '休息切换', duration_min: 30, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: '15:15-17:45', action: '独山子城区漫步/备物资', duration_min: 150, node_type: 'core_experience', elasticity: 'replaceable', cost: 50, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: '17:45-18:00', action: '回酒店', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '18:00-19:00', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: '19:00-19:15', action: '晚间休整/过夜', duration_min: 15, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},

    // ── D2: 独库北段 → 那拉提（1080min, 车程低估致超预算）──
    { time_block: '07:00-08:00', action: '早餐 + 出发准备', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '08:00-14:00', action: '独库公路北段 自驾', route: '独山子 → 乔尔玛(独库北段)', duration_min: 360, node_type: 'transit', elasticity: 'non_compressible', cost: 200, source: '本地宝: 独库公路季节开放, 全程561km', source_trust: 0.6, state: ['in_transit'] , day: 2},
    { time_block: '14:00-16:30', action: '乔尔玛 观景+烈士陵园', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 30, source: '攻略共识(独库沿途景观)', source_trust: 0.7, state: [] , day: 2},
    { time_block: '16:30-17:30', action: '唐布拉百里画廊 往返', route: '乔尔玛 → 唐布拉', duration_min: 60, node_type: 'transit', elasticity: 'non_compressible', cost: 60, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '17:30-19:00', action: '唐布拉百里画廊', duration_min: 90, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略共识(独库沿途景观)', source_trust: 0.7, state: [] , day: 2},
    { time_block: '19:00-19:30', action: '返回乔尔玛', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 30, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '19:30-20:30', action: '晚餐 乔尔玛', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '20:30-23:00', action: '乔尔玛 → 那拉提', route: '乔尔玛 → 那拉提镇', duration_min: 150, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约2.5h车程)', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '23:00-23:30', action: '那拉提 入住', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 2},
    { time_block: '23:30-23:40', action: '放行李/休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '23:40-00:40', action: '宵夜', duration_min: 60, node_type: 'dining', elasticity: 'replaceable', cost: 60, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '00:40-00:50', action: '晚间休整/过夜', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},

    // ── D3: 那拉提草原全天（690min）──
    { time_block: '08:00-09:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},
    { time_block: '09:00-09:40', action: '区间车 至空中草原', duration_min: 40, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '那拉提门票95含区间车(携程)', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '09:40-12:10', action: '空中草原 徒步', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '网易/携程: 那拉提门票95元', source_trust: 0.8, state: [] , day: 3},
    { time_block: '12:10-12:40', action: '草原间换乘', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '那拉提景区区间车', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '12:40-15:40', action: '河谷草原 徒步/骑马', duration_min: 180, node_type: 'core_experience', elasticity: 'compressible', cost: 150, source: '攻略共识(那拉提河谷草原)', source_trust: 0.7, state: [] , day: 3},
    { time_block: '15:40-16:20', action: '区间车 返游客中心', duration_min: 40, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '那拉提景区区间车', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '16:20-17:20', action: '午餐(晚) 景区外', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 70, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},
    { time_block: '17:20-17:35', action: '回酒店', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 3},
    { time_block: '17:35-18:35', action: '休整', duration_min: 60, node_type: 'checkin', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 3},
    { time_block: '18:35-18:45', action: '换衣/休整切换', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},
    { time_block: '18:45-19:45', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},
    { time_block: '19:45-20:00', action: '晚间休整/过夜', duration_min: 15, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},

    // ── D4: 巴音布鲁克（870min, 尾处缺桥）──
    { time_block: '08:00-09:00', action: '早餐 + 退房', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: '09:00-12:00', action: '那拉提 → 巴音布鲁克', route: '那拉提 → 巴音布鲁克镇', duration_min: 180, node_type: 'transit', elasticity: 'non_compressible', cost: 120, source: '攻略共识(约3h车程)', source_trust: 0.7, state: ['in_transit'] , day: 4},
    { time_block: '12:00-13:00', action: '午餐 巴音布鲁克镇', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: '13:00-13:30', action: '游客中心 → 天鹅湖(区间车)', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '网易: 巴音布鲁克门票140含区间车', source_trust: 0.8, state: ['in_transit'] , day: 4},
    { time_block: '13:30-17:30', action: '天鹅湖 湿地观鸟', duration_min: 240, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '网易: 门票140元/人(含区间车)', source_trust: 0.8, state: [] , day: 4},
    { time_block: '17:30-18:00', action: '天鹅湖 → 九曲观景台(区间车)', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '景区区间车', source_trust: 0.8, state: ['in_transit'] , day: 4},
    { time_block: '18:00-22:00', action: '九曲十八弯 等日落+拍摄', duration_min: 240, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: '网易: 落日要预留2小时, 带厚外套', source_trust: 0.8, state: [] , day: 4},
    { time_block: '22:00-23:00', action: '回酒店（缺区间车/交通节点）', duration_min: 60, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 4},
    { time_block: '23:00-23:10', action: '晚间休整/过夜', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},

    // ── D5: 巴音布鲁克 → 独山子 → 精河（630min, 连续 in_transit 无清除）──
    { time_block: '07:00-08:00', action: '早餐 + 出发', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: '08:00-11:00', action: '巴音布鲁克 → 乔尔玛', route: '巴音布鲁克 → 乔尔玛(独库北段)', duration_min: 180, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(独库北段原路)', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '11:00-13:00', action: '乔尔玛 → 独山子', route: '乔尔玛 → 独山子', duration_min: 120, node_type: 'transit', elasticity: 'non_compressible', cost: 130, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '13:00-14:00', action: '午餐 独山子', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: '14:00-15:30', action: '独山子 → 精河', route: '独山子 → 精河(G30)', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 100, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '15:30-16:30', action: '精河 入住', duration_min: 60, node_type: 'checkin', elasticity: 'compressible', cost: 280, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 5},
    { time_block: '16:30-16:40', action: '房间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: '16:40-17:40', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: '17:40-17:50', action: '晚间休整/过夜', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},

    // ── D6: 赛里木湖环湖（750min）──
    { time_block: '08:00-09:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: '09:00-10:30', action: '精河 → 赛里木湖', route: '精河 → 赛里木湖(G30)', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 80, source: '网易: 乌市→赛里木湖约6h(精河方向更近)', source_trust: 0.8, state: ['in_transit'] , day: 6},
    { time_block: '10:30-16:30', action: '赛里木湖 环湖+拍照', duration_min: 360, node_type: 'core_experience', elasticity: 'compressible', cost: 145, source: '小红书1.1万赞: "有一种蓝叫赛里木湖蓝"', source_trust: 0.85, state: [] , day: 6},
    { time_block: '16:30-17:00', action: '景区内换乘', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '景区区间车', source_trust: 0.8, state: ['in_transit'] , day: 6},
    { time_block: '17:00-18:00', action: '补给/下午餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 70, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: '18:00-19:30', action: '赛里木湖 → 精河', route: '赛里木湖 → 精河', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 6},
    { time_block: '19:30-20:30', action: '精河 休整', duration_min: 60, node_type: 'checkin', elasticity: 'compressible', cost: 280, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 6},
    { time_block: '20:30-20:40', action: '房间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: '20:40-21:40', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: '21:40-21:50', action: '晚间休整/过夜', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},

    // ── D7: 返程 144团（240min）──
    { time_block: '08:00-09:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 7},
    { time_block: '09:00-11:00', action: '精河 → 144团', route: '精河 → 石河子144团(G30→S115)', duration_min: 120, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约2h车程)', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '11:00-12:00', action: '抵达 144团, 行程总结', duration_min: 60, node_type: 'buffer', elasticity: 'replaceable', cost: 0, source: '攻略共识', source_trust: 0.7, state: ['at_144'] , day: 7},
  ],
};

/** 全程 duration_min 总和（供脚本打印核对）。 */
export const xinjiang7dayV1TotalMinutes = xinjiang7dayV1.nodes.reduce(
  (sum, n) => sum + (typeof n.duration_min === 'number' ? n.duration_min : 0),
  0,
);
