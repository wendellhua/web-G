/**
 * V2.0 Five-Stage Progression Data Contract - Static Data-Driven Config Schemas
 * 包含字段类型、物理单位护栏、五阶段/五形态严格绑定校验与跨表引用完整性校验（superRefine）。
 */
import { z } from 'zod';
import {
  DebugTimeScaleSchema,
  ENEMY_IDS,
  EnemyIdSchema,
  EvolutionIdSchema,
  FORM_IDS,
  FormIdSchema,
  NonNegativeFiniteNumber,
  NonNegativeIntSchema,
  PassiveIdSchema,
  PositiveFiniteNumber,
  Ratio01Schema,
  STAGE_IDS,
  StageIdSchema,
  TalentIdSchema,
  WeaponAttackPatternSchema,
  WeaponIdSchema,
} from './ids.schema';

export const GlobalBalanceConfigSchema = z.object({
  basePlayerMoveSpeedPxPerSec: PositiveFiniteNumber.min(80).max(420),
  basePlayerPickupRadiusPx: PositiveFiniteNumber.min(40).max(400),
  basePlayerMaxHp: PositiveFiniteNumber,
  basePlayerInvulnDurationSec: PositiveFiniteNumber.max(2),
  baseCritChanceRatio: Ratio01Schema.max(0.85),
  baseCritDamageMult: PositiveFiniteNumber.min(1),
  baseKnockbackPxPerSec: NonNegativeFiniteNumber,
  baseRerollsPerRun: NonNegativeIntSchema,
  maxFallbackHealsPerRun: z.number().int().min(1).max(10),
  maxTotalLevels: z.literal(36),
  crystalOutputMult: PositiveFiniteNumber.min(0.1).max(3).default(0.8),
  maxPossibleActiveSlots: z.literal(4),
  maxPossiblePassiveSlots: z.literal(4),
  normalItemMaxLevel: z.literal(5),
  minWeaponCooldownMs: PositiveFiniteNumber.min(120),
  maxCooldownReductionRatio: Ratio01Schema.max(0.6),
  evoFallbackInLevelUpProbRatio: Ratio01Schema,
  activeEnemySoftCap: z.number().int().min(100).max(320),
  activeEnemyHardCap: z.number().int().min(150).max(400),
  activeXpGemHardCap: z.number().int().min(100).max(500),
  enemyRelocateDistancePx: PositiveFiniteNumber.min(800),
  endlessMaxHpMult: PositiveFiniteNumber.max(1000),
  endlessMaxDmgMult: PositiveFiniteNumber.max(20),
  endlessMaxSpeedMult: PositiveFiniteNumber.max(1.55),
  debugPlayerInvincible: z.boolean().default(false),
  debugTimeScale: DebugTimeScaleSchema.default(1),
});
export type GlobalBalanceConfig = z.infer<typeof GlobalBalanceConfigSchema>;

export const FormConfigSchema = z.object({
  id: FormIdSchema,
  stageId: StageIdSchema,
  tier: z.number().int().min(1).max(5),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  visualAssetSlotId: z.string().min(1),
  primaryColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  requiredTotalClears: NonNegativeIntSchema,
  maxActiveSlots: z.number().int().min(2).max(4),
  maxPassiveSlots: z.number().int().min(1).max(4),
  starterWeaponId: WeaponIdSchema,
  starterWeaponLevel: z.number().int().min(1).max(5),
  baseAttackBonusRatio: NonNegativeFiniteNumber.max(2).default(0),
});
export type FormConfig = z.infer<typeof FormConfigSchema>;

export const EliteMilestoneSchema = z.object({
  triggerSec: PositiveFiniteNumber,
  enemyId: z.enum(['elite_vanguard', 'elite_prism']),
  count: z.number().int().min(1).max(3),
});
export type EliteMilestone = z.infer<typeof EliteMilestoneSchema>;

export const StageConfigSchema = z.object({
  id: StageIdSchema,
  stageNumber: z.number().int().min(1).max(5),
  name: z.string().min(1),
  description: z.string().min(1),
  formId: FormIdSchema,
  minLevelNumber: z.number().int().min(1),
  maxLevelNumber: z.number().int().min(1).nullable(),
  requiredTotalClearsToUnlock: NonNegativeIntSchema,
  maxActiveSlots: z.number().int().min(2).max(4),
  maxPassiveSlots: z.number().int().min(1).max(4),
  starterWeaponLevel: z.number().int().min(1).max(5),
  durationLimitSec: PositiveFiniteNumber,
  bossSpawnTimesSec: z.array(PositiveFiniteNumber).min(1).max(4),
  spawnIntervalSec: PositiveFiniteNumber.min(0.12),
  packSizeMin: z.number().int().min(1),
  packSizeMax: z.number().int().min(1),
  enemyHpScaleMult: PositiveFiniteNumber,
  enemyDamageScaleMult: PositiveFiniteNumber,
  bossHpScaleMult: PositiveFiniteNumber,
  subLevelHpStepMult: NonNegativeFiniteNumber,
  clearCrystalBonus: NonNegativeIntSchema,
  enableAltar: z.boolean(),
  maxAltarsPerRun: z.number().int().min(0).max(5),
  enableEndlessOnVictory: z.boolean(),
  enemyWeights: z
    .array(
      z.object({
        enemyId: EnemyIdSchema,
        weight: PositiveFiniteNumber,
      }),
    )
    .min(1),
  eliteMilestones: z.array(EliteMilestoneSchema),
});
export type StageConfig = z.infer<typeof StageConfigSchema>;

export const WeaponLevelStatsSchema = z.object({
  level: z.number().int().min(1).max(5),
  damage: PositiveFiniteNumber,
  cooldownMs: PositiveFiniteNumber.min(120),
  projectileCount: z.number().int().min(1).max(16),
  areaRadiusPx: PositiveFiniteNumber,
  pierceCount: z.number().int().min(1).max(99),
  projectileSpeedPxPerSec: NonNegativeFiniteNumber,
  durationMs: NonNegativeFiniteNumber,
  knockbackScaleRatio: NonNegativeFiniteNumber,
  upgradeSummary: z.string().min(1),
});
export type WeaponLevelStats = z.infer<typeof WeaponLevelStatsSchema>;

export const WeaponConfigSchema = z.object({
  id: WeaponIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  attackPattern: WeaponAttackPatternSchema,
  accentColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  levels: z.array(WeaponLevelStatsSchema).length(5),
});
export type WeaponConfig = z.infer<typeof WeaponConfigSchema>;

export const PassiveStatKeySchema = z.enum([
  'damageRatio',
  'cooldownReductionRatio',
  'areaRatio',
  'maxHpAndRegen',
  'critChanceAndDamage',
  'moveSpeedRatio',
]);

export const PassiveLevelStatsSchema = z.object({
  level: z.number().int().min(1).max(5),
  primaryValue: PositiveFiniteNumber,
  secondaryValue: NonNegativeFiniteNumber.default(0),
  upgradeSummary: z.string().min(1),
});

export const PassiveConfigSchema = z.object({
  id: PassiveIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  statKey: PassiveStatKeySchema,
  accentColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  levels: z.array(PassiveLevelStatsSchema).length(5),
});
export type PassiveConfig = z.infer<typeof PassiveConfigSchema>;

export const EvolutionRecipeConfigSchema = z.object({
  id: EvolutionIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  requiredWeaponId: WeaponIdSchema,
  requiredPassiveId: PassiveIdSchema,
  requiredWeaponLevel: z.literal(5),
  requiredPassiveMinLevel: z.literal(1),
  accentColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  stats: z.object({
    damage: PositiveFiniteNumber,
    cooldownMs: PositiveFiniteNumber.min(120),
    projectileCount: z.number().int().min(1).max(24),
    areaRadiusPx: PositiveFiniteNumber,
    pierceCount: z.number().int().min(1).max(999),
    projectileSpeedPxPerSec: NonNegativeFiniteNumber,
    durationMs: NonNegativeFiniteNumber,
    knockbackScaleRatio: NonNegativeFiniteNumber,
    specialParamA: NonNegativeFiniteNumber.default(0),
    specialParamB: NonNegativeFiniteNumber.default(0),
  }),
});
export type EvolutionRecipeConfig = z.infer<typeof EvolutionRecipeConfigSchema>;

export const EnemyConfigSchema = z.object({
  id: EnemyIdSchema,
  name: z.string().min(1),
  tier: z.enum(['normal', 'elite', 'boss']),
  radiusPx: PositiveFiniteNumber,
  baseHp: PositiveFiniteNumber,
  baseMoveSpeedPxPerSec: PositiveFiniteNumber,
  contactDamage: PositiveFiniteNumber,
  xpValue: NonNegativeIntSchema,
  knockbackResistanceRatio: Ratio01Schema.max(0.95),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  splitCount: NonNegativeIntSchema.default(0),
  explosionRadiusPx: NonNegativeFiniteNumber.default(0),
  explosionFuseSec: NonNegativeFiniteNumber.default(0),
  preferredRangePx: NonNegativeFiniteNumber.default(0),
  projectileSpeedPxPerSec: NonNegativeFiniteNumber.default(0),
  skillCooldownSec: NonNegativeFiniteNumber.default(0),
});
export type EnemyConfig = z.infer<typeof EnemyConfigSchema>;

export const MapEventConfigSchema = z.object({
  altarFirstSpawnSec: PositiveFiniteNumber,
  altarIntervalSec: PositiveFiniteNumber,
  altarRadiusPx: PositiveFiniteNumber,
  altarRequiredChargeSec: PositiveFiniteNumber,
  altarDecayRatePerSec: PositiveFiniteNumber,
  altarShockwaveRadiusPx: PositiveFiniteNumber,
  altarShockwaveDamage: PositiveFiniteNumber,
  beaconFirstSpawnSec: PositiveFiniteNumber,
  beaconIntervalSec: PositiveFiniteNumber,
  beaconHealRatio: Ratio01Schema,
});
export type MapEventConfig = z.infer<typeof MapEventConfigSchema>;

export const MetaTalentConfigSchema = z.object({
  id: TalentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  maxLevel: z.number().int().min(1).max(10),
  valuePerLevel: PositiveFiniteNumber,
  unitLabel: z.string().min(1),
  costsByLevel: z.array(PositiveFiniteNumber.int()).min(1),
});
export type MetaTalentConfig = z.infer<typeof MetaTalentConfigSchema>;

const EXPECTED_CLEAR_THRESHOLDS = [0, 3, 8, 16, 25] as const;
const EXPECTED_ACTIVE_SLOTS = [2, 2, 3, 3, 4] as const;
const EXPECTED_PASSIVE_SLOTS = [1, 2, 2, 3, 4] as const;
const EXPECTED_STARTER_LEVELS = [1, 2, 3, 4, 5] as const;
const EXPECTED_FORM_BASE_ATK_BONUS = [0, 0.05, 0.1, 0.15, 0.2] as const;
const EXPECTED_STAGE_DURATIONS_SEC = [180, 300, 420, 540, 540] as const;
const EXPECTED_BOSS_COUNTS = [1, 2, 3, 4, 4] as const;

export const GameConfigBundleSchema = z
  .object({
    balance: GlobalBalanceConfigSchema,
    forms: z.array(FormConfigSchema).length(5),
    stages: z.array(StageConfigSchema).length(5),
    weapons: z.array(WeaponConfigSchema).length(6),
    passives: z.array(PassiveConfigSchema).length(6),
    evolutions: z.array(EvolutionRecipeConfigSchema).length(6),
    enemies: z.array(EnemyConfigSchema).length(10),
    mapEvents: MapEventConfigSchema,
    talents: z.array(MetaTalentConfigSchema).length(8),
  })
  .superRefine((bundle, ctx) => {
    const weaponSet = new Set(bundle.weapons.map((w) => w.id));
    const passiveSet = new Set(bundle.passives.map((p) => p.id));
    const enemySet = new Set(bundle.enemies.map((e) => e.id));

    for (const requiredEnemyId of ENEMY_IDS) {
      if (!enemySet.has(requiredEnemyId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required enemy config for ${requiredEnemyId}`,
        });
      }
    }

    // 校验五大阶段与五形态严格一一对应及规格锁定数值
    const expectedMaxAltars = [1, 1, 2, 2, 3] as const;
    for (let i = 0; i < 5; i++) {
      const st = bundle.stages[i]!;
      const fm = bundle.forms[i]!;
      if (st.maxAltarsPerRun !== expectedMaxAltars[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage ${st.id} maxAltarsPerRun must be ${expectedMaxAltars[i]}`,
        });
      }
      if (i === 4 && st.maxLevelNumber !== bundle.balance.maxTotalLevels) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage 5 maxLevelNumber must equal maxTotalLevels (${bundle.balance.maxTotalLevels})`,
        });
      }
      if (st.id !== STAGE_IDS[i] || fm.id !== FORM_IDS[i] || st.formId !== fm.id || fm.stageId !== st.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage/Form strict 1:1 binding mismatch at index ${i}`,
        });
      }
      if (st.requiredTotalClearsToUnlock !== EXPECTED_CLEAR_THRESHOLDS[i] || fm.requiredTotalClears !== EXPECTED_CLEAR_THRESHOLDS[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage ${st.id} unlock threshold must be ${EXPECTED_CLEAR_THRESHOLDS[i]}`,
        });
      }
      if (
        st.maxActiveSlots !== EXPECTED_ACTIVE_SLOTS[i] ||
        st.maxPassiveSlots !== EXPECTED_PASSIVE_SLOTS[i] ||
        fm.maxActiveSlots !== EXPECTED_ACTIVE_SLOTS[i] ||
        fm.maxPassiveSlots !== EXPECTED_PASSIVE_SLOTS[i]
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage/Form slot cap mismatch at index ${i}`,
        });
      }
      if (st.starterWeaponLevel !== EXPECTED_STARTER_LEVELS[i] || fm.starterWeaponLevel !== EXPECTED_STARTER_LEVELS[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Starter weapon level must be ${EXPECTED_STARTER_LEVELS[i]} at index ${i}`,
        });
      }
      if (Math.abs(fm.baseAttackBonusRatio - EXPECTED_FORM_BASE_ATK_BONUS[i]!) > 1e-6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Form ${fm.id} baseAttackBonusRatio must be ${EXPECTED_FORM_BASE_ATK_BONUS[i]}`,
        });
      }
      if (st.durationLimitSec !== EXPECTED_STAGE_DURATIONS_SEC[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage ${st.id} durationLimitSec must be ${EXPECTED_STAGE_DURATIONS_SEC[i]}`,
        });
      }
      if (st.bossSpawnTimesSec.length !== EXPECTED_BOSS_COUNTS[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stage ${st.id} boss count must be ${EXPECTED_BOSS_COUNTS[i]}`,
        });
      }
      for (let b = 0; b < st.bossSpawnTimesSec.length; b++) {
        const t = st.bossSpawnTimesSec[b]!;
        if (b === 0 && t !== 120) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${st.id} first boss must spawn at 120s (2-minute cadence), got ${t}s`,
          });
        }
        if (t >= st.durationLimitSec) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${st.id} boss #${b + 1} spawn time (${t}s) must be strictly less than durationLimitSec (${st.durationLimitSec}s)`,
          });
        }
        if (b > 0 && t - st.bossSpawnTimesSec[b - 1]! !== 120) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${st.id} bosses must spawn at 120s (2-minute) intervals`,
          });
        }
      }
      for (const em of st.eliteMilestones) {
        if (em.triggerSec >= st.durationLimitSec) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${st.id} elite milestone (${em.triggerSec}s) must be strictly less than durationLimitSec (${st.durationLimitSec}s)`,
          });
        }
      }
      if (!weaponSet.has(fm.starterWeaponId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Form ${fm.id} references unknown starterWeaponId ${fm.starterWeaponId}`,
        });
      }
      for (const ew of st.enemyWeights) {
        if (!enemySet.has(ew.enemyId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${st.id} references unknown enemyId ${ew.enemyId}`,
          });
        }
      }
    }

    for (const evo of bundle.evolutions) {
      if (!weaponSet.has(evo.requiredWeaponId) || !passiveSet.has(evo.requiredPassiveId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evolution ${evo.id} has broken weapon/passive pair`,
        });
      }
    }

    for (const t of bundle.talents) {
      if (t.costsByLevel.length !== t.maxLevel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Talent ${t.id} costsByLevel length must match maxLevel`,
        });
      }
    }

    const runner = bundle.enemies.find((e) => e.id === 'runner');
    if (runner && runner.baseMoveSpeedPxPerSec >= bundle.balance.basePlayerMoveSpeedPxPerSec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Stage 2 Balance Rule Violation: runner speed (${runner.baseMoveSpeedPxPerSec}) must stay strictly below base player speed (${bundle.balance.basePlayerMoveSpeedPxPerSec})`,
      });
    }
  });

export type GameConfigBundle = z.infer<typeof GameConfigBundleSchema>;
