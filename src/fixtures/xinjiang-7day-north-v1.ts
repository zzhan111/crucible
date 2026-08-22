import type { Artifact } from '../predicates/types.js';

/**
 * 新疆北线 7 天环线 v1（buggy）— 石河子 144 团出发/返回。
 * 路线: 144团 → 乌尔禾魔鬼城 → 布尔津(五彩滩) → 喀纳斯 → 禾木 → 富蕴(可可托海) → 144团
 * 避开已玩地点: 独山子/独库公路/那拉提/伊宁/赛里木湖（v1 伊犁线已覆盖, 不再重复）
 *
 * 信源（2026-08-01 采集, data/sources-master.jsonl）:
 *   - 喀纳斯: 门票160+区间车70(一进230), 观鱼台区间车往返20, 全域通票旺季375 (新浪/汽车之家) trust 0.8
 *   - 禾木: 门票50+区间车往返52(套票102), 贾登峪→禾木专线1.5h (本地宝/腾讯) trust 0.8
 *   - 白哈巴: 区间车往返45, 需提前办边防证 (攻略) trust 0.8
 *   - 乌尔禾魔鬼城: 门票约42+区间车20, 售票10:00-19:00, 距克拉玛依~106km (本地宝) trust 0.8
 *   - 五彩滩: 日落前1.5h抵达, 三脚架拍暖调丹霞 (小红书+攻略) trust 0.8
 *   - 可可托海: 神钟山峡谷徒步, 富蕴旅游官方 (网易攻略) trust 0.8
 *   - 布尔津烤狗鱼(本地人都爱), 贾登峪住宿200-800/晚, 喀纳斯景区简餐拌面35-50 (攻略) trust 0.7
 *   - 车程: 144团→乌尔禾~5h, 乌尔禾→布尔津~4h, 布尔津→喀纳斯~3h, 禾木→布尔津~4h,
 *           布尔津→可可托海~5h, 富蕴→144团~7h (攻略共识) trust 0.7
 *
 * 埋 3 个真实违规:
 *   1. time_budget: 全程 sum > 5040（D7 富蕴→144团 8h 车程+全程排满, 返程日为长途日）
 *   2. continuity: D4 禾木村漫步(core_experience) → 晚餐(dining) 之间无 transit/switch 桥
 *   3. no_duplicate_state: D7 连续两个 transit 节点都持 in_transit, 无 switch/buffer 清除
 */
export const xinjiang7dayNorthV1: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 5040, // 7天 × 12h 合理预算
    budget: { min: 0, max: 8000 },
  },
  nodes: [
    // ── D1: 144团 → 乌尔禾魔鬼城（720min）──
    { time_block: '07:00-08:00', action: '早餐 144团', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: ['at_144'] , day: 1},
    { time_block: '08:00-13:00', action: '自驾 144团 → 乌尔禾', route: '144团 → 克拉玛依 → 乌尔禾(G30→G217)', duration_min: 300, node_type: 'transit', elasticity: 'non_compressible', cost: 250, source: '攻略共识(约5h车程)', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '13:00-14:00', action: '午餐 克拉玛依/乌尔禾', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: '14:00-14:30', action: '至魔鬼城景区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '本地宝: 魔鬼城距克拉玛依~106km', source_trust: 0.8, state: ['in_transit'] , day: 1},
    { time_block: '14:30-17:00', action: '世界魔鬼城 雅丹地貌', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 62, source: '本地宝: 门票约42+区间车20', source_trust: 0.8, state: [] , day: 1},
    { time_block: '17:00-17:30', action: '景区小火车 观景', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '魔鬼城区间车(含票)', source_trust: 0.8, state: ['in_transit'] , day: 1},
    { time_block: '17:30-19:00', action: '魔鬼城 日落观景', duration_min: 90, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 日落时分雅丹被夕阳染橙', source_trust: 0.8, state: [] , day: 1},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '19:00-20:00', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '20:00-20:30', action: '入住乌尔禾', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 280, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 1},
    { time_block: '20:30-20:40', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},

    // ── D2: 乌尔禾 → 布尔津 五彩滩（780min）──
    { time_block: '07:00-08:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '08:00-12:00', action: '自驾 乌尔禾 → 布尔津', route: '乌尔禾 → 布尔津(G217)', duration_min: 240, node_type: 'transit', elasticity: 'non_compressible', cost: 180, source: '攻略共识(约4h车程)', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '12:00-13:00', action: '午餐 布尔津', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略: 布尔津烤狗鱼, 本地人都爱这口', source_trust: 0.8, state: [] , day: 2},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '13:00-15:00', action: '布尔津县城 休整', duration_min: 120, node_type: 'buffer', elasticity: 'replaceable', cost: 50, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '15:00-15:30', action: '至五彩滩景区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略共识(五彩滩距布尔津~20km)', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '15:30-19:00', action: '五彩滩 丹霞地貌+日落', duration_min: 210, node_type: 'core_experience', elasticity: 'compressible', cost: 45, source: '小红书: 日落前1.5h抵达, 三脚架拍暖调丹霞', source_trust: 0.85, state: [] , day: 2},
    { time_block: '19:00-19:30', action: '返回布尔津', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '19:30-20:30', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '20:30-21:00', action: '入住布尔津', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 2},
    { time_block: '21:00-21:10', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},

    // ── D3: 布尔津 → 喀纳斯（710min）──
    { time_block: '07:00-08:00', action: '早餐 + 退房', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},
    { time_block: '08:00-11:00', action: '自驾 布尔津 → 贾登峪', route: '布尔津 → 贾登峪门票站', duration_min: 180, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约3h车程)', source_trust: 0.7, state: ['in_transit'] , day: 3},
    { time_block: '11:00-12:00', action: '午餐 贾登峪', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略: 喀纳斯景区简餐拌面35-50', source_trust: 0.7, state: [] , day: 3},
    { time_block: '12:00-12:40', action: '贾登峪 → 喀纳斯换乘中心(区间车)', duration_min: 40, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '汽车之家: 喀纳斯区间车8:00-20:00', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '12:40-15:10', action: '观鱼台 登1068级台阶', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 20, source: '攻略: 观鱼台区间车往返20', source_trust: 0.8, state: [] , day: 3},
    { time_block: '15:10-15:40', action: '观鱼台 区间车下山', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '观鱼台区间车(往返票)', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '15:40-17:40', action: '喀纳斯湖 湖边漫步', duration_min: 120, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 喀纳斯湖水随季节变色', source_trust: 0.8, state: [] , day: 3},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 3},
    { time_block: '17:40-18:40', action: '晚餐 喀纳斯', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 100, source: '攻略: 景区内抓饭40-60/盘', source_trust: 0.7, state: [] , day: 3},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 3},
    { time_block: '18:40-19:10', action: '入住木屋', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 500, source: '攻略: 景区内高端木屋', source_trust: 0.7, state: ['at_hotel'] , day: 3},
    { time_block: '19:10-19:20', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},

    // ── D4: 喀纳斯三湾 → 禾木（720min, 漫步→晚餐无桥）──
    { time_block: '07:00-08:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 60, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 4},
    { time_block: '08:00-12:00', action: '三湾游览 神仙湾/月亮湾/卧龙湾', duration_min: 240, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '马蜂窝: 月亮湾卧龙湾神仙湾鸭泽湖', source_trust: 0.8, state: [] , day: 4},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 4},
    { time_block: '12:00-13:00', action: '午餐 贾登峪', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: '13:00-14:30', action: '贾登峪 → 禾木 专线大巴', route: '贾登峪 → 禾木门票站', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 52, source: '本地宝: 禾木区间车往返52', source_trust: 0.8, state: ['in_transit'] , day: 4},
    { time_block: '14:30-17:00', action: '禾木村 漫步(白桦林/禾木河/老桥)', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 禾木村图瓦人风土人情', source_trust: 0.8, state: [] , day: 4},
    { time_block: '17:00-18:00', action: '晚餐（缺衔接节点）', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 4},
    { time_block: '18:00-18:30', action: '入住禾木小木屋', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 450, source: '攻略: 禾木特色木屋', source_trust: 0.7, state: ['at_hotel'] , day: 4},
    { time_block: '18:30-18:40', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},

    // ── D5: 禾木晨雾 → 布尔津（720min）──
    { time_block: '05:30-07:30', action: '禾木 晨雾+日出 观景台', duration_min: 120, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: '小红书: 禾木晨雾机位', source_trust: 0.85, state: [] , day: 5},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '07:30-08:30', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 60, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '08:30-10:30', action: '禾木村 深度游(观景台/白桦林)', duration_min: 120, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 禾木村观景台打卡', source_trust: 0.8, state: [] , day: 5},
    { time_block: '10:30-11:00', action: '禾木 → 贾登峪 专线', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '禾木区间车(往返票)', source_trust: 0.8, state: ['in_transit'] , day: 5},
    { time_block: '11:00-12:00', action: '午餐 贾登峪', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: '12:00-16:00', action: '自驾 贾登峪 → 布尔津', route: '贾登峪 → 布尔津', duration_min: 240, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约4h车程)', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '16:00-17:00', action: '晚餐 布尔津', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '17:00-17:30', action: '入住布尔津', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 5},
    { time_block: '17:30-17:40', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},

    // ── D6: 布尔津 → 可可托海（750min）──
    { time_block: '07:00-08:00', action: '早餐 + 退房', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: '08:00-13:00', action: '自驾 布尔津 → 可可托海', route: '布尔津 → 富蕴 → 可可托海', duration_min: 300, node_type: 'transit', elasticity: 'non_compressible', cost: 220, source: '攻略共识(约5h车程)', source_trust: 0.7, state: ['in_transit'] , day: 6},
    { time_block: '13:00-14:00', action: '午餐 富蕴/可可托海', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: '14:00-14:30', action: '至可可托海景区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '富蕴旅游(官方)', source_trust: 0.8, state: ['in_transit'] , day: 6},
    { time_block: '14:30-17:30', action: '神钟山峡谷 徒步', duration_min: 180, node_type: 'core_experience', elasticity: 'compressible', cost: 100, source: '网易: 可可托海门票/观光车详解', source_trust: 0.8, state: [] , day: 6},
    { time_block: '17:30-18:00', action: '观光车 出景区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '可可托海观光车(含票)', source_trust: 0.8, state: ['in_transit'] , day: 6},
    { time_block: '18:00-19:00', action: '晚餐 富蕴', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 6},
    { time_block: '19:00-19:30', action: '入住富蕴', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 280, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 6},
    { time_block: '19:30-19:40', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 6},

    // ── D7: 富蕴 → 144团 返程（660min, 长途日; 连续 in_transit 无清除）──
    { time_block: '06:30-07:30', action: '早餐 + 出发', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 7},
    { time_block: '07:30-12:00', action: '自驾 富蕴 → 乌鲁木齐方向', route: '富蕴 → 五彩湾 → G216', duration_min: 270, node_type: 'transit', elasticity: 'non_compressible', cost: 200, source: '攻略共识(约4.5h车程)', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '12:00-14:00', action: '自驾 至石河子/144团', route: 'G216 → G30 → S115', duration_min: 120, node_type: 'transit', elasticity: 'non_compressible', cost: 120, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '14:00-15:00', action: '午餐 服务区', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 70, source: '攻略共识', source_trust: 0.7, state: [] , day: 7},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '15:00-16:00', action: '抵达 144团, 行程总结', duration_min: 60, node_type: 'buffer', elasticity: 'replaceable', cost: 0, source: '攻略共识', source_trust: 0.7, state: ['at_144'] , day: 7},
  ],
};

/** 全程 duration_min 总和（供脚本打印核对）。 */
export const xinjiang7dayNorthV1TotalMinutes = xinjiang7dayNorthV1.nodes.reduce(
  (sum, n) => sum + (typeof n.duration_min === 'number' ? n.duration_min : 0),
  0,
);
