import { describe, expect, it } from 'vitest';
import { GameController } from '../../src/controller/GameController';
import { FIXED_DT_SEC } from '../../src/core/engine/SimulationWorld';
import { SaveManager, type StorageAdapter } from '../../src/storage/SaveManager';

class InMemoryStorage implements StorageAdapter {
  private readonly map = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

interface SimRunMetrics {
  seed: number;
  levelNumber: number;
  stageNumber: number;
  formId: string;
  starterWeaponLevel: number;
  maxActiveSlots: number;
  maxPassiveSlots: number;
  framesSimulated: number;
  survivedSec: number;
  maxEnemiesPeak: number;
  maxProjectilesPeak: number;
  maxEnemyBulletsPeak: number;
  maxXpGemsPeak: number;
  levelReached: number;
  kills: number;
  bossesKilled: number;
  bossesRequired: number;
  slotOverflowDetected: boolean;
  evolutionsAchieved: number;
  reachedBoss: boolean;
  defeatedAllBosses: boolean;
  enteredEndless: boolean;
  nanDetected: boolean;
}

function runHeadlessBotSimulation(options: {
  seed: number;
  clearedLevelsBefore: number;
  maxFrames: number;
  grantMaxTalents?: boolean;
  keepAliveForStress?: boolean;
}): SimRunMetrics {
  const controller = new GameController(new SaveManager(new InMemoryStorage()));
  controller.debugSetClearedLevels(options.clearedLevelsBefore);

  if (options.grantMaxTalents) {
    controller.debugGrantCrystals(50_000);
    for (const talent of controller.getHudSnapshot().meta.talents) {
      for (let i = 0; i < talent.maxLevel; i++) {
        controller.buyTalent(talent.id);
      }
    }
  }

  controller.startRun(options.seed);
  const startHud = controller.getHudSnapshot();
  const starterWeaponLevel = startHud.weaponSlots[0]?.level ?? 0;

  let maxEnemiesPeak = 0;
  let maxProjectilesPeak = 0;
  let maxEnemyBulletsPeak = 0;
  let maxXpGemsPeak = 0;
  let reachedBoss = false;
  let defeatedAllBosses = false;
  let enteredEndless = false;
  let nanDetected = false;
  let slotOverflowDetected = false;
  let framesSimulated = 0;

  for (let frame = 0; frame < options.maxFrames; frame++) {
    const state = controller.world.appState;

    if (state === 'LEVEL_UP_MODAL' || state === 'ALTAR_MODAL') {
      const hud = controller.getHudSnapshot();
      const choices = state === 'LEVEL_UP_MODAL' ? hud.levelUpChoices : hud.altarChoices;
      const evoIdx = choices.findIndex((c) => c.kind === 'evolution');
      const pick = (evoIdx >= 0 ? evoIdx : 0) as 0 | 1 | 2;
      controller.selectModalChoice(pick);

      // 每次选卡后立即严检当前武器/被动槽位绝对不超过阶段动态槽位上限！
      const postHud = controller.getHudSnapshot();
      if (
        postHud.weaponSlots.length > postHud.maxActiveSlots ||
        postHud.passiveSlots.length > postHud.maxPassiveSlots
      ) {
        slotOverflowDetected = true;
        break;
      }
      continue;
    }

    if (state === 'CHEST_MODAL') {
      controller.confirmChestModal();
      continue;
    }

    if (state === 'VICTORY_MODAL') {
      defeatedAllBosses = true;
      if (controller.getHudSnapshot().settlementModal?.canContinueEndless) {
        controller.continueEndless();
        enteredEndless = true;
        continue;
      }
      break;
    }

    if (state === 'GAME_OVER_MODAL') {
      break;
    }

    const angle = frame * 0.017;
    let moveX = Math.cos(angle);
    let moveY = Math.sin(angle);

    const renderSnap = controller.getRenderSnapshot();
    const activeAltar = renderSnap.altars.find((a) => a.chargeRatio < 1);
    if (activeAltar) {
      const dx = activeAltar.x - renderSnap.player.x;
      const dy = activeAltar.y - renderSnap.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 35) {
        moveX = dx / dist;
        moveY = dy / dist;
      }
    }

    if (options.keepAliveForStress && controller.world.player.hp < controller.world.player.maxHp * 0.45) {
      controller.world.player.hp = controller.world.player.maxHp;
    }

    controller.step(FIXED_DT_SEC, { moveX, moveY });
    controller.clearFrameEvents();
    framesSimulated++;

    if (controller.world.activeRunPhase === 'RUN_BOSS') {
      reachedBoss = true;
    }

    const counts = controller.world.getEntityCounts();
    if (counts.enemies > maxEnemiesPeak) maxEnemiesPeak = counts.enemies;
    if (counts.projectiles > maxProjectilesPeak) maxProjectilesPeak = counts.projectiles;
    if (counts.enemyBullets > maxEnemyBulletsPeak) maxEnemyBulletsPeak = counts.enemyBullets;
    if (counts.xpGems > maxXpGemsPeak) maxXpGemsPeak = counts.xpGems;

    if (frame % 60 === 0) {
      const snap = controller.getRenderSnapshot();
      const p = controller.world.player;
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.hp) ||
        !Number.isFinite(p.xp) ||
        p.hp < 0 ||
        p.xp < 0
      ) {
        nanDetected = true;
        break;
      }
      for (const e of snap.enemies) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) {
          nanDetected = true;
          break;
        }
      }
      if (nanDetected) break;
    }
  }

  const hud = controller.getHudSnapshot();
  return {
    seed: options.seed,
    levelNumber: startHud.currentLevel,
    stageNumber: startHud.stageNumber,
    formId: startHud.formId,
    starterWeaponLevel,
    maxActiveSlots: startHud.maxActiveSlots,
    maxPassiveSlots: startHud.maxPassiveSlots,
    framesSimulated,
    survivedSec: Math.round(hud.elapsedSec),
    maxEnemiesPeak,
    maxProjectilesPeak,
    maxEnemyBulletsPeak,
    maxXpGemsPeak,
    levelReached: hud.level,
    kills: hud.kills,
    bossesKilled: hud.bossProgress.killed,
    bossesRequired: hud.bossProgress.total,
    slotOverflowDetected,
    evolutionsAchieved: hud.weaponSlots.filter((w) => w.isEvolved).length,
    reachedBoss,
    defeatedAllBosses,
    enteredEndless,
    nanDetected,
  };
}

describe('V2.0 Stage 9 Headless Simulation & Stress Soak (5 Stages + 45,000 Frames)', () => {
  it('runs Stage 5 (Level 26, Form V) 45,000-frame multi-Boss stress soak across 3 seeds with zero NaN & zero slot overflow', () => {
    const seeds = [1001, 2002, 3003];
    const results: SimRunMetrics[] = [];

    for (const seed of seeds) {
      const m = runHeadlessBotSimulation({
        seed,
        clearedLevelsBefore: 25,
        maxFrames: 45_000,
        grantMaxTalents: true,
        keepAliveForStress: true,
      });
      results.push(m);

      expect(m.nanDetected).toBe(false);
      expect(m.slotOverflowDetected).toBe(false);
      expect(m.stageNumber).toBe(5);
      expect(m.starterWeaponLevel).toBe(5);
      expect(m.maxEnemiesPeak).toBeLessThanOrEqual(324);
      expect(m.maxProjectilesPeak).toBeLessThanOrEqual(240);
      expect(m.maxEnemyBulletsPeak).toBeLessThanOrEqual(180);
      expect(m.maxXpGemsPeak).toBeLessThanOrEqual(320);
      expect(m.reachedBoss).toBe(true);
      expect(m.levelReached).toBeGreaterThanOrEqual(12);
      expect(m.kills).toBeGreaterThanOrEqual(300);
    }

    console.info('[SIM-V2-STAGE5-SOAK]', JSON.stringify(results));
  }, 45_000);

  it('verifies all 5 Stages (Levels 1/4/9/17/26): starter weapon Lv.1→Lv.5, strict 2+1→4+4 zero slot overflow, zero NaN', () => {
    const stageSamples = [
      { cleared: 0, expectedStage: 1, expectedStarterLv: 1, expectedSlots: '2+1' },
      { cleared: 3, expectedStage: 2, expectedStarterLv: 2, expectedSlots: '2+2' },
      { cleared: 8, expectedStage: 3, expectedStarterLv: 3, expectedSlots: '3+2' },
      { cleared: 16, expectedStage: 4, expectedStarterLv: 4, expectedSlots: '3+3' },
      { cleared: 25, expectedStage: 5, expectedStarterLv: 5, expectedSlots: '4+4' },
    ];
    const stageMetrics: SimRunMetrics[] = [];

    for (const sample of stageSamples) {
      const m = runHeadlessBotSimulation({
        seed: 7777,
        clearedLevelsBefore: sample.cleared,
        maxFrames: 11_000,
        grantMaxTalents: false,
        keepAliveForStress: true,
      });

      expect(m.nanDetected).toBe(false);
      expect(m.slotOverflowDetected).toBe(false);
      expect(m.stageNumber).toBe(sample.expectedStage);
      expect(m.starterWeaponLevel).toBe(sample.expectedStarterLv);
      expect(`${m.maxActiveSlots}+${m.maxPassiveSlots}`).toBe(sample.expectedSlots);
      expect(m.kills).toBeGreaterThan(20);
      stageMetrics.push(m);
    }

    console.info('[SIM-V2-FIVE-STAGES]', JSON.stringify(stageMetrics));
  }, 30_000);

  it('survives 20 consecutive Clean Reset cycles with zero entity leak and identical initial state', () => {
    const controller = new GameController(new SaveManager(new InMemoryStorage()));
    controller.startRun(4242);

    for (let i = 0; i < 20; i++) {
      for (let f = 0; f < 180; f++) {
        if (controller.world.isRunningPhase()) {
          controller.step(FIXED_DT_SEC, { moveX: 1, moveY: 0 });
          controller.clearFrameEvents();
        }
      }
      expect(controller.restartRun(4242).ok).toBe(false);
      expect(controller.pause('manual').ok).toBe(true);
      expect(controller.restartRun(4242).ok).toBe(true);
      const counts = controller.world.getEntityCounts();
      const hud = controller.getHudSnapshot();
      expect(counts.enemies).toBe(5);
      expect(counts.projectiles).toBe(0);
      expect(counts.xpGems).toBe(0);
      expect(counts.chests).toBe(0);
      expect(hud.kills).toBe(0);
      expect(hud.elapsedSec).toBe(0);
      expect(hud.level).toBe(1);
    }
  });
});
