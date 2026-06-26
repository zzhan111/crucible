/**
 * Kendall τ (Kendall rank correlation coefficient) 计算。
 *
 * 用途:judge 排序 vs 人类排序的一致性度量(P1 §2.4 judge 校准)。
 *
 * 定义:对两个长度为 n 的排序,τ = (concordant - discordant) / (n*(n-1)/2)。
 * - concordant pair: 两个排序中相对顺序一致的对
 * - discordant pair: 顺序相反的对
 * - τ ∈ [-1, 1]:1=完全一致,0=无关,-1=完全相反
 *
 * P1 用 τ-b(忽略 ties,因 judge final_score 浮点,实际无 tie)。
 */
export interface KendallTauResult {
  tau: number;
  concordant: number;
  discordant: number;
  total_pairs: number;
}

/**
 * 计算 Kendall τ。
 * @param rankingA 第一个排序(工件 ID 列表,降序)
 * @param rankingB 第二个排序(工件 ID 列表,降序,同集合)
 * @returns τ 结果
 * @throws 若两排序长度不同或元素集合不同
 */
export function kendallTau(rankingA: string[], rankingB: string[]): KendallTauResult {
  if (rankingA.length !== rankingB.length) {
    throw new Error(
      `kendallTau: length mismatch (A=${rankingA.length}, B=${rankingB.length})`
    );
  }
  const n = rankingA.length;
  if (n < 2) {
    return { tau: 0, concordant: 0, discordant: 0, total_pairs: 0 };
  }

  // 校验两排序包含相同元素集合
  const setA = new Set(rankingA);
  const setB = new Set(rankingB);
  if (setA.size !== setB.size || [...setA].some(id => !setB.has(id))) {
    throw new Error('kendallTau: rankings must contain the same set of IDs');
  }

  // 把 rankingB 的位置映射成 rankingA 顺序下的位置序列
  // posInB[id] = id 在 rankingB 中的索引
  const posInB = new Map<string, number>();
  rankingB.forEach((id, idx) => posInB.set(id, idx));

  // 按 rankingA 顺序取 B 位置:得到一个排列
  const perm = rankingA.map(id => posInB.get(id)!);

  // 数逆序对(discordant pairs)即 perm 中的逆序对数
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (perm[i] > perm[j]) discordant++;
    }
  }
  const totalPairs = (n * (n - 1)) / 2;
  const concordant = totalPairs - discordant;
  const tau = (concordant - discordant) / totalPairs;

  return { tau, concordant, discordant, total_pairs: totalPairs };
}

/**
 * 从分数映射生成排序(降序,分数越高排越前)。
 * 用于把 judge final_score 转成 ranking 后和人类排序比 τ。
 * @param scores 工件 ID → 分数
 * @returns 降序排列的工件 ID 列表
 */
export function rankingFromScores(scores: Record<string, number>): string[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
