/**
 * V2.0 Five-Stage Progression Data Contract - Runtime State & FSM Types
 * 纯 TypeScript 类型契约，严禁依赖任何浏览器或 DOM 类型。
 */
import type {
  BeaconKind,
  EnemyId,
  EvolutionId,
  FormId,
  PassiveId,
  StageId,
  WeaponId,
} from './ids.schema';

export type AppFsmState =
  | 'BOOT'
  | 'TITLE'
  | 'RUN_NORMAL'
  | 'RUN_BOSS'
  | 'RUN_ENDLESS'
  | 'PAUSED'
  | 'PAUSED_OVER_MODAL'
  | 'CHEST_MODAL'
  | 'ALTAR_MODAL'
  | 'LEVEL_UP_MODAL'
  | 'VICTORY_MODAL'
  | 'GAME_OVER_MODAL'
  | 'RESETTING';

export type ActiveRunPhase = 'RUN_NORMAL' | 'RUN_BOSS' | 'RUN_ENDLESS';

export type TitleSubView =
  | 'MAIN_MENU'
  | 'FORM_CODEX'
  | 'TALENT_TREE'
  | 'RECORDS'
  | 'SETTINGS'
  | 'RESET_CONFIRM';

export type DefeatReason = 'hp_zero' | 'timeout';

export type PlayerEntityState = 'ALIVE_NORMAL' | 'ALIVE_INVULN' | 'DEAD';

export type EnemyEntityState =
  | 'ACTIVE_CHASE'
  | 'HIT_KNOCKBACK'
  | 'FUSE_TELEGRAPH'
  | 'SKILL_TELEGRAPH'
  | 'SKILL_EXECUTE'
  | 'SKILL_RECOVER'
  | 'BOSS_SPAWN_INTRO'
  | 'DEAD';

export type BossPhase = 1 | 2 | 3;

export type AltarEntityState = 'IDLE_WAITING' | 'CHARGING' | 'DECAYING' | 'COMPLETED';

export type ModalQueueKind = 'CHEST_MODAL' | 'ALTAR_MODAL' | 'LEVEL_UP_MODAL';

export interface WeaponSlotState {
  weaponId: WeaponId;
  level: number;
  isEvolved: boolean;
  evolutionId: EvolutionId | null;
  cooldownTimerMs: number;
  orbitAngleRad: number;
}

export interface PassiveSlotState {
  passiveId: PassiveId;
  level: number;
}

export interface ComputedPlayerStats {
  maxHp: number;
  moveSpeedPxPerSec: number;
  pickupRadiusPx: number;
  damageMult: number;
  cooldownReductionRatio: number;
  areaMult: number;
  critChanceRatio: number;
  critDamageMult: number;
  xpGainMult: number;
  hpRegenPerSec: number;
  crystalExtractMult: number;
}

export interface PlayerRuntimeState {
  formId: FormId;
  stageId: StageId;
  currentLevel: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  radiusPx: number;
  hp: number;
  maxHp: number;
  invulnSec: number;
  level: number;
  xp: number;
  xpToNext: number;
  rerollsLeft: number;
  entityState: PlayerEntityState;
  stats: ComputedPlayerStats;
}

export interface EnemyRuntimeEntity {
  id: number;
  enemyId: EnemyId;
  tier: 'normal' | 'elite' | 'boss';
  x: number;
  y: number;
  vx: number;
  vy: number;
  kbVx: number;
  kbVy: number;
  radiusPx: number;
  hp: number;
  maxHp: number;
  hitFlashSec: number;
  entityState: EnemyEntityState;
  stateTimerSec: number;
  skillCooldownSec: number;
  telegraphDirX: number;
  telegraphDirY: number;
  bossPhase: BossPhase | null;
}

export interface ProjectileRuntimeEntity {
  id: number;
  sourceWeaponId: WeaponId;
  isEvolution: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radiusPx: number;
  damage: number;
  pierceLeft: number;
  lifeSec: number;
  maxLifeSec: number;
  knockbackScaleRatio: number;
  returning: boolean;
  hitEnemyIds: number[];
}

export interface EnemyBulletRuntimeEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radiusPx: number;
  damage: number;
  lifeSec: number;
}

export interface XpGemRuntimeEntity {
  id: number;
  x: number;
  y: number;
  xpValue: number;
  tier: 'small' | 'medium' | 'large';
  magnetized: boolean;
}

export interface AltarRuntimeEntity {
  id: number;
  x: number;
  y: number;
  radiusPx: number;
  chargeSec: number;
  requiredSec: number;
  pressureTimerSec: number;
  state: AltarEntityState;
}

export interface BeaconRuntimeEntity {
  id: number;
  kind: BeaconKind;
  x: number;
  y: number;
  radiusPx: number;
}

export interface ChestRuntimeEntity {
  id: number;
  x: number;
  y: number;
  radiusPx: number;
}

export interface TelegraphZoneEntity {
  id: number;
  shape: 'line' | 'circle';
  x: number;
  y: number;
  endX: number;
  endY: number;
  radiusPx: number;
  progressRatio: number;
}

export interface RunEconomyRuntimeState {
  kills: number;
  elitesKilled: number;
  altarsCompleted: number;
  runBonusCrystals: number;
  damageByWeapon: Partial<Record<WeaponId, number>>;
  victoryRewardGranted: boolean;
  endlessRewardSettled: boolean;
  victoryBaselineKills: number;
  victoryBaselineElites: number;
  victoryBaselineAltars: number;
  victoryBaselineBonusCrystals: number;
  lastGrantedCrystals: number;
}
