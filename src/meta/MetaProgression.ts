/**
 * 局外成长与五阶段生涯进度纯逻辑系统（V2.0）
 * - 8 项免费可洗点永久天赋树
 * - 不可逆生涯推进（累计通关 3/8/16/25 关自动解锁形态 II~V）
 * - 完整重置生涯（角色形态、天赋、晶体、关卡进度、战绩全部清零回第 1 关）
 */
import {
  TALENT_IDS,
  createEmptyTalentRecord,
  type EvolutionId,
  type FormConfig,
  type GameSettings,
  type SaveDataV2,
  type StageConfig,
  type TalentId,
} from '../../schemas';
import {
  FORM_BY_ID,
  GAME_CONFIG,
  STAGE_BY_ID,
  TALENT_BY_ID,
  resolveStageByClearedCount,
} from '../config/gameConfig';
import { createDefaultSaveData } from '../storage/SaveManager';

export interface MetaMutationResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly nextSave: SaveDataV2;
}

export interface MetaStatBonuses {
  readonly maxHpFlat: number;
  readonly moveSpeedRatio: number;
  readonly damageRatio: number;
  readonly cooldownReductionRatio: number;
  readonly pickupRadiusRatio: number;
  readonly xpGainRatio: number;
  readonly extraRerolls: number;
  readonly crystalExtractRatio: number;
}

export function computeMetaStatBonuses(save: SaveDataV2): MetaStatBonuses {
  const t = save.metaProgress.talents;
  return {
    maxHpFlat: t.void_hull * TALENT_BY_ID.void_hull.valuePerLevel,
    moveSpeedRatio: t.warp_engine * TALENT_BY_ID.warp_engine.valuePerLevel,
    damageRatio: t.energy_overload * TALENT_BY_ID.energy_overload.valuePerLevel,
    cooldownReductionRatio: t.phase_cooldown * TALENT_BY_ID.phase_cooldown.valuePerLevel,
    pickupRadiusRatio: t.gravity_horizon * TALENT_BY_ID.gravity_horizon.valuePerLevel,
    xpGainRatio: t.wisdom_siphon * TALENT_BY_ID.wisdom_siphon.valuePerLevel,
    extraRerolls: t.fate_reroll * TALENT_BY_ID.fate_reroll.valuePerLevel,
    crystalExtractRatio: t.crystal_extract * TALENT_BY_ID.crystal_extract.valuePerLevel,
  };
}

export function getNextTalentCost(save: SaveDataV2, talentId: TalentId): number | null {
  const cfg = TALENT_BY_ID[talentId];
  const currentLevel = save.metaProgress.talents[talentId];
  if (currentLevel >= cfg.maxLevel) return null;
  return cfg.costsByLevel[currentLevel] ?? null;
}

export function buyTalent(save: SaveDataV2, talentId: TalentId): MetaMutationResult {
  const cost = getNextTalentCost(save, talentId);
  if (cost === null) {
    return { ok: false, reason: 'TALENT_MAXED', nextSave: save };
  }
  if (save.metaProgress.voidCrystals < cost) {
    return { ok: false, reason: 'INSUFFICIENT_CRYSTALS', nextSave: save };
  }

  const nextSave = structuredClone(save);
  nextSave.metaProgress.voidCrystals -= cost;
  nextSave.metaProgress.spentCrystals += cost;
  nextSave.metaProgress.talents[talentId] += 1;
  return { ok: true, nextSave };
}

/** 免费一键洗点：全额退还全部已投入虚空晶体（精确重算零损耗） */
export function resetAllTalents(save: SaveDataV2): MetaMutationResult {
  let refundable = 0;
  for (const id of TALENT_IDS) {
    const cfg = TALENT_BY_ID[id];
    const lv = save.metaProgress.talents[id];
    for (let i = 0; i < lv; i++) {
      refundable += cfg.costsByLevel[i] ?? 0;
    }
  }
  if (refundable === 0) {
    return { ok: false, reason: 'NO_TALENTS_TO_RESET', nextSave: save };
  }

  const nextSave = structuredClone(save);
  nextSave.metaProgress.voidCrystals += refundable;
  nextSave.metaProgress.spentCrystals = 0;
  nextSave.metaProgress.talents = createEmptyTalentRecord();
  return { ok: true, nextSave };
}

/**
 * 完整重置生涯（回到第 1 关全新玩家状态）：
 * 角色形态、天赋树、虚空晶体、关卡进度与战绩全部归零，仅保留音频/护眼设置。
 */
export function resetCareerProgress(save: SaveDataV2, nowMs: number = Date.now()): MetaMutationResult {
  const fresh = createDefaultSaveData(nowMs);
  fresh.settings = structuredClone(save.settings);
  return { ok: true, nextSave: fresh };
}

export function updateSaveSettings(save: SaveDataV2, patch: Partial<GameSettings>): MetaMutationResult {
  const nextSave = structuredClone(save);
  nextSave.settings = {
    ...nextSave.settings,
    ...patch,
    masterVolumeRatio: Math.max(0, Math.min(1, patch.masterVolumeRatio ?? nextSave.settings.masterVolumeRatio)),
    bgmVolumeRatio: Math.max(0, Math.min(1, patch.bgmVolumeRatio ?? nextSave.settings.bgmVolumeRatio)),
    sfxVolumeRatio: Math.max(0, Math.min(1, patch.sfxVolumeRatio ?? nextSave.settings.sfxVolumeRatio)),
  };
  return { ok: true, nextSave };
}

export interface RunSettlementPatch {
  readonly grantedCrystals: number;
  readonly isVictorySettlement: boolean;
  readonly isRunFinalEnd: boolean;
  readonly survivedSec: number;
  readonly endlessSec: number;
  readonly totalRunKills: number;
  readonly deltaKillsToAdd: number;
  readonly newlyDiscoveredEvolutions: readonly EvolutionId[];
}

export interface SettlementApplyResult {
  readonly nextSave: SaveDataV2;
  readonly newlyUnlockedForm: FormConfig | null;
  readonly newlyUnlockedStage: StageConfig | null;
}

export function applyRunSettlementToSave(
  save: SaveDataV2,
  patch: RunSettlementPatch,
): SettlementApplyResult {
  const nextSave = structuredClone(save);
  nextSave.metaProgress.voidCrystals += Math.max(0, Math.floor(patch.grantedCrystals));

  let newlyUnlockedForm: FormConfig | null = null;
  let newlyUnlockedStage: StageConfig | null = null;

  if (patch.isVictorySettlement) {
    const maxLevels = GAME_CONFIG.balance.maxTotalLevels;
    const prevFormId = nextSave.career.unlockedFormId;
    nextSave.runRecords.totalVictories += 1;
    nextSave.career.clearedLevelsCount = Math.min(maxLevels, nextSave.career.clearedLevelsCount + 1);
    nextSave.career.currentLevel = Math.min(maxLevels, nextSave.career.clearedLevelsCount + 1);

    const resolvedStage = resolveStageByClearedCount(nextSave.career.clearedLevelsCount);
    nextSave.career.currentStageId = resolvedStage.id;
    nextSave.career.unlockedFormId = resolvedStage.formId;

    if (resolvedStage.formId !== prevFormId) {
      newlyUnlockedForm = FORM_BY_ID[resolvedStage.formId];
      newlyUnlockedStage = STAGE_BY_ID[resolvedStage.id];
    }
  }

  if (patch.isRunFinalEnd) {
    nextSave.runRecords.totalRuns += 1;
  }
  nextSave.runRecords.totalKills += Math.max(0, Math.floor(patch.deltaKillsToAdd));
  nextSave.runRecords.bestSurvivalSec = Math.max(nextSave.runRecords.bestSurvivalSec, patch.survivedSec);
  nextSave.runRecords.bestEndlessSec = Math.max(nextSave.runRecords.bestEndlessSec, patch.endlessSec);
  nextSave.runRecords.bestSingleRunKills = Math.max(
    nextSave.runRecords.bestSingleRunKills,
    Math.floor(patch.totalRunKills),
  );

  for (const evoId of patch.newlyDiscoveredEvolutions) {
    if (!nextSave.unlocks.discoveredEvolutions.includes(evoId)) {
      nextSave.unlocks.discoveredEvolutions.push(evoId);
    }
  }

  return { nextSave, newlyUnlockedForm, newlyUnlockedStage };
}

/** 计算距离下一形态自动解锁的进度信息（供主界面进度条展示） */
export function getNextFormUnlockProgress(clearedLevelsCount: number): {
  nextForm: FormConfig | null;
  remainingClears: number;
  targetClears: number;
} {
  for (const form of GAME_CONFIG.forms) {
    if (clearedLevelsCount < form.requiredTotalClears) {
      return {
        nextForm: form,
        remainingClears: form.requiredTotalClears - clearedLevelsCount,
        targetClears: form.requiredTotalClears,
      };
    }
  }
  return { nextForm: null, remainingClears: 0, targetClears: 25 };
}
