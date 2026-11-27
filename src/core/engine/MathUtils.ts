/**
 * 无头核心数值与几何工具（含除零保护、有限数防 NaN 护栏、无尽模式非线性缩放）
 */

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function safeFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function safeDamage(rawDamage: number): number {
  if (!Number.isFinite(rawDamage)) return 1;
  return Math.max(1, Math.round(rawDamage));
}

export function normalize2D(x: number, y: number): { readonly x: number; readonly y: number } {
  const lenSq = x * x + y * y;
  if (!Number.isFinite(lenSq) || lenSq <= 1e-12) {
    return { x: 0, y: 0 };
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return { x: x * invLen, y: y * invLen };
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function clampWeaponCooldownMs(
  baseCooldownMs: number,
  cooldownReductionRatio: number,
  minCooldownMs: number,
  maxCooldownReductionRatio: number,
): number {
  const safeCdr = clamp(cooldownReductionRatio, 0, maxCooldownReductionRatio);
  const raw = baseCooldownMs * (1 - safeCdr);
  return Math.max(minCooldownMs, safeFiniteNumber(raw, minCooldownMs));
}

export interface EndlessMultipliers {
  readonly hpMult: number;
  readonly dmgMult: number;
  readonly speedMult: number;
}

/**
 * 阶段 5 冻结无尽模式非线性安全缩放公式：
 * m = max(0, (elapsedSec - 720) / 60)
 * hpMult    = min(maxHpMult,    1 + 0.35*m + 0.06*m^2)
 * dmgMult   = min(maxDmgMult,   1 + 0.14*m)
 * speedMult = min(maxSpeedMult, 1 + 0.025*m)
 */
export function computeEndlessMultipliers(
  elapsedSec: number,
  endlessStartSec: number,
  maxHpMult: number,
  maxDmgMult: number,
  maxSpeedMult: number,
): EndlessMultipliers {
  const m = Math.max(0, (safeFiniteNumber(elapsedSec, 0) - endlessStartSec) / 60);
  if (m <= 0) {
    return { hpMult: 1, dmgMult: 1, speedMult: 1 };
  }
  return {
    hpMult: Math.min(maxHpMult, 1 + 0.35 * m + 0.06 * m * m),
    dmgMult: Math.min(maxDmgMult, 1 + 0.14 * m),
    speedMult: Math.min(maxSpeedMult, 1 + 0.025 * m),
  };
}
