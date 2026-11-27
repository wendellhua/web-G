/**
 * 玩家最终面板属性汇总计算（V2.1）
 * 角色形态每升级 1 阶（形态 I → V），战斗机本身的基础攻击力提升 10%（+0% / +10% / +20% / +30% / +40%），
 * 其余基础移速/血量/拾取半径统一取自全局基线 + 局外 8 项天赋 + 局内被动与祭坛赐福。
 */
import type { ComputedPlayerStats, GlobalBalanceConfig, PassiveSlotState } from '../../../schemas';
import { PASSIVE_BY_ID } from '../../config/gameConfig';
import type { MetaStatBonuses } from '../../meta/MetaProgression';
import { clamp } from '../engine/MathUtils';

export interface RunAltarAndFallbackBuffs {
  moveSpeedBonusRatio: number;
  damageBonusRatio: number;
  extraMaxHpFlat: number;
  pickupBonusRatio: number;
}

export function recomputePlayerStats(
  balance: GlobalBalanceConfig,
  meta: MetaStatBonuses,
  passives: readonly PassiveSlotState[],
  buffs: RunAltarAndFallbackBuffs,
  formBaseAttackBonusRatio = 0,
): ComputedPlayerStats {
  let passiveDamageRatio = 0;
  let passiveCdrRatio = 0;
  let passiveAreaRatio = 0;
  let passiveMaxHpFlat = 0;
  let passiveHpRegenPerSec = 0;
  let passiveCritChance = 0;
  let passiveCritDmg = 0;
  let passiveMoveSpeedRatio = 0;

  for (const slot of passives) {
    const cfg = PASSIVE_BY_ID[slot.passiveId];
    const lvStats = cfg.levels[Math.max(0, Math.min(cfg.levels.length - 1, slot.level - 1))];
    if (!lvStats) continue;
    switch (cfg.statKey) {
      case 'damageRatio':
        passiveDamageRatio += lvStats.primaryValue;
        break;
      case 'cooldownReductionRatio':
        passiveCdrRatio += lvStats.primaryValue;
        break;
      case 'areaRatio':
        passiveAreaRatio += lvStats.primaryValue;
        break;
      case 'maxHpAndRegen':
        passiveMaxHpFlat += lvStats.primaryValue;
        passiveHpRegenPerSec += lvStats.secondaryValue;
        break;
      case 'critChanceAndDamage':
        passiveCritChance += lvStats.primaryValue;
        passiveCritDmg += lvStats.secondaryValue;
        break;
      case 'moveSpeedRatio':
        passiveMoveSpeedRatio += lvStats.primaryValue;
        break;
    }
  }

  const maxHp = Math.max(
    1,
    Math.round(balance.basePlayerMaxHp + meta.maxHpFlat + passiveMaxHpFlat + buffs.extraMaxHpFlat),
  );

  const rawMoveSpeed =
    balance.basePlayerMoveSpeedPxPerSec * (1 + meta.moveSpeedRatio + passiveMoveSpeedRatio + buffs.moveSpeedBonusRatio);
  const moveSpeedPxPerSec = clamp(rawMoveSpeed, 80, 420);

  const pickupRadiusPx = clamp(
    balance.basePlayerPickupRadiusPx * (1 + meta.pickupRadiusRatio + buffs.pickupBonusRatio),
    40,
    450,
  );

  const formBaseAttackMult = 1 + Math.max(0, formBaseAttackBonusRatio);
  const damageMult = Math.max(
    0.2,
    formBaseAttackMult * (1 + meta.damageRatio + passiveDamageRatio + buffs.damageBonusRatio),
  );

  const cooldownReductionRatio = clamp(
    meta.cooldownReductionRatio + passiveCdrRatio,
    0,
    balance.maxCooldownReductionRatio,
  );

  const areaMult = clamp(1 + passiveAreaRatio, 0.5, 3.0);

  const critChanceRatio = clamp(balance.baseCritChanceRatio + passiveCritChance, 0, 0.85);

  const critDamageMult = Math.max(1.0, balance.baseCritDamageMult + passiveCritDmg);

  const xpGainMult = Math.max(0.5, 1 + meta.xpGainRatio);

  const crystalExtractMult = Math.max(1.0, 1 + meta.crystalExtractRatio);

  return {
    maxHp,
    moveSpeedPxPerSec,
    pickupRadiusPx,
    damageMult,
    cooldownReductionRatio,
    areaMult,
    critChanceRatio,
    critDamageMult,
    xpGainMult,
    hpRegenPerSec: passiveHpRegenPerSec,
    crystalExtractMult,
  };
}
