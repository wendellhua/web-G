import { describe, expect, it } from 'vitest';
import { SpatialHashGrid } from '../../src/core/engine/SpatialHashGrid';

interface PointEntity {
  id: number;
  x: number;
  y: number;
}

describe('SpatialHashGrid (零 GC 整数键空间哈希网格)', () => {
  it('能准确检索负坐标、大坐标及跨边界半径内的实体', () => {
    const grid = new SpatialHashGrid<PointEntity>(64);
    const items: PointEntity[] = [
      { id: 1, x: -12000, y: -8500 },
      { id: 2, x: -11970, y: -8480 },
      { id: 3, x: 45000, y: 32000 },
      { id: 4, x: 0, y: 0 },
    ];
    for (const item of items) {
      grid.insert(item, item.x, item.y);
    }

    const buf: PointEntity[] = [];
    grid.queryRadius(-11990, -8490, 50, buf);
    const ids = buf.map((e) => e.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);

    grid.clear();
    grid.queryRadius(-11990, -8490, 50, buf);
    expect(buf.length).toBe(0);
  });
});
