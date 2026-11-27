/**
 * 强类型全量美术资产清单与五阶段深空环境色板（对齐 docs/09 美术风格圣经 V2.0）
 * 纯 TypeScript 数据契约，严禁依赖任何浏览器或 DOM API。
 * 涵盖：2 张 AI 高清插画 + 5 套深空星域背景 + 23 枚全量硬表面厚涂透明 PNG 精灵 + 26 枚 128×128 硬表面精绘 UI 图标 PNG。
 */
import type { EnemyId, EvolutionId, PassiveId, TalentId, WeaponId } from '../../schemas';

export const PROCEDURAL_ASSET_IDS = [
  'form_visual_1',
  'form_visual_2',
  'form_visual_3',
  'form_visual_4',
  'form_visual_5',
  'proc_enemy_swarm',
  'proc_enemy_runner',
  'proc_enemy_spitter',
  'proc_enemy_tank',
  'proc_enemy_bomber',
  'proc_enemy_splitter',
  'proc_elite_vanguard',
  'proc_elite_prism',
  'proc_boss_void_weaver',
  'proc_boss_pulsar_bastion',
  'proc_boss_phase_hydra',
  'proc_boss_solar_leviathan',
  'proc_boss_void_empress',
] as const;

export type ProceduralAssetId = (typeof PROCEDURAL_ASSET_IDS)[number];

export interface AssetRegistryEntry {
  readonly id: ProceduralAssetId;
  readonly kind: 'procedural_vector';
  readonly fallbackColorHex: string;
}

export const ASSET_MANIFEST: Readonly<Record<ProceduralAssetId, AssetRegistryEntry>> = {
  form_visual_1: { id: 'form_visual_1', kind: 'procedural_vector', fallbackColorHex: '#38BDF8' },
  form_visual_2: { id: 'form_visual_2', kind: 'procedural_vector', fallbackColorHex: '#0EA5E9' },
  form_visual_3: { id: 'form_visual_3', kind: 'procedural_vector', fallbackColorHex: '#34D399' },
  form_visual_4: { id: 'form_visual_4', kind: 'procedural_vector', fallbackColorHex: '#C084FC' },
  form_visual_5: { id: 'form_visual_5', kind: 'procedural_vector', fallbackColorHex: '#FACC15' },
  proc_enemy_swarm: { id: 'proc_enemy_swarm', kind: 'procedural_vector', fallbackColorHex: '#F43F5E' },
  proc_enemy_runner: { id: 'proc_enemy_runner', kind: 'procedural_vector', fallbackColorHex: '#E879F9' },
  proc_enemy_spitter: { id: 'proc_enemy_spitter', kind: 'procedural_vector', fallbackColorHex: '#FB923C' },
  proc_enemy_tank: { id: 'proc_enemy_tank', kind: 'procedural_vector', fallbackColorHex: '#BE123C' },
  proc_enemy_bomber: { id: 'proc_enemy_bomber', kind: 'procedural_vector', fallbackColorHex: '#FF4D6D' },
  proc_enemy_splitter: { id: 'proc_enemy_splitter', kind: 'procedural_vector', fallbackColorHex: '#E11D48' },
  proc_elite_vanguard: { id: 'proc_elite_vanguard', kind: 'procedural_vector', fallbackColorHex: '#FF1E56' },
  proc_elite_prism: { id: 'proc_elite_prism', kind: 'procedural_vector', fallbackColorHex: '#F43F5E' },
  proc_boss_void_weaver: { id: 'proc_boss_void_weaver', kind: 'procedural_vector', fallbackColorHex: '#FF1E56' },
  proc_boss_pulsar_bastion: { id: 'proc_boss_pulsar_bastion', kind: 'procedural_vector', fallbackColorHex: '#FB923C' },
  proc_boss_phase_hydra: { id: 'proc_boss_phase_hydra', kind: 'procedural_vector', fallbackColorHex: '#C084FC' },
  proc_boss_solar_leviathan: { id: 'proc_boss_solar_leviathan', kind: 'procedural_vector', fallbackColorHex: '#EF4444' },
  proc_boss_void_empress: { id: 'proc_boss_void_empress', kind: 'procedural_vector', fallbackColorHex: '#FACC15' },
};

export function resolveAssetFallbackColor(id: ProceduralAssetId): string {
  return ASSET_MANIFEST[id].fallbackColorHex;
}

export type SpriteAssetKey =
  | 'form_visual_1'
  | 'form_visual_2'
  | 'form_visual_3'
  | 'form_visual_4'
  | 'form_visual_5'
  | 'enemy_swarm'
  | 'enemy_runner'
  | 'enemy_spitter'
  | 'enemy_tank'
  | 'enemy_bomber'
  | 'enemy_splitter'
  | 'enemy_splitter_mini'
  | 'elite_vanguard'
  | 'elite_prism'
  | 'boss_void_weaver'
  | 'boss_pulsar_bastion'
  | 'boss_phase_hydra'
  | 'boss_solar_leviathan'
  | 'boss_void_empress'
  | 'prop_altar'
  | 'prop_chest'
  | 'prop_beacon_heal'
  | 'prop_beacon_nuke'
  | 'prop_beacon_magnet'
  | 'prop_xp_gem_s'
  | 'prop_xp_gem_m'
  | 'prop_xp_gem_l';

export interface SpriteAssetSpec {
  readonly key: SpriteAssetKey;
  readonly url: string;
  readonly cacheSizePx: number;
  readonly needsWhiteFlash: boolean;
  readonly rimGlowRgba?: string;
}

export const SPRITE_MANIFEST: Readonly<Record<SpriteAssetKey, SpriteAssetSpec>> = {
  form_visual_1: { key: 'form_visual_1', url: './assets/sprites/form_visual_1.png', cacheSizePx: 240, needsWhiteFlash: false, rimGlowRgba: 'rgba(56, 189, 248, 0.78)' },
  form_visual_2: { key: 'form_visual_2', url: './assets/sprites/form_visual_2.png', cacheSizePx: 240, needsWhiteFlash: false, rimGlowRgba: 'rgba(14, 165, 233, 0.82)' },
  form_visual_3: { key: 'form_visual_3', url: './assets/sprites/form_visual_3.png', cacheSizePx: 240, needsWhiteFlash: false, rimGlowRgba: 'rgba(52, 211, 153, 0.84)' },
  form_visual_4: { key: 'form_visual_4', url: './assets/sprites/form_visual_4.png', cacheSizePx: 240, needsWhiteFlash: false, rimGlowRgba: 'rgba(192, 132, 252, 0.86)' },
  form_visual_5: { key: 'form_visual_5', url: './assets/sprites/form_visual_5.png', cacheSizePx: 256, needsWhiteFlash: false, rimGlowRgba: 'rgba(250, 204, 21, 0.90)' },
  enemy_swarm: { key: 'enemy_swarm', url: './assets/sprites/enemy_swarm.png', cacheSizePx: 192, needsWhiteFlash: true, rimGlowRgba: 'rgba(255, 30, 86, 0.72)' },
  enemy_runner: { key: 'enemy_runner', url: './assets/sprites/enemy_runner.png', cacheSizePx: 192, needsWhiteFlash: true, rimGlowRgba: 'rgba(217, 70, 239, 0.78)' },
  enemy_spitter: { key: 'enemy_spitter', url: './assets/sprites/enemy_spitter.png', cacheSizePx: 208, needsWhiteFlash: true, rimGlowRgba: 'rgba(251, 146, 60, 0.76)' },
  enemy_tank: { key: 'enemy_tank', url: './assets/sprites/enemy_tank.png', cacheSizePx: 240, needsWhiteFlash: true, rimGlowRgba: 'rgba(244, 63, 94, 0.72)' },
  enemy_bomber: { key: 'enemy_bomber', url: './assets/sprites/enemy_bomber.png', cacheSizePx: 192, needsWhiteFlash: true, rimGlowRgba: 'rgba(250, 204, 21, 0.8)' },
  enemy_splitter: { key: 'enemy_splitter', url: './assets/sprites/enemy_splitter.png', cacheSizePx: 224, needsWhiteFlash: true, rimGlowRgba: 'rgba(192, 132, 252, 0.76)' },
  enemy_splitter_mini: { key: 'enemy_splitter_mini', url: './assets/sprites/enemy_splitter_mini.png', cacheSizePx: 144, needsWhiteFlash: true, rimGlowRgba: 'rgba(232, 121, 249, 0.78)' },
  elite_vanguard: { key: 'elite_vanguard', url: './assets/sprites/elite_vanguard.png', cacheSizePx: 288, needsWhiteFlash: true, rimGlowRgba: 'rgba(250, 204, 21, 0.85)' },
  elite_prism: { key: 'elite_prism', url: './assets/sprites/elite_prism.png', cacheSizePx: 288, needsWhiteFlash: true, rimGlowRgba: 'rgba(217, 70, 239, 0.85)' },
  boss_void_weaver: { key: 'boss_void_weaver', url: './assets/sprites/boss_void_weaver.png', cacheSizePx: 360, needsWhiteFlash: true, rimGlowRgba: 'rgba(255, 30, 86, 0.88)' },
  boss_pulsar_bastion: { key: 'boss_pulsar_bastion', url: './assets/sprites/boss_pulsar_bastion.png', cacheSizePx: 360, needsWhiteFlash: true, rimGlowRgba: 'rgba(251, 146, 60, 0.90)' },
  boss_phase_hydra: { key: 'boss_phase_hydra', url: './assets/sprites/boss_phase_hydra.png', cacheSizePx: 360, needsWhiteFlash: true, rimGlowRgba: 'rgba(192, 132, 252, 0.90)' },
  boss_solar_leviathan: { key: 'boss_solar_leviathan', url: './assets/sprites/boss_solar_leviathan.png', cacheSizePx: 360, needsWhiteFlash: true, rimGlowRgba: 'rgba(239, 68, 68, 0.90)' },
  boss_void_empress: { key: 'boss_void_empress', url: './assets/sprites/boss_void_empress.png', cacheSizePx: 384, needsWhiteFlash: true, rimGlowRgba: 'rgba(250, 204, 21, 0.92)' },
  prop_altar: { key: 'prop_altar', url: './assets/sprites/prop_altar.png', cacheSizePx: 192, needsWhiteFlash: false, rimGlowRgba: 'rgba(56, 189, 248, 0.82)' },
  prop_chest: { key: 'prop_chest', url: './assets/sprites/prop_chest.png', cacheSizePx: 144, needsWhiteFlash: false, rimGlowRgba: 'rgba(250, 204, 21, 0.88)' },
  prop_beacon_heal: { key: 'prop_beacon_heal', url: './assets/sprites/prop_beacon_heal.png', cacheSizePx: 128, needsWhiteFlash: false, rimGlowRgba: 'rgba(52, 211, 153, 0.85)' },
  prop_beacon_nuke: { key: 'prop_beacon_nuke', url: './assets/sprites/prop_beacon_nuke.png', cacheSizePx: 128, needsWhiteFlash: false, rimGlowRgba: 'rgba(250, 204, 21, 0.88)' },
  prop_beacon_magnet: { key: 'prop_beacon_magnet', url: './assets/sprites/prop_beacon_magnet.png', cacheSizePx: 128, needsWhiteFlash: false, rimGlowRgba: 'rgba(34, 211, 238, 0.85)' },
  prop_xp_gem_s: { key: 'prop_xp_gem_s', url: './assets/sprites/prop_xp_gem_s.png', cacheSizePx: 64, needsWhiteFlash: false, rimGlowRgba: 'rgba(56, 189, 248, 0.72)' },
  prop_xp_gem_m: { key: 'prop_xp_gem_m', url: './assets/sprites/prop_xp_gem_m.png', cacheSizePx: 72, needsWhiteFlash: false, rimGlowRgba: 'rgba(52, 211, 153, 0.78)' },
  prop_xp_gem_l: { key: 'prop_xp_gem_l', url: './assets/sprites/prop_xp_gem_l.png', cacheSizePx: 96, needsWhiteFlash: false, rimGlowRgba: 'rgba(250, 204, 21, 0.88)' },
};

export const ENEMY_SPRITE_KEY_BY_ID: Readonly<Record<EnemyId, SpriteAssetKey>> = {
  swarm: 'enemy_swarm',
  runner: 'enemy_runner',
  spitter: 'enemy_spitter',
  tank: 'enemy_tank',
  bomber: 'enemy_bomber',
  splitter: 'enemy_splitter',
  splitter_mini: 'enemy_splitter_mini',
  elite_vanguard: 'elite_vanguard',
  elite_prism: 'elite_prism',
  boss_void_weaver: 'boss_void_weaver',
  boss_pulsar_bastion: 'boss_pulsar_bastion',
  boss_phase_hydra: 'boss_phase_hydra',
  boss_solar_leviathan: 'boss_solar_leviathan',
  boss_void_empress: 'boss_void_empress',
};

export const FORM_SPRITE_URL_BY_TIER: Readonly<Record<number, string>> = {
  1: './assets/sprites/form_visual_1.png',
  2: './assets/sprites/form_visual_2.png',
  3: './assets/sprites/form_visual_3.png',
  4: './assets/sprites/form_visual_4.png',
  5: './assets/sprites/form_visual_5.png',
};

export const ILLUSTRATION_URLS = {
  titleKeyArt: './assets/illustrations/key_art_title.jpg',
  bossConcept: './assets/illustrations/concept_boss_void_weaver.jpg',
} as const;

export const STAGE_BACKGROUND_URL_BY_TIER: Readonly<Record<number, string>> = {
  1: './assets/backgrounds/bg_stage_1.jpg',
  2: './assets/backgrounds/bg_stage_2.jpg',
  3: './assets/backgrounds/bg_stage_3.jpg',
  4: './assets/backgrounds/bg_stage_4.jpg',
  5: './assets/backgrounds/bg_stage_5.jpg',
};

export const WEAPON_ICON_URL_BY_ID: Readonly<Record<WeaponId, string>> = {
  tracking_pulse: './assets/icons/icon_wpn_tracking_pulse.png',
  orbital_blade: './assets/icons/icon_wpn_orbital_blade.png',
  void_lightning: './assets/icons/icon_wpn_void_lightning.png',
  gravity_nova: './assets/icons/icon_wpn_gravity_nova.png',
  rift_beam: './assets/icons/icon_wpn_rift_beam.png',
  boomerang_matrix: './assets/icons/icon_wpn_boomerang_matrix.png',
};

export const EVOLUTION_ICON_URL_BY_ID: Readonly<Record<EvolutionId, string>> = {
  evo_star_cluster: './assets/icons/icon_evo_star_cluster.png',
  evo_stellar_saw: './assets/icons/icon_evo_stellar_saw.png',
  evo_thunder_storm: './assets/icons/icon_evo_thunder_storm.png',
  evo_singularity_ring: './assets/icons/icon_evo_singularity_ring.png',
  evo_annihilation_ray: './assets/icons/icon_evo_annihilation_ray.png',
  evo_spiral_cutter: './assets/icons/icon_evo_spiral_cutter.png',
};

export const PASSIVE_ICON_URL_BY_ID: Readonly<Record<PassiveId, string>> = {
  overclock_chip: './assets/icons/icon_pas_overclock_chip.png',
  quantum_accel: './assets/icons/icon_pas_quantum_accel.png',
  wide_amp: './assets/icons/icon_pas_wide_amp.png',
  shield_gen: './assets/icons/icon_pas_shield_gen.png',
  precision_scope: './assets/icons/icon_pas_precision_scope.png',
  warp_thruster: './assets/icons/icon_pas_warp_thruster.png',
};

export const TALENT_ICON_URL_BY_ID: Readonly<Record<TalentId, string>> = {
  void_hull: './assets/icons/icon_tal_void_hull.png',
  warp_engine: './assets/icons/icon_tal_warp_engine.png',
  energy_overload: './assets/icons/icon_tal_energy_overload.png',
  phase_cooldown: './assets/icons/icon_tal_phase_cooldown.png',
  gravity_horizon: './assets/icons/icon_tal_gravity_horizon.png',
  wisdom_siphon: './assets/icons/icon_tal_wisdom_siphon.png',
  fate_reroll: './assets/icons/icon_tal_fate_reroll.png',
  crystal_extract: './assets/icons/icon_tal_crystal_extract.png',
};

export interface StageEnvironmentTheme {
  readonly baseBgHex: string;
  readonly nebulaPrimaryRgba: string;
  readonly nebulaSecondaryRgba: string;
  readonly fineGridRgba: string;
  readonly majorGridRgba: string;
  readonly starTintHex: string;
}

export const STAGE_ENVIRONMENT_THEMES: Readonly<Record<number, StageEnvironmentTheme>> = {
  1: {
    baseBgHex: '#050914',
    nebulaPrimaryRgba: 'rgba(14, 165, 233, 0.14)',
    nebulaSecondaryRgba: 'rgba(30, 58, 138, 0.16)',
    fineGridRgba: 'rgba(30, 58, 95, 0.24)',
    majorGridRgba: 'rgba(56, 189, 248, 0.11)',
    starTintHex: '#BAE6FD',
  },
  2: {
    baseBgHex: '#060B1A',
    nebulaPrimaryRgba: 'rgba(37, 99, 235, 0.16)',
    nebulaSecondaryRgba: 'rgba(14, 165, 233, 0.14)',
    fineGridRgba: 'rgba(30, 64, 125, 0.24)',
    majorGridRgba: 'rgba(59, 130, 246, 0.13)',
    starTintHex: '#93C5FD',
  },
  3: {
    baseBgHex: '#041014',
    nebulaPrimaryRgba: 'rgba(16, 185, 129, 0.14)',
    nebulaSecondaryRgba: 'rgba(6, 182, 212, 0.13)',
    fineGridRgba: 'rgba(15, 76, 76, 0.24)',
    majorGridRgba: 'rgba(52, 211, 153, 0.12)',
    starTintHex: '#A7F3D0',
  },
  4: {
    baseBgHex: '#0B0617',
    nebulaPrimaryRgba: 'rgba(147, 51, 234, 0.18)',
    nebulaSecondaryRgba: 'rgba(217, 70, 239, 0.12)',
    fineGridRgba: 'rgba(76, 29, 149, 0.24)',
    majorGridRgba: 'rgba(192, 132, 252, 0.14)',
    starTintHex: '#E9D5FF',
  },
  5: {
    baseBgHex: '#12040A',
    nebulaPrimaryRgba: 'rgba(225, 29, 72, 0.20)',
    nebulaSecondaryRgba: 'rgba(147, 51, 234, 0.16)',
    fineGridRgba: 'rgba(127, 29, 29, 0.24)',
    majorGridRgba: 'rgba(244, 63, 94, 0.15)',
    starTintHex: '#FECDD3',
  },
};
