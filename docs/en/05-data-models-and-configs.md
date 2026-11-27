# 05. Data Models, Static Configs & Persistence Schema (V2.0)

> 🌐 **Language**: [简体中文](../05.数据模型与配置表设计.md) | **English**

> **Document Version**: V2.0 (Campaign Stages, 5 Forms, Slot Caps & SaveDataV2 Auto-Migration)  
> **Single Source of Truth**: `schemas/config.schema.ts`, `schemas/save.schema.ts`, `src/config/gameConfig.ts`

> **Live Implementation Note (V2.1 Balance Patch)**: In live `schemas/config.schema.ts` and `src/config/gameConfig.ts`, Boss counts across `stage_1`–`stage_5` are **`[1, 2, 3, 4, 4]`** spawning every `120s` (`[120]`, `[120,240]`, `[120,240,360]`, `[120,240,360,480]`, `[120,240,360,480]`), and stage time limits are **`[180, 300, 420, 540, 540] s`** (`3 / 5 / 7 / 9 / 9 min`).

---

## 1. Global Canonical ID Enums

All IDs are strictly validated as Zod literal unions so typos fail both TypeScript compilation and runtime boot validation:

- **`StageId`**: `stage_1 | stage_2 | stage_3 | stage_4 | stage_5`
- **`FormId`**: `form_1 | form_2 | form_3 | form_4 | form_5`
- **`WeaponId` (6)**: `tracking_pulse | orbital_blade | void_lightning | gravity_nova | rift_beam | boomerang_matrix`
- **`PassiveId` (6)**: `overclock_chip | quantum_accel | wide_amp | shield_gen | precision_scope | warp_thruster`
- **`EvolutionId` (6)**: `evo_star_cluster | evo_stellar_saw | evo_thunder_storm | evo_singularity_ring | evo_annihilation_ray | evo_spiral_cutter`
- **`EnemyId` (10)**: `drifter | runner | charger | spitter | heavy_tank | bomber | splitter | elite_charger | elite_striker | elite_prism | boss_void_weaver`
- **`BeaconId` (3)**: `beacon_magnet | beacon_overload | beacon_altar`
- **`TalentId` (8)**: `talent_atk | talent_hp | talent_regen | talent_speed | talent_pickup | talent_xp | talent_crystal | talent_reroll`

---

## 2. Shared Restrained Baseline & Stage/Form Binding Table

### 2.1 Shared Level-0 Base Player Stats (`playerBase`)
```ts
{
  maxHp: 100,
  moveSpeed: 150,     // px/s (locked from Stage 2 greybox)
  pickupRadius: 100,  // px
  attackMultiplier: 1.0,
  hpRegenPerSec: 0,
  baseRerolls: 1,
  invulnDurationSec: 0.45
}
```

### 2.2 Five-Stage & Five-Form Strict Binding Matrix

| `stageId` | Levels | Bound `formId` | Clear Unlock Threshold | Starter Weapon Lv | `maxActiveSlots` + `maxPassiveSlots` | Boss Count (V2.0 / *Live V2.1*) | `durationSec` (V2.0 / *Live V2.1*) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `stage_1` | `1–3` | `form_1` | `0` | `1` | `2 + 1` | `1` / *`1`* | `180` / *`180`* |
| `stage_2` | `4–8` | `form_2` | `3` | `2` | `2 + 2` | `2` / *`2`* | `360` / *`300`* |
| `stage_3` | `9–16` | `form_3` | `8` | `3` | `3 + 2` | `3` / *`3`* | `540` / *`420`* |
| `stage_4` | `17–25` | `form_4` | `16` | `4` | `3 + 3` | `4` / *`4`* | `720` / *`540`* |
| `stage_5` | `26–36` | `form_5` | `25` | `5` | `4 + 4` | `5` / *`4`* | `900` / *`540`* |

---

## 3. Zod `superRefine` Cross-Table Invariants

`GameConfigSchema.superRefine(...)` executes on boot and in `tests/unit/configValidation.test.ts` to guarantee zero silent data drift:

1. **1-to-1 Evolution Mapping**: Every `EvolutionConfig` must reference a valid `weaponId` and valid `passiveId`, with no duplicate pairs across all 6 evolutions.
2. **Stage Continuity & Monotonicity**: `stages` must cover `stage_1` through `stage_5` sequentially with strictly contiguous `minLevel..maxLevel` ranges and non-decreasing slot caps (`maxActiveSlots`, `maxPassiveSlots`).
3. **Boss Schedule Validity**: For every stage, `bossSpawnTimesSec.length === requiredBossCount`, timestamps are strictly increasing, and every spawn timestamp is strictly less than `durationSec` (leaving at least `60s` combat buffer before timeout).
4. **Enemy Reference Integrity**: Every enemy ID listed in a stage's unlock pool must exist in `enemies` table.
5. **Talent Curve Validity**: Every talent's `costs.length === maxLevel` and all costs/bonuses are positive finite numbers.

---

## 4. Runtime State Extensions (`RunState`)

Key fields maintained inside `SimulationWorld`:
- `level: number`, `stageId: StageId`, `formId: FormId`
- `elapsedSec: number`, `stageDurationSec: number`
- `bossesSpawned: number`, `bossesDefeated: number`, `requiredBossCount: number`
- `maxActiveSlots: number`, `maxPassiveSlots: number`
- `weapons: ActiveWeaponState[]`, `passives: PassiveState[]`, `evolutions: EvolutionId[]`
- `draftQueue: DraftRequest[]`, `activeDraft: DraftPresentation | null`
- `defeatReason: 'HP_DEPLETED' | 'TIMEOUT' | null`

---

## 5. Persistence Schema (`SaveDataV2`) & Auto-Migration

- **Storage Key**: `void_runner_save_v1` (key retained for seamless backward compatibility; payload upgraded to `schemaVersion: 2`).
- **Core Fields**:
  - `schemaVersion: 2`
  - `crystals: number` (current unspent Void Crystals)
  - `totalCrystalsEarned: number`
  - `unlockedLevel: number` (starts at `1`)
  - `currentLevel: number` (active sortie level)
  - `clearedLevels: number[]` (unique list of cleared level numbers; `clearedLevels.length` determines auto-unlocked Form!)
  - `endlessUnlocked: boolean`
  - `talents: Record<TalentId, number>` (level `0..maxLevel` per talent)
  - `settings: { muted: boolean; sfxVolume: number; bgmVolume: number; lowParticles: boolean; disableShake: boolean; hideDamageText: boolean; speedMultiplier: 1 | 2 | 3 }`
  - `stats: { totalRuns: number; totalKills: number; totalBossKills: number; bestSurvivalSec: number }`
- **V1 → V2 Auto-Migration**: When loading a legacy `schemaVersion: 1` save, `SaveManager` preserves all earned crystals, talent levels, audio/accessibility settings, and lifetime stats, maps legacy progress into `unlockedLevel / clearedLevels`, and atomically writes back `schemaVersion: 2`.
- **Corruption & Reset Safety**: Any invalid JSON or schema-failing payload safely falls back to `createDefaultSaveV2()`. Calling `resetCareer()` wipes progression back to Level 1 / Form I / 0 crystals while preserving user audio/accessibility settings.
