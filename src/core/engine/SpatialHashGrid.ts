/**
 * 零 GC 整数键空间哈希网格（Spatial Hash Grid）
 * - CELL_SIZE_PX = 64，单次局部邻域查询仅遍历 3x3 = 9 桶；
 * - 使用 32-bit 整数偏移键 ((gx + 32768) << 16) | ((gy + 32768) & 0xFFFF)，严禁字符串拼接；
 * - 桶数组全程复用，clear() 仅重置 length = 0，彻底消除热路径 GC 抖动。
 */
export class SpatialHashGrid<T> {
  public readonly cellSizePx: number;
  private readonly invCellSize: number;
  private readonly buckets = new Map<number, T[]>();
  private readonly activeKeys: number[] = [];

  constructor(cellSizePx: number = 64) {
    this.cellSizePx = Math.max(16, cellSizePx);
    this.invCellSize = 1 / this.cellSizePx;
  }

  private packKey(gx: number, gy: number): number {
    const ox = (gx + 32768) & 0xffff;
    const oy = (gy + 32768) & 0xffff;
    return (ox << 16) | oy;
  }

  public clear(): void {
    for (let i = 0; i < this.activeKeys.length; i++) {
      const key = this.activeKeys[i];
      if (key === undefined) continue;
      const bucket = this.buckets.get(key);
      if (bucket) {
        bucket.length = 0;
      }
    }
    this.activeKeys.length = 0;
  }

  public insert(item: T, x: number, y: number): void {
    const gx = Math.floor(x * this.invCellSize);
    const gy = Math.floor(y * this.invCellSize);
    const key = this.packKey(gx, gy);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    if (bucket.length === 0) {
      this.activeKeys.push(key);
    }
    bucket.push(item);
  }

  /** 将指定圆周包围盒覆盖单元格内的所有实体写入调用方复用的 outBuffer */
  public queryRadius(x: number, y: number, radiusPx: number, outBuffer: T[]): T[] {
    outBuffer.length = 0;
    const minGx = Math.floor((x - radiusPx) * this.invCellSize);
    const maxGx = Math.floor((x + radiusPx) * this.invCellSize);
    const minGy = Math.floor((y - radiusPx) * this.invCellSize);
    const maxGy = Math.floor((y + radiusPx) * this.invCellSize);

    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        const bucket = this.buckets.get(this.packKey(gx, gy));
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          const entry = bucket[i];
          if (entry !== undefined) {
            outBuffer.push(entry);
          }
        }
      }
    }
    return outBuffer;
  }
}
