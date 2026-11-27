# 06. Module Interfaces & Audio-Visual Specification (V2.0)

> 🌐 **Language**: [简体中文](../06.模块接口与资源视听规范.md) | **English**

> **Document Version**: V2.0 (Interface Contracts, Read-Only Snapshots & 5-Form Visual Progression)

---

## 1. Input Contract (`NormalizedInput`)

`InputNormalizer` consolidates keyboard (`WASD` / Arrows), pointer drag, and touch input into a pure, stateless frame command:
```ts
export interface NormalizedInput {
  moveX: number; // Clamped unit vector component [-1, 1]
  moveY: number; // Clamped unit vector component [-1, 1]
}
```
Diagonal movement is normalized to unit length (`Math.hypot(dx, dy) <= 1`) before entering `SimulationWorld.step()`, guaranteeing identical top speed across keyboard and touch/mouse steering.

---

## 2. Core → Presentation Read-Only Snapshots

Presentation layers (`CanvasRenderer`, `UiOverlayManager`, `SynthAudioEngine`) **never mutate Core state**; they consume immutable snapshots produced once per animation frame:

### 2.1 `RenderSnapshot` (Consumed by `CanvasRenderer`)
- `elapsedSec`, `stageId`, `formId`, `visualTier` (`1..5`)
- `player`: `{ x, y, vx, vy, angle, hp, maxHp, invulnTimer, hitFlashTimer, pickupRadius, overloadTimer }`
- `enemies[]`: `{ id, enemyId, x, y, vx, vy, radius, hp, maxHp, isElite, isBoss, bossPhase, hitFlashTimer, state, facingAngle }`
- `projectiles[]`, `beams[]`, `lightningArcs[]`, `orbitalBlades[]`, `telegraphs[]`
- `pickups[]` (XP gems, Void Crystals, Supply Crates, Medkits), `beacons[]` (with `chargeProgress` & edge indicator coords)
- `camera`: `{ x, y, shakeX, shakeY }`

### 2.2 `HudSnapshot` (Consumed by `UiOverlayManager`)
- `appState`: `BOOT | TITLE | IN_RUN | PAUSED | MODAL_ACTIVE | PAUSED_OVER_MODAL | VICTORY_MODAL | GAME_OVER_MODAL | RESETTING`
- `level`, `stageId`, `formId`, `formName`
- `elapsedSec`, `remainingSec`, `stageDurationSec`
- `bossesDefeated`, `requiredBossCount`, `activeBoss`: `{ name, hp, maxHp, phase } | null`
- `hp`, `maxHp`, `xp`, `xpToNext`, `playerLevel`
- `weapons[]` & `passives[]` alongside `maxActiveSlots` & `maxPassiveSlots`
- `kills`, `crystalsInRun`, `speedMultiplier` (`1 | 2 | 3`)
- `activeDraft`: `{ source, rerollsLeft, cards: DraftCardView[] } | null`

### 2.3 `SettlementModalPayload` & `MetaHudSnapshot`
- **Settlement Payload**: `outcome` (`VICTORY | DEFEAT`), `defeatReason` (`HP_DEPLETED | TIMEOUT | null`), `level`, `stageId`, `survivedSec`, `kills`, `bossesDefeated`, `requiredBossCount`, `crystalsBreakdown` (`inRun + survival + firstClear`), `newlyUnlockedFormId | null`, `weaponDpsBreakdown[]`.
- **Meta Snapshot**: `crystals`, `unlockedLevel`, `currentLevel`, `totalClears`, `unlockedFormId`, `nextFormClearsNeeded`, `endlessUnlocked`, `talents[]`, `settings`.

---

## 3. UI ↔ `GameController` Action Contract & Test Bridge

### 3.1 Title Subviews & Controller Actions
- `TitleSubView`: `'HOME' | 'TALENTS' | 'FORMS' | 'EVOLUTIONS'`
- `controller.startRun(level?)` / `controller.retryRun()` / `controller.nextLevel()`
- `controller.selectDraftCard(index: 0 | 1 | 2)` / `controller.rerollDraft()`
- `controller.upgradeTalent(talentId)` / `controller.refundAllTalents()` / `controller.resetCareer()`
- `controller.setSpeedMultiplier(1 | 2 | 3)` / `controller.updateSettings(partial)`

### 3.2 Controlled Debug / E2E Bridge (`window.__VOID_RUNNER_DEBUG__`)
Exposed **only** when running in dev/test mode (`?debug=1` or Vite dev server) so Playwright E2E tests can deterministically inspect state and trigger edge-case flows (e.g., instant Boss spawn, level-up, timeout check) without polluting production gameplay:
- `getState()` — read-only FSM, stage, Boss, and save snapshot
- `forceLevelUp()` / `spawnNextBoss()` / `killActiveBoss()` / `setElapsedSec(sec)` / `grantCrystals(amount)`

---

## 4. Five-Form Visual Progression & Audio Rules

### 4.1 Starfighter Visual Progression (`form_visual_1` → `form_visual_5`)
| Form Tier | Visual Identity | Thruster & Aura Accent |
| :---: | :--- | :--- |
| `form_visual_1` | Compact single-wing Initiate interceptor | Single cyan ion plume |
| `form_visual_2` | Twin-wing Pulse Striker with forward cannons | Dual cyan-blue plasma plumes |
| `form_visual_3` | Swept delta Phase Raider with energy core vents | Triple cyan-violet plumes + phase shimmer |
| `form_visual_4` | Armored quad-wing Astral Sovereign | Quad gold-cyan plumes + faint command halo |
| `form_visual_5` | Apex Void Sovereign with articulated energy wings | Multi-tier radiant gold-cyan afterburners + pulsing energy ring |

### 4.2 Procedural Web Audio Specification
- **Zero External Files**: All SFX and Synthwave BGM are generated live via `AudioContext` (`OscillatorNode`, `GainNode`, `BiquadFilterNode`, pre-baked noise `AudioBuffer`).
- **Autoplay Compliance**: `AudioContext` initializes lazily and calls `resume()` strictly inside the user's first pointer/key gesture.
- **Channel Budgeting**: Concurrent hit SFX throttled (`minInterval >= 45ms`) to avoid clipping during 200-enemy swarm explosions.
