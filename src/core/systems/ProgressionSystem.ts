/**
 * 经验曲线、动态槽位上限抽卡隔离（2+1 → 4+4）、重随去重、满级保底与精英宝箱系统（V2.0）
 * 核心红线：一旦主动或被动槽达到当前阶段形态上限，100% 剔除全部未拥有新技能，绝不出现无法装备的超槽选项。
 */
import type {
  EvolutionRecipeConfig,
  PassiveSlotState,
  PlayerRuntimeState,
  RunEconomyRuntimeState,
  WeaponSlotState,
} from '../../../schemas';
import {
  EVOLUTION_BY_ID,
  GAME_CONFIG,
  PASSIVE_BY_ID,
  WEAPON_BY_ID,
} from '../../config/gameConfig';
import type { ChestModalPayload, UpgradeCardChoice } from '../contracts/gameContracts';
import type { SeededRNG } from '../engine/SeededRNG';
import type { RunAltarAndFallbackBuffs } from './StatCalculator';

export function computeXpToNextLevel(level: number): number {
  const safeLv = Math.max(1, Math.floor(level));
  return Math.round(12 + (safeLv - 1) * 9 + Math.pow(safeLv - 1, 1.48) * 3.4);
}

/** 查询当前满足「武器满级 Lv.5 + 配对被动 >= Lv.1 + 尚未进化」的全部就绪超武配方 */
export function findReadyEvolutions(
  weapons: readonly WeaponSlotState[],
  passives: readonly PassiveSlotState[],
): EvolutionRecipeConfig[] {
  const ready: EvolutionRecipeConfig[] = [];
  for (const recipe of GAME_CONFIG.evolutions) {
    const w = weapons.find((slot) => slot.weaponId === recipe.requiredWeaponId);
    const p = passives.find((slot) => slot.passiveId === recipe.requiredPassiveId);
    if (
      w &&
      !w.isEvolved &&
      w.level >= recipe.requiredWeaponLevel &&
      p &&
      p.level >= recipe.requiredPassiveMinLevel
    ) {
      ready.push(recipe);
    }
  }
  return ready;
}

export function buildFallbackLevelUpChoices(fallbackHealsUsed = 0): UpgradeCardChoice[] {
  const maxHeals = GAME_CONFIG.balance.maxFallbackHealsPerRun;
  const remainingHeals = Math.max(0, maxHeals - fallbackHealsUsed);

  const cards: UpgradeCardChoice[] = [];
  if (remainingHeals > 0) {
    cards.push({
      key: 'fallback_heal',
      kind: 'fallback_heal',
      tag: `满级保底 · 修复 (${remainingHeals}/${maxHeals})`,
      title: '应急修复协议',
      description: `立即回复 30% 最大生命值，稳住高压黑潮防线（单局最多 ${maxHeals} 次，剩余 ${remainingHeals} 次）。`,
      accentColorHex: '#34D399',
    });
  }

  cards.push(
    {
      key: 'fallback_crystals',
      kind: 'fallback_crystals',
      tag: '满级保底 · 经济',
      title: '虚空晶体提炼',
      description: '本局额外获得 +32 虚空晶体（结算计入萃取倍率）。',
      accentColorHex: '#FACC15',
    },
    {
      key: 'fallback_damage',
      kind: 'fallback_damage',
      tag: '满级保底 · 过载',
      title: '无限过载增幅',
      description: '本局永久提升 +5% 全局攻击力（可无限叠加）。',
      accentColorHex: '#C084FC',
    },
  );

  if (cards.length < 3) {
    cards.push({
      key: 'fallback_speed',
      kind: 'fallback_speed',
      tag: '满级保底 · 机动',
      title: '跃迁机动微调',
      description: '本局永久提升 +5% 移动速度，增强高压黑潮走位拉扯容错。',
      accentColorHex: '#38BDF8',
    });
  }

  return cards;
}

export function buildAltarBlessingChoices(): UpgradeCardChoice[] {
  return [
    {
      key: 'altar_speed',
      kind: 'altar_speed',
      tag: '祭坛赐福 · 机动',
      title: '虚空跃迁场',
      description: '本局移动速度永久 +15%，显著增强走位拉扯空间。',
      accentColorHex: '#38BDF8',
    },
    {
      key: 'altar_damage',
      kind: 'altar_damage',
      tag: '祭坛赐福 · 火力',
      title: '核心共振过载',
      description: '本局全局攻击力永久 +15%，大幅加快清潮效率。',
      accentColorHex: '#FACC15',
    },
    {
      key: 'altar_heal_crystals',
      kind: 'altar_heal_crystals',
      tag: '祭坛赐福 · 续航',
      title: '全效能量重构',
      description: '立即回满生命值并额外获得 +48 虚空晶体。',
      accentColorHex: '#34D399',
    },
  ];
}

/**
 * 抽取升级三选一卡片（严格遵守当前阶段的 maxActiveSlots + maxPassiveSlots 上限隔离）
 * - 主动槽满后：严禁抽取任何 new_weapon
 * - 被动槽满后：严禁抽取任何 new_passive
 * - 候选不足 3 张时：由固定 3 项保底卡补齐，确保 100% 合法可生效
 */
export function rollLevelUpChoices(
  rng: SeededRNG,
  weapons: readonly WeaponSlotState[],
  passives: readonly PassiveSlotState[],
  maxActiveSlots: number,
  maxPassiveSlots: number,
  previousChoiceKeys: readonly string[] = [],
  fallbackHealsUsed = 0,
): UpgradeCardChoice[] {
  const balance = GAME_CONFIG.balance;
  const weightedPool: { item: UpgradeCardChoice; weight: number }[] = [];

  // 1. 若有就绪超武（必然是已拥有武器+已拥有被动），按 15% 保底概率注入 1 张进化卡
  const readyEvos = findReadyEvolutions(weapons, passives);
  let guaranteedEvoCard: UpgradeCardChoice | null = null;
  if (readyEvos.length > 0 && rng.chance(balance.evoFallbackInLevelUpProbRatio)) {
    const picked = readyEvos[rng.nextInt(0, readyEvos.length - 1)];
    if (picked) {
      const wName = WEAPON_BY_ID[picked.requiredWeaponId].name;
      const pName = PASSIVE_BY_ID[picked.requiredPassiveId].name;
      guaranteedEvoCard = {
        key: `evo:${picked.id}`,
        kind: 'evolution',
        tag: '超武觉醒 · 保底共鸣',
        title: `⚡ ${picked.name}`,
        description: `【${wName} + ${pName}】${picked.description}`,
        accentColorHex: picked.accentColorHex,
        weaponId: picked.requiredWeaponId,
        evolutionId: picked.id,
      };
    }
  }

  // 2. 主动武器候选（严格检查 weapons.length >= maxActiveSlots）
  const weaponSlotsFull = weapons.length >= maxActiveSlots;
  for (const cfg of GAME_CONFIG.weapons) {
    const owned = weapons.find((s) => s.weaponId === cfg.id);
    if (owned) {
      if (!owned.isEvolved && owned.level < balance.normalItemMaxLevel) {
        const nextLv = owned.level + 1;
        const lvInfo = cfg.levels[nextLv - 1];
        weightedPool.push({
          item: {
            key: `w:${cfg.id}`,
            kind: 'upgrade_weapon',
            tag: `主动升级 · LV.${nextLv}`,
            title: cfg.name,
            description: lvInfo?.upgradeSummary ?? cfg.description,
            accentColorHex: cfg.accentColorHex,
            weaponId: cfg.id,
            nextLevel: nextLv,
          },
          weight: 30,
        });
      }
    } else if (!weaponSlotsFull) {
      weightedPool.push({
        item: {
          key: `w:${cfg.id}`,
          kind: 'new_weapon',
          tag: '新主动武器',
          title: cfg.name,
          description: cfg.description,
          accentColorHex: cfg.accentColorHex,
          weaponId: cfg.id,
          nextLevel: 1,
        },
        weight: 22,
      });
    }
  }

  // 3. 被动核心候选（严格检查 passives.length >= maxPassiveSlots）
  const passiveSlotsFull = passives.length >= maxPassiveSlots;
  const ownedWeaponIds = new Set(weapons.map((w) => w.weaponId));
  for (const cfg of GAME_CONFIG.passives) {
    const owned = passives.find((s) => s.passiveId === cfg.id);
    const matchesOwnedWeapon = GAME_CONFIG.evolutions.some(
      (evo) => evo.requiredPassiveId === cfg.id && ownedWeaponIds.has(evo.requiredWeaponId),
    );
    if (owned) {
      if (owned.level < balance.normalItemMaxLevel) {
        const nextLv = owned.level + 1;
        const lvInfo = cfg.levels[nextLv - 1];
        weightedPool.push({
          item: {
            key: `p:${cfg.id}`,
            kind: 'upgrade_passive',
            tag: `被动升级 · LV.${nextLv}`,
            title: cfg.name,
            description: lvInfo?.upgradeSummary ?? cfg.description,
            accentColorHex: cfg.accentColorHex,
            passiveId: cfg.id,
            nextLevel: nextLv,
          },
          weight: 26,
        });
      }
    } else if (!passiveSlotsFull) {
      weightedPool.push({
        item: {
          key: `p:${cfg.id}`,
          kind: 'new_passive',
          tag: matchesOwnedWeapon ? '新被动核心 · 超武配对' : '新被动核心',
          title: cfg.name,
          description: cfg.description,
          accentColorHex: cfg.accentColorHex,
          passiveId: cfg.id,
          nextLevel: 1,
        },
        weight: matchesOwnedWeapon ? 26 : 16,
      });
    }
  }

  // 4. 若当前阶段槽位内全部已满级且无就绪超武，直接返回满级固定 3 项保底卡
  if (weightedPool.length === 0 && !guaranteedEvoCard) {
    return buildFallbackLevelUpChoices(fallbackHealsUsed);
  }

  const prevSet = new Set(previousChoiceKeys);
  const filteredPool =
    prevSet.size > 0 && weightedPool.filter((e) => !prevSet.has(e.item.key)).length >= (guaranteedEvoCard ? 2 : 3)
      ? weightedPool.filter((e) => !prevSet.has(e.item.key))
      : [...weightedPool];

  const result: UpgradeCardChoice[] = [];
  if (guaranteedEvoCard) {
    result.push(guaranteedEvoCard);
  }

  const working = [...filteredPool];
  while (result.length < 3 && working.length > 0) {
    const picked = rng.pickWeighted(working);
    if (!picked) break;
    result.push(picked);
    const idx = working.findIndex((e) => e.item.key === picked.key);
    if (idx !== -1) working.splice(idx, 1);
  }

  // 不足 3 张时用保底强化卡补齐，绝不越槽塞入未拥有技能
  const fallbacks = buildFallbackLevelUpChoices(fallbackHealsUsed);
  for (const fb of fallbacks) {
    if (result.length >= 3) break;
    if (!result.some((c) => c.key === fb.key)) {
      result.push(fb);
    }
  }

  return result;
}

/** 开启精英进化宝箱：满足超武条件 100% 必出超武觉醒；否则发放 1~2 项已有装备升级 + 虚空晶体 */
export function resolveEliteChest(
  rng: SeededRNG,
  weapons: WeaponSlotState[],
  passives: PassiveSlotState[],
  economy: RunEconomyRuntimeState,
  buffs: RunAltarAndFallbackBuffs,
): { readonly payload: ChestModalPayload; readonly evolvedTo: EvolutionRecipeConfig | null } {
  const readyEvos = findReadyEvolutions(weapons, passives);
  if (readyEvos.length > 0) {
    const evo = readyEvos[0]!;
    const slot = weapons.find((w) => w.weaponId === evo.requiredWeaponId);
    if (slot) {
      slot.isEvolved = true;
      slot.evolutionId = evo.id;
      slot.cooldownTimerMs = 0;
    }
    const grantedCrystals = 40;
    economy.runBonusCrystals += grantedCrystals;
    return {
      evolvedTo: evo,
      payload: {
        title: '⚡ 超武共鸣觉醒！',
        isEvolution: true,
        evolutionId: evo.id,
        sourceWeaponName: WEAPON_BY_ID[evo.requiredWeaponId].name,
        sourcePassiveName: PASSIVE_BY_ID[evo.requiredPassiveId].name,
        evolutionName: evo.name,
        evolutionDescription: evo.description,
        bonusUpgradeSummaries: [],
        grantedCrystals,
      },
    };
  }

  const upgradable: { readonly kind: 'w' | 'p'; readonly idx: number }[] = [];
  weapons.forEach((w, idx) => {
    if (!w.isEvolved && w.level < GAME_CONFIG.balance.normalItemMaxLevel) {
      upgradable.push({ kind: 'w', idx });
    }
  });
  passives.forEach((p, idx) => {
    if (p.level < GAME_CONFIG.balance.normalItemMaxLevel) {
      upgradable.push({ kind: 'p', idx });
    }
  });

  const summaries: string[] = [];
  const grantCount = Math.min(2, upgradable.length);
  rng.shuffleInPlace(upgradable);

  for (let i = 0; i < grantCount; i++) {
    const target = upgradable[i];
    if (!target) continue;
    if (target.kind === 'w') {
      const slot = weapons[target.idx];
      if (slot) {
        slot.level += 1;
        const cfg = WEAPON_BY_ID[slot.weaponId];
        summaries.push(`${cfg.name} 升至 LV.${slot.level}`);
      }
    } else {
      const slot = passives[target.idx];
      if (slot) {
        slot.level += 1;
        const cfg = PASSIVE_BY_ID[slot.passiveId];
        summaries.push(`${cfg.name} 升至 LV.${slot.level}`);
      }
    }
  }

  if (summaries.length === 0) {
    buffs.damageBonusRatio += 0.08;
    summaries.push('全装满级转化：本局全局攻击力 +8%');
  }

  const grantedCrystals = 52;
  economy.runBonusCrystals += grantedCrystals;
  return {
    evolvedTo: null,
    payload: {
      title: '精英虚空补给箱',
      isEvolution: false,
      evolutionId: null,
      sourceWeaponName: null,
      sourcePassiveName: null,
      evolutionName: null,
      evolutionDescription: null,
      bonusUpgradeSummaries: summaries,
      grantedCrystals,
    },
  };
}

/** 将玩家选中的升级卡或祭坛赐福应用到运行时状态（严格校验当前阶段动态槽位上限） */
export function applySelectedChoice(
  choice: UpgradeCardChoice,
  player: PlayerRuntimeState,
  weapons: WeaponSlotState[],
  passives: PassiveSlotState[],
  buffs: RunAltarAndFallbackBuffs,
  economy: RunEconomyRuntimeState,
  maxActiveSlots: number,
  maxPassiveSlots: number,
  fallbackHealsUsed = 0,
): {
  readonly healedAmount: number;
  readonly evolvedId: EvolutionRecipeConfig['id'] | null;
  readonly usedFallbackHeal: boolean;
} {
  let healedAmount = 0;
  let evolvedId: EvolutionRecipeConfig['id'] | null = null;
  let usedFallbackHeal = false;

  switch (choice.kind) {
    case 'new_weapon': {
      if (choice.weaponId && weapons.length < maxActiveSlots) {
        weapons.push({
          weaponId: choice.weaponId,
          level: 1,
          isEvolved: false,
          evolutionId: null,
          cooldownTimerMs: 120,
          orbitAngleRad: 0,
        });
      }
      break;
    }
    case 'upgrade_weapon': {
      if (choice.weaponId) {
        const slot = weapons.find((w) => w.weaponId === choice.weaponId);
        if (slot && !slot.isEvolved && slot.level < GAME_CONFIG.balance.normalItemMaxLevel) {
          slot.level += 1;
        }
      }
      break;
    }
    case 'new_passive': {
      if (choice.passiveId && passives.length < maxPassiveSlots) {
        passives.push({ passiveId: choice.passiveId, level: 1 });
      }
      break;
    }
    case 'upgrade_passive': {
      if (choice.passiveId) {
        const slot = passives.find((p) => p.passiveId === choice.passiveId);
        if (slot && slot.level < GAME_CONFIG.balance.normalItemMaxLevel) {
          slot.level += 1;
        }
      }
      break;
    }
    case 'evolution': {
      if (choice.evolutionId) {
        const evo = EVOLUTION_BY_ID[choice.evolutionId];
        const slot = weapons.find((w) => w.weaponId === evo.requiredWeaponId);
        if (slot && !slot.isEvolved) {
          slot.isEvolved = true;
          slot.evolutionId = evo.id;
          slot.cooldownTimerMs = 0;
          evolvedId = evo.id;
        }
      }
      break;
    }
    case 'fallback_heal': {
      if (fallbackHealsUsed < GAME_CONFIG.balance.maxFallbackHealsPerRun) {
        const heal = Math.round(player.maxHp * 0.3);
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + heal);
        healedAmount = Math.max(0, player.hp - before);
        usedFallbackHeal = true;
      }
      break;
    }
    case 'fallback_crystals': {
      economy.runBonusCrystals += 32;
      break;
    }
    case 'fallback_damage': {
      buffs.damageBonusRatio += 0.05;
      break;
    }
    case 'fallback_speed': {
      buffs.moveSpeedBonusRatio += 0.05;
      break;
    }
    case 'altar_speed': {
      buffs.moveSpeedBonusRatio += 0.15;
      break;
    }
    case 'altar_damage': {
      buffs.damageBonusRatio += 0.15;
      break;
    }
    case 'altar_heal_crystals': {
      const before = player.hp;
      player.hp = player.maxHp;
      healedAmount = Math.max(0, player.hp - before);
      economy.runBonusCrystals += 48;
      break;
    }
  }

  return { healedAmount, evolvedId, usedFallbackHeal };
}
