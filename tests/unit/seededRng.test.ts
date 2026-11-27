import { describe, expect, it } from 'vitest';
import { SeededRNG } from '../../src/core/engine/SeededRNG';

describe('SeededRNG (Mulberry32 确定性随机)', () => {
  it('相同种子必须产出完全一致的随机序列', () => {
    const a = new SeededRNG(20261126);
    const b = new SeededRNG(20261126);

    const seqA = Array.from({ length: 100 }, () => a.nextFloat());
    const seqB = Array.from({ length: 100 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);

    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('reset() 回到初始种子后产出序列完全复现', () => {
    const rng = new SeededRNG(42);
    const first = Array.from({ length: 20 }, () => rng.nextInt(1, 1000));
    rng.reset();
    const second = Array.from({ length: 20 }, () => rng.nextInt(1, 1000));
    expect(second).toEqual(first);
  });

  it('seed=0 或 NaN 等极端入参能自动规范化且产出有限数值', () => {
    const rngZero = new SeededRNG(0);
    const rngNaN = new SeededRNG(Number.NaN);
    expect(Number.isFinite(rngZero.nextFloat())).toBe(true);
    expect(Number.isFinite(rngNaN.nextFloat())).toBe(true);
  });

  it('pickWeighted 与 shuffleInPlace 严格遵循确定性', () => {
    const items = [
      { item: 'swarm', weight: 70 },
      { item: 'runner', weight: 30 },
    ];
    const r1 = new SeededRNG(999);
    const r2 = new SeededRNG(999);
    const picks1 = Array.from({ length: 30 }, () => r1.pickWeighted(items));
    const picks2 = Array.from({ length: 30 }, () => r2.pickWeighted(items));
    expect(picks1).toEqual(picks2);

    const arr1 = [1, 2, 3, 4, 5, 6];
    const arr2 = [1, 2, 3, 4, 5, 6];
    expect(r1.shuffleInPlace(arr1)).toEqual(r2.shuffleInPlace(arr2));
  });
});
