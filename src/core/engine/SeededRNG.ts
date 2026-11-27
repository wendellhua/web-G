/**
 * Mulberry32 确定性 32-bit 伪随机数生成器（Headless Core 唯一合法随机源）
 * 严禁在 src/core/ 中使用 Math.random()。
 */
export class SeededRNG {
  private state: number;
  public readonly initialSeed: number;

  constructor(seed: number) {
    const normalized = Number.isFinite(seed) ? (seed >>> 0) : 0x9e3779b9;
    this.initialSeed = normalized === 0 ? 0x6d2b79f5 : normalized;
    this.state = this.initialSeed;
  }

  public reset(newSeed?: number): void {
    if (newSeed !== undefined && Number.isFinite(newSeed)) {
      const normalized = newSeed >>> 0;
      this.state = normalized === 0 ? 0x6d2b79f5 : normalized;
      return;
    }
    this.state = this.initialSeed;
  }

  /** 返回 [0, 1) 区间均匀分布浮点数 */
  public nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max) 区间浮点数 */
  public nextRange(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.nextFloat() * (max - min);
  }

  /** 返回 [minInclusive, maxInclusive] 闭区间整数 */
  public nextInt(minInclusive: number, maxInclusive: number): number {
    const lo = Math.ceil(minInclusive);
    const hi = Math.floor(maxInclusive);
    if (hi <= lo) return lo;
    return lo + Math.floor(this.nextFloat() * (hi - lo + 1));
  }

  /** 按概率 probabilityRatio ∈ [0, 1] 返回布尔值 */
  public chance(probabilityRatio: number): boolean {
    if (probabilityRatio <= 0) return false;
    if (probabilityRatio >= 1) return true;
    return this.nextFloat() < probabilityRatio;
  }

  /** 按权重列表确定性抽取一项 */
  public pickWeighted<T>(items: readonly { item: T; weight: number }[]): T | undefined {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const entry = items[i];
      if (entry && entry.weight > 0) total += entry.weight;
    }
    if (total <= 0) return items[0]?.item;
    let cursor = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      const entry = items[i];
      if (!entry || entry.weight <= 0) continue;
      cursor -= entry.weight;
      if (cursor <= 0) return entry.item;
    }
    return items[items.length - 1]?.item;
  }

  /** 原地 Fisher-Yates 确定性洗牌 */
  public shuffleInPlace<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = array[i];
      const swapTarget = array[j];
      if (tmp !== undefined && swapTarget !== undefined) {
        array[i] = swapTarget;
        array[j] = tmp;
      }
    }
    return array;
  }
}
