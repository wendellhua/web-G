/**
 * V2.0 Five-Stage Progression Data Contract - Core IDs & Shared Value Schemas
 * 纯契约定义（无业务逻辑、零浏览器依赖），供静态配置、核心引擎与本地存档共享。
 */
import { z } from 'zod';

export const STAGE_IDS = ['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5'] as const;
export const StageIdSchema = z.enum(STAGE_IDS);
export type StageId = z.infer<typeof StageIdSchema>;

export const FORM_IDS = [
  'form_1_initiate',
  'form_2_pulse',
  'form_3_phase',
  'form_4_astral',
  'form_5_void_apex',
] as const;
export const FormIdSchema = z.enum(FORM_IDS);
export type FormId = z.infer<typeof FormIdSchema>;

export const WEAPON_IDS = [
  'tracking_pulse',
  'orbital_blade',
  'void_lightning',
  'gravity_nova',
  'rift_beam',
  'boomerang_matrix',
] as const;
export const WeaponIdSchema = z.enum(WEAPON_IDS);
export type WeaponId = z.infer<typeof WeaponIdSchema>;

export const PASSIVE_IDS = [
  'overclock_chip',
  'quantum_accel',
  'wide_amp',
  'shield_gen',
  'precision_scope',
  'warp_thruster',
] as const;
export const PassiveIdSchema = z.enum(PASSIVE_IDS);
export type PassiveId = z.infer<typeof PassiveIdSchema>;

export const EVOLUTION_IDS = [
  'evo_star_cluster',
  'evo_stellar_saw',
  'evo_thunder_storm',
  'evo_singularity_ring',
  'evo_annihilation_ray',
  'evo_spiral_cutter',
] as const;
export const EvolutionIdSchema = z.enum(EVOLUTION_IDS);
export type EvolutionId = z.infer<typeof EvolutionIdSchema>;

export const ENEMY_IDS = [
  'swarm',
  'runner',
  'spitter',
  'tank',
  'bomber',
  'splitter',
  'splitter_mini',
  'elite_vanguard',
  'elite_prism',
  'boss_void_weaver',
] as const;
export const EnemyIdSchema = z.enum(ENEMY_IDS);
export type EnemyId = z.infer<typeof EnemyIdSchema>;

export const BEACON_KINDS = ['beacon_magnet', 'beacon_nuke', 'beacon_heal'] as const;
export const BeaconKindSchema = z.enum(BEACON_KINDS);
export type BeaconKind = z.infer<typeof BeaconKindSchema>;

export const TALENT_IDS = [
  'void_hull',
  'warp_engine',
  'energy_overload',
  'phase_cooldown',
  'gravity_horizon',
  'wisdom_siphon',
  'fate_reroll',
  'crystal_extract',
] as const;
export const TalentIdSchema = z.enum(TALENT_IDS);
export type TalentId = z.infer<typeof TalentIdSchema>;

export const WEAPON_ATTACK_PATTERNS = [
  'nearest_projectile',
  'orbit_blades',
  'random_strike',
  'self_nova',
  'facing_beam',
  'boomerang',
] as const;
export const WeaponAttackPatternSchema = z.enum(WEAPON_ATTACK_PATTERNS);
export type WeaponAttackPattern = z.infer<typeof WeaponAttackPatternSchema>;

export const PositiveFiniteNumber = z.number().finite().positive();
export const NonNegativeFiniteNumber = z.number().finite().nonnegative();
export const Ratio01Schema = z.number().finite().min(0).max(1);
export const NonNegativeIntSchema = z.number().int().nonnegative();

export const DebugTimeScaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type DebugTimeScale = z.infer<typeof DebugTimeScaleSchema>;
