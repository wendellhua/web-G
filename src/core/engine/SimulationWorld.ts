/**
 * 《黑潮突围（VOID RUNNER）》无头核心模拟引擎（Headless SimulationWorld）
 * 最高红线：严格零 DOM / 零 Canvas / 零 window / 零 Audio / 零 Math.random()，
 * 100% 可在 Node.js 环境确定性单步运行与万帧压测。
 */
import type {
  ActiveRunPhase,
  AltarRuntimeEntity,
  AppFsmState,
  BeaconKind,
  BeaconRuntimeEntity,
  BossPhase,
  ChestRuntimeEntity,
  DefeatReason,
  EnemyBulletRuntimeEntity,
  EnemyId,
  EnemyRuntimeEntity,
  EvolutionId,
  FormConfig,
  ModalQueueKind,
  PassiveSlotState,
  PlayerRuntimeState,
  ProjectileRuntimeEntity,
  RunEconomyRuntimeState,
  StageConfig,
  TelegraphZoneEntity,
  WeaponId,
  WeaponSlotState,
  XpGemRuntimeEntity,
} from '../../../schemas';
import {
  ENEMY_BY_ID,
  EVOLUTION_BY_ID,
  EVOLUTION_BY_WEAPON_ID,
  FORM_BY_ID,
  GAME_CONFIG,
  PASSIVE_BY_ID,
  WEAPON_BY_ID,
  resolveStageByLevelNumber,
} from '../../config/gameConfig';
import type { MetaStatBonuses } from '../../meta/MetaProgression';
import type {
  BossHudView,
  BossProgressView,
  ChestModalPayload,
  EdgeIndicatorView,
  EvolutionRecipeStatusView,
  FormUnlockAnnouncement,
  GameEvent,
  HudPassiveSlotView,
  HudWeaponSlotView,
  InputCommandFrame,
  RenderBeamRayView,
  RenderLightningView,
  RenderNovaRingView,
  RenderOrbitalBladeView,
  RenderSnapshot,
  SettlementModalPayload,
  UpgradeCardChoice,
  WeaponDamageStatView,
} from '../contracts/gameContracts';
import { GameEventBus } from './EventBus';
import {
  clamp,
  clampWeaponCooldownMs,
  computeEndlessMultipliers,
  distSq,
  normalize2D,
  safeDamage,
} from './MathUtils';
import { SeededRNG } from './SeededRNG';
import { SpatialHashGrid } from './SpatialHashGrid';
import {
  calculateEndlessDeltaCrystals,
  calculateNormalOrVictoryCrystals,
} from '../systems/EconomyCalculator';
import {
  applySelectedChoice,
  buildAltarBlessingChoices,
  computeXpToNextLevel,
  findReadyEvolutions,
  resolveEliteChest,
  rollLevelUpChoices,
} from '../systems/ProgressionSystem';
import { recomputePlayerStats, type RunAltarAndFallbackBuffs } from '../systems/StatCalculator';

export const FIXED_DT_SEC = 1 / 60;
export const BOSS_VICTORY_OUTRO_DURATION_SEC = 3.0;
const VIEWPORT_HALF_W = 640;
const VIEWPORT_HALF_H = 360;
const CELL_SIZE_PX = 64;
const BOSS_RESERVED_SLOTS = 4;

interface InternalEnemy extends EnemyRuntimeEntity {
  bladeHitCdSec: number;
  comboRemaining: number;
  bombTargetX: number;
  bombTargetY: number;
}

interface InternalBeamVisual {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  lengthPx: number;
  widthPx: number;
  lifeSec: number;
  maxLifeSec: number;
  isEvolution: boolean;
}

interface InternalLightningVisual {
  x: number;
  y: number;
  radiusPx: number;
  lifeSec: number;
  maxLifeSec: number;
  isEvolution: boolean;
}

interface InternalNovaVisual {
  x: number;
  y: number;
  radiusPx: number;
  maxRadiusPx: number;
  lifeSec: number;
  maxLifeSec: number;
  isEvolution: boolean;
  isCollapse: boolean;
}

interface PendingCollapseBurst {
  timerSec: number;
  x: number;
  y: number;
  radiusPx: number;
  damage: number;
  weaponId: WeaponId;
}

const MODAL_PRIORITY: Readonly<Record<ModalQueueKind, number>> = {
  CHEST_MODAL: 0,
  ALTAR_MODAL: 1,
  LEVEL_UP_MODAL: 2,
};

export interface SettlementEventOutput {
  readonly kind: 'victory' | 'game_over';
  readonly payload: SettlementModalPayload;
  readonly newlyDiscoveredEvolutions: readonly EvolutionId[];
  readonly deltaKillsToAdd: number;
}

/** 计算消灭本局第一个 Boss 后的额外精英怪刷怪数量（第 5 关 3 只，后续每关 +1） */
export function computePostFirstBossBonusEliteCount(levelNumber: number): number {
  const safeLv = Math.floor(levelNumber);
  if (safeLv < 5) return 0;
  return 3 + (safeLv - 5);
}

export class SimulationWorld {
  private rng = new SeededRNG(1);
  private readonly eventBus = new GameEventBus();
  private readonly enemyGrid = new SpatialHashGrid<InternalEnemy>(CELL_SIZE_PX);
  private readonly queryBuffer: InternalEnemy[] = [];

  private nextEntityId = 1;
  public appState: AppFsmState = 'TITLE';
  public activeRunPhase: ActiveRunPhase = 'RUN_NORMAL';
  private pausedModalUnderlay: ModalQueueKind | null = null;
  private modalQueue: ModalQueueKind[] = [];

  public tickCount = 0;
  public elapsedSec = 0;
  public endlessElapsedSec = 0;

  private metaBonuses: MetaStatBonuses = {
    maxHpFlat: 0,
    moveSpeedRatio: 0,
    damageRatio: 0,
    cooldownReductionRatio: 0,
    pickupRadiusRatio: 0,
    xpGainRatio: 0,
    extraRerolls: 0,
    crystalExtractRatio: 0,
  };

  public player: PlayerRuntimeState;
  public weapons: WeaponSlotState[] = [];
  public passives: PassiveSlotState[] = [];
  private buffs: RunAltarAndFallbackBuffs = {
    moveSpeedBonusRatio: 0,
    damageBonusRatio: 0,
    extraMaxHpFlat: 0,
    pickupBonusRatio: 0,
  };

  private enemies: InternalEnemy[] = [];
  private projectiles: ProjectileRuntimeEntity[] = [];
  private enemyBullets: EnemyBulletRuntimeEntity[] = [];
  private xpGems: XpGemRuntimeEntity[] = [];
  private chests: ChestRuntimeEntity[] = [];
  private altars: AltarRuntimeEntity[] = [];
  private beacons: BeaconRuntimeEntity[] = [];
  private telegraphs: TelegraphZoneEntity[] = [];

  private orbitalBlades: RenderOrbitalBladeView[] = [];
  private beamVisuals: InternalBeamVisual[] = [];
  private lightningVisuals: InternalLightningVisual[] = [];
  private novaVisuals: InternalNovaVisual[] = [];
  private pendingCollapses: PendingCollapseBurst[] = [];

  private currentLevel = 1;
  private currentStage: StageConfig = GAME_CONFIG.stages[0]!;
  private currentForm: FormConfig = GAME_CONFIG.forms[0]!;

  private spawnAccumulatorSec = 0;
  private triggeredEliteIndices = new Set<number>();
  private triggeredPostFirstBossElites = false;
  private fallbackHealsUsed = 0;
  private debugPlayerInvincibleOverride: boolean | null = null;
  private bossesSpawned = 0;
  private bossesKilled = 0;
  private altarsSpawned = 0;
  private activeBossIds: number[] = [];
  private nextEndlessEliteSec = 780;
  private nextAltarSpawnSec = GAME_CONFIG.mapEvents.altarFirstSpawnSec;
  private nextBeaconSpawnSec = GAME_CONFIG.mapEvents.beaconFirstSpawnSec;

  private economy: RunEconomyRuntimeState;
  private runDiscoveredEvolutions = new Set<EvolutionId>();

  private activeLevelUpChoices: UpgradeCardChoice[] = [];
  private activeAltarChoices: UpgradeCardChoice[] = [];
  private activeChestModal: ChestModalPayload | null = null;
  private activeSettlementModal: SettlementModalPayload | null = null;
  private pendingSettlementOutput: SettlementEventOutput | null = null;

  // Boss 击杀后的 3 秒过渡动画状态（独立于战斗倍速与关卡计时，让玩家充分释放紧张情绪）
  private victoryOutroElapsedSec = 0;
  private victoryOutroBossX = 0;
  private victoryOutroBossY = 0;
  private victoryOutroBossRadiusPx = 56;
  private victoryOutroCanContinueEndless = false;
  private lastKilledBossX = 0;
  private lastKilledBossY = 0;
  private lastKilledBossRadiusPx = 56;

  constructor() {
    this.economy = this.createEmptyEconomy();
    this.player = this.createInitialPlayer(1);
  }

  private createEmptyEconomy(): RunEconomyRuntimeState {
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

  private createInitialPlayer(levelNumber: number): PlayerRuntimeState {
    const stage = resolveStageByLevelNumber(levelNumber);
    const stats = recomputePlayerStats(
      GAME_CONFIG.balance,
      this.metaBonuses,
      [],
      this.buffs,
      this.currentForm.baseAttackBonusRatio,
    );
    return {
      formId: stage.formId,
      stageId: stage.id,
      currentLevel: Math.max(1, Math.floor(levelNumber)),
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      radiusPx: 14,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      invulnSec: 0,
      level: 1,
      xp: 0,
      xpToNext: computeXpToNextLevel(1),
      rerollsLeft: GAME_CONFIG.balance.baseRerollsPerRun + this.metaBonuses.extraRerolls,
      entityState: 'ALIVE_NORMAL',
      stats,
    };
  }

  /**
   * Clean Reset 契约实现（V2.0：严格读取当前关卡所属阶段与形态，初始化动态槽位与初始主武等级）
   */
  public resetRun(levelNumber: number, metaBonuses: MetaStatBonuses, seed: number): void {
    this.rng = new SeededRNG(seed);
    this.eventBus.clearFrameEvents();
    this.enemyGrid.clear();
    this.queryBuffer.length = 0;

    this.currentLevel = Math.min(GAME_CONFIG.balance.maxTotalLevels, Math.max(1, Math.floor(levelNumber)));
    this.currentStage = resolveStageByLevelNumber(this.currentLevel);
    this.currentForm = FORM_BY_ID[this.currentStage.formId];

    this.nextEntityId = 1;
    this.tickCount = 0;
    this.elapsedSec = 0;
    this.endlessElapsedSec = 0;
    this.activeRunPhase = 'RUN_NORMAL';
    this.appState = 'RUN_NORMAL';
    this.pausedModalUnderlay = null;
    this.modalQueue = [];

    this.metaBonuses = { ...metaBonuses };
    this.buffs = {
      moveSpeedBonusRatio: 0,
      damageBonusRatio: 0,
      extraMaxHpFlat: 0,
      pickupBonusRatio: 0,
    };

    // 按当前角色形态固定装备追踪脉冲枪并赋予对应起始等级（Lv.1 → Lv.5）
    this.weapons = [
      {
        weaponId: this.currentForm.starterWeaponId,
        level: this.currentForm.starterWeaponLevel,
        isEvolved: false,
        evolutionId: null,
        cooldownTimerMs: 120,
        orbitAngleRad: 0,
      },
    ];
    this.passives = [];
    this.player = this.createInitialPlayer(this.currentLevel);

    this.enemies = [];
    this.projectiles = [];
    this.enemyBullets = [];
    this.xpGems = [];
    this.chests = [];
    this.altars = [];
    this.beacons = [];
    this.telegraphs = [];
    this.orbitalBlades = [];
    this.beamVisuals = [];
    this.lightningVisuals = [];
    this.novaVisuals = [];
    this.pendingCollapses = [];

    this.spawnAccumulatorSec = 0;
    this.triggeredEliteIndices.clear();
    this.triggeredPostFirstBossElites = false;
    this.fallbackHealsUsed = 0;
    this.bossesSpawned = 0;
    this.bossesKilled = 0;
    this.altarsSpawned = 0;
    this.activeBossIds = [];
    this.nextEndlessEliteSec = this.currentStage.durationLimitSec + 120;
    this.nextAltarSpawnSec = GAME_CONFIG.mapEvents.altarFirstSpawnSec;
    this.nextBeaconSpawnSec = GAME_CONFIG.mapEvents.beaconFirstSpawnSec;

    this.economy = this.createEmptyEconomy();
    this.runDiscoveredEvolutions.clear();

    this.activeLevelUpChoices = [];
    this.activeAltarChoices = [];
    this.activeChestModal = null;
    this.activeSettlementModal = null;
    this.pendingSettlementOutput = null;
    this.victoryOutroElapsedSec = 0;
    this.victoryOutroBossX = 0;
    this.victoryOutroBossY = 0;
    this.victoryOutroBossRadiusPx = 56;
    this.victoryOutroCanContinueEndless = false;
    this.lastKilledBossX = 0;
    this.lastKilledBossY = 0;
    this.lastKilledBossRadiusPx = 56;

    // 开局投放 5 只初始集群怪，确保 3 秒内立刻开打
    for (let i = 0; i < 5; i++) {
      this.spawnEnemy('swarm');
    }
  }

  /** 返回主菜单时的彻底清理 */
  public resetToTitle(): void {
    this.eventBus.clearFrameEvents();
    this.enemyGrid.clear();
    this.queryBuffer.length = 0;
    this.enemies = [];
    this.projectiles = [];
    this.enemyBullets = [];
    this.xpGems = [];
    this.chests = [];
    this.altars = [];
    this.beacons = [];
    this.telegraphs = [];
    this.orbitalBlades = [];
    this.beamVisuals = [];
    this.lightningVisuals = [];
    this.novaVisuals = [];
    this.pendingCollapses = [];
    this.modalQueue = [];
    this.pausedModalUnderlay = null;
    this.activeLevelUpChoices = [];
    this.activeAltarChoices = [];
    this.activeChestModal = null;
    this.activeSettlementModal = null;
    this.pendingSettlementOutput = null;
    this.victoryOutroElapsedSec = 0;
    this.victoryOutroBossX = 0;
    this.victoryOutroBossY = 0;
    this.victoryOutroBossRadiusPx = 56;
    this.victoryOutroCanContinueEndless = false;
    this.lastKilledBossX = 0;
    this.lastKilledBossY = 0;
    this.lastKilledBossRadiusPx = 56;
    this.appState = 'TITLE';
    this.activeRunPhase = 'RUN_NORMAL';
  }

  public isRunningPhase(): boolean {
    return (
      this.appState === 'RUN_NORMAL' ||
      this.appState === 'RUN_BOSS' ||
      this.appState === 'RUN_ENDLESS'
    );
  }

  public isVictoryOutro(): boolean {
    return this.appState === 'VICTORY_OUTRO';
  }

  public getFrameEvents(): readonly GameEvent[] {
    return this.eventBus.getFrameEvents();
  }

  public clearFrameEvents(): void {
    this.eventBus.clearFrameEvents();
  }

  /** 供 GameController 读取并落盘本帧新产生的两段式结算结果 */
  public consumePendingSettlement(): SettlementEventOutput | null {
    const out = this.pendingSettlementOutput;
    this.pendingSettlementOutput = null;
    return out;
  }

  public refreshComputedStats(): void {
    const prevMaxHp = this.player.maxHp;
    const nextStats = recomputePlayerStats(
      GAME_CONFIG.balance,
      this.metaBonuses,
      this.passives,
      this.buffs,
      this.currentForm.baseAttackBonusRatio,
    );
    this.player.stats = nextStats;
    this.player.maxHp = nextStats.maxHp;
    if (nextStats.maxHp > prevMaxHp && this.player.entityState !== 'DEAD') {
      this.player.hp = Math.min(nextStats.maxHp, this.player.hp + (nextStats.maxHp - prevMaxHp));
    } else if (this.player.hp > nextStats.maxHp) {
      this.player.hp = nextStats.maxHp;
    }
  }

  /** 由 GameController 在跨阶段通关后注入形态进阶解锁公告至当前胜利弹窗 */
  public attachFormUnlockAnnouncement(announcement: FormUnlockAnnouncement): void {
    if (this.activeSettlementModal && this.activeSettlementModal.isVictory) {
      this.activeSettlementModal = {
        ...this.activeSettlementModal,
        newlyUnlockedForm: announcement,
      };
    }
  }

  // ==================== 固定步长主模拟管线（严格确定性顺序） ====================
  public step(dtSec: number, input: InputCommandFrame): void {
    const dt = clamp(dtSec, 0, 0.05);
    if (dt <= 0) return;

    // 终局 Boss 死亡 3 秒过渡动画：停止玩家移动、冻结关卡倒计时、免疫伤害与弹窗打断，3 秒后弹出胜利结算
    if (this.appState === 'VICTORY_OUTRO') {
      this.stepVictoryOutro(dt);
      return;
    }

    if (!this.isRunningPhase()) return;

    this.tickCount += 1;
    this.elapsedSec += dt;
    if (this.activeRunPhase === 'RUN_ENDLESS') {
      this.endlessElapsedSec += dt;
    }

    let bossDefeatedThisFrame = false;

    // 1. 玩家八方向归一化移动、朝向、无敌帧与被动秒回
    this.stepPlayer(dt, input);

    // 2. 波次导演与精英/Boss/无尽调度
    this.stepWaveDirector(dt);

    // 3. 地图事件（祭坛 5 秒读条/衰减/施压、战术信标、宝箱拾取）
    bossDefeatedThisFrame = this.stepMapEvents(dt) || bossDefeatedThisFrame;

    // 4. 清理并推进视觉短效（激光/落雷/震荡环/奇点二段坍缩）
    bossDefeatedThisFrame = this.stepTransientVisualsAndCollapses(dt) || bossDefeatedThisFrame;

    // 5. 构建本帧零 GC 空间哈希网格（索引全部活跃敌怪）
    this.rebuildEnemySpatialGrid();

    // 6. 全自动武器与超武系统更新（索敌/发射/光刃/落雷/震荡波/激光/回旋刃）
    bossDefeatedThisFrame = this.stepWeapons(dt) || bossDefeatedThisFrame;

    // 7. 敌怪与终局 Boss AI（追击、软分离、重定位、自爆预警、冲锋红线、弹幕）
    this.stepEnemiesAndBoss(dt);

    // 8. 弹幕与敌方弹幕碰撞结算
    bossDefeatedThisFrame = this.stepProjectiles(dt) || bossDefeatedThisFrame;
    this.stepEnemyBullets(dt);

    // 9. 经验宝石磁吸、聚合与升级入队
    this.stepXpGems(dt);

    // 10. 单帧竞态仲裁（冻结优先级：Boss同帧险胜 > 玩家死亡 > 弹窗队列有序弹出）
    this.resolveEndOfFrameArbitration(bossDefeatedThisFrame);
  }

  private stepPlayer(dt: number, input: InputCommandFrame): void {
    const p = this.player;
    if (p.entityState === 'DEAD') return;

    if (p.invulnSec > 0) {
      p.invulnSec = Math.max(0, p.invulnSec - dt);
      if (p.invulnSec <= 0) {
        p.entityState = 'ALIVE_NORMAL';
      }
    }

    if (p.stats.hpRegenPerSec > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + p.stats.hpRegenPerSec * dt);
    }

    const dir = normalize2D(input.moveX, input.moveY);
    if (dir.x !== 0 || dir.y !== 0) {
      p.dirX = dir.x;
      p.dirY = dir.y;
    }
    p.x += dir.x * p.stats.moveSpeedPxPerSec * dt;
    p.y += dir.y * p.stats.moveSpeedPxPerSec * dt;
  }

  private getSubLevelDifficultyMult(): number {
    const subIdx = Math.max(0, this.currentLevel - this.currentStage.minLevelNumber);
    return Math.min(3.0, 1 + subIdx * this.currentStage.subLevelHpStepMult);
  }

  private stepWaveDirector(dt: number): void {
    const bal = GAME_CONFIG.balance;
    const st = this.currentStage;

    // 1. 按当前阶段 2 分钟间隔时间轴依次刷新 Boss（1 / 2 / 3 / 4 / 4 只，全数消灭即立刻通关结算）
    while (
      this.activeRunPhase !== 'RUN_ENDLESS' &&
      this.bossesSpawned < st.bossSpawnTimesSec.length &&
      this.elapsedSec >= (st.bossSpawnTimesSec[this.bossesSpawned] ?? Infinity)
    ) {
      this.spawnStageBoss();
    }

    // 2. 当前阶段精英突袭里程碑
    st.eliteMilestones.forEach((m, idx) => {
      if (!this.triggeredEliteIndices.has(idx) && this.elapsedSec >= m.triggerSec) {
        this.triggeredEliteIndices.add(idx);
        for (let c = 0; c < m.count; c++) {
          this.spawnEnemy(m.enemyId);
        }
      }
    });

    // 3. 阶段 5 无尽模式每 2 分钟刷新高阶精英
    if (this.activeRunPhase === 'RUN_ENDLESS' && this.elapsedSec >= this.nextEndlessEliteSec) {
      this.nextEndlessEliteSec += 120;
      this.spawnEnemy('elite_vanguard');
      this.spawnEnemy('elite_prism');
    }

    // 4. 阶段波次与无尽波次刷怪：
    //    - 第 3~25 关将普通小怪刷怪速率与同屏上限降低约 20%，提升中段走位空间；
    //    - 第 5 阶段（第 26~36 关）解除降密限制并按关卡递增提升刷怪速率、每波数量与同屏上限。
    const stage5SubIdx = st.stageNumber >= 5 ? Math.max(0, this.currentLevel - st.minLevelNumber) : 0;
    const levelDensityIntervalMult =
      st.stageNumber >= 5
        ? Math.max(0.68, 1 - stage5SubIdx * 0.03)
        : this.currentLevel >= 3
          ? 1.25
          : 1;
    const levelDensityCapMult = st.stageNumber >= 5 ? 1 : this.currentLevel >= 3 ? 0.8 : 1;
    const timeRamp = 1 - Math.min(0.28, (this.elapsedSec / Math.max(60, st.durationLimitSec)) * 0.28);
    const baseInterval = Math.max(0.14, st.spawnIntervalSec * timeRamp * levelDensityIntervalMult);
    const effectiveInterval =
      this.activeRunPhase === 'RUN_ENDLESS'
        ? Math.max(0.14, baseInterval * 0.78)
        : this.activeRunPhase === 'RUN_BOSS'
          ? baseInterval * 1.6
          : baseInterval;

    const rawNormalCap =
      this.activeRunPhase === 'RUN_ENDLESS' || st.stageNumber >= 4
        ? bal.activeEnemyHardCap - BOSS_RESERVED_SLOTS
        : bal.activeEnemySoftCap;
    const normalCap = Math.min(
      bal.activeEnemyHardCap - BOSS_RESERVED_SLOTS,
      Math.max(24, Math.round(rawNormalCap * levelDensityCapMult)),
    );
    const stage5ExtraPack = st.stageNumber >= 5 ? Math.floor(stage5SubIdx / 3) : 0;

    this.spawnAccumulatorSec += dt;
    while (this.spawnAccumulatorSec >= effectiveInterval) {
      this.spawnAccumulatorSec -= effectiveInterval;
      if (this.enemies.length >= normalCap) break;
      const packSize = this.rng.nextInt(st.packSizeMin + stage5ExtraPack, st.packSizeMax + stage5ExtraPack);
      const weights = st.enemyWeights.map((w) => ({ item: w.enemyId, weight: w.weight }));
      for (let i = 0; i < packSize; i++) {
        if (this.enemies.length >= normalCap) break;
        const picked = this.rng.pickWeighted(weights);
        if (picked) {
          this.spawnEnemy(picked);
        }
      }
    }
  }

  private spawnStageBoss(): void {
    const bossIndex = this.bossesSpawned;
    this.bossesSpawned += 1;
    this.activeRunPhase = 'RUN_BOSS';
    this.appState = 'RUN_BOSS';

    // 适度清退过远的普通杂兵，为 Boss 战腾出空间与可读性
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e || e.tier !== 'normal') continue;
      if (distSq(e.x, e.y, this.player.x, this.player.y) > 450 * 450) {
        this.swapRemove(this.enemies, i);
      }
    }

    const angle = (bossIndex * Math.PI * 0.75) % (Math.PI * 2);
    const bx = this.player.x + Math.cos(angle) * 360;
    const by = this.player.y + Math.sin(angle) * 360;
    const boss = this.spawnEnemy('boss_void_weaver', bx, by);
    if (boss) {
      boss.entityState = 'BOSS_SPAWN_INTRO';
      boss.stateTimerSec = 1.1;
      boss.bossPhase = 1;
      this.activeBossIds.push(boss.id);
      this.eventBus.emit({
        type: 'BOSS_SPAWNED',
        enemyId: 'boss_void_weaver',
        x: boss.x,
        y: boss.y,
      });
    }
  }

  public spawnEnemy(enemyId: EnemyId, xOverride?: number, yOverride?: number): InternalEnemy | null {
    const cfg = ENEMY_BY_ID[enemyId];
    const bal = GAME_CONFIG.balance;
    if (cfg.tier === 'normal' && this.enemies.length >= bal.activeEnemyHardCap - BOSS_RESERVED_SLOTS) {
      return null;
    }
    if (this.enemies.length >= bal.activeEnemyHardCap) {
      // Boss 与精英刷新拥有优先权：若满编则驱逐最远普通怪，确保关键目标绝不漏刷
      if (cfg.tier === 'boss' || cfg.tier === 'elite') {
        let farthestIdx = -1;
        let farthestDistSq = -1;
        for (let i = 0; i < this.enemies.length; i++) {
          const candidate = this.enemies[i];
          if (!candidate || candidate.tier !== 'normal') continue;
          const d2 = distSq(candidate.x, candidate.y, this.player.x, this.player.y);
          if (d2 > farthestDistSq) {
            farthestDistSq = d2;
            farthestIdx = i;
          }
        }
        if (farthestIdx !== -1) {
          this.swapRemove(this.enemies, farthestIdx);
        } else {
          return null;
        }
      } else {
        return null;
      }
    }

    let x = xOverride;
    let y = yOverride;
    if (x === undefined || y === undefined) {
      const angle = this.rng.nextFloat() * Math.PI * 2;
      const spawnDist = Math.hypot(VIEWPORT_HALF_W, VIEWPORT_HALF_H) + 55 + this.rng.nextFloat() * 110;
      x = this.player.x + Math.cos(angle) * spawnDist;
      y = this.player.y + Math.sin(angle) * spawnDist;
    }

    const st = this.currentStage;
    const subMult = this.getSubLevelDifficultyMult();
    const endless =
      this.activeRunPhase === 'RUN_ENDLESS'
        ? computeEndlessMultipliers(
            this.elapsedSec,
            st.durationLimitSec,
            bal.endlessMaxHpMult,
            bal.endlessMaxDmgMult,
            bal.endlessMaxSpeedMult,
          )
        : { hpMult: 1, dmgMult: 1, speedMult: 1 };

    const hpMult =
      (cfg.tier === 'boss' ? st.bossHpScaleMult : st.enemyHpScaleMult) * subMult * endless.hpMult;
    const maxHp = Math.max(1, Math.round(cfg.baseHp * hpMult));

    const entity: InternalEnemy = {
      id: this.nextEntityId++,
      enemyId,
      tier: cfg.tier,
      x,
      y,
      vx: 0,
      vy: 0,
      kbVx: 0,
      kbVy: 0,
      radiusPx: cfg.radiusPx,
      hp: maxHp,
      maxHp,
      hitFlashSec: 0,
      entityState: 'ACTIVE_CHASE',
      stateTimerSec: 0,
      skillCooldownSec: cfg.skillCooldownSec > 0 ? cfg.skillCooldownSec * 0.65 : 0,
      telegraphDirX: 1,
      telegraphDirY: 0,
      bossPhase: cfg.tier === 'boss' ? 1 : null,
      bladeHitCdSec: 0,
      comboRemaining: 0,
      bombTargetX: x,
      bombTargetY: y,
    };
    this.enemies.push(entity);
    return entity;
  }

  private stepMapEvents(dt: number): boolean {
    const cfg = GAME_CONFIG.mapEvents;
    const p = this.player;
    let bossKilled = false;

    // 1. 充能祭坛生成（按阶段限次：1-2 阶段 1 次，3-4 阶段 2 次，5 阶段及后续 3 次；Boss 战期间暂缓生成）
    if (
      this.currentStage.enableAltar &&
      this.altarsSpawned < this.currentStage.maxAltarsPerRun &&
      this.activeRunPhase !== 'RUN_BOSS' &&
      this.altars.length < 1 &&
      this.elapsedSec >= this.nextAltarSpawnSec
    ) {
      this.spawnAltarNearPlayer();
      this.altarsSpawned += 1;
      this.nextAltarSpawnSec = this.elapsedSec + cfg.altarIntervalSec;
    }

    // 2. 战术信标生成（含 Boss 战期间保留以提供紧急续航）
    if (this.beacons.length < 2 && this.elapsedSec >= this.nextBeaconSpawnSec) {
      this.spawnBeaconNearPlayer();
      this.nextBeaconSpawnSec = this.elapsedSec + cfg.beaconIntervalSec;
    }

    // 3. 更新充能祭坛 FSM
    for (let i = this.altars.length - 1; i >= 0; i--) {
      const altar = this.altars[i];
      if (!altar) continue;
      const inRange = distSq(p.x, p.y, altar.x, altar.y) <= altar.radiusPx * altar.radiusPx;
      if (inRange) {
        altar.state = 'CHARGING';
        altar.chargeSec += dt;
        altar.pressureTimerSec += dt;
        if (altar.pressureTimerSec >= 0.9) {
          altar.pressureTimerSec = 0;
          const ang = this.rng.nextFloat() * Math.PI * 2;
          this.spawnEnemy('runner', altar.x + Math.cos(ang) * 320, altar.y + Math.sin(ang) * 320);
          this.spawnEnemy('swarm', altar.x - Math.cos(ang) * 300, altar.y - Math.sin(ang) * 300);
        }
        if (altar.chargeSec >= altar.requiredSec) {
          altar.state = 'COMPLETED';
          this.economy.altarsCompleted += 1;
          this.novaVisuals.push({
            x: altar.x,
            y: altar.y,
            radiusPx: 12,
            maxRadiusPx: cfg.altarShockwaveRadiusPx,
            lifeSec: 0.42,
            maxLifeSec: 0.42,
            isEvolution: false,
            isCollapse: false,
          });
          this.eventBus.emit({
            type: 'ALTAR_COMPLETED',
            x: altar.x,
            y: altar.y,
            shockwaveRadiusPx: cfg.altarShockwaveRadiusPx,
          });
          // 全屏震退冲击波清退周边敌怪（Boss 免疫震荡清场冲击）
          const rSq = cfg.altarShockwaveRadiusPx * cfg.altarShockwaveRadiusPx;
          for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
            const e = this.enemies[ei];
            if (!e) continue;
            if (distSq(e.x, e.y, altar.x, altar.y) <= rSq) {
              if (e.tier === 'boss') {
                this.eventBus.emit({ type: 'BOSS_IMMUNE', x: e.x, y: e.y, label: '震荡免疫' });
                continue;
              }
              bossKilled =
                this.applyDamageToEnemy(e, cfg.altarShockwaveDamage, 'gravity_nova', altar.x, altar.y, 2.4, false) ||
                bossKilled;
            }
          }
          this.swapRemove(this.altars, i);
          this.enqueueModal('ALTAR_MODAL');
        }
      } else if (altar.chargeSec > 0) {
        altar.state = 'DECAYING';
        altar.chargeSec = Math.max(0, altar.chargeSec - dt * cfg.altarDecayRatePerSec);
        if (altar.chargeSec <= 0) {
          altar.state = 'IDLE_WAITING';
        }
      } else {
        altar.state = 'IDLE_WAITING';
      }
    }

    // 4. 战术信标触碰
    for (let i = this.beacons.length - 1; i >= 0; i--) {
      const b = this.beacons[i];
      if (!b) continue;
      const touchR = p.radiusPx + b.radiusPx;
      if (distSq(p.x, p.y, b.x, b.y) <= touchR * touchR) {
        bossKilled = this.triggerBeaconEffect(b) || bossKilled;
        this.swapRemove(this.beacons, i);
      }
    }

    // 5. 进化宝箱触碰
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];
      if (!c) continue;
      const touchR = p.radiusPx + c.radiusPx + 8;
      if (distSq(p.x, p.y, c.x, c.y) <= touchR * touchR) {
        this.swapRemove(this.chests, i);
        this.enqueueModal('CHEST_MODAL');
      }
    }

    return bossKilled;
  }

  public spawnAltarNearPlayer(): AltarRuntimeEntity {
    const angle = this.rng.nextFloat() * Math.PI * 2;
    const dist = 460 + this.rng.nextFloat() * 190;
    const altar: AltarRuntimeEntity = {
      id: this.nextEntityId++,
      x: this.player.x + Math.cos(angle) * dist,
      y: this.player.y + Math.sin(angle) * dist,
      radiusPx: GAME_CONFIG.mapEvents.altarRadiusPx,
      chargeSec: 0,
      requiredSec: GAME_CONFIG.mapEvents.altarRequiredChargeSec,
      pressureTimerSec: 0,
      state: 'IDLE_WAITING',
    };
    this.altars.push(altar);
    return altar;
  }

  private spawnBeaconNearPlayer(): BeaconRuntimeEntity {
    const kinds: readonly BeaconKind[] = ['beacon_magnet', 'beacon_nuke', 'beacon_heal'];
    const kind = kinds[this.rng.nextInt(0, kinds.length - 1)] ?? 'beacon_magnet';
    const angle = this.rng.nextFloat() * Math.PI * 2;
    const dist = 420 + this.rng.nextFloat() * 200;
    const beacon: BeaconRuntimeEntity = {
      id: this.nextEntityId++,
      kind,
      x: this.player.x + Math.cos(angle) * dist,
      y: this.player.y + Math.sin(angle) * dist,
      radiusPx: 18,
    };
    this.beacons.push(beacon);
    return beacon;
  }

  private triggerBeaconEffect(beacon: BeaconRuntimeEntity): boolean {
    let bossKilled = false;
    this.eventBus.emit({
      type: 'BEACON_TRIGGERED',
      kind: beacon.kind,
      x: beacon.x,
      y: beacon.y,
    });

    if (beacon.kind === 'beacon_magnet') {
      for (const gem of this.xpGems) {
        gem.magnetized = true;
      }
    } else if (beacon.kind === 'beacon_heal') {
      const heal = Math.round(this.player.maxHp * GAME_CONFIG.mapEvents.beaconHealRatio);
      const before = this.player.hp;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      const actual = Math.max(0, Math.round(this.player.hp - before));
      if (actual > 0) {
        this.eventBus.emit({ type: 'PLAYER_HEALED', amount: actual, x: this.player.x, y: this.player.y });
      }
    } else if (beacon.kind === 'beacon_nuke') {
      this.novaVisuals.push({
        x: beacon.x,
        y: beacon.y,
        radiusPx: 20,
        maxRadiusPx: 760,
        lifeSec: 0.45,
        maxLifeSec: 0.45,
        isEvolution: true,
        isCollapse: false,
      });
      const rSq = 760 * 760;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e) continue;
        if (distSq(e.x, e.y, beacon.x, beacon.y) > rSq) continue;
        // 虚空震爆对 Boss 完全免疫，彻底杜绝核爆秒杀/重残 Boss
        if (e.tier === 'boss') {
          this.eventBus.emit({ type: 'BOSS_IMMUNE', x: e.x, y: e.y, label: '虚空震爆免疫' });
          continue;
        }
        // 普通怪清场，精英怪仅受固定 12% 非倍率削韧伤害
        const dmg = e.tier === 'normal' ? e.maxHp + 999 : Math.round(e.maxHp * 0.12);
        bossKilled =
          this.applyDamageToEnemy(e, dmg, 'gravity_nova', beacon.x, beacon.y, 1.8, false, true) || bossKilled;
      }
    }
    return bossKilled;
  }

  private stepTransientVisualsAndCollapses(dt: number): boolean {
    let bossKilled = false;
    for (let i = this.beamVisuals.length - 1; i >= 0; i--) {
      const b = this.beamVisuals[i];
      if (!b) continue;
      b.lifeSec -= dt;
      if (b.lifeSec <= 0) this.swapRemove(this.beamVisuals, i);
    }
    for (let i = this.lightningVisuals.length - 1; i >= 0; i--) {
      const l = this.lightningVisuals[i];
      if (!l) continue;
      l.lifeSec -= dt;
      if (l.lifeSec <= 0) this.swapRemove(this.lightningVisuals, i);
    }
    for (let i = this.novaVisuals.length - 1; i >= 0; i--) {
      const n = this.novaVisuals[i];
      if (!n) continue;
      n.lifeSec -= dt;
      const ratio = 1 - Math.max(0, n.lifeSec / n.maxLifeSec);
      n.radiusPx = n.isCollapse ? n.maxRadiusPx * (1 - ratio) : n.maxRadiusPx * ratio;
      if (n.lifeSec <= 0) this.swapRemove(this.novaVisuals, i);
    }
    for (let i = this.pendingCollapses.length - 1; i >= 0; i--) {
      const c = this.pendingCollapses[i];
      if (!c) continue;
      c.timerSec -= dt;
      if (c.timerSec <= 0) {
        this.novaVisuals.push({
          x: c.x,
          y: c.y,
          radiusPx: c.radiusPx,
          maxRadiusPx: c.radiusPx,
          lifeSec: 0.28,
          maxLifeSec: 0.28,
          isEvolution: true,
          isCollapse: true,
        });
        const rSq = c.radiusPx * c.radiusPx;
        for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
          const e = this.enemies[ei];
          if (!e) continue;
          if (distSq(e.x, e.y, c.x, c.y) <= rSq) {
            bossKilled =
              this.applyDamageToEnemy(e, c.damage, c.weaponId, c.x, c.y, -1.2, true) || bossKilled;
          }
        }
        this.swapRemove(this.pendingCollapses, i);
      }
    }
    return bossKilled;
  }

  private rebuildEnemySpatialGrid(): void {
    this.enemyGrid.clear();
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e && e.hp > 0) {
        this.enemyGrid.insert(e, e.x, e.y);
      }
    }
  }

  private stepWeapons(dt: number): boolean {
    const p = this.player;
    if (p.entityState === 'DEAD') return false;

    let bossKilled = false;
    this.orbitalBlades.length = 0;
    const bal = GAME_CONFIG.balance;

    for (const slot of this.weapons) {
      const wCfg = WEAPON_BY_ID[slot.weaponId];
      const evoCfg = slot.isEvolved && slot.evolutionId ? EVOLUTION_BY_ID[slot.evolutionId] : null;
      const lvStats = wCfg.levels[Math.max(0, Math.min(wCfg.levels.length - 1, slot.level - 1))]!;

      const baseDamage = evoCfg ? evoCfg.stats.damage : lvStats.damage;
      const baseCdMs = evoCfg ? evoCfg.stats.cooldownMs : lvStats.cooldownMs;
      const projCount = evoCfg ? evoCfg.stats.projectileCount : lvStats.projectileCount;
      const areaRadius = (evoCfg ? evoCfg.stats.areaRadiusPx : lvStats.areaRadiusPx) * p.stats.areaMult;
      const pierceCount = evoCfg ? evoCfg.stats.pierceCount : lvStats.pierceCount;
      const projSpeed = evoCfg ? evoCfg.stats.projectileSpeedPxPerSec : lvStats.projectileSpeedPxPerSec;
      const durationSec = (evoCfg ? evoCfg.stats.durationMs : lvStats.durationMs) / 1000;
      const kbScale = evoCfg ? evoCfg.stats.knockbackScaleRatio : lvStats.knockbackScaleRatio;
      const effectiveCdMs = clampWeaponCooldownMs(
        baseCdMs,
        p.stats.cooldownReductionRatio,
        bal.minWeaponCooldownMs,
        bal.maxCooldownReductionRatio,
      );

      // 特殊：环绕相位刃持续公转
      if (wCfg.attackPattern === 'orbit_blades') {
        slot.orbitAngleRad += projSpeed * dt;
        const innerRatio = evoCfg ? evoCfg.stats.specialParamA : 0;
        const outerCount = evoCfg ? Math.ceil(projCount / 2) : projCount;
        const innerCount = evoCfg ? Math.floor(projCount / 2) : 0;

        for (let i = 0; i < outerCount; i++) {
          const ang = slot.orbitAngleRad + (i * Math.PI * 2) / outerCount;
          const bx = p.x + Math.cos(ang) * areaRadius;
          const by = p.y + Math.sin(ang) * areaRadius;
          this.orbitalBlades.push({ x: bx, y: by, angleRad: ang, radiusPx: 14, isEvolution: slot.isEvolved });
          bossKilled = this.hitEnemiesAroundBlade(bx, by, 15, baseDamage, slot.weaponId, kbScale, effectiveCdMs / 1000) || bossKilled;
        }
        if (innerCount > 0 && innerRatio > 0) {
          const innerR = areaRadius * innerRatio;
          for (let i = 0; i < innerCount; i++) {
            const ang = -slot.orbitAngleRad * 1.25 + (i * Math.PI * 2) / innerCount;
            const bx = p.x + Math.cos(ang) * innerR;
            const by = p.y + Math.sin(ang) * innerR;
            this.orbitalBlades.push({ x: bx, y: by, angleRad: ang, radiusPx: 12, isEvolution: true });
            bossKilled = this.hitEnemiesAroundBlade(bx, by, 13, baseDamage, slot.weaponId, kbScale, effectiveCdMs / 1000) || bossKilled;
          }
        }
        continue;
      }

      slot.cooldownTimerMs -= dt * 1000;
      if (slot.cooldownTimerMs > 0) continue;

      if (wCfg.attackPattern === 'nearest_projectile') {
        const targets = this.findNearestEnemies(p.x, p.y, 700, projCount);
        if (targets.length === 0) continue;
        slot.cooldownTimerMs = effectiveCdMs;
        this.eventBus.emit({ type: 'WEAPON_FIRED', weaponId: slot.weaponId, isEvolution: slot.isEvolved, x: p.x, y: p.y });
        for (let i = 0; i < projCount; i++) {
          const target = targets[i % targets.length]!;
          const baseAng = Math.atan2(target.y - p.y, target.x - p.x);
          const spread = projCount > 1 ? (i - (projCount - 1) / 2) * 0.09 : 0;
          const ang = baseAng + spread;
          this.spawnPlayerProjectile({
            sourceWeaponId: slot.weaponId,
            isEvolution: slot.isEvolved,
            x: p.x,
            y: p.y,
            vx: Math.cos(ang) * projSpeed,
            vy: Math.sin(ang) * projSpeed,
            radiusPx: areaRadius,
            damage: baseDamage,
            pierceLeft: pierceCount,
            lifeSec: durationSec,
            knockbackScaleRatio: kbScale,
          });
        }
      } else if (wCfg.attackPattern === 'random_strike') {
        const inView = this.enemies.filter(
          (e) => e.hp > 0 && Math.abs(e.x - p.x) <= VIEWPORT_HALF_W + 40 && Math.abs(e.y - p.y) <= VIEWPORT_HALF_H + 40,
        );
        if (inView.length === 0) continue;
        slot.cooldownTimerMs = effectiveCdMs;
        this.eventBus.emit({ type: 'WEAPON_FIRED', weaponId: slot.weaponId, isEvolution: slot.isEvolved, x: p.x, y: p.y });
        for (let i = 0; i < projCount; i++) {
          const target = inView[this.rng.nextInt(0, inView.length - 1)];
          if (!target) continue;
          bossKilled = this.triggerLightningStrike(target.x, target.y, areaRadius, baseDamage, slot.weaponId, kbScale, durationSec, slot.isEvolved) || bossKilled;
          if (evoCfg) {
            const chainCount = Math.floor(evoCfg.stats.specialParamA);
            const chainDmg = baseDamage * evoCfg.stats.specialParamB;
            for (let c = 0; c < chainCount; c++) {
              const chainTarget = inView[this.rng.nextInt(0, inView.length - 1)];
              if (chainTarget) {
                bossKilled =
                  this.triggerLightningStrike(chainTarget.x, chainTarget.y, areaRadius * 0.72, chainDmg, slot.weaponId, kbScale * 0.7, durationSec * 0.85, true) ||
                  bossKilled;
              }
            }
          }
        }
      } else if (wCfg.attackPattern === 'self_nova') {
        slot.cooldownTimerMs = effectiveCdMs;
        this.eventBus.emit({ type: 'WEAPON_FIRED', weaponId: slot.weaponId, isEvolution: slot.isEvolved, x: p.x, y: p.y });
        this.novaVisuals.push({
          x: p.x,
          y: p.y,
          radiusPx: 14,
          maxRadiusPx: areaRadius,
          lifeSec: durationSec,
          maxLifeSec: durationSec,
          isEvolution: slot.isEvolved,
          isCollapse: false,
        });
        const hits = this.enemyGrid.queryRadius(p.x, p.y, areaRadius + 48, this.queryBuffer);
        for (let i = 0; i < hits.length; i++) {
          const e = hits[i];
          if (!e || e.hp <= 0) continue;
          const rSum = areaRadius + e.radiusPx;
          if (distSq(e.x, e.y, p.x, p.y) <= rSum * rSum) {
            bossKilled = this.applyDamageToEnemy(e, baseDamage, slot.weaponId, p.x, p.y, kbScale, true) || bossKilled;
          }
        }
        if (evoCfg && evoCfg.stats.specialParamA > 0) {
          this.pendingCollapses.push({
            timerSec: 0.28,
            x: p.x,
            y: p.y,
            radiusPx: areaRadius * 0.92,
            damage: baseDamage * evoCfg.stats.specialParamA,
            weaponId: slot.weaponId,
          });
        }
      } else if (wCfg.attackPattern === 'facing_beam') {
        slot.cooldownTimerMs = effectiveCdMs;
        this.eventBus.emit({ type: 'WEAPON_FIRED', weaponId: slot.weaponId, isEvolution: slot.isEvolved, x: p.x, y: p.y });
        const baseAng = Math.atan2(p.dirY, p.dirX);
        const angles: number[] =
          slot.isEvolved
            ? [baseAng - 0.38, baseAng, baseAng + 0.38]
            : projCount >= 2
              ? [baseAng, baseAng + Math.PI]
              : [baseAng];
        const beamLen = projSpeed;
        const halfWidth = areaRadius * 0.5;

        for (const ang of angles) {
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          this.beamVisuals.push({
            x: p.x,
            y: p.y,
            dirX: dx,
            dirY: dy,
            lengthPx: beamLen,
            widthPx: areaRadius,
            lifeSec: durationSec,
            maxLifeSec: durationSec,
            isEvolution: slot.isEvolved,
          });
          for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
            const e = this.enemies[ei];
            if (!e || e.hp <= 0) continue;
            const relX = e.x - p.x;
            const relY = e.y - p.y;
            const proj = relX * dx + relY * dy;
            if (proj < -e.radiusPx || proj > beamLen + e.radiusPx) continue;
            const perp = Math.abs(relX * -dy + relY * dx);
            if (perp <= halfWidth + e.radiusPx) {
              const execMult = evoCfg && e.hp / e.maxHp < 0.35 ? 1 + evoCfg.stats.specialParamA : 1;
              bossKilled = this.applyDamageToEnemy(e, baseDamage * execMult, slot.weaponId, p.x, p.y, kbScale, true) || bossKilled;
            }
          }
        }
      } else if (wCfg.attackPattern === 'boomerang') {
        slot.cooldownTimerMs = effectiveCdMs;
        this.eventBus.emit({ type: 'WEAPON_FIRED', weaponId: slot.weaponId, isEvolution: slot.isEvolved, x: p.x, y: p.y });
        const nearest = this.findNearestEnemies(p.x, p.y, 650, 1)[0];
        const baseAng = nearest
          ? Math.atan2(nearest.y - p.y, nearest.x - p.x)
          : Math.atan2(p.dirY, p.dirX);
        const speedBonusMult = evoCfg ? 1 + p.stats.moveSpeedPxPerSec * evoCfg.stats.specialParamA : 1;
        for (let i = 0; i < projCount; i++) {
          const ang = baseAng + (i * Math.PI * 2) / projCount;
          this.spawnPlayerProjectile({
            sourceWeaponId: slot.weaponId,
            isEvolution: slot.isEvolved,
            x: p.x,
            y: p.y,
            vx: Math.cos(ang) * projSpeed,
            vy: Math.sin(ang) * projSpeed,
            radiusPx: areaRadius,
            damage: baseDamage * speedBonusMult,
            pierceLeft: pierceCount,
            lifeSec: durationSec,
            knockbackScaleRatio: kbScale,
          });
        }
      }
    }

    return bossKilled;
  }

  private hitEnemiesAroundBlade(
    bx: number,
    by: number,
    bladeR: number,
    damage: number,
    weaponId: WeaponId,
    kbScale: number,
    hitCdSec: number,
  ): boolean {
    let bossKilled = false;
    const hits = this.enemyGrid.queryRadius(bx, by, bladeR + 48, this.queryBuffer);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e || e.hp <= 0 || e.bladeHitCdSec > 0) continue;
      const rSum = bladeR + e.radiusPx;
      if (distSq(e.x, e.y, bx, by) <= rSum * rSum) {
        e.bladeHitCdSec = hitCdSec;
        bossKilled = this.applyDamageToEnemy(e, damage, weaponId, this.player.x, this.player.y, kbScale, true) || bossKilled;
      }
    }
    return bossKilled;
  }

  private triggerLightningStrike(
    x: number,
    y: number,
    radiusPx: number,
    damage: number,
    weaponId: WeaponId,
    kbScale: number,
    durationSec: number,
    isEvolution: boolean,
  ): boolean {
    let bossKilled = false;
    this.lightningVisuals.push({
      x,
      y,
      radiusPx,
      lifeSec: durationSec,
      maxLifeSec: durationSec,
      isEvolution,
    });
    const hits = this.enemyGrid.queryRadius(x, y, radiusPx + 48, this.queryBuffer);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e || e.hp <= 0) continue;
      const rSum = radiusPx + e.radiusPx;
      if (distSq(e.x, e.y, x, y) <= rSum * rSum) {
        bossKilled = this.applyDamageToEnemy(e, damage, weaponId, x, y, kbScale, true) || bossKilled;
      }
    }
    return bossKilled;
  }

  private findNearestEnemies(x: number, y: number, maxRangePx: number, count: number): InternalEnemy[] {
    const maxSq = maxRangePx * maxRangePx;
    const candidates: { readonly e: InternalEnemy; readonly d2: number }[] = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e || e.hp <= 0) continue;
      const d2 = distSq(e.x, e.y, x, y);
      if (d2 <= maxSq) {
        candidates.push({ e, d2 });
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2);
    return candidates.slice(0, count).map((c) => c.e);
  }

  private spawnPlayerProjectile(params: Omit<ProjectileRuntimeEntity, 'id' | 'maxLifeSec' | 'returning' | 'hitEnemyIds'>): void {
    const MAX_PROJ = 240;
    if (this.projectiles.length >= MAX_PROJ) {
      // 淘汰剩余寿命最短的弹幕
      let minIdx = 0;
      for (let i = 1; i < this.projectiles.length; i++) {
        if ((this.projectiles[i]?.lifeSec ?? 99) < (this.projectiles[minIdx]?.lifeSec ?? 99)) {
          minIdx = i;
        }
      }
      this.swapRemove(this.projectiles, minIdx);
    }
    this.projectiles.push({
      ...params,
      id: this.nextEntityId++,
      maxLifeSec: params.lifeSec,
      returning: false,
      hitEnemyIds: [],
    });
  }

  private stepEnemiesAndBoss(dt: number): void {
    const p = this.player;
    const bal = GAME_CONFIG.balance;
    this.telegraphs.length = 0;

    const endlessRaw =
      this.activeRunPhase === 'RUN_ENDLESS'
        ? computeEndlessMultipliers(
            this.elapsedSec,
            this.currentStage.durationLimitSec,
            bal.endlessMaxHpMult,
            bal.endlessMaxDmgMult,
            bal.endlessMaxSpeedMult,
          )
        : { hpMult: 1, dmgMult: 1, speedMult: 1 };
    const endless = {
      hpMult: endlessRaw.hpMult,
      dmgMult: endlessRaw.dmgMult * this.currentStage.enemyDamageScaleMult,
      speedMult: endlessRaw.speedMult,
    };

    const relocateSq = bal.enemyRelocateDistancePx * bal.enemyRelocateDistancePx;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e || e.hp <= 0) {
        this.swapRemove(this.enemies, i);
        continue;
      }

      if (e.hitFlashSec > 0) e.hitFlashSec = Math.max(0, e.hitFlashSec - dt);
      if (e.bladeHitCdSec > 0) e.bladeHitCdSec = Math.max(0, e.bladeHitCdSec - dt);

      const cfg = ENEMY_BY_ID[e.enemyId];
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dSq = dx * dx + dy * dy;

      // 超远距离普通怪前移重投放至玩家视野外
      if (e.tier === 'normal' && dSq > relocateSq) {
        const ang = this.rng.nextFloat() * Math.PI * 2;
        e.x = p.x + Math.cos(ang) * 760;
        e.y = p.y + Math.sin(ang) * 760;
        continue;
      }

      const dist = Math.sqrt(dSq) || 1;
      const dirX = dx / dist;
      const dirY = dy / dist;
      const moveSpeed = cfg.baseMoveSpeedPxPerSec * endless.speedMult;

      // ---- 终局 Boss「虚空织主」3 阶段状态机 ----
      if (e.enemyId === 'boss_void_weaver') {
        this.stepBossAi(e, dt, dirX, dirY, dist, moveSpeed, endless.dmgMult);
      } else if (e.enemyId === 'elite_vanguard') {
        this.stepVanguardAi(e, dt, dirX, dirY, dist, moveSpeed, endless.dmgMult);
      } else if (e.enemyId === 'elite_prism') {
        this.stepPrismAi(e, dt, dirX, dirY, dist, moveSpeed, endless.dmgMult);
      } else if (e.enemyId === 'bomber') {
        this.stepBomberAi(e, i, dt, dirX, dirY, dist, moveSpeed, endless.dmgMult);
        if (e.hp <= 0) continue;
      } else if (e.enemyId === 'spitter') {
        this.stepSpitterAi(e, dt, dirX, dirY, dist, moveSpeed, endless.dmgMult);
      } else {
        e.vx = dirX * moveSpeed;
        e.vy = dirY * moveSpeed;
      }

      // 邻域软分离（利用零 GC SpatialHashGrid）
      let sepX = 0;
      let sepY = 0;
      if (e.entityState !== 'SKILL_EXECUTE' && e.entityState !== 'FUSE_TELEGRAPH') {
        const neighbors = this.enemyGrid.queryRadius(e.x, e.y, e.radiusPx * 2 + 12, this.queryBuffer);
        for (let n = 0; n < neighbors.length; n++) {
          const other = neighbors[n];
          if (!other || other === e || other.hp <= 0) continue;
          const sx = e.x - other.x;
          const sy = e.y - other.y;
          const minD = e.radiusPx + other.radiusPx + 2;
          const sSq = sx * sx + sy * sy;
          if (sSq > 0.01 && sSq < minD * minD) {
            const sDist = Math.sqrt(sSq);
            const push = ((minD - sDist) / minD) * 125;
            sepX += (sx / sDist) * push;
            sepY += (sy / sDist) * push;
          }
        }
      }

      e.x += (e.vx + sepX + e.kbVx) * dt;
      e.y += (e.vy + sepY + e.kbVy) * dt;
      const kbDecay = Math.pow(0.0015, dt);
      e.kbVx *= kbDecay;
      e.kbVy *= kbDecay;

      // 玩家接触伤害与无敌帧（Boss 高速冲锋技能撞击伤害额外 +20%）
      const hitDist = e.radiusPx + p.radiusPx - 2;
      if (distSq(e.x, e.y, p.x, p.y) <= hitDist * hitDist) {
        const dashSkillMult = e.tier === 'boss' && e.entityState === 'SKILL_EXECUTE' ? 1.2 : 1;
        this.damagePlayer(safeDamage(cfg.contactDamage * dashSkillMult * endless.dmgMult));
      }
    }
  }

  private stepSpitterAi(
    e: InternalEnemy,
    dt: number,
    dirX: number,
    dirY: number,
    dist: number,
    moveSpeed: number,
    dmgMult: number,
  ): void {
    const cfg = ENEMY_BY_ID.spitter;
    if (dist > cfg.preferredRangePx) {
      e.vx = dirX * moveSpeed;
      e.vy = dirY * moveSpeed;
    } else if (dist < cfg.preferredRangePx * 0.65) {
      e.vx = -dirX * moveSpeed * 0.55;
      e.vy = -dirY * moveSpeed * 0.55;
    } else {
      e.vx = -dirY * moveSpeed * 0.4;
      e.vy = dirX * moveSpeed * 0.4;
    }
    e.skillCooldownSec -= dt;
    if (e.skillCooldownSec <= 0 && dist < 520) {
      e.skillCooldownSec = cfg.skillCooldownSec;
      this.spawnEnemyBullet(e.x, e.y, dirX * cfg.projectileSpeedPxPerSec, dirY * cfg.projectileSpeedPxPerSec, safeDamage(11 * dmgMult));
    }
  }

  private stepBomberAi(
    e: InternalEnemy,
    enemyIdx: number,
    dt: number,
    dirX: number,
    dirY: number,
    dist: number,
    moveSpeed: number,
    dmgMult: number,
  ): void {
    const cfg = ENEMY_BY_ID.bomber;
    if (e.entityState === 'FUSE_TELEGRAPH') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      const progress = clamp(1 - e.stateTimerSec / cfg.explosionFuseSec, 0, 1);
      this.telegraphs.push({
        id: e.id,
        shape: 'circle',
        x: e.x,
        y: e.y,
        endX: e.x,
        endY: e.y,
        radiusPx: cfg.explosionRadiusPx,
        progressRatio: progress,
      });
      if (e.stateTimerSec <= 0) {
        // 引爆并移除
        const rSum = cfg.explosionRadiusPx + this.player.radiusPx;
        if (distSq(e.x, e.y, this.player.x, this.player.y) <= rSum * rSum) {
          this.damagePlayer(safeDamage(cfg.contactDamage * dmgMult));
        }
        this.novaVisuals.push({
          x: e.x,
          y: e.y,
          radiusPx: 12,
          maxRadiusPx: cfg.explosionRadiusPx,
          lifeSec: 0.25,
          maxLifeSec: 0.25,
          isEvolution: false,
          isCollapse: false,
        });
        e.hp = 0;
        this.swapRemove(this.enemies, enemyIdx);
      }
      return;
    }

    e.vx = dirX * moveSpeed;
    e.vy = dirY * moveSpeed;
    if (dist <= cfg.preferredRangePx) {
      e.entityState = 'FUSE_TELEGRAPH';
      e.stateTimerSec = cfg.explosionFuseSec;
    }
  }

  private stepVanguardAi(
    e: InternalEnemy,
    dt: number,
    dirX: number,
    dirY: number,
    dist: number,
    moveSpeed: number,
    _dmgMult: number,
  ): void {
    const cfg = ENEMY_BY_ID.elite_vanguard;
    if (e.entityState === 'SKILL_TELEGRAPH') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      const progress = clamp(1 - e.stateTimerSec / 0.9, 0, 1);
      this.telegraphs.push({
        id: e.id,
        shape: 'line',
        x: e.x,
        y: e.y,
        endX: e.x + e.telegraphDirX * 320,
        endY: e.y + e.telegraphDirY * 320,
        radiusPx: e.radiusPx,
        progressRatio: progress,
      });
      if (e.stateTimerSec <= 0) {
        e.entityState = 'SKILL_EXECUTE';
        e.stateTimerSec = 0.55;
      }
      return;
    }
    if (e.entityState === 'SKILL_EXECUTE') {
      e.vx = e.telegraphDirX * cfg.projectileSpeedPxPerSec;
      e.vy = e.telegraphDirY * cfg.projectileSpeedPxPerSec;
      e.stateTimerSec -= dt;
      if (e.stateTimerSec <= 0) {
        e.entityState = 'SKILL_RECOVER';
        e.stateTimerSec = 0.65;
      }
      return;
    }
    if (e.entityState === 'SKILL_RECOVER') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      if (e.stateTimerSec <= 0) {
        e.entityState = 'ACTIVE_CHASE';
        e.skillCooldownSec = cfg.skillCooldownSec;
      }
      return;
    }

    e.vx = dirX * moveSpeed;
    e.vy = dirY * moveSpeed;
    e.skillCooldownSec -= dt;
    if (e.skillCooldownSec <= 0 && dist <= cfg.preferredRangePx) {
      e.entityState = 'SKILL_TELEGRAPH';
      e.stateTimerSec = 0.9;
      e.telegraphDirX = dirX;
      e.telegraphDirY = dirY;
    }
  }

  private stepPrismAi(
    e: InternalEnemy,
    dt: number,
    dirX: number,
    dirY: number,
    dist: number,
    moveSpeed: number,
    dmgMult: number,
  ): void {
    const cfg = ENEMY_BY_ID.elite_prism;
    if (e.entityState === 'SKILL_TELEGRAPH') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      this.telegraphs.push({
        id: e.id,
        shape: 'circle',
        x: e.x,
        y: e.y,
        endX: e.x,
        endY: e.y,
        radiusPx: e.radiusPx + 24,
        progressRatio: clamp(1 - e.stateTimerSec / 0.8, 0, 1),
      });
      if (e.stateTimerSec <= 0) {
        const count = 8;
        const offset = this.rng.nextFloat() * Math.PI * 2;
        for (let k = 0; k < count; k++) {
          const ang = offset + (k * Math.PI * 2) / count;
          this.spawnEnemyBullet(
            e.x,
            e.y,
            Math.cos(ang) * cfg.projectileSpeedPxPerSec,
            Math.sin(ang) * cfg.projectileSpeedPxPerSec,
            safeDamage(14 * dmgMult),
          );
        }
        e.entityState = 'SKILL_RECOVER';
        e.stateTimerSec = 0.5;
      }
      return;
    }
    if (e.entityState === 'SKILL_RECOVER') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      if (e.stateTimerSec <= 0) {
        e.entityState = 'ACTIVE_CHASE';
        e.skillCooldownSec = cfg.skillCooldownSec;
      }
      return;
    }

    e.vx = dirX * moveSpeed;
    e.vy = dirY * moveSpeed;
    e.skillCooldownSec -= dt;
    if (e.skillCooldownSec <= 0 && dist <= 460) {
      e.entityState = 'SKILL_TELEGRAPH';
      e.stateTimerSec = 0.8;
    }
  }

  private stepBossAi(
    e: InternalEnemy,
    dt: number,
    dirX: number,
    dirY: number,
    _dist: number,
    moveSpeed: number,
    dmgMult: number,
  ): void {
    const cfg = ENEMY_BY_ID.boss_void_weaver;
    const hpRatio = e.hp / e.maxHp;
    const nextPhase: BossPhase = hpRatio <= 0.3 ? 3 : hpRatio <= 0.65 ? 2 : 1;
    if (e.bossPhase !== null && nextPhase > e.bossPhase && nextPhase !== 1) {
      e.bossPhase = nextPhase;
      this.eventBus.emit({ type: 'BOSS_PHASE_CHANGED', newPhase: nextPhase, x: e.x, y: e.y });
      if (nextPhase === 3) {
        this.spawnEnemy('splitter_mini', e.x + 90, e.y);
        this.spawnEnemy('splitter_mini', e.x - 90, e.y);
      }
    }

    if (e.entityState === 'BOSS_SPAWN_INTRO') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      if (e.stateTimerSec <= 0) {
        e.entityState = 'ACTIVE_CHASE';
        e.skillCooldownSec = 1.6;
      }
      return;
    }

    const phase = e.bossPhase ?? 1;
    if (e.entityState === 'SKILL_TELEGRAPH') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      const dur = phase === 3 ? 0.65 : 0.8;
      const progress = clamp(1 - e.stateTimerSec / dur, 0, 1);
      this.telegraphs.push({
        id: e.id,
        shape: 'line',
        x: e.x,
        y: e.y,
        endX: e.x + e.telegraphDirX * 420,
        endY: e.y + e.telegraphDirY * 420,
        radiusPx: e.radiusPx * 0.85,
        progressRatio: progress,
      });
      if (phase === 3) {
        this.telegraphs.push({
          id: e.id + 100000,
          shape: 'circle',
          x: e.bombTargetX,
          y: e.bombTargetY,
          endX: e.bombTargetX,
          endY: e.bombTargetY,
          radiusPx: cfg.explosionRadiusPx,
          progressRatio: progress,
        });
      }
      if (e.stateTimerSec <= 0) {
        e.entityState = 'SKILL_EXECUTE';
        e.stateTimerSec = 0.55;
        // 冲锋启动时发射留有安全缝隙的弹幕环（Boss 技能伤害 +20%：16 -> 19.2，P3 震爆 24 -> 28.8）
        const bulletCount = phase === 1 ? 10 : phase === 2 ? 14 : 16;
        const baseOff = this.elapsedSec * 1.4;
        for (let k = 0; k < bulletCount; k++) {
          const ang = baseOff + (k * Math.PI * 2) / bulletCount;
          this.spawnEnemyBullet(e.x, e.y, Math.cos(ang) * 205, Math.sin(ang) * 205, safeDamage(19.2 * dmgMult));
        }
        if (phase === 3) {
          const rSum = cfg.explosionRadiusPx + this.player.radiusPx;
          if (distSq(e.bombTargetX, e.bombTargetY, this.player.x, this.player.y) <= rSum * rSum) {
            this.damagePlayer(safeDamage(28.8 * dmgMult));
          }
        }
      }
      return;
    }

    if (e.entityState === 'SKILL_EXECUTE') {
      e.vx = e.telegraphDirX * cfg.projectileSpeedPxPerSec;
      e.vy = e.telegraphDirY * cfg.projectileSpeedPxPerSec;
      e.stateTimerSec -= dt;
      if (e.stateTimerSec <= 0) {
        if (e.comboRemaining > 1) {
          e.comboRemaining -= 1;
          e.entityState = 'SKILL_TELEGRAPH';
          e.stateTimerSec = phase === 3 ? 0.65 : 0.8;
          e.telegraphDirX = dirX;
          e.telegraphDirY = dirY;
          e.bombTargetX = this.player.x;
          e.bombTargetY = this.player.y;
        } else {
          e.entityState = 'SKILL_RECOVER';
          e.stateTimerSec = 0.85;
        }
      }
      return;
    }

    if (e.entityState === 'SKILL_RECOVER') {
      e.vx = 0;
      e.vy = 0;
      e.stateTimerSec -= dt;
      if (e.stateTimerSec <= 0) {
        e.entityState = 'ACTIVE_CHASE';
        e.skillCooldownSec = phase === 3 ? 2.1 : phase === 2 ? 2.6 : cfg.skillCooldownSec;
      }
      return;
    }

    e.vx = dirX * moveSpeed;
    e.vy = dirY * moveSpeed;
    e.skillCooldownSec -= dt;
    if (e.skillCooldownSec <= 0) {
      e.entityState = 'SKILL_TELEGRAPH';
      e.stateTimerSec = phase === 3 ? 0.65 : 0.8;
      e.comboRemaining = phase;
      e.telegraphDirX = dirX;
      e.telegraphDirY = dirY;
      e.bombTargetX = this.player.x;
      e.bombTargetY = this.player.y;
    }
  }

  private spawnEnemyBullet(x: number, y: number, vx: number, vy: number, damage: number): void {
    const MAX_ENEMY_BULLETS = 180;
    if (this.enemyBullets.length >= MAX_ENEMY_BULLETS) {
      this.swapRemove(this.enemyBullets, 0);
    }
    this.enemyBullets.push({
      id: this.nextEntityId++,
      x,
      y,
      vx,
      vy,
      radiusPx: 6,
      damage,
      lifeSec: 4.0,
    });
  }

  private stepProjectiles(dt: number): boolean {
    let bossKilled = false;
    const p = this.player;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (!proj) continue;

      proj.lifeSec -= dt;
      if (proj.lifeSec <= 0) {
        this.swapRemove(this.projectiles, i);
        continue;
      }

      // 回旋矩阵刃折返物理
      if (proj.sourceWeaponId === 'boomerang_matrix') {
        const halfLife = proj.maxLifeSec * 0.55;
        if (!proj.returning && proj.lifeSec <= halfLife) {
          proj.returning = true;
          proj.hitEnemyIds.length = 0; // 折返允许二次收割
        }
        if (proj.returning) {
          const toP = normalize2D(p.x - proj.x, p.y - proj.y);
          const spd = Math.max(460, Math.hypot(proj.vx, proj.vy));
          proj.vx = toP.x * spd;
          proj.vy = toP.y * spd;
          if (distSq(proj.x, proj.y, p.x, p.y) <= 22 * 22 && proj.lifeSec < halfLife - 0.15) {
            this.swapRemove(this.projectiles, i);
            continue;
          }
        } else {
          proj.vx *= Math.pow(0.28, dt);
          proj.vy *= Math.pow(0.28, dt);
        }
      }

      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;

      const candidates = this.enemyGrid.queryRadius(proj.x, proj.y, proj.radiusPx + 48, this.queryBuffer);
      let consumed = false;
      for (let c = 0; c < candidates.length; c++) {
        const e = candidates[c];
        if (!e || e.hp <= 0 || proj.hitEnemyIds.includes(e.id)) continue;
        const rSum = proj.radiusPx + e.radiusPx;
        if (distSq(proj.x, proj.y, e.x, e.y) <= rSum * rSum) {
          proj.hitEnemyIds.push(e.id);
          proj.pierceLeft -= 1;
          bossKilled =
            this.applyDamageToEnemy(
              e,
              proj.damage,
              proj.sourceWeaponId,
              proj.x - proj.vx * 0.02,
              proj.y - proj.vy * 0.02,
              proj.knockbackScaleRatio,
              true,
            ) || bossKilled;

          // 星穹集束炮命中溅射电弧
          if (proj.isEvolution && proj.sourceWeaponId === 'tracking_pulse') {
            const evo = EVOLUTION_BY_ID.evo_star_cluster;
            const splashR = evo.stats.specialParamA;
            const splashDmg = proj.damage * evo.stats.specialParamB;
            for (let s = 0; s < candidates.length; s++) {
              const other = candidates[s];
              if (!other || other === e || other.hp <= 0) continue;
              if (distSq(other.x, other.y, e.x, e.y) <= splashR * splashR) {
                bossKilled =
                  this.applyDamageToEnemy(other, splashDmg, proj.sourceWeaponId, e.x, e.y, 0.4, false) || bossKilled;
              }
            }
          }

          if (proj.pierceLeft <= 0) {
            this.swapRemove(this.projectiles, i);
            consumed = true;
            break;
          }
        }
      }
      if (consumed) continue;
    }

    return bossKilled;
  }

  private stepEnemyBullets(dt: number): void {
    const p = this.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      if (!b) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.lifeSec -= dt;
      if (b.lifeSec <= 0) {
        this.swapRemove(this.enemyBullets, i);
        continue;
      }
      const rSum = b.radiusPx + p.radiusPx - 2;
      if (distSq(b.x, b.y, p.x, p.y) <= rSum * rSum) {
        this.damagePlayer(b.damage);
        this.swapRemove(this.enemyBullets, i);
      }
    }
  }

  private applyDamageToEnemy(
    e: InternalEnemy,
    rawBaseDamage: number,
    weaponId: WeaponId,
    fromX: number,
    fromY: number,
    kbScale: number,
    allowCrit: boolean,
    ignoreDamageMult = false,
  ): boolean {
    if (e.hp <= 0) return false;
    const p = this.player;
    const isCrit = allowCrit && this.rng.chance(p.stats.critChanceRatio);
    const mult = ignoreDamageMult ? 1 : p.stats.damageMult * (isCrit ? p.stats.critDamageMult : 1);
    const dmg = safeDamage(rawBaseDamage * mult);

    e.hp -= dmg;
    e.hitFlashSec = 0.08;
    this.economy.damageByWeapon[weaponId] = (this.economy.damageByWeapon[weaponId] ?? 0) + dmg;

    this.eventBus.emit({
      type: 'ENEMY_HIT',
      enemyId: e.enemyId,
      weaponId,
      x: e.x,
      y: e.y,
      damage: dmg,
      isCrit,
    });

    const cfg = ENEMY_BY_ID[e.enemyId];
    const dir = normalize2D(e.x - fromX, e.y - fromY);
    const kbMag = GAME_CONFIG.balance.baseKnockbackPxPerSec * kbScale * (1 - cfg.knockbackResistanceRatio);
    e.kbVx = dir.x * kbMag;
    e.kbVy = dir.y * kbMag;

    if (e.hp > 0) return false;

    // 击杀死亡钩子
    e.entityState = 'DEAD';
    this.economy.kills += 1;
    this.eventBus.emit({
      type: 'ENEMY_KILLED',
      enemyId: e.enemyId,
      tier: e.tier,
      x: e.x,
      y: e.y,
      colorHex: cfg.colorHex,
    });

    if (cfg.xpValue > 0) {
      this.spawnXpGem(e.x, e.y, cfg.xpValue);
    }

    if (cfg.splitCount > 0) {
      for (let s = 0; s < cfg.splitCount; s++) {
        const ang = (s * Math.PI * 2) / cfg.splitCount + this.rng.nextFloat() * 0.6;
        this.spawnEnemy('splitter_mini', e.x + Math.cos(ang) * 20, e.y + Math.sin(ang) * 20);
      }
    }

    if (e.tier === 'elite') {
      this.economy.elitesKilled += 1;
      // 精英怪不再爆出进化宝箱，已通过上方 spawnXpGem 掉落高级金色经验水晶（tier: 'large'）
    }

    if (e.tier === 'boss') {
      this.lastKilledBossX = e.x;
      this.lastKilledBossY = e.y;
      this.lastKilledBossRadiusPx = e.radiusPx;
      const idx = this.activeBossIds.indexOf(e.id);
      if (idx !== -1) this.activeBossIds.splice(idx, 1);
      this.bossesKilled += 1;

      if (this.bossesKilled === 1 && !this.triggeredPostFirstBossElites) {
        this.triggeredPostFirstBossElites = true;
        const bonusElites = computePostFirstBossBonusEliteCount(this.currentLevel);
        if (bonusElites > 0) {
          this.spawnPostFirstBossEliteWave(bonusElites);
        }
      }

      if (this.activeBossIds.length === 0) {
        this.enemyBullets.length = 0;
        this.telegraphs.length = 0;
        if (this.bossesKilled < this.currentStage.bossSpawnTimesSec.length && this.activeRunPhase === 'RUN_BOSS') {
          this.activeRunPhase = 'RUN_NORMAL';
          if (this.appState === 'RUN_BOSS') {
            this.appState = 'RUN_NORMAL';
          }
        }
      }

      // 仅当本关规定数量的全部 Boss 均已肃清，才触发本关通关胜利！
      return this.bossesKilled >= this.currentStage.bossSpawnTimesSec.length;
    }

    return false;
  }

  /** 第 5 关起消灭首个 Boss 后，环绕玩家外圈刷出额外精英增援波 */
  private spawnPostFirstBossEliteWave(count: number): void {
    const baseAngle = this.rng.nextFloat() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const enemyId: EnemyId =
        this.currentStage.stageNumber >= 3 && i % 2 === 1 ? 'elite_prism' : 'elite_vanguard';
      const angle = baseAngle + (i * Math.PI * 2) / count;
      const dist = 430 + (i % 3) * 45;
      this.spawnEnemy(enemyId, this.player.x + Math.cos(angle) * dist, this.player.y + Math.sin(angle) * dist);
    }
  }

  public setDebugPlayerInvincible(enabled: boolean): void {
    this.debugPlayerInvincibleOverride = enabled;
  }

  public isPlayerInvincible(): boolean {
    return this.debugPlayerInvincibleOverride ?? GAME_CONFIG.balance.debugPlayerInvincible;
  }

  private damagePlayer(amount: number): void {
    const p = this.player;
    if (this.isPlayerInvincible()) return;
    if (p.entityState !== 'ALIVE_NORMAL' || p.invulnSec > 0) return;
    const dmg = safeDamage(amount);
    p.hp = Math.max(0, p.hp - dmg);
    p.invulnSec = GAME_CONFIG.balance.basePlayerInvulnDurationSec;
    p.entityState = p.hp <= 0 ? 'DEAD' : 'ALIVE_INVULN';
    this.eventBus.emit({
      type: 'PLAYER_HIT',
      damage: dmg,
      hpAfter: p.hp,
      x: p.x,
      y: p.y,
    });
  }

  private spawnXpGem(x: number, y: number, xpValue: number): void {
    const cap = GAME_CONFIG.balance.activeXpGemHardCap;
    if (this.xpGems.length >= cap) {
      // 视野外（或最老）低阶宝石聚合为金色大宝石，经验 100% 零损失
      let mergeTarget: XpGemRuntimeEntity | undefined;
      for (let i = 0; i < this.xpGems.length; i++) {
        const g = this.xpGems[i];
        if (g && !g.magnetized && Math.abs(g.x - this.player.x) > VIEWPORT_HALF_W) {
          mergeTarget = g;
          break;
        }
      }
      mergeTarget = mergeTarget ?? this.xpGems[0];
      if (mergeTarget) {
        mergeTarget.xpValue += xpValue;
        mergeTarget.tier = 'large';
        return;
      }
    }
    const tier: XpGemRuntimeEntity['tier'] = xpValue >= 8 ? 'large' : xpValue >= 4 ? 'medium' : 'small';
    this.xpGems.push({
      id: this.nextEntityId++,
      x,
      y,
      xpValue,
      tier,
      magnetized: false,
    });
  }

  private stepXpGems(dt: number): void {
    const p = this.player;
    if (p.entityState === 'DEAD') return;
    const pickSq = p.stats.pickupRadiusPx * p.stats.pickupRadiusPx;
    const collectSq = (p.radiusPx + 11) * (p.radiusPx + 11);

    for (let i = this.xpGems.length - 1; i >= 0; i--) {
      const g = this.xpGems[i];
      if (!g) continue;
      const dSq = distSq(p.x, p.y, g.x, g.y);
      if (!g.magnetized && dSq <= pickSq) {
        g.magnetized = true;
      }
      if (g.magnetized) {
        const d = Math.sqrt(dSq) || 1;
        const pullSpeed = Math.max(460, p.stats.moveSpeedPxPerSec * 2.4);
        g.x += ((p.x - g.x) / d) * pullSpeed * dt;
        g.y += ((p.y - g.y) / d) * pullSpeed * dt;
        if (distSq(p.x, p.y, g.x, g.y) <= collectSq) {
          const gained = Math.max(1, Math.round(g.xpValue * p.stats.xpGainMult));
          p.xp += gained;
          this.eventBus.emit({ type: 'XP_PICKED', xpValue: gained, tier: g.tier });
          this.swapRemove(this.xpGems, i);

          while (p.xp >= p.xpToNext) {
            p.xp -= p.xpToNext;
            p.level += 1;
            p.xpToNext = computeXpToNextLevel(p.level);
            this.eventBus.emit({ type: 'LEVEL_UP', newLevel: p.level });
            this.enqueueModal('LEVEL_UP_MODAL');
          }
        }
      }
    }
  }

  private enqueueModal(kind: ModalQueueKind): void {
    this.modalQueue.push(kind);
    this.modalQueue.sort((a, b) => MODAL_PRIORITY[a] - MODAL_PRIORITY[b]);
  }

  private triggerDefeat(defeatReason: DefeatReason): void {
    if (defeatReason === 'hp_zero') {
      this.player.entityState = 'DEAD';
    } else if (defeatReason === 'timeout') {
      this.elapsedSec = this.currentStage.durationLimitSec;
    }
    this.modalQueue.length = 0;
    const isEndlessEnd = this.economy.victoryRewardGranted;
    let granted = 0;
    let deltaKillsToAdd = 0;
    if (isEndlessEnd && !this.economy.endlessRewardSettled) {
      granted = calculateEndlessDeltaCrystals(
        this.endlessElapsedSec,
        this.economy,
        this.player.stats.crystalExtractMult,
      );
      deltaKillsToAdd = Math.max(0, this.economy.kills - this.economy.victoryBaselineKills);
      this.economy.endlessRewardSettled = true;
    } else if (!isEndlessEnd && !this.economy.endlessRewardSettled) {
      granted = calculateNormalOrVictoryCrystals(
        this.elapsedSec,
        this.economy,
        false,
        0,
        this.player.stats.crystalExtractMult,
      );
      deltaKillsToAdd = this.economy.kills;
      this.economy.endlessRewardSettled = true;
    }
    this.economy.lastGrantedCrystals = granted;

    const payload: SettlementModalPayload = {
      isVictory: false,
      isEndlessEnd,
      defeatReason,
      canContinueEndless: false,
      playedLevelNumber: this.currentLevel,
      nextLevelNumber: this.currentLevel, // 失败不推进不回退，进度保持当前关卡
      newlyUnlockedForm: null,
      survivedSec: this.elapsedSec,
      endlessSec: this.endlessElapsedSec,
      kills: this.economy.kills,
      elitesKilled: this.economy.elitesKilled,
      altarsCompleted: this.economy.altarsCompleted,
      levelReached: this.player.level,
      grantedCrystals: granted,
    };
    this.activeSettlementModal = payload;
    this.pendingSettlementOutput = {
      kind: 'game_over',
      payload,
      newlyDiscoveredEvolutions: Array.from(this.runDiscoveredEvolutions),
      deltaKillsToAdd,
    };
    this.appState = 'GAME_OVER_MODAL';
    this.eventBus.emit({ type: 'RUN_GAME_OVER', grantedCrystals: granted, isEndlessEnd });
  }

  /** 击杀本关最后一只 Boss 后进入 3 秒过渡动画：清场剩余杂兵/弹幕、停下主角、播放 Boss 死亡演出 */
  private beginVictoryOutro(): void {
    this.modalQueue.length = 0;
    this.enemyBullets.length = 0;
    this.telegraphs.length = 0;
    this.pendingCollapses.length = 0;
    this.orbitalBlades.length = 0;

    // 肃清场上残余小怪与精英（最多派发 24 条击杀爆炸事件，保证视觉清场爽感且不超粒子预算）
    let emittedPurges = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const rem = this.enemies[i];
      if (!rem || rem.hp <= 0 || rem.tier === 'boss') continue;
      rem.hp = 0;
      rem.entityState = 'DEAD';
      if (emittedPurges < 24) {
        const cfg = ENEMY_BY_ID[rem.enemyId];
        this.eventBus.emit({
          type: 'ENEMY_KILLED',
          enemyId: rem.enemyId,
          tier: rem.tier,
          x: rem.x,
          y: rem.y,
          colorHex: cfg.colorHex,
        });
        emittedPurges += 1;
      }
    }
    this.enemies.length = 0;
    this.activeBossIds.length = 0;

    this.victoryOutroCanContinueEndless = this.currentStage.enableEndlessOnVictory && this.player.hp > 0;
    this.victoryOutroElapsedSec = 0;
    this.victoryOutroBossX =
      this.lastKilledBossX !== 0 || this.lastKilledBossY !== 0 ? this.lastKilledBossX : this.player.x;
    this.victoryOutroBossY =
      this.lastKilledBossX !== 0 || this.lastKilledBossY !== 0 ? this.lastKilledBossY : this.player.y;
    this.victoryOutroBossRadiusPx = this.lastKilledBossRadiusPx || 56;
    this.appState = 'VICTORY_OUTRO';

    this.eventBus.emit({
      type: 'BOSS_DEATH_OUTRO_STARTED',
      x: this.victoryOutroBossX,
      y: this.victoryOutroBossY,
      radiusPx: this.victoryOutroBossRadiusPx,
      durationSec: BOSS_VICTORY_OUTRO_DURATION_SEC,
    });
  }

  /** 3 秒 Boss 死亡过渡期：玩家原地停下放松情绪，残留光效柔和消散，3 秒整弹出胜利结算 */
  private stepVictoryOutro(dt: number): void {
    this.tickCount += 1;
    this.victoryOutroElapsedSec = Math.min(
      BOSS_VICTORY_OUTRO_DURATION_SEC,
      this.victoryOutroElapsedSec + dt,
    );

    // 柔和衰减场上残留的激光/落雷/冲击波与弹幕
    for (let i = this.beamVisuals.length - 1; i >= 0; i--) {
      const b = this.beamVisuals[i];
      if (!b) continue;
      b.lifeSec -= dt * 2;
      if (b.lifeSec <= 0) this.beamVisuals.splice(i, 1);
    }
    for (let i = this.lightningVisuals.length - 1; i >= 0; i--) {
      const l = this.lightningVisuals[i];
      if (!l) continue;
      l.lifeSec -= dt * 2;
      if (l.lifeSec <= 0) this.lightningVisuals.splice(i, 1);
    }
    for (let i = this.novaVisuals.length - 1; i >= 0; i--) {
      const n = this.novaVisuals[i];
      if (!n) continue;
      n.lifeSec -= dt * 1.4;
      n.radiusPx = n.maxRadiusPx * clamp(1 - n.lifeSec / n.maxLifeSec, 0.12, 1);
      if (n.lifeSec <= 0) this.novaVisuals.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (!pr) continue;
      pr.x += pr.vx * dt * 0.45;
      pr.y += pr.vy * dt * 0.45;
      pr.lifeSec -= dt * 3.5;
      if (pr.lifeSec <= 0) this.projectiles.splice(i, 1);
    }

    if (this.victoryOutroElapsedSec >= BOSS_VICTORY_OUTRO_DURATION_SEC - 1e-6) {
      this.finalizeVictoryModal();
    }
  }

  private finalizeVictoryModal(): void {
    if (this.economy.victoryRewardGranted) return;
    const canContinueEndless = this.victoryOutroCanContinueEndless;
    const granted = calculateNormalOrVictoryCrystals(
      this.elapsedSec,
      this.economy,
      true,
      this.currentStage.clearCrystalBonus,
      this.player.stats.crystalExtractMult,
    );
    this.economy.victoryRewardGranted = true;
    this.economy.lastGrantedCrystals = granted;
    this.economy.victoryBaselineKills = this.economy.kills;
    this.economy.victoryBaselineElites = this.economy.elitesKilled;
    this.economy.victoryBaselineAltars = this.economy.altarsCompleted;
    this.economy.victoryBaselineBonusCrystals = this.economy.runBonusCrystals;

    const payload: SettlementModalPayload = {
      isVictory: true,
      isEndlessEnd: false,
      defeatReason: null,
      canContinueEndless,
      playedLevelNumber: this.currentLevel,
      nextLevelNumber: Math.min(GAME_CONFIG.balance.maxTotalLevels, this.currentLevel + 1),
      newlyUnlockedForm: null,
      survivedSec: this.elapsedSec,
      endlessSec: 0,
      kills: this.economy.kills,
      elitesKilled: this.economy.elitesKilled,
      altarsCompleted: this.economy.altarsCompleted,
      levelReached: this.player.level,
      grantedCrystals: granted,
    };
    this.activeSettlementModal = payload;
    this.pendingSettlementOutput = {
      kind: 'victory',
      payload,
      newlyDiscoveredEvolutions: Array.from(this.runDiscoveredEvolutions),
      deltaKillsToAdd: this.economy.kills,
    };
    this.appState = 'VICTORY_MODAL';
    this.eventBus.emit({ type: 'RUN_VICTORY', grantedCrystals: granted, canContinueEndless });
  }

  private resolveEndOfFrameArbitration(allBossesDefeatedThisFrame: boolean): void {
    // 状态不变量兜底：无论最后一只 Boss 死于何种伤害来源，只要已满足全部 Boss 肃清条件且尚未发奖，立即切入 3 秒 Boss 死亡过渡动画！
    const allStageBossesDefeated =
      allBossesDefeatedThisFrame ||
      (this.currentStage.bossSpawnTimesSec.length > 0 &&
        this.bossesKilled >= this.currentStage.bossSpawnTimesSec.length);

    // 优先级 1：全 Boss 肃清同帧险胜 > 玩家死亡 / 时间上限到达
    if (allStageBossesDefeated && !this.economy.victoryRewardGranted && this.appState !== 'VICTORY_OUTRO') {
      this.beginVictoryOutro();
      return;
    }

    // 优先级 2：玩家血量归零
    if (this.player.hp <= 0 || this.player.entityState === 'DEAD') {
      this.triggerDefeat('hp_zero');
      return;
    }

    // 优先级 2.5：单局时间达到阶段上限且本关 Boss 尚未全部被击杀 -> 超时判败（进度保持当前关卡）
    if (
      this.activeRunPhase !== 'RUN_ENDLESS' &&
      !this.economy.victoryRewardGranted &&
      this.elapsedSec >= this.currentStage.durationLimitSec &&
      this.bossesKilled < this.currentStage.bossSpawnTimesSec.length
    ) {
      this.triggerDefeat('timeout');
      return;
    }

    // 优先级 3：按 CHEST → ALTAR → LEVEL_UP 顺序弹出排队模态窗口
    if (this.modalQueue.length > 0) {
      this.openNextQueuedModal();
    }
  }

  private openNextQueuedModal(): void {
    const next = this.modalQueue.shift();
    if (!next) {
      this.appState = this.activeRunPhase;
      return;
    }

    if (next === 'CHEST_MODAL') {
      const { payload, evolvedTo } = resolveEliteChest(
        this.rng,
        this.weapons,
        this.passives,
        this.economy,
        this.buffs,
      );
      if (evolvedTo) {
        this.runDiscoveredEvolutions.add(evolvedTo.id);
      }
      this.refreshComputedStats();
      this.activeChestModal = payload;
      this.appState = 'CHEST_MODAL';
      this.eventBus.emit({
        type: 'CHEST_OPENED',
        evolvedTo: evolvedTo?.id ?? null,
        grantedCrystals: payload.grantedCrystals,
      });
    } else if (next === 'ALTAR_MODAL') {
      this.activeAltarChoices = buildAltarBlessingChoices();
      this.appState = 'ALTAR_MODAL';
    } else if (next === 'LEVEL_UP_MODAL') {
      this.activeLevelUpChoices = rollLevelUpChoices(
        this.rng,
        this.weapons,
        this.passives,
        this.currentStage.maxActiveSlots,
        this.currentStage.maxPassiveSlots,
        [],
        this.fallbackHealsUsed,
      );
      this.appState = 'LEVEL_UP_MODAL';
    }
  }

  public getFallbackHealsUsed(): number {
    return this.fallbackHealsUsed;
  }

  public getAltarsSpawned(): number {
    return this.altarsSpawned;
  }

  // ==================== 模态与流程控制方法（由 GameController 调用） ====================

  public pauseWorld(): boolean {
    if (this.isRunningPhase()) {
      this.appState = 'PAUSED';
      return true;
    }
    if (
      this.appState === 'CHEST_MODAL' ||
      this.appState === 'ALTAR_MODAL' ||
      this.appState === 'LEVEL_UP_MODAL'
    ) {
      this.pausedModalUnderlay = this.appState;
      this.appState = 'PAUSED_OVER_MODAL';
      return true;
    }
    return false;
  }

  public resumeWorld(): boolean {
    if (this.appState === 'PAUSED') {
      this.appState = this.activeRunPhase;
      return true;
    }
    if (this.appState === 'PAUSED_OVER_MODAL' && this.pausedModalUnderlay) {
      this.appState = this.pausedModalUnderlay;
      this.pausedModalUnderlay = null;
      return true;
    }
    return false;
  }

  public selectModalChoice(index: 0 | 1 | 2): boolean {
    if (this.appState === 'LEVEL_UP_MODAL') {
      const choice = this.activeLevelUpChoices[index];
      if (!choice) return false;
      const res = applySelectedChoice(
        choice,
        this.player,
        this.weapons,
        this.passives,
        this.buffs,
        this.economy,
        this.currentStage.maxActiveSlots,
        this.currentStage.maxPassiveSlots,
        this.fallbackHealsUsed,
      );
      if (res.usedFallbackHeal) {
        this.fallbackHealsUsed += 1;
      }
      if (res.evolvedId) this.runDiscoveredEvolutions.add(res.evolvedId);
      if (res.healedAmount > 0) {
        this.eventBus.emit({ type: 'PLAYER_HEALED', amount: res.healedAmount, x: this.player.x, y: this.player.y });
      }
      this.refreshComputedStats();
      this.activeLevelUpChoices = [];
      this.openNextQueuedModal();
      return true;
    }
    if (this.appState === 'ALTAR_MODAL') {
      const choice = this.activeAltarChoices[index];
      if (!choice) return false;
      const res = applySelectedChoice(
        choice,
        this.player,
        this.weapons,
        this.passives,
        this.buffs,
        this.economy,
        this.currentStage.maxActiveSlots,
        this.currentStage.maxPassiveSlots,
      );
      if (res.healedAmount > 0) {
        this.eventBus.emit({ type: 'PLAYER_HEALED', amount: res.healedAmount, x: this.player.x, y: this.player.y });
      }
      this.refreshComputedStats();
      this.activeAltarChoices = [];
      this.openNextQueuedModal();
      return true;
    }
    return false;
  }

  public rerollLevelUp(): boolean {
    if (this.appState !== 'LEVEL_UP_MODAL' || this.player.rerollsLeft <= 0) return false;
    this.player.rerollsLeft -= 1;
    const prevKeys = this.activeLevelUpChoices.map((c) => c.key);
    this.activeLevelUpChoices = rollLevelUpChoices(
      this.rng,
      this.weapons,
      this.passives,
      this.currentStage.maxActiveSlots,
      this.currentStage.maxPassiveSlots,
      prevKeys,
      this.fallbackHealsUsed,
    );
    return true;
  }

  public confirmChestModal(): boolean {
    if (this.appState !== 'CHEST_MODAL') return false;
    this.activeChestModal = null;
    this.openNextQueuedModal();
    return true;
  }

  public continueEndless(): boolean {
    if (
      this.appState !== 'VICTORY_MODAL' ||
      !this.currentStage.enableEndlessOnVictory ||
      this.player.hp <= 0
    ) {
      return false;
    }
    this.activeSettlementModal = null;
    this.activeRunPhase = 'RUN_ENDLESS';
    this.appState = 'RUN_ENDLESS';
    this.nextAltarSpawnSec = this.elapsedSec + 35;
    return true;
  }

  // ==================== 只读快照生成器（RenderSnapshot / HUD 分片） ====================

  public getRenderSnapshot(): RenderSnapshot {
    const p = this.player;
    const edgeIndicators: EdgeIndicatorView[] = [];
    const pushIfOffscreen = (kind: EdgeIndicatorView['kind'], x: number, y: number): void => {
      if (Math.abs(x - p.x) > VIEWPORT_HALF_W - 24 || Math.abs(y - p.y) > VIEWPORT_HALF_H - 24) {
        edgeIndicators.push({
          kind,
          angleRad: Math.atan2(y - p.y, x - p.x),
          distancePx: Math.round(Math.hypot(x - p.x, y - p.y)),
        });
      }
    };

    for (const a of this.altars) pushIfOffscreen('altar', a.x, a.y);
    for (const c of this.chests) pushIfOffscreen('chest', c.x, c.y);
    for (const b of this.beacons) pushIfOffscreen('beacon', b.x, b.y);
    for (const e of this.enemies) {
      if (e.tier === 'elite' || e.tier === 'boss') pushIfOffscreen('elite', e.x, e.y);
    }

    const isOutro = this.appState === 'VICTORY_OUTRO';
    return {
      worldTimeSec: isOutro ? this.elapsedSec + this.victoryOutroElapsedSec : this.elapsedSec,
      isEndless: this.activeRunPhase === 'RUN_ENDLESS',
      isBossActive: this.activeBossIds.length > 0,
      bossesActiveCount: this.activeBossIds.length,
      victoryOutro: isOutro
        ? {
            elapsedSec: this.victoryOutroElapsedSec,
            durationSec: BOSS_VICTORY_OUTRO_DURATION_SEC,
            progressRatio: clamp(this.victoryOutroElapsedSec / BOSS_VICTORY_OUTRO_DURATION_SEC, 0, 1),
            bossX: this.victoryOutroBossX,
            bossY: this.victoryOutroBossY,
            bossRadiusPx: this.victoryOutroBossRadiusPx,
          }
        : null,
      cameraTargetX: p.x,
      cameraTargetY: p.y,
      player: {
        formId: this.currentForm.id,
        formTier: this.currentForm.tier,
        primaryColorHex: this.currentForm.primaryColorHex,
        secondaryColorHex: this.currentForm.secondaryColorHex,
        x: p.x,
        y: p.y,
        dirX: p.dirX,
        dirY: p.dirY,
        radiusPx: p.radiusPx,
        hp: p.hp,
        maxHp: p.maxHp,
        invulnSec: p.invulnSec,
        pickupRadiusPx: p.stats.pickupRadiusPx,
        isAlive: p.entityState !== 'DEAD',
      },
      enemies: this.enemies.map((e) => ({
        id: e.id,
        enemyId: e.enemyId,
        tier: e.tier,
        x: e.x,
        y: e.y,
        radiusPx: e.radiusPx,
        hp: e.hp,
        maxHp: e.maxHp,
        hitFlashSec: e.hitFlashSec,
        entityState: e.entityState,
        bossPhase: e.bossPhase,
        colorHex: ENEMY_BY_ID[e.enemyId].colorHex,
      })),
      playerProjectiles: this.projectiles.map((pr) => ({
        id: pr.id,
        sourceWeaponId: pr.sourceWeaponId,
        isEvolution: pr.isEvolution,
        x: pr.x,
        y: pr.y,
        vx: pr.vx,
        vy: pr.vy,
        radiusPx: pr.radiusPx,
        returning: pr.returning,
        colorHex: pr.isEvolution
          ? EVOLUTION_BY_WEAPON_ID[pr.sourceWeaponId].accentColorHex
          : WEAPON_BY_ID[pr.sourceWeaponId].accentColorHex,
      })),
      orbitalBlades: this.orbitalBlades.slice(),
      beamRays: this.beamVisuals.map(
        (b): RenderBeamRayView => ({
          x: b.x,
          y: b.y,
          dirX: b.dirX,
          dirY: b.dirY,
          lengthPx: b.lengthPx,
          widthPx: b.widthPx,
          lifeRatio: clamp(b.lifeSec / b.maxLifeSec, 0, 1),
          isEvolution: b.isEvolution,
        }),
      ),
      lightningStrikes: this.lightningVisuals.map(
        (l): RenderLightningView => ({
          x: l.x,
          y: l.y,
          radiusPx: l.radiusPx,
          lifeRatio: clamp(l.lifeSec / l.maxLifeSec, 0, 1),
          isEvolution: l.isEvolution,
        }),
      ),
      novaRings: this.novaVisuals.map(
        (n): RenderNovaRingView => ({
          x: n.x,
          y: n.y,
          radiusPx: n.radiusPx,
          maxRadiusPx: n.maxRadiusPx,
          lifeRatio: clamp(n.lifeSec / n.maxLifeSec, 0, 1),
          isEvolution: n.isEvolution,
          isCollapse: n.isCollapse,
        }),
      ),
      enemyBullets: this.enemyBullets.map((eb) => ({ x: eb.x, y: eb.y, radiusPx: eb.radiusPx })),
      xpGems: this.xpGems.map((g) => ({ x: g.x, y: g.y, tier: g.tier, magnetized: g.magnetized })),
      chests: this.chests.map((c) => ({ x: c.x, y: c.y, radiusPx: c.radiusPx })),
      altars: this.altars.map((a) => ({
        x: a.x,
        y: a.y,
        radiusPx: a.radiusPx,
        chargeRatio: clamp(a.chargeSec / a.requiredSec, 0, 1),
        state: a.state,
      })),
      beacons: this.beacons.map((b) => ({ x: b.x, y: b.y, radiusPx: b.radiusPx, kind: b.kind })),
      telegraphs: this.telegraphs.map((t) => ({ ...t })),
      edgeIndicators,
    };
  }

  public getHudPartials(): {
    readonly currentLevel: number;
    readonly stage: StageConfig;
    readonly form: FormConfig;
    readonly bossProgress: BossProgressView;
    readonly weaponSlots: readonly HudWeaponSlotView[];
    readonly passiveSlots: readonly HudPassiveSlotView[];
    readonly bossHud: BossHudView | null;
    readonly levelUpChoices: readonly UpgradeCardChoice[];
    readonly altarChoices: readonly UpgradeCardChoice[];
    readonly chestModal: ChestModalPayload | null;
    readonly settlementModal: SettlementModalPayload | null;
    readonly evolutionRecipesStatus: readonly EvolutionRecipeStatusView[];
    readonly weaponDamageStats: readonly WeaponDamageStatView[];
    readonly kills: number;
    readonly runBonusCrystals: number;
    readonly victoryOutroProgressRatio: number | null;
  } {
    const readyIds = new Set(findReadyEvolutions(this.weapons, this.passives).map((r) => r.requiredWeaponId));

    const weaponSlots: HudWeaponSlotView[] = this.weapons.map((slot) => {
      const cfg = WEAPON_BY_ID[slot.weaponId];
      const evo = slot.evolutionId ? EVOLUTION_BY_ID[slot.evolutionId] : null;
      return {
        weaponId: slot.weaponId,
        name: cfg.name,
        level: slot.level,
        isEvolved: slot.isEvolved,
        evolutionId: slot.evolutionId,
        evolutionName: evo?.name ?? null,
        canEvolveNow: readyIds.has(slot.weaponId),
        accentColorHex: evo ? evo.accentColorHex : cfg.accentColorHex,
      };
    });

    const passiveSlots: HudPassiveSlotView[] = this.passives.map((slot) => {
      const cfg = PASSIVE_BY_ID[slot.passiveId];
      return {
        passiveId: slot.passiveId,
        name: cfg.name,
        level: slot.level,
        accentColorHex: cfg.accentColorHex,
      };
    });

    const activeBosses = this.enemies.filter((e) => e.tier === 'boss');
    const primaryBoss = activeBosses[0];
    const bossHud: BossHudView | null = primaryBoss
      ? {
          name:
            activeBosses.length > 1
              ? `${ENEMY_BY_ID.boss_void_weaver.name}（同屏 ${activeBosses.length} 只）`
              : ENEMY_BY_ID.boss_void_weaver.name,
          hp: Math.max(0, Math.round(primaryBoss.hp)),
          maxHp: primaryBoss.maxHp,
          phase: primaryBoss.bossPhase ?? 1,
          activeCount: activeBosses.length,
        }
      : null;

    const bossProgress: BossProgressView = {
      spawned: this.bossesSpawned,
      killed: this.bossesKilled,
      total: this.currentStage.bossSpawnTimesSec.length,
      activeCount: activeBosses.length,
    };

    const evolutionRecipesStatus: EvolutionRecipeStatusView[] = GAME_CONFIG.evolutions.map((evo) => {
      const wSlot = this.weapons.find((w) => w.weaponId === evo.requiredWeaponId);
      const pSlot = this.passives.find((p) => p.passiveId === evo.requiredPassiveId);
      let status: EvolutionRecipeStatusView['status'] = 'locked';
      if (wSlot?.isEvolved) status = 'evolved';
      else if (wSlot && wSlot.level >= evo.requiredWeaponLevel && pSlot && pSlot.level >= evo.requiredPassiveMinLevel)
        status = 'ready';
      else if (wSlot || pSlot) status = 'partial';

      return {
        evolutionId: evo.id,
        evolutionName: evo.name,
        weaponId: evo.requiredWeaponId,
        weaponName: WEAPON_BY_ID[evo.requiredWeaponId].name,
        passiveId: evo.requiredPassiveId,
        passiveName: PASSIVE_BY_ID[evo.requiredPassiveId].name,
        status,
      };
    });

    const totalDmg = Object.values(this.economy.damageByWeapon).reduce((acc, v) => acc + (v ?? 0), 0);
    const weaponDamageStats: WeaponDamageStatView[] = this.weapons
      .map((slot) => {
        const dmg = this.economy.damageByWeapon[slot.weaponId] ?? 0;
        const evo = slot.evolutionId ? EVOLUTION_BY_ID[slot.evolutionId] : null;
        return {
          weaponId: slot.weaponId,
          displayName: evo ? `⚡ ${evo.name}` : WEAPON_BY_ID[slot.weaponId].name,
          isEvolved: slot.isEvolved,
          totalDamage: dmg,
          shareRatio: totalDmg > 0 ? dmg / totalDmg : 0,
          accentColorHex: evo ? evo.accentColorHex : WEAPON_BY_ID[slot.weaponId].accentColorHex,
        };
      })
      .sort((a, b) => b.totalDamage - a.totalDamage);

    return {
      currentLevel: this.currentLevel,
      stage: this.currentStage,
      form: this.currentForm,
      bossProgress,
      weaponSlots,
      passiveSlots,
      bossHud,
      levelUpChoices: this.activeLevelUpChoices,
      altarChoices: this.activeAltarChoices,
      chestModal: this.activeChestModal,
      settlementModal: this.activeSettlementModal,
      evolutionRecipesStatus,
      weaponDamageStats,
      kills: this.economy.kills,
      runBonusCrystals: this.economy.runBonusCrystals,
      victoryOutroProgressRatio:
        this.appState === 'VICTORY_OUTRO'
          ? clamp(this.victoryOutroElapsedSec / BOSS_VICTORY_OUTRO_DURATION_SEC, 0, 1)
          : null,
    };
  }

  public getEntityCounts(): Readonly<{
    enemies: number;
    projectiles: number;
    enemyBullets: number;
    xpGems: number;
    chests: number;
    altars: number;
    beacons: number;
  }> {
    return {
      enemies: this.enemies.length,
      projectiles: this.projectiles.length,
      enemyBullets: this.enemyBullets.length,
      xpGems: this.xpGems.length,
      chests: this.chests.length,
      altars: this.altars.length,
      beacons: this.beacons.length,
    };
  }

  // ==================== 受控测试与调试注入方法（供单元测试 & Debug Bridge） ====================

  public debugForceLevelUp(): void {
    if (!this.isRunningPhase()) return;
    this.player.level += 1;
    this.player.xp = 0;
    this.player.xpToNext = computeXpToNextLevel(this.player.level);
    this.eventBus.emit({ type: 'LEVEL_UP', newLevel: this.player.level });
    this.enqueueModal('LEVEL_UP_MODAL');
    this.resolveEndOfFrameArbitration(false);
  }

  public debugSpawnChestAtPlayer(): void {
    this.chests.push({ id: this.nextEntityId++, x: this.player.x, y: this.player.y, radiusPx: 18 });
  }

  public debugJumpToNextBoss(): void {
    if (!this.isRunningPhase()) return;
    const nextTime = this.currentStage.bossSpawnTimesSec[this.bossesSpawned];
    if (nextTime !== undefined) {
      this.elapsedSec = Math.max(this.elapsedSec, nextTime);
      this.spawnStageBoss();
    }
  }

  public debugJumpToTimeout(): void {
    if (!this.isRunningPhase()) return;
    this.elapsedSec = this.currentStage.durationLimitSec;
    this.resolveEndOfFrameArbitration(false);
  }

  public debugKillAllStageBosses(): void {
    if (!this.isRunningPhase()) return;
    while (this.bossesSpawned < this.currentStage.bossSpawnTimesSec.length) {
      this.spawnStageBoss();
    }
    let allDefeated = false;
    const bosses = this.enemies.filter((e) => e.tier === 'boss');
    for (const boss of bosses) {
      const killed = this.applyDamageToEnemy(
        boss,
        boss.maxHp + 9999,
        this.weapons[0]?.weaponId ?? 'tracking_pulse',
        this.player.x,
        this.player.y,
        0,
        false,
      );
      allDefeated = allDefeated || killed;
    }
    this.resolveEndOfFrameArbitration(allDefeated);
  }

  public debugDamagePlayer(amount: number): void {
    this.player.invulnSec = 0;
    this.player.entityState = 'ALIVE_NORMAL';
    this.damagePlayer(amount);
    this.resolveEndOfFrameArbitration(false);
  }

  public debugTriggerBeaconNukeAtPlayer(): void {
    this.beacons.push({
      id: this.nextEntityId++,
      kind: 'beacon_nuke',
      x: this.player.x,
      y: this.player.y,
      radiusPx: 18,
    });
    this.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
  }

  public debugKillBossViaDelayedCollapse(): void {
    if (this.enemies.every((e) => e.tier !== 'boss')) {
      this.spawnStageBoss();
    }
    const boss = this.enemies.find((e) => e.tier === 'boss');
    if (!boss) return;
    boss.hp = 10;
    this.pendingCollapses.push({
      x: boss.x,
      y: boss.y,
      radiusPx: 220,
      damage: 500,
      weaponId: 'gravity_nova',
      timerSec: FIXED_DT_SEC * 0.5,
    });
    this.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
  }

  public debugTriggerSameFrameMutualKill(): void {
    while (this.bossesSpawned < this.currentStage.bossSpawnTimesSec.length) {
      this.spawnStageBoss();
    }
    const bosses = this.enemies.filter((e) => e.tier === 'boss');
    if (bosses.length === 0) return;
    this.player.invulnSec = 0;
    this.player.entityState = 'ALIVE_NORMAL';
    this.damagePlayer(this.player.maxHp + 999);
    let allDefeated = false;
    for (const boss of bosses) {
      const killed = this.applyDamageToEnemy(
        boss,
        boss.maxHp + 9999,
        this.weapons[0]?.weaponId ?? 'tracking_pulse',
        this.player.x,
        this.player.y,
        0,
        false,
      );
      allDefeated = allDefeated || killed;
    }
    this.resolveEndOfFrameArbitration(allDefeated);
  }

  private swapRemove<T>(arr: T[], idx: number): void {
    const lastIdx = arr.length - 1;
    if (idx < 0 || idx > lastIdx) return;
    if (idx !== lastIdx) {
      arr[idx] = arr[lastIdx]!;
    }
    arr.pop();
  }
}
