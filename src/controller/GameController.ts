/**
 * GameController —— V2.0 五大阶段宏观流程协调器
 * 负责衔接 SimulationWorld（无头核心）、SaveManager（V2 存档与自动迁移）与 MetaProgression（五阶段不可逆生涯），
 * 强制校验前置 FSM 状态合法性，执行两段增量安全落盘与跨阶段形态进阶解锁公告注入。
 */
import type {
  DebugTimeScale,
  GameSettings,
  SaveDataV2,
  SaveLoadResult,
  TalentId,
  TitleSubView,
} from '../../schemas';
import { FORM_BY_ID, GAME_CONFIG, STAGE_BY_ID } from '../config/gameConfig';
import type {
  ControllerActionResult,
  GameEvent,
  HudSnapshot,
  InputCommandFrame,
  MetaHudSnapshot,
  RenderSnapshot,
} from '../core/contracts/gameContracts';
import { SimulationWorld } from '../core/engine/SimulationWorld';
import {
  applyRunSettlementToSave,
  buyTalent,
  computeMetaStatBonuses,
  getNextFormUnlockProgress,
  getNextTalentCost,
  resetAllTalents,
  resetCareerProgress,
  updateSaveSettings,
} from '../meta/MetaProgression';
import { SaveManager } from '../storage/SaveManager';

export class GameController {
  public readonly world: SimulationWorld;
  private readonly saveManager: SaveManager;
  private saveData: SaveDataV2;
  private titleSubView: TitleSubView = 'MAIN_MENU';
  private pauseReason: string | null = null;
  private isResetting = false;
  private seedCounter = 1001;
  private runtimeTimeScaleOverride: DebugTimeScale | null = null;

  constructor(saveManager: SaveManager = new SaveManager(), world: SimulationWorld = new SimulationWorld()) {
    this.saveManager = saveManager;
    this.world = world;
    const loaded = this.saveManager.load();
    this.saveData = loaded.data;
    if (this.saveData.settings.debugPlayerInvincible) {
      this.world.setDebugPlayerInvincible(true);
    }
    this.world.appState = 'TITLE';
  }

  public isPlayerInvincible(): boolean {
    return this.world.isPlayerInvincible();
  }

  public setDebugPlayerInvincible(enabled: boolean): void {
    const res = updateSaveSettings(this.saveData, { debugPlayerInvincible: enabled });
    this.saveData = res.nextSave;
    this.saveManager.persist(this.saveData);
    this.world.setDebugPlayerInvincible(enabled);
  }

  public getEffectiveTimeScale(): DebugTimeScale {
    if (this.runtimeTimeScaleOverride !== null) {
      return this.runtimeTimeScaleOverride;
    }
    return Math.max(GAME_CONFIG.balance.debugTimeScale, this.saveData.settings.debugTimeScale) as DebugTimeScale;
  }

  public setDebugTimeScale(scale: DebugTimeScale): void {
    const safeScale: DebugTimeScale = scale === 3 ? 3 : scale === 2 ? 2 : 1;
    this.runtimeTimeScaleOverride = safeScale;
    const res = updateSaveSettings(this.saveData, { debugTimeScale: safeScale });
    this.saveData = res.nextSave;
    this.saveManager.persist(this.saveData);
  }

  public cycleDebugTimeScale(): DebugTimeScale {
    const cur = this.getEffectiveTimeScale();
    const next: DebugTimeScale = cur === 1 ? 2 : cur === 2 ? 3 : 1;
    this.setDebugTimeScale(next);
    return next;
  }

  public getSaveSnapshot(): SaveLoadResult {
    return this.saveManager.getSnapshot();
  }

  public getSettings(): GameSettings {
    return this.saveData.settings;
  }

  public step(dtSec: number, input: InputCommandFrame): void {
    this.world.step(dtSec, input);
    this.flushPendingSettlementIfAny();
  }

  public getFrameEvents(): readonly GameEvent[] {
    return this.world.getFrameEvents();
  }

  public clearFrameEvents(): void {
    this.world.clearFrameEvents();
  }

  public getRenderSnapshot(): RenderSnapshot {
    return this.world.getRenderSnapshot();
  }

  private flushPendingSettlementIfAny(): void {
    const settlement = this.world.consumePendingSettlement();
    if (!settlement) return;

    const applied = applyRunSettlementToSave(this.saveData, {
      grantedCrystals: settlement.payload.grantedCrystals,
      isVictorySettlement: settlement.kind === 'victory',
      isRunFinalEnd: settlement.kind === 'game_over',
      survivedSec: settlement.payload.survivedSec,
      endlessSec: settlement.payload.endlessSec,
      totalRunKills: settlement.payload.kills,
      deltaKillsToAdd: settlement.deltaKillsToAdd,
      newlyDiscoveredEvolutions: settlement.newlyDiscoveredEvolutions,
    });

    this.saveData = applied.nextSave;
    this.saveManager.persist(this.saveData);

    // 若本次通关跨入新阶段并自动解锁了更高角色形态，立刻将公告注入当前胜利弹窗告知玩家！
    if (applied.newlyUnlockedForm && applied.newlyUnlockedStage) {
      const fm = applied.newlyUnlockedForm;
      const st = applied.newlyUnlockedStage;
      this.world.attachFormUnlockAnnouncement({
        formId: fm.id,
        formName: fm.name,
        formTitle: fm.title,
        stageName: st.name,
        maxActiveSlots: st.maxActiveSlots,
        maxPassiveSlots: st.maxPassiveSlots,
        starterWeaponLevel: st.starterWeaponLevel,
        durationLimitSec: st.durationLimitSec,
        bossCount: st.bossSpawnTimesSec.length,
      });
    }
  }

  // ==================== 幂等控制接口 ====================

  public navigateTitleSubView(view: TitleSubView): ControllerActionResult {
    if (this.world.appState !== 'TITLE') {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    this.titleSubView = view;
    return { ok: true };
  }

  public buyTalent(talentId: TalentId): ControllerActionResult {
    if (this.world.appState !== 'TITLE') {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    const res = buyTalent(this.saveData, talentId);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.saveData = res.nextSave;
    this.saveManager.persist(this.saveData);
    return { ok: true };
  }

  public resetAllTalents(): ControllerActionResult {
    if (this.world.appState !== 'TITLE') {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    const res = resetAllTalents(this.saveData);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.saveData = res.nextSave;
    this.saveManager.persist(this.saveData);
    return { ok: true };
  }

  /** 完整重置生涯（角色形态/天赋/晶体/关卡进度/战绩全部归零回第 1 关） */
  public resetCareer(): ControllerActionResult {
    if (this.world.appState !== 'TITLE') {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    const res = resetCareerProgress(this.saveData);
    this.saveData = res.nextSave;
    this.world.setDebugPlayerInvincible(this.saveData.settings.debugPlayerInvincible);
    this.titleSubView = 'MAIN_MENU';
    this.saveManager.persist(this.saveData);
    return { ok: true };
  }

  public updateSettings(patch: Partial<GameSettings>): ControllerActionResult {
    if (this.world.appState !== 'TITLE' && this.world.appState !== 'PAUSED') {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    const res = updateSaveSettings(this.saveData, patch);
    this.saveData = res.nextSave;
    if (patch.debugPlayerInvincible !== undefined) {
      this.world.setDebugPlayerInvincible(this.saveData.settings.debugPlayerInvincible);
    }
    if (patch.debugTimeScale !== undefined) {
      this.runtimeTimeScaleOverride = this.saveData.settings.debugTimeScale;
    }
    this.saveManager.persist(this.saveData);
    return { ok: true };
  }

  public startRun(seedOverride?: number): ControllerActionResult {
    if (this.isResetting || this.world.appState !== 'TITLE') {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    this.isResetting = true;
    try {
      const seed = seedOverride ?? ((Date.now() ^ (this.seedCounter++ * 2654435761)) >>> 0);
      const bonuses = computeMetaStatBonuses(this.saveData);
      this.pauseReason = null;
      this.world.resetRun(this.saveData.career.currentLevel, bonuses, seed);
      return { ok: true };
    } finally {
      this.isResetting = false;
    }
  }

  public pause(reason: 'manual' | 'blur' | 'hidden'): ControllerActionResult {
    const ok = this.world.pauseWorld();
    if (!ok) return { ok: false, reason: 'INVALID_STATE' };
    this.pauseReason =
      reason === 'hidden'
        ? '切出标签页已自动暂停'
        : reason === 'blur'
          ? '窗口失焦已自动暂停'
          : '手动暂停';
    return { ok: true };
  }

  public resume(): ControllerActionResult {
    const ok = this.world.resumeWorld();
    if (!ok) return { ok: false, reason: 'INVALID_STATE' };
    this.pauseReason = null;
    return { ok: true };
  }

  public selectModalChoice(index: 0 | 1 | 2): ControllerActionResult {
    const ok = this.world.selectModalChoice(index);
    return ok ? { ok: true } : { ok: false, reason: 'INVALID_STATE' };
  }

  public rerollLevelUp(): ControllerActionResult {
    const ok = this.world.rerollLevelUp();
    return ok ? { ok: true } : { ok: false, reason: 'INVALID_STATE_OR_NO_REROLLS' };
  }

  public confirmChestModal(): ControllerActionResult {
    const ok = this.world.confirmChestModal();
    return ok ? { ok: true } : { ok: false, reason: 'INVALID_STATE' };
  }

  public continueEndless(): ControllerActionResult {
    const ok = this.world.continueEndless();
    return ok ? { ok: true } : { ok: false, reason: 'INVALID_STATE' };
  }

  /** 重开当前关卡（或在胜利弹窗点「挑战下一关」时直接按最新 currentLevel 开局） */
  public restartRun(seedOverride?: number): ControllerActionResult {
    const allowed =
      this.world.appState === 'PAUSED' ||
      this.world.appState === 'VICTORY_MODAL' ||
      this.world.appState === 'GAME_OVER_MODAL';
    if (this.isResetting || !allowed) {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    this.isResetting = true;
    const wasVictoryExit = this.world.appState === 'VICTORY_MODAL';
    this.world.appState = 'RESETTING';
    try {
      if (wasVictoryExit) {
        const applied = applyRunSettlementToSave(this.saveData, {
          grantedCrystals: 0,
          isVictorySettlement: false,
          isRunFinalEnd: true,
          survivedSec: this.world.elapsedSec,
          endlessSec: 0,
          totalRunKills: this.world.getHudPartials().kills,
          deltaKillsToAdd: 0,
          newlyDiscoveredEvolutions: [],
        });
        this.saveData = applied.nextSave;
        this.saveManager.persist(this.saveData);
      }
      const seed = seedOverride ?? ((Date.now() ^ (this.seedCounter++ * 2654435761)) >>> 0);
      const bonuses = computeMetaStatBonuses(this.saveData);
      this.pauseReason = null;
      this.world.resetRun(this.saveData.career.currentLevel, bonuses, seed);
      return { ok: true };
    } finally {
      this.isResetting = false;
    }
  }

  public returnToTitle(subView: TitleSubView = 'MAIN_MENU'): ControllerActionResult {
    const allowed =
      this.world.appState === 'PAUSED' ||
      this.world.appState === 'VICTORY_MODAL' ||
      this.world.appState === 'GAME_OVER_MODAL';
    if (this.isResetting || !allowed) {
      return { ok: false, reason: 'INVALID_STATE' };
    }
    this.isResetting = true;
    const wasVictoryExit = this.world.appState === 'VICTORY_MODAL';
    this.world.appState = 'RESETTING';
    try {
      if (wasVictoryExit) {
        const applied = applyRunSettlementToSave(this.saveData, {
          grantedCrystals: 0,
          isVictorySettlement: false,
          isRunFinalEnd: true,
          survivedSec: this.world.elapsedSec,
          endlessSec: 0,
          totalRunKills: this.world.getHudPartials().kills,
          deltaKillsToAdd: 0,
          newlyDiscoveredEvolutions: [],
        });
        this.saveData = applied.nextSave;
        this.saveManager.persist(this.saveData);
      }
      this.pauseReason = null;
      this.titleSubView = subView;
      this.world.resetToTitle();
      return { ok: true };
    } finally {
      this.isResetting = false;
    }
  }

  /** 仅限受控测试桥使用：直接增加测试晶体并落盘 */
  public debugGrantCrystals(amount: number): void {
    this.saveData = structuredClone(this.saveData);
    this.saveData.metaProgress.voidCrystals += Math.max(0, Math.floor(amount));
    this.saveManager.persist(this.saveData);
  }

  /** 仅限受控测试桥使用：将生涯累计通关数直接设定至指定值（验证跨阶段与五形态解锁） */
  public debugSetClearedLevels(clearedCount: number): void {
    const maxLevels = GAME_CONFIG.balance.maxTotalLevels;
    const safe = Math.min(maxLevels, Math.max(0, Math.floor(clearedCount)));
    const nextSave = structuredClone(this.saveData);
    nextSave.career.clearedLevelsCount = safe;
    nextSave.career.currentLevel = Math.min(maxLevels, safe + 1);
    let stage = GAME_CONFIG.stages[0]!;
    for (const st of GAME_CONFIG.stages) {
      if (safe >= st.requiredTotalClearsToUnlock) stage = st;
    }
    nextSave.career.currentStageId = stage.id;
    nextSave.career.unlockedFormId = stage.formId;
    this.saveData = nextSave;
    this.saveManager.persist(this.saveData);
  }

  public debugFlushSettlement(): void {
    this.flushPendingSettlementIfAny();
  }

  public getHudSnapshot(): HudSnapshot {
    const saveSnap = this.saveManager.getSnapshot();
    const partials = this.world.getHudPartials();
    const p = this.world.player;

    const careerStage = STAGE_BY_ID[this.saveData.career.currentStageId];
    const careerForm = FORM_BY_ID[this.saveData.career.unlockedFormId];
    const nextProg = getNextFormUnlockProgress(this.saveData.career.clearedLevelsCount);

    const meta: MetaHudSnapshot = {
      voidCrystals: this.saveData.metaProgress.voidCrystals,
      spentCrystals: this.saveData.metaProgress.spentCrystals,
      career: {
        currentLevel: this.saveData.career.currentLevel,
        clearedLevelsCount: this.saveData.career.clearedLevelsCount,
        currentStageId: careerStage.id,
        currentStageNumber: careerStage.stageNumber,
        currentStageName: careerStage.name,
        currentFormId: careerForm.id,
        currentFormName: careerForm.name,
        currentFormTier: careerForm.tier,
        maxActiveSlots: careerStage.maxActiveSlots,
        maxPassiveSlots: careerStage.maxPassiveSlots,
        starterWeaponLevel: careerStage.starterWeaponLevel,
        stageDurationLimitSec: careerStage.durationLimitSec,
        stageBossCount: careerStage.bossSpawnTimesSec.length,
        nextFormName: nextProg.nextForm?.name ?? null,
        nextFormTargetClears: nextProg.targetClears,
        remainingClearsForNextForm: nextProg.remainingClears,
      },
      forms: GAME_CONFIG.forms.map((fm) => {
        const st = STAGE_BY_ID[fm.stageId];
        return {
          id: fm.id,
          stageId: fm.stageId,
          tier: fm.tier,
          name: fm.name,
          title: fm.title,
          description: fm.description,
          primaryColorHex: fm.primaryColorHex,
          requiredTotalClears: fm.requiredTotalClears,
          maxActiveSlots: fm.maxActiveSlots,
          maxPassiveSlots: fm.maxPassiveSlots,
          starterWeaponLevel: fm.starterWeaponLevel,
          stageDurationSec: st.durationLimitSec,
          stageBossCount: st.bossSpawnTimesSec.length,
          unlocked: this.saveData.career.clearedLevelsCount >= fm.requiredTotalClears,
          isCurrent: this.saveData.career.unlockedFormId === fm.id,
        };
      }),
      talents: GAME_CONFIG.talents.map((cfg) => ({
        id: cfg.id,
        name: cfg.name,
        description: cfg.description,
        level: this.saveData.metaProgress.talents[cfg.id],
        maxLevel: cfg.maxLevel,
        nextCost: getNextTalentCost(this.saveData, cfg.id),
        valuePerLevel: cfg.valuePerLevel,
        unitLabel: cfg.unitLabel,
      })),
      runRecords: this.saveData.runRecords,
      discoveredEvolutions: this.saveData.unlocks.discoveredEvolutions,
      settings: this.saveData.settings,
    };

    const runStage = partials.stage;
    const runForm = partials.form;
    const remainingSec = runStage.durationLimitSec - this.world.elapsedSec;
    const isNearTimeout =
      this.world.activeRunPhase !== 'RUN_ENDLESS' &&
      remainingSec <= 30 &&
      partials.bossProgress.killed < partials.bossProgress.total;

    return {
      appState: this.world.appState,
      activeRunPhase: this.world.activeRunPhase,
      titleSubView: this.titleSubView,
      pauseReason: this.pauseReason,
      storageStatus: saveSnap.status,
      storageWarning: saveSnap.warningMessage,
      currentLevel: partials.currentLevel,
      stageId: runStage.id,
      stageNumber: runStage.stageNumber,
      stageName: runStage.name,
      formId: runForm.id,
      formName: runForm.name,
      formTier: runForm.tier,
      maxActiveSlots: runStage.maxActiveSlots,
      maxPassiveSlots: runStage.maxPassiveSlots,
      durationLimitSec: runStage.durationLimitSec,
      isNearTimeout,
      bossProgress: partials.bossProgress,
      elapsedSec: this.world.elapsedSec,
      endlessElapsedSec: this.world.endlessElapsedSec,
      level: p.level,
      xp: p.xp,
      xpToNext: p.xpToNext,
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      kills: partials.kills,
      runBonusCrystals: partials.runBonusCrystals,
      rerollsLeft: p.rerollsLeft,
      weaponSlots: partials.weaponSlots,
      passiveSlots: partials.passiveSlots,
      bossHud: partials.bossHud,
      levelUpChoices: partials.levelUpChoices,
      altarChoices: partials.altarChoices,
      chestModal: partials.chestModal,
      settlementModal: partials.settlementModal,
      evolutionRecipesStatus: partials.evolutionRecipesStatus,
      weaponDamageStats: partials.weaponDamageStats,
      meta,
    };
  }
}
