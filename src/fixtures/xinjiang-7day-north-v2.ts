import type { Artifact } from '../predicates/types.js';

/**
 * 新疆北线 7 天环线 v3（科学性修正版）— 石河子 144 团出发/返回。
 *
 * v3 重点 = 核对行程路线科学合理性（对照信源 + 新疆夏令时作息）:
 *   1. 日落时段修正: 新疆夏季(6-8月)日落 ~21:30-22:00。v2 把魔鬼城日落排在 17:30-19:00、
 *      五彩滩排在 15:30-19:00 — 实际看不到日落（太阳还很高）。v3: 五彩滩 19:45 抵达
 *      （信源"日落前1.5小时抵达"），20:45-21:45 看日落；魔鬼城改下午游览（斜阳光线），
 *      日落留给最顺路的五彩滩（布尔津 20min 即达，看完 3min 回城）。
 *   2. 观鱼台时段: v2 正午(12:40)爬 1068 级台阶暴晒。v3 上午游喀纳斯湖（湖边林荫），
 *      15:10 登观鱼台 — 傍晚顺光拍喀纳斯湖 S 弯（信源: "顺光拍摄湖水更蓝"）。
 *   3. D7 疲劳驾驶: v2 富蕴→144团 连续 6.5h 无休息。v3 拆 3 段 + 2 次服务区休息。
 *   4. D5 下午闲置: v2 禾木 16:00 回布尔津后无安排。v3 加布尔津河堤夜市/中俄老码头
 *      风情街（布尔津特色，信源: 烤狗鱼本地人都爱）。
 *   5. D2 干等 2h: v2 布尔津 13:00-15:00 纯休整等五彩滩。v3 改河堤漫步 + 早晚餐，
 *      18:00 出发五彩滩。
 *
 * 信源: 同 v2（喀纳斯230/观鱼台20/禾木102/魔鬼城42+20/五彩滩日落1.5h/可可托海神钟山
 *       /白哈巴边防证/布尔津烤狗鱼），data/sources-master.jsonl 逐节点可溯源。
 *
 * 埋 3 个真实违规（引擎抓 + 自动 patch）:
 *   1. time_budget: 全程 5415min > 5040（7 天排满, 引擎提示 8 天更舒适 — 信源"8天为常态"）
 *   2. continuity: D5 布尔津河堤夜市(core) → 晚餐(dining) 之间无 transit/switch 桥
 *   3. no_duplicate_state: D2 至五彩滩 transit + 景区内换乘 transit 连续持 in_transit, 无 clearing
 */
export const xinjiang7dayNorthV2: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 5040, // 7天 × 12h 合理预算
    budget: { min: 0, max: 8000 },
  },
  nodes: [
    // ── D1: 144团 → 乌尔禾 魔鬼城（下午斜阳游览, 日落留给五彩滩）──
    { time_block: '07:00-08:00', action: '早餐 144团', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: ['at_144'] , day: 1},
    { time_block: '08:00-13:00', action: '自驾 144团 → 乌尔禾', route: '144团 → 克拉玛依 → 乌尔禾(G30→G217)', duration_min: 300, node_type: 'transit', elasticity: 'non_compressible', cost: 250, source: '攻略共识(约5h车程)', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '13:00-14:00', action: '午餐 克拉玛依/乌尔禾', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: '14:00-14:30', action: '至魔鬼城景区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '本地宝: 魔鬼城距克拉玛依~106km', source_trust: 0.8, state: ['in_transit'] , day: 1},
    { time_block: '14:30-16:00', action: '世界魔鬼城 雅丹地貌', duration_min: 90, node_type: 'core_experience', elasticity: 'compressible', cost: 62, source: '本地宝: 门票约42+区间车20', source_trust: 0.8, state: [] , day: 1},
    { time_block: '16:00-16:30', action: '景区小火车 观景', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '魔鬼城区间车(含票)', source_trust: 0.8, state: ['in_transit'] , day: 1},
    { time_block: '16:30-18:00', action: '魔鬼城 斜阳观景(17:00后光线)', duration_min: 90, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 傍晚雅丹光影最佳', source_trust: 0.8, state: [] , day: 1},
    { time_block: '18:00-18:30', action: '返回乌尔禾城区', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '18:30-19:30', action: '晚餐 乌尔禾', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 1},
    { time_block: '19:30-20:00', action: '入住乌尔禾', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 280, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 1},
    { time_block: '20:00-20:10', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 1},

    // ── D2: 乌尔禾 → 布尔津 → 五彩滩日落（19:45 抵达, 21:30 日落）──
    { time_block: '07:30-08:30', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '08:30-12:30', action: '自驾 乌尔禾 → 布尔津', route: '乌尔禾 → 布尔津(G217)', duration_min: 240, node_type: 'transit', elasticity: 'non_compressible', cost: 180, source: '攻略共识(约4h车程)', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '12:30-13:30', action: '午餐 布尔津烤狗鱼', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 80, source: '攻略: 布尔津烤狗鱼, 本地人都爱这口', source_trust: 0.8, state: [] , day: 2},
    { time_block: '13:30-14:30', action: '步行/返程衔接', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '14:30-16:30', action: '布尔津河堤/中俄老码头风情街', duration_min: 120, node_type: 'core_experience', elasticity: 'compressible', cost: 30, source: '攻略共识(布尔津特色街区)', source_trust: 0.7, state: [] , day: 2},
    { time_block: '16:30-17:00', action: '至酒店', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '17:00-18:00', action: '早晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},
    { time_block: '18:00-18:30', action: '至五彩滩景区', route: '布尔津 → 五彩滩(约20km)', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略共识(五彩滩距布尔津~20km)', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '18:30-19:00', action: '景区内停车/换乘', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '19:00-21:45', action: '五彩滩 丹霞日落(日落~21:30)', duration_min: 165, node_type: 'core_experience', elasticity: 'non_compressible', cost: 45, source: '小红书: 日落前1.5h抵达, 三脚架拍暖调丹霞', source_trust: 0.85, state: [] , day: 2},
    { time_block: '21:45-22:15', action: '返回布尔津', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 2},
    { time_block: '22:15-22:25', action: '入住布尔津', duration_min: 10, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 2},
    { time_block: '22:25-22:35', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 2},

    // ── D3: 布尔津 → 喀纳斯（上午游湖, 傍晚观鱼台顺光）──
    { time_block: '07:00-08:00', action: '早餐 + 退房', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},
    { time_block: '08:00-11:00', action: '自驾 布尔津 → 贾登峪', route: '布尔津 → 贾登峪门票站', duration_min: 180, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约3h车程)', source_trust: 0.7, state: ['in_transit'] , day: 3},
    { time_block: '11:00-12:00', action: '午餐 贾登峪', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略: 喀纳斯景区简餐拌面35-50', source_trust: 0.7, state: [] , day: 3},
    { time_block: '12:00-12:40', action: '贾登峪 → 换乘中心(区间车)', duration_min: 40, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '汽车之家: 喀纳斯区间车8:00-20:00', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '12:40-14:40', action: '喀纳斯湖 湖边漫步(林荫)', duration_min: 120, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 喀纳斯湖水随季节变色', source_trust: 0.8, state: [] , day: 3},
    { time_block: '14:40-15:10', action: '至观鱼台区间车', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 20, source: '攻略: 观鱼台区间车往返20', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '15:10-17:40', action: '观鱼台 登1068级台阶(傍晚顺光)', duration_min: 150, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: '攻略: 观鱼台长焦拍S弯, 顺光湖水更蓝', source_trust: 0.8, state: [] , day: 3},
    { time_block: '17:40-18:10', action: '观鱼台区间车下山', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '观鱼台区间车(往返票)', source_trust: 0.8, state: ['in_transit'] , day: 3},
    { time_block: '18:10-19:10', action: '晚餐 喀纳斯', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 100, source: '攻略: 景区内抓饭40-60/盘', source_trust: 0.7, state: [] , day: 3},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 3},
    { time_block: '19:10-19:40', action: '入住木屋', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 500, source: '攻略: 景区内高端木屋', source_trust: 0.7, state: ['at_hotel'] , day: 3},
    { time_block: '19:40-19:50', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 3},

    // ── D4: 喀纳斯三湾晨雾 → 禾木 ──
    { time_block: '07:00-08:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 60, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: '08:00-08:30', action: '区间车 至神仙湾', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '喀纳斯景区区间车', source_trust: 0.8, state: ['in_transit'] , day: 4},
    { time_block: '08:30-11:00', action: '三湾游览 神仙湾晨雾/月亮湾/卧龙湾', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '马蜂窝: 月亮湾卧龙湾神仙湾鸭泽湖', source_trust: 0.8, state: [] , day: 4},
    { time_block: '11:00-11:30', action: '区间车 返换乘中心', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '喀纳斯景区区间车', source_trust: 0.8, state: ['in_transit'] , day: 4},
    { time_block: '11:30-12:30', action: '午餐 贾登峪', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: '12:30-14:00', action: '贾登峪 → 禾木 专线大巴', route: '贾登峪 → 禾木门票站', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 52, source: '本地宝: 禾木区间车往返52', source_trust: 0.8, state: ['in_transit'] , day: 4},
    { time_block: '14:00-16:30', action: '禾木村 漫步(白桦林/禾木河/老桥)', duration_min: 150, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 禾木村图瓦人风土人情', source_trust: 0.8, state: [] , day: 4},
    { time_block: '16:30-17:00', action: '至住处', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 4},
    { time_block: '17:00-18:00', action: '晚餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 4},
    { time_block: '18:00-18:30', action: '入住禾木小木屋', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 450, source: '攻略: 禾木特色木屋', source_trust: 0.7, state: ['at_hotel'] , day: 4},
    { time_block: '18:30-18:40', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 4},

    // ── D5: 禾木晨雾 → 布尔津（下午河堤夜市, 不再闲置）──
    { time_block: '05:30-07:30', action: '禾木 晨雾+日出 观景台', duration_min: 120, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: '小红书: 禾木晨雾机位', source_trust: 0.85, state: [] , day: 5},
    { time_block: '07:30-08:00', action: '回住处', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '08:00-09:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 60, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '09:00-10:00', action: '禾木村 深度游(观景台/白桦林)', duration_min: 60, node_type: 'core_experience', elasticity: 'compressible', cost: 0, source: '攻略: 禾木村观景台打卡', source_trust: 0.8, state: [] , day: 5},
    { time_block: '10:00-10:30', action: '专线 至贾登峪', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', cost: 0, source: '禾木区间车(往返票)', source_trust: 0.8, state: ['in_transit'] , day: 5},
    { time_block: '10:30-11:30', action: '午餐 贾登峪', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},
    { time_block: '11:30-15:30', action: '自驾 贾登峪 → 布尔津', route: '贾登峪 → 布尔津', duration_min: 240, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约4h车程)', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '15:30-17:30', action: '布尔津河堤夜市/中俄老码头风情街', duration_min: 120, node_type: 'core_experience', elasticity: 'compressible', cost: 50, source: '攻略: 布尔津特色夜市', source_trust: 0.7, state: [] , day: 5},
    { time_block: '17:30-18:30', action: '晚餐 烤鱼（缺衔接节点）', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 90, source: '攻略: 布尔津烤狗鱼本地人都爱', source_trust: 0.8, state: [] , day: 5},
    { time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, node_type: 'transit', elasticity: 'non_compressible', cost: 10, source: '攻略共识', source_trust: 0.7, state: ['in_transit'] , day: 5},
    { time_block: '18:30-19:00', action: '入住布尔津', duration_min: 30, node_type: 'checkin', elasticity: 'compressible', cost: 300, source: '攻略共识', source_trust: 0.7, state: ['at_hotel'] , day: 5},
    { time_block: '19:00-19:10', action: '晚间休整', duration_min: 10, node_type: 'switch', elasticity: 'compressible', cost: 0, source: '攻略共识', source_trust: 0.7, state: [] , day: 5},

    // ── D6: 布尔津 → 可可托海 ──
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

    // ── D7: 富蕴 → 144团（拆 3 段 + 2 次服务区休息, 防疲劳驾驶）──
    { time_block: '06:30-07:30', action: '早餐 + 出发', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: '攻略共识', source_trust: 0.7, state: [] , day: 7},
    { time_block: '07:30-10:00', action: '自驾 富蕴 → 五彩湾', route: '富蕴 → 五彩湾(G216)', duration_min: 150, node_type: 'transit', elasticity: 'non_compressible', cost: 150, source: '攻略共识(约2.5h)', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '10:00-10:30', action: '服务区休息', duration_min: 30, node_type: 'buffer', elasticity: 'compressible', cost: 20, source: '攻略共识(防疲劳)', source_trust: 0.7, state: [] , day: 7},
    { time_block: '10:30-12:30', action: '自驾 五彩湾 → 乌鲁木齐北', route: '五彩湾 → G216 → 乌市北', duration_min: 120, node_type: 'transit', elasticity: 'non_compressible', cost: 130, source: '攻略共识(约2h)', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '12:30-13:30', action: '午餐 服务区', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 70, source: '攻略共识', source_trust: 0.7, state: [] , day: 7},
    { time_block: '13:30-15:00', action: '自驾 至石河子', route: 'G30 → 石河子', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 100, source: '攻略共识(约1.5h)', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '15:00-15:30', action: '服务区休息', duration_min: 30, node_type: 'buffer', elasticity: 'compressible', cost: 20, source: '攻略共识(防疲劳)', source_trust: 0.7, state: [] , day: 7},
    { time_block: '15:30-17:00', action: '自驾 至144团', route: '石河子 → 144团(S115)', duration_min: 90, node_type: 'transit', elasticity: 'non_compressible', cost: 80, source: '攻略共识(约1.5h)', source_trust: 0.7, state: ['in_transit'] , day: 7},
    { time_block: '17:00-18:00', action: '抵达 144团, 行程总结', duration_min: 60, node_type: 'buffer', elasticity: 'replaceable', cost: 0, source: '攻略共识', source_trust: 0.7, state: ['at_144'] , day: 7},
  ],
};

/** 全程 duration_min 总和（供脚本打印核对）。 */
export const xinjiang7dayNorthV2TotalMinutes = xinjiang7dayNorthV2.nodes.reduce(
  (sum, n) => sum + (typeof n.duration_min === 'number' ? n.duration_min : 0),
  0,
);
