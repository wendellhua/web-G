/**
 * 两段增量虚空晶体结算公式（V2.0 适配五大阶段通关奖金）
 * - 常规/通关段（包含阶段通关奖金 clearCrystalBonus）；
 * - 无尽增量段（仅阶段 5 进入无尽并在无尽中阵亡时追加结算）。
 */
import type { RunEconomyRuntimeState } from '../../../schemas';
import { GAME_CONFIG } from '../../config/gameConfig';

export function calculateNormalOrVictoryCrystals(
  survivedSec: number,
  economy: RunEconomyRuntimeState,
  bossDefeated: boolean,
  stageClearBonus: number,
  crystalExtractMult: number,
): number {
  const outputMult = GAME_CONFIG.balance.crystalOutputMult;
  const survivedMin = Math.floor(Math.max(0, survivedSec) / 60);
  const performanceRaw =
    survivedMin * 18 +
    Math.floor(economy.kills / 15) +
    economy.elitesKilled * 35 +
    economy.altarsCompleted * 25;
  const raw =
    performanceRaw * outputMult +
    economy.runBonusCrystals +
    (bossDefeated ? stageClearBonus : 0);
  return Math.max(0, Math.floor(raw * Math.max(1, crystalExtractMult)));
}

export function calculateEndlessDeltaCrystals(
  endlessSec: number,
  economy: RunEconomyRuntimeState,
  crystalExtractMult: number,
): number {
  const outputMult = GAME_CONFIG.balance.crystalOutputMult;
  const endlessMin = Math.floor(Math.max(0, endlessSec) / 60);
  const deltaKills = Math.max(0, economy.kills - economy.victoryBaselineKills);
  const deltaElites = Math.max(0, economy.elitesKilled - economy.victoryBaselineElites);
  const deltaAltars = Math.max(0, economy.altarsCompleted - economy.victoryBaselineAltars);
  const deltaBonus = Math.max(0, economy.runBonusCrystals - economy.victoryBaselineBonusCrystals);

  const performanceRaw =
    endlessMin * 25 +
    Math.floor(deltaKills / 12) +
    deltaElites * 45 +
    deltaAltars * 30;
  const raw = performanceRaw * outputMult + deltaBonus;
  return Math.max(0, Math.floor(raw * Math.max(1, crystalExtractMult)));
}
