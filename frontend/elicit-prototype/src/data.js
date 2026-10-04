'use strict';
/* ================= 数据层：来源映射、品类关键词表、规格解析 ================= */

// 来源系列：由包装编码前缀推出【假设，见 README】
const SOURCE_RULES = [
  { prefix: 'XM', source: '喜美福', why: 'XM- 前缀 → 喜美福经销商系列（CSV“来源”列几乎都是“主数据”）' },
  { prefix: 'ZS', source: 'ZS', why: 'ZS- 前缀 → 店内自建 ZS 系列（多为药品/器械/健康品），单列为一个来源' },
  { prefix: '1688', source: '1688', why: '1688- 前缀 → 1688 平台采购（多为日化、保健冲调）' },
  { prefix: 'KL', source: '店内自建', why: 'KL- 前缀 → 归入“店内自建”（内容是可口可乐系饮料，KL 含义未确认）' },
  { prefix: 'YB', source: '店内自建', why: 'YB- 前缀 → 归入“店内自建”（仅 1 条：怡宝矿泉水）' },
];
const SOURCES = ['喜美福', 'ZS', '1688', '店内自建'];

// 品类 / 子类关键词表：按顺序匹配“商品名称 + 包装名称”，先命中先得；都不中 → 未分类
const CAT_RULES = [
  { cat: '医疗护理', sub: '计生用品', kw: ['杜蕾斯', '冈本', '久薄', '久润', '润滑液'] },
  { cat: '医疗护理', sub: '检测器械', kw: ['血压计', '体温计', '血氧仪', '测试笔', '诊断试剂', '筋膜枪', '洗鼻器', '氧气', '冰袋', '备皮刀', '手套'] },
  { cat: '医疗护理', sub: '口罩', kw: ['口罩'] },
  { cat: '医疗护理', sub: '贴类', kw: ['退热贴', '鼻贴', '暖宝宝', '热敷贴', '三伏贴', '透骨贴'] },
  { cat: '药品', sub: '眼耳鼻', kw: ['滴眼液', '鼻腔喷雾', '吸鼻盐'] },
  { cat: '药品', sub: '感冒解热', kw: ['感冒', '对乙酰氨基酚', '酚咖', '板蓝根', '抗病毒', '银翘', '清热解毒', '夏桑菊', '午时茶', '感寒'] },
  { cat: '药品', sub: '咽喉口腔', kw: ['止咳', '枇杷合剂', '清喉', '咽喉', '喉片', '西地碘', '蓝芩', '西青果', '润喉', '口腔膜', '口腔溃疡', '口珍舒', '牙痛'] },
  { cat: '药品', sub: '肠胃', kw: ['健脾', '乳酸菌素', '健胃', '消食', '开塞露', '参苓', '槐角', '痔疮'] },
  { cat: '保健食品', sub: '营养补充', kw: ['益生菌', '固体饮料', '电解质', '钙片', '叶黄素', '膳食', '红参', '元气丸', '羽衣甘蓝', '钙铁锌', '肽', '金樽', '葡萄糖粉', '红糖姜茶', '黄芪'] },
  { cat: '个护日化', sub: '护肤', kw: ['维生素E乳', '护手霜', '珍珠霜', '润唇膏', '润肤露', 'SOD', '补水喷雾', '舒眠膏'] },
  { cat: '医疗护理', sub: '消毒敷料', kw: ['酒精', '碘伏', '消毒', '双氧水', '过氧化氢', '创可贴', '创口贴', '敷贴', '敷料', '纱布', '绷带', '棉签', '棉棒', '棉片', '棉球', '压敏胶', '盐水清洗', '氯化钠', '护理垫', '水胶体', '抑菌粉', '抑菌喷', '抑菌液', '湿巾', '高锰酸钾'] },
  { cat: '药品', sub: '外用', kw: ['软膏', '乳膏', '凝胶', '气雾剂', '喷雾剂', '喷剂', '搽剂', '红花油', '风油精', '伤痛', '烧烫伤', '洗液', '洗剂', '栓', '红霉素', '黄皮肤', '祛痛', '痱子粉', '硫磺皂', '裂可宁'] },
  { cat: '药品', sub: '维矿', kw: ['维生素C泡腾', '维生素B1'] },
  { cat: '药品', sub: '滋补中成药', kw: ['地黄丸', '大补丸', '益气丸', '归脾丸', '益母草', '天麻'] },
  { cat: '个护日化', sub: '洗护发', kw: ['洗发', '海飞丝', '飘柔', '潘婷'] },
  { cat: '个护日化', sub: '沐浴清洁', kw: ['沐浴', '洗手液', '香皂', '皂', '舒肤佳'] },
  { cat: '个护日化', sub: '口腔护理', kw: ['牙膏', '牙线', '护齿'] },
  { cat: '个护日化', sub: '纸品', kw: ['面巾纸', '金博仕'] },
  { cat: '个护日化', sub: '家清洗衣', kw: ['洗衣', '洗内衣', '足浴', '鞋袜', '花露水'] },
  { cat: '个护日化', sub: '剃须', kw: ['剃须'] },
  { cat: '个护日化', sub: '女性护理', kw: ['卫生巾', '内裤'] },
  { cat: '方便速食', sub: '肉肠', kw: ['双汇', '火腿肠'] },
  { cat: '烘焙', sub: '汉堡', kw: ['汉堡', '堡'] },
  { cat: '烘焙', sub: '面包', kw: ['面包', '飞饼'] },
  { cat: '烘焙', sub: '蛋糕', kw: ['蛋糕', '铜锣烧', '妙芙', 'Q蒂', '酸奶棒'] },
  { cat: '烘焙', sub: '派', kw: ['蛋黄派', '巧克力派', '好丽友派'] },
  { cat: '休闲零食', sub: '膨化薯片', kw: ['薯片', '乐事', '薯愿', '可比克', '呀土豆', '好友趣', '小小酥', '雪饼', '仙贝', '锅巴', '好多鱼', '鱼果', '虾片', '小浣熊', '快餐面'] },
  { cat: '休闲零食', sub: '海苔', kw: ['海苔'] },
  { cat: '休闲零食', sub: '饼干', kw: ['饼干', '曲奇', '趣多多', '奥利奥', '百奇', '百醇', '蛋酥卷', '乐芙球', '小馒头', '脆脆鲨', '蘑古力', '冰点筒', '风车果'] },
  { cat: '休闲零食', sub: '辣条素食', kw: ['辣条', '辣片', '面筋', '素牛', '皇鱼', '开胃丝', '亲嘴片', '老辣棍', '斑马肉', '根根爽', '一根葱', '麦片', '豆干', '豆条', '豆卷', '魔芋', '贡菜', '海带', '春笋', '乡巴佬丝', '鸡筋', '麻辣王子', '留香展翅', '米线', '嘴巴香'] },
  { cat: '休闲零食', sub: '肉类卤味', kw: ['鸭心', '鹅肝', '凤爪', '鸡爪', '鸡腿', '香酥腿', '鸡脖', '烤脖', '猪蹄', '牛板筋', '牛筋', '猪皮', '卤蛋', '咸鸭蛋', '蚕蛹', '去骨筋'] },
  { cat: '休闲零食', sub: '海味', kw: ['小鱼', '鱿鱼', '带鱼', '小黄鱼', '鱼皮', '蟹柳'] },
  { cat: '休闲零食', sub: '坚果炒货', kw: ['花生', '瓜子', '腰果', '开心果', '果仁'] },
  { cat: '休闲零食', sub: '果干蜜饯', kw: ['梅肉', '西梅', '杨梅', '芒果干', '果丹皮', '杏', '甘薯'] },
  { cat: '饮品', sub: '碳酸', kw: ['汽水', '可口可乐', '雪碧', '芬达', '魔爪', '醒目'] },
  { cat: '饮品', sub: '饮用水', kw: ['矿泉水', '饮用水', '怡宝', '纯悦', '冰露'] },
  { cat: '饮品', sub: '果汁茶饮', kw: ['果汁', '橙汁', '苹果汁', '果粒橙', '美汁源', '酷儿', '酸梅汤', '枇杷汁', '四神汤', '双白饮'] },
  { cat: '糖果巧克力', sub: '口香糖', kw: ['口香糖', '木糖醇', '益达'] },
  { cat: '糖果巧克力', sub: '果冻', kw: ['果冻', '果粒爽'] },
  { cat: '糖果巧克力', sub: '巧克力', kw: ['巧克力', '士力架', '德芙', '脆香米'] },
  { cat: '糖果巧克力', sub: '糖果', kw: ['糖', '拖肥', 'QQ', '嗨啾', '曼妥思', '荷氏', '含片'] },
  { cat: '方便速食', sub: '方便面', kw: ['火鸡面', '牛肉面', '鱼板面', '红烧面', '粉丝', '杯面', '螺狮粉', '螺蛳粉'] },
  { cat: '方便速食', sub: '自热', kw: ['自热', '煲仔饭'] },
  { cat: '方便速食', sub: '其他速食', kw: ['八宝粥', '罐头'] },
  { cat: '饮品', sub: '乳饮', kw: ['牛奶', 'AD钙奶'] },
  { cat: '饮品', sub: '咖啡冲调', kw: ['咖啡', 'Coffee', '奶茶'] },
];
const CATS = ['烘焙', '休闲零食', '糖果巧克力', '方便速食', '饮品', '药品', '医疗护理', '保健食品', '个护日化', '未分类'];
const SUBS_BY_CAT = {};
CATS.forEach(c => SUBS_BY_CAT[c] = []);
CAT_RULES.forEach(r => { if (!SUBS_BY_CAT[r.cat].includes(r.sub)) SUBS_BY_CAT[r.cat].push(r.sub); });
SUBS_BY_CAT['未分类'] = ['未分类'];
const CAT_COLORS = {
  '烘焙': '#f59e0b', '休闲零食': '#ef4444', '糖果巧克力': '#ec4899', '方便速食': '#f97316', '饮品': '#0ea5e9',
  '药品': '#10b981', '医疗护理': '#14b8a6', '保健食品': '#84cc16', '个护日化': '#8b5cf6', '未分类': '#94a3b8',
};

function sourceOf(code) {
  const r = SOURCE_RULES.find(s => code.startsWith(s.prefix));
  return r ? r.source : '店内自建';
}
function classify(text) {
  for (const r of CAT_RULES) {
    const k = r.kw.find(k => text.includes(k));
    if (k) return { cat: r.cat, sub: r.sub, kw: k };
  }
  return { cat: '未分类', sub: '未分类', kw: null };
}
// 规格：从名称里解析克/毫升（含“10克*10袋”这种乘法）；解析不出 → null
function parseSpec(text) {
  const t = text.replace(/（[^）]*）/g, ' ');
  let m = t.match(/(\d+(?:\.\d+)?)\s*(克|g|毫升|ml|ML)\s*[*×]\s*(\d+)/i);
  if (m) return Math.round(parseFloat(m[1]) * parseInt(m[3], 10));
  m = t.match(/(\d+(?:\.\d+)?)\s*(克|g|毫升|ml|升|L)(?![a-z])/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2] === '升' || m[2] === 'L') v *= 1000;
  return Math.round(v * 10) / 10;
}

const ITEMS = window.__DATA__.map(r => {
  const [code, sku, name, pkgName, price, barcode, shelf, origin, note, front, side, back] = r;
  const display = name === pkgName ? name : code.startsWith('XM') ? (pkgName.startsWith(name.slice(0, 2)) ? pkgName : name + '（' + pkgName + '）') : (name + ' ' + pkgName);
  const c = classify(name + ' ' + pkgName);
  const spec = parseSpec(pkgName) ?? parseSpec(name);
  return {
    code, sku, rawName: name, pkgName, name: display, price, barcode, shelf, origin, note,
    photo: front, side, back, source: sourceOf(code), prefix: code.split('-')[0],
    autoCat: c.cat, autoSub: c.sub, autoKw: c.kw, cat: c.cat, sub: c.sub,
    spec, unitPrice: (spec && price != null && spec >= 1) ? Math.round(price / spec * 10000) / 100 : null,
  };
});
const ITEM = {};
ITEMS.forEach(it => ITEM[it.code] = it);

// 可用于条件 / 例外的字段
const FIELDS = {
  price: { label: '单价', unit: '元', type: 'num', get: it => it.price },
  spec: { label: '规格', unit: 'g/ml', type: 'num', get: it => it.spec, hint: '从名称解析，可能不准' },
  unit: { label: '每100g/ml价', unit: '元', type: 'num', get: it => it.unitPrice },
  shelf: { label: '保质期', unit: '天', type: 'num', get: it => it.shelf },
  sub: { label: '子类', unit: '', type: 'enum', get: it => it.sub },
  name: { label: '名称', unit: '', type: 'text', get: it => it.name },
  photo: { label: '正面照', unit: '', type: 'bool', get: it => it.photo ? '有' : '无' },
};
const OPS = { num: ['>', '≥', '<', '≤', '='], enum: ['=', '≠'], text: ['包含', '不包含'], bool: ['='] };
