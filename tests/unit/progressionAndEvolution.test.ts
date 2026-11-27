import { describe, expect, it } from 'vitest';
import type { PassiveSlotState, RunEconomyRuntimeState, WeaponSlotState } from '../../schemas';
import { GAME_CONFIG, WEAPON_BY_ID } from '../../src/config/gameConfig';
import { SeededRNG } from '../../src/core/engine/SeededRNG';
import {
  applySelectedChoice,
  buildFallbackLevelUpChoices,
  findReadyEvolutions,
  resolveEliteChest,
  rollLevelUpChoices,
} from '../../src/core/systems/ProgressionSystem';

function makeEmptyEconomy(): RunEconomyRuntimeState {
  return {
    kills: 0,
    elitesKilled: 0,
    altarsCompleted: 0,
    runBonusCrystals: 0,
    damageByWeapon: {},
    victoryRewardGranted: false,
    endlessRewardSettled: false,
    victoryBaselineKills: 0,
    victoryBaselineElites: 0,
    victoryBaselineAltars: 0,
    victoryBaselineBonusCrystals: 0,
    lastGrantedCrystals: 0,
  };
}

describe('ProgressionSystem V2：动态槽位（2+1 → 4+4）抽卡零越界隔离与超武觉醒', () => {
  it('阶段 1（2+1 槽位）选满 2 主动 + 1 被动后，100 次抽卡绝不出现任何无法装备的新技能', () => {
    const rng = new SeededRNG(12345);
    const weapons: WeaponSlotState[] = [
      { weaponId: 'tracking_pulse', level: 2, isEvolved: false, evolutionId: null, cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'orbital_blade', level: 1, isEvolved: false, evolutionId: null, cooldownTimerMs: 0, orbitAngleRad: 0 },
    ];
    const passives: PassiveSlotState[] = [{ passiveId: 'overclock_chip', level: 2 }];

    for (let i = 0; i < 100; i++) {
      const cards = rollLevelUpChoices(rng, weapons, passives, 2, 1);
      expect(cards.length).toBe(3);
      for (const card of cards) {
        expect(card.kind).not.toBe('new_weapon');
        expect(card.kind).not.toBe('new_passive');
        if (card.weaponId) {
          expect(['tracking_pulse', 'orbital_blade']).toContain(card.weaponId);
        }
        if (card.passiveId) {
          expect(card.passiveId).toBe('overclock_chip');
        }
      }
    }
  });

  it('阶段 1（2+1）仅剩 1 项未满级时，其余 2 张由保底强化卡补齐，绝不越槽塞入新技能', () => {
    const rng = new SeededRNG(999);
    const weapons: WeaponSlotState[] = [
      { weaponId: 'tracking_pulse', level: 5, isEvolved: true, evolutionId: 'evo_star_cluster', cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'orbital_blade', level: 4, isEvolved: false, evolutionId: null, cooldownTimerMs: 0, orbitAngleRad: 0 },
    ];
    const passives: PassiveSlotState[] = [{ passiveId: 'overclock_chip', level: 5 }];

    const cards = rollLevelUpChoices(rng, weapons, passives, 2, 1);
    expect(cards.length).toBe(3);
    expect(cards[0]?.kind).toBe('upgrade_weapon');
    expect(cards[0]?.weaponId).toBe('orbital_blade');
    expect(cards[1]?.kind.startsWith('fallback_')).toBe(true);
    expect(cards[2]?.kind.startsWith('fallback_')).toBe(true);
  });

  it('4+4 槽位全部满级且已进化后，自动切换为固定 3 张满级保底卡', () => {
    const rng = new SeededRNG(777);
    const weapons: WeaponSlotState[] = [
      { weaponId: 'tracking_pulse', level: 5, isEvolved: true, evolutionId: 'evo_star_cluster', cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'orbital_blade', level: 5, isEvolved: true, evolutionId: 'evo_stellar_saw', cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'void_lightning', level: 5, isEvolved: true, evolutionId: 'evo_thunder_storm', cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'gravity_nova', level: 5, isEvolved: true, evolutionId: 'evo_singularity_ring', cooldownTimerMs: 0, orbitAngleRad: 0 },
    ];
    const passives: PassiveSlotState[] = [
      { passiveId: 'overclock_chip', level: 5 },
      { passiveId: 'quantum_accel', level: 5 },
      { passiveId: 'wide_amp', level: 5 },
      { passiveId: 'shield_gen', level: 5 },
    ];

    const cards = rollLevelUpChoices(rng, weapons, passives, 4, 4);
    expect(cards.map((c) => c.kind)).toEqual(['fallback_heal', 'fallback_crystals', 'fallback_damage']);
  });

  it('武器 Lv.5 + 持有对应被动 >= Lv.1 时，开启精英宝箱 100% 必出超武觉醒', () => {
    const rng = new SeededRNG(888);
    const weapons: WeaponSlotState[] = [
      { weaponId: 'tracking_pulse', level: 5, isEvolved: false, evolutionId: null, cooldownTimerMs: 0, orbitAngleRad: 0 },
    ];
    const passives: PassiveSlotState[] = [{ passiveId: 'overclock_chip', level: 1 }];
    const economy = makeEmptyEconomy();
    const buffs = { moveSpeedBonusRatio: 0, damageBonusRatio: 0, extraMaxHpFlat: 0, pickupBonusRatio: 0 };

    expect(findReadyEvolutions(weapons, passives).map((e) => e.id)).toEqual(['evo_star_cluster']);

    const { payload, evolvedTo } = resolveEliteChest(rng, weapons, passives, economy, buffs);
    expect(evolvedTo?.id).toBe('evo_star_cluster');
    expect(payload.isEvolution).toBe(true);
    expect(weapons[0]?.isEvolved).toBe(true);
    expect(weapons[0]?.evolutionId).toBe('evo_star_cluster');
  });

  it('单局保底回血最多生效 3 次，达到上限后自动从抽卡池移除并由机动保底卡补足 3 项', () => {
    const rng = new SeededRNG(2026);
    const weapons: WeaponSlotState[] = [
      { weaponId: 'tracking_pulse', level: 5, isEvolved: true, evolutionId: 'evo_star_cluster', cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'orbital_blade', level: 5, isEvolved: true, evolutionId: 'evo_stellar_saw', cooldownTimerMs: 0, orbitAngleRad: 0 },
    ];
    const passives: PassiveSlotState[] = [{ passiveId: 'overclock_chip', level: 5 }];

    // 第 1~3 次（已用 0/1/2 次）均允许出现保底回血
    for (let used = 0; used < 3; used++) {
      const cards = rollLevelUpChoices(rng, weapons, passives, 2, 1, [], used);
      expect(cards.map((c) => c.kind)).toEqual(['fallback_heal', 'fallback_crystals', 'fallback_damage']);
      expect(cards[0]?.tag).toContain(`${3 - used}/3`);
    }

    // 达到 3 次上限后，彻底剔除 fallback_heal，保持 3 张合法保底卡
    const cappedCards = rollLevelUpChoices(rng, weapons, passives, 2, 1, [], 3);
    expect(cappedCards.map((c) => c.kind)).toEqual(['fallback_crystals', 'fallback_damage', 'fallback_speed']);
    expect(cappedCards.some((c) => c.kind === 'fallback_heal')).toBe(false);

    // 即便直接调用 applySelectedChoice 也严格拦截第 4 次保底回血
    const healCard = buildFallbackLevelUpChoices(0)[0]!;
    const player = {
      formId: 'form_1_initiate' as const,
      stageId: 'stage_1' as const,
      currentLevel: 1,
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      radiusPx: 14,
      hp: 40,
      maxHp: 100,
      invulnSec: 0,
      level: 20,
      xp: 0,
      xpToNext: 100,
      rerollsLeft: 0,
      entityState: 'ALIVE_NORMAL' as const,
      stats: {
        maxHp: 100,
        moveSpeedPxPerSec: 150,
        pickupRadiusPx: 100,
        damageMult: 1,
        cooldownReductionRatio: 0,
        areaMult: 1,
        critChanceRatio: 0.08,
        critDamageMult: 1.75,
        xpGainMult: 1,
        hpRegenPerSec: 0,
        crystalExtractMult: 1,
      },
    };
    const buffs = { moveSpeedBonusRatio: 0, damageBonusRatio: 0, extraMaxHpFlat: 0, pickupBonusRatio: 0 };
    const blocked = applySelectedChoice(healCard, player, weapons, passives, buffs, makeEmptyEconomy(), 2, 1, 3);
    expect(blocked.healedAmount).toBe(0);
    expect(blocked.usedFallbackHeal).toBe(false);
    expect(player.hp).toBe(40);
  });

  it('六大超武二次下调 20% 伤害后：单次基础伤害收敛至 Lv.5 原武之下，但综合 DPS 仍显著高于 Lv.5 原武', () => {
    expect(GAME_CONFIG.evolutions).toHaveLength(6);
    for (const evo of GAME_CONFIG.evolutions) {
      const baseLv5 = WEAPON_BY_ID[evo.requiredWeaponId].levels[4]!;
      expect(evo.stats.damage).toBeGreaterThanOrEqual(Math.floor(baseLv5.damage * 0.75));
      expect(evo.stats.damage).toBeLessThanOrEqual(baseLv5.damage);

      const baseDps = (baseLv5.damage * baseLv5.projectileCount) / (baseLv5.cooldownMs / 1000);
      const evoDps = (evo.stats.damage * evo.stats.projectileCount) / (evo.stats.cooldownMs / 1000);
      expect(evoDps).toBeGreaterThan(baseDps * 1.2);
    }
  });
});
