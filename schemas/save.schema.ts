/**
 * V2.0 Five-Stage Progression Data Contract - Local Persistence & Migration Schema
 * schemaVersion 升级至 2，新增不可逆生涯进度 domain（career），支持 V1→V2 无损迁移与无痕降级。
 */
import { z } from 'zod';
import {
  DebugTimeScaleSchema,
  EvolutionIdSchema,
  FormIdSchema,
  NonNegativeFiniteNumber,
  NonNegativeIntSchema,
  Ratio01Schema,
  StageIdSchema,
  TALENT_IDS,
} from './ids.schema';

export const SAVE_STORAGE_KEY = 'void_runner_save_v1' as const;
export const CURRENT_SAVE_SCHEMA_VERSION = 2 as const;

export const TalentLevelsSchema = z.object({
  void_hull: NonNegativeIntSchema.default(0),
  warp_engine: NonNegativeIntSchema.default(0),
  energy_overload: NonNegativeIntSchema.default(0),
  phase_cooldown: NonNegativeIntSchema.default(0),
  gravity_horizon: NonNegativeIntSchema.default(0),
  wisdom_siphon: NonNegativeIntSchema.default(0),
  fate_reroll: NonNegativeIntSchema.default(0),
  crystal_extract: NonNegativeIntSchema.default(0),
});

export const GameSettingsSchema = z.object({
  masterVolumeRatio: Ratio01Schema.default(0.8),
  bgmVolumeRatio: Ratio01Schema.default(0.45),
  sfxVolumeRatio: Ratio01Schema.default(0.85),
  isMuted: z.boolean().default(false),
  disableScreenShake: z.boolean().default(false),
  disableDamageText: z.boolean().default(false),
  lowParticleMode: z.boolean().default(false),
  debugPlayerInvincible: z.boolean().default(false),
  debugTimeScale: DebugTimeScaleSchema.default(1),
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const RunRecordsSchema = z.object({
  totalRuns: NonNegativeIntSchema.default(0),
  totalVictories: NonNegativeIntSchema.default(0),
  totalKills: NonNegativeIntSchema.default(0),
  bestSurvivalSec: NonNegativeFiniteNumber.default(0),
  bestEndlessSec: NonNegativeFiniteNumber.default(0),
  bestSingleRunKills: NonNegativeIntSchema.default(0),
});
export type RunRecords = z.infer<typeof RunRecordsSchema>;

export const CareerProgressSchema = z.object({
  currentLevel: z.number().int().min(1).default(1),
  clearedLevelsCount: NonNegativeIntSchema.default(0),
  currentStageId: StageIdSchema.default('stage_1'),
  unlockedFormId: FormIdSchema.default('form_1_initiate'),
});
export type CareerProgress = z.infer<typeof CareerProgressSchema>;

export const SaveDataV2Schema = z.object({
  schemaVersion: z.literal(CURRENT_SAVE_SCHEMA_VERSION),
  updatedAtMs: NonNegativeIntSchema,
  career: CareerProgressSchema,
  metaProgress: z.object({
    voidCrystals: NonNegativeIntSchema,
    spentCrystals: NonNegativeIntSchema,
    talents: TalentLevelsSchema,
  }),
  unlocks: z.object({
    discoveredEvolutions: z.array(EvolutionIdSchema),
  }),
  runRecords: RunRecordsSchema,
  settings: GameSettingsSchema,
});
export type SaveDataV2 = z.infer<typeof SaveDataV2Schema>;

export type StorageHealthStatus = 'ok' | 'memory_fallback' | 'corrupted_reset';

export interface SaveLoadResult {
  data: SaveDataV2;
  status: StorageHealthStatus;
  warningMessage: string | null;
}

export function createEmptyTalentRecord(): Record<(typeof TALENT_IDS)[number], number> {
  return {
    void_hull: 0,
    warp_engine: 0,
    energy_overload: 0,
    phase_cooldown: 0,
    gravity_horizon: 0,
    wisdom_siphon: 0,
    fate_reroll: 0,
    crystal_extract: 0,
  };
}
