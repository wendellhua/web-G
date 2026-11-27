/**
 * V2.0 五大阶段内部通信契约总表（严格对齐 docs/06 V2.0）
 * 纯 TypeScript 只读类型契约，严禁依赖任何浏览器或 DOM 类型。
 */
import type {
  ActiveRunPhase,
  AltarEntityState,
  AppFsmState,
  BeaconKind,
  BossEnemyId,
  BossPhase,
  DefeatReason,
  EnemyEntityState,
  EnemyId,
  EvolutionId,
  FormId,
  GameSettings,
  PassiveId,
  RunRecords,
  StageId,
  StorageHealthStatus,
  TalentId,
  TitleSubView,
  WeaponId,
} from '../../../schemas';

export interface InputCommandFrame {
  readonly moveX: number;
  readonly moveY: number;
}

export type GameEvent =
  | { readonly type: 'WEAPON_FIRED'; readonly weaponId: WeaponId; readonly isEvolution: boolean; readonly x: number; readonly y: number }
  | { readonly type: 'ENEMY_HIT'; readonly enemyId: EnemyId; readonly weaponId: WeaponId; readonly x: number; readonly y: number; readonly damage: number; readonly isCrit: boolean }
  | { readonly type: 'ENEMY_KILLED'; readonly enemyId: EnemyId; readonly tier: 'normal' | 'elite' | 'boss'; readonly x: number; readonly y: number; readonly colorHex: string }
  | { readonly type: 'PLAYER_HIT'; readonly damage: number; readonly hpAfter: number; readonly x: number; readonly y: number }
  | { readonly type: 'PLAYER_HEALED'; readonly amount: number; readonly x: number; readonly y: number }
  | { readonly type: 'XP_PICKED'; readonly xpValue: number; readonly tier: 'small' | 'medium' | 'large' }
  | { readonly type: 'LEVEL_UP'; readonly newLevel: number }
  | { readonly type: 'CHEST_OPENED'; readonly evolvedTo: EvolutionId | null; readonly grantedCrystals: number }
  | { readonly type: 'ALTAR_COMPLETED'; readonly x: number; readonly y: number; readonly shockwaveRadiusPx: number }
  | { readonly type: 'BEACON_TRIGGERED'; readonly kind: BeaconKind; readonly x: number; readonly y: number }
  | { readonly type: 'BOSS_SPAWNED'; readonly enemyId: BossEnemyId; readonly x: number; readonly y: number }
  | { readonly type: 'BOSS_PHASE_CHANGED'; readonly newPhase: 2 | 3; readonly x: number; readonly y: number }
  | { readonly type: 'BOSS_IMMUNE'; readonly x: number; readonly y: number; readonly label: string }
  | { readonly type: 'BOSS_DEATH_OUTRO_STARTED'; readonly x: number; readonly y: number; readonly radiusPx: number; readonly durationSec: number }
  | { readonly type: 'RUN_VICTORY'; readonly grantedCrystals: number; readonly canContinueEndless: boolean }
  | { readonly type: 'RUN_GAME_OVER'; readonly grantedCrystals: number; readonly isEndlessEnd: boolean };

export interface RenderPlayerView {
  readonly formId: FormId;
  readonly formTier: number;
  readonly primaryColorHex: string;
  readonly secondaryColorHex: string;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly radiusPx: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly invulnSec: number;
  readonly pickupRadiusPx: number;
  readonly isAlive: boolean;
}

export interface RenderEnemyView {
  readonly id: number;
  readonly enemyId: EnemyId;
  readonly tier: 'normal' | 'elite' | 'boss';
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hitFlashSec: number;
  readonly entityState: EnemyEntityState;
  readonly bossPhase: BossPhase | null;
  readonly colorHex: string;
}

export interface RenderProjectileView {
  readonly id: number;
  readonly sourceWeaponId: WeaponId;
  readonly isEvolution: boolean;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radiusPx: number;
  readonly returning: boolean;
  readonly colorHex: string;
}

export interface RenderOrbitalBladeView {
  readonly x: number;
  readonly y: number;
  readonly angleRad: number;
  readonly radiusPx: number;
  readonly isEvolution: boolean;
}

export interface RenderBeamRayView {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly lengthPx: number;
  readonly widthPx: number;
  readonly lifeRatio: number;
  readonly isEvolution: boolean;
}

export interface RenderLightningView {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly lifeRatio: number;
  readonly isEvolution: boolean;
}

export interface RenderNovaRingView {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly maxRadiusPx: number;
  readonly lifeRatio: number;
  readonly isEvolution: boolean;
  readonly isCollapse: boolean;
}

export interface RenderEnemyBulletView {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly colorHex?: string;
}

export interface RenderXpGemView {
  readonly x: number;
  readonly y: number;
  readonly tier: 'small' | 'medium' | 'large';
  readonly magnetized: boolean;
}

export interface RenderChestView {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
}

export interface RenderAltarView {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly chargeRatio: number;
  readonly state: AltarEntityState;
}

export interface RenderBeaconView {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly kind: BeaconKind;
}

export interface RenderTelegraphView {
  readonly shape: 'line' | 'circle';
  readonly x: number;
  readonly y: number;
  readonly endX: number;
  readonly endY: number;
  readonly radiusPx: number;
  readonly progressRatio: number;
  readonly colorHex?: string;
}

export interface EdgeIndicatorView {
  readonly kind: 'altar' | 'elite' | 'chest' | 'beacon';
  readonly angleRad: number;
  readonly distancePx: number;
}

export interface RenderVictoryOutroView {
  readonly elapsedSec: number;
  readonly durationSec: number;
  readonly progressRatio: number;
  readonly bossX: number;
  readonly bossY: number;
  readonly bossRadiusPx: number;
  readonly bossEnemyId: BossEnemyId;
}

export interface RenderSnapshot {
  readonly worldTimeSec: number;
  readonly isEndless: boolean;
  readonly isBossActive: boolean;
  readonly bossesActiveCount: number;
  readonly victoryOutro: RenderVictoryOutroView | null;
  readonly cameraTargetX: number;
  readonly cameraTargetY: number;
  readonly player: RenderPlayerView;
  readonly enemies: readonly RenderEnemyView[];
  readonly playerProjectiles: readonly RenderProjectileView[];
  readonly orbitalBlades: readonly RenderOrbitalBladeView[];
  readonly beamRays: readonly RenderBeamRayView[];
  readonly lightningStrikes: readonly RenderLightningView[];
  readonly novaRings: readonly RenderNovaRingView[];
  readonly enemyBullets: readonly RenderEnemyBulletView[];
  readonly xpGems: readonly RenderXpGemView[];
  readonly chests: readonly RenderChestView[];
  readonly altars: readonly RenderAltarView[];
  readonly beacons: readonly RenderBeaconView[];
  readonly telegraphs: readonly RenderTelegraphView[];
  readonly edgeIndicators: readonly EdgeIndicatorView[];
}

export type UpgradeChoiceKind =
  | 'new_weapon'
  | 'upgrade_weapon'
  | 'new_passive'
  | 'upgrade_passive'
  | 'evolution'
  | 'fallback_heal'
  | 'fallback_crystals'
  | 'fallback_damage'
  | 'fallback_speed'
  | 'altar_speed'
  | 'altar_damage'
  | 'altar_heal_crystals';

export interface UpgradeCardChoice {
  readonly key: string;
  readonly kind: UpgradeChoiceKind;
  readonly tag: string;
  readonly title: string;
  readonly description: string;
  readonly accentColorHex: string;
  readonly weaponId?: WeaponId;
  readonly passiveId?: PassiveId;
  readonly evolutionId?: EvolutionId;
  readonly nextLevel?: number;
}

export interface ChestModalPayload {
  readonly title: string;
  readonly isEvolution: boolean;
  readonly evolutionId: EvolutionId | null;
  readonly sourceWeaponName: string | null;
  readonly sourcePassiveName: string | null;
  readonly evolutionName: string | null;
  readonly evolutionDescription: string | null;
  readonly bonusUpgradeSummaries: readonly string[];
  readonly grantedCrystals: number;
}

export interface FormUnlockAnnouncement {
  readonly formId: FormId;
  readonly formName: string;
  readonly formTitle: string;
  readonly stageName: string;
  readonly maxActiveSlots: number;
  readonly maxPassiveSlots: number;
  readonly starterWeaponLevel: number;
  readonly baseAttackBonusRatio: number;
  readonly durationLimitSec: number;
  readonly bossCount: number;
}

export interface SettlementModalPayload {
  readonly isVictory: boolean;
  readonly isEndlessEnd: boolean;
  readonly defeatReason: DefeatReason | null;
  readonly canContinueEndless: boolean;
  readonly playedLevelNumber: number;
  readonly nextLevelNumber: number;
  readonly newlyUnlockedForm: FormUnlockAnnouncement | null;
  readonly survivedSec: number;
  readonly endlessSec: number;
  readonly kills: number;
  readonly elitesKilled: number;
  readonly altarsCompleted: number;
  readonly levelReached: number;
  readonly grantedCrystals: number;
}

export interface HudWeaponSlotView {
  readonly weaponId: WeaponId;
  readonly name: string;
  readonly level: number;
  readonly isEvolved: boolean;
  readonly evolutionId: EvolutionId | null;
  readonly evolutionName: string | null;
  readonly canEvolveNow: boolean;
  readonly accentColorHex: string;
}

export interface HudPassiveSlotView {
  readonly passiveId: PassiveId;
  readonly name: string;
  readonly level: number;
  readonly accentColorHex: string;
}

export interface EvolutionRecipeStatusView {
  readonly evolutionId: EvolutionId;
  readonly evolutionName: string;
  readonly weaponId: WeaponId;
  readonly weaponName: string;
  readonly passiveId: PassiveId;
  readonly passiveName: string;
  readonly status: 'locked' | 'partial' | 'ready' | 'evolved';
}

export interface WeaponDamageStatView {
  readonly weaponId: WeaponId;
  readonly displayName: string;
  readonly isEvolved: boolean;
  readonly totalDamage: number;
  readonly shareRatio: number;
  readonly accentColorHex: string;
}

export interface BossHudView {
  readonly enemyId: BossEnemyId;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly phase: BossPhase;
  readonly activeCount: number;
}

export interface BossProgressView {
  readonly spawned: number;
  readonly killed: number;
  readonly total: number;
  readonly activeCount: number;
}

export interface MetaTalentHudView {
  readonly id: TalentId;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly nextCost: number | null;
  readonly valuePerLevel: number;
  readonly unitLabel: string;
}

export interface MetaFormHudView {
  readonly id: FormId;
  readonly stageId: StageId;
  readonly tier: number;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly primaryColorHex: string;
  readonly requiredTotalClears: number;
  readonly maxActiveSlots: number;
  readonly maxPassiveSlots: number;
  readonly starterWeaponLevel: number;
  readonly baseAttackBonusRatio: number;
  readonly stageDurationSec: number;
  readonly stageBossCount: number;
  readonly unlocked: boolean;
  readonly isCurrent: boolean;
}

export interface MetaCareerHudView {
  readonly currentLevel: number;
  readonly clearedLevelsCount: number;
  readonly currentStageId: StageId;
  readonly currentStageNumber: number;
  readonly currentStageName: string;
  readonly currentFormId: FormId;
  readonly currentFormName: string;
  readonly currentFormTier: number;
  readonly maxActiveSlots: number;
  readonly maxPassiveSlots: number;
  readonly starterWeaponLevel: number;
  readonly baseAttackBonusRatio: number;
  readonly stageDurationLimitSec: number;
  readonly stageBossCount: number;
  readonly nextFormName: string | null;
  readonly nextFormTargetClears: number;
  readonly remainingClearsForNextForm: number;
}

export interface MetaHudSnapshot {
  readonly voidCrystals: number;
  readonly spentCrystals: number;
  readonly career: MetaCareerHudView;
  readonly forms: readonly MetaFormHudView[];
  readonly talents: readonly MetaTalentHudView[];
  readonly runRecords: RunRecords;
  readonly discoveredEvolutions: readonly EvolutionId[];
  readonly settings: GameSettings;
}

export interface HudSnapshot {
  readonly appState: AppFsmState;
  readonly activeRunPhase: ActiveRunPhase;
  readonly titleSubView: TitleSubView;
  readonly pauseReason: string | null;
  readonly storageStatus: StorageHealthStatus;
  readonly storageWarning: string | null;
  readonly currentLevel: number;
  readonly stageId: StageId;
  readonly stageNumber: number;
  readonly stageName: string;
  readonly formId: FormId;
  readonly formName: string;
  readonly formTier: number;
  readonly maxActiveSlots: number;
  readonly maxPassiveSlots: number;
  readonly durationLimitSec: number;
  readonly isNearTimeout: boolean;
  readonly victoryOutroProgressRatio: number | null;
  readonly bossProgress: BossProgressView;
  readonly elapsedSec: number;
  readonly endlessElapsedSec: number;
  readonly level: number;
  readonly xp: number;
  readonly xpToNext: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly kills: number;
  readonly runBonusCrystals: number;
  readonly rerollsLeft: number;
  readonly weaponSlots: readonly HudWeaponSlotView[];
  readonly passiveSlots: readonly HudPassiveSlotView[];
  readonly bossHud: BossHudView | null;
  readonly levelUpChoices: readonly UpgradeCardChoice[];
  readonly altarChoices: readonly UpgradeCardChoice[];
  readonly chestModal: ChestModalPayload | null;
  readonly settlementModal: SettlementModalPayload | null;
  readonly evolutionRecipesStatus: readonly EvolutionRecipeStatusView[];
  readonly weaponDamageStats: readonly WeaponDamageStatView[];
  readonly meta: MetaHudSnapshot;
}

export interface ControllerActionResult {
  readonly ok: boolean;
  readonly reason?: string;
}
