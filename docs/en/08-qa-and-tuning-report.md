# 08. Quality Assurance Acceptance & Tuning Report

> 🌐 **Language**: [简体中文](../08.质量验收与调优报告.md) | **English**

> **Verification Status**: **ALL 6 QUALITY GATES PASSING (100% Green)**  
> **Scope**: Automated static verification, deterministic core unit tests, 45,000-frame headless multi-seed soak tests across all 5 stages, Clean Reset leak tests, and Playwright real-browser E2E suites.

> **Live Implementation Note (V2.1 Balance & Visual Polish)**: Following the V2.0 QA baseline below, the project passed an additional full 6-gate regression cycle after implementing: (1) holographic laser warning corridors & Boss VFX upgrades, (2) 2-minute Boss cadence `[1, 2, 3, 4, 4]` with `[3, 5, 7, 9, 9] min` stage durations and immediate victory settlement on clearing all stage Bosses, (3) `-20%` evolution damage tuning & `+20%` late-game/Boss skill damage scaling, and (4) complete painted PNG sprite/icon asset cleanup. All 6 gates (`typecheck`, `lint`, `test:unit` 43/43, `test:sim` 3/3, `test:e2e` 3/3, `build`) remain 100% green.

---

## 1. Six Automated Quality Gates (G1 – G6)

| Gate | Command | Scope & Pass Criteria | Result |
| :---: | :--- | :--- | :---: |
| **G1** | `npm run typecheck` | Strict TypeScript (`tsc --noEmit`), zero errors across `schemas/`, `src/`, `tests/` | **PASS** |
| **G2** | `npm run lint` | ESLint static rules + strict headless isolation (`src/core/**` zero DOM/browser imports) | **PASS** |
| **G3** | `npm run test:unit` | Vitest unit suite (`43/43` tests): Zod `superRefine`, Mulberry32 determinism, FSM arbitration, slot isolation, 6 evolutions, Save V1→V2 migration | **PASS (43/43)** |
| **G4** | `npm run test:sim` | Headless simulation soak (`3/3` suites): 45,000-frame Stage 5 multi-seed stress, 5-stage campaign progression, 20× Clean Reset leak check | **PASS (3/3)** |
| **G5** | `npm run test:e2e` | Playwright real-browser E2E (`3/3` full specs): Title → Deploy → Draft → Pause → Boss Victory / Timeout Defeat → Meta Talent & Persistence | **PASS (3/3)** |
| **G6** | `npm run build` | Production Vite bundle (`dist/`) with relative paths (`base: './'`) and zero bundling warnings | **PASS** |

---

## 2. Headless Stress Soak Metrics

### 2.1 Stage 5 Multi-Seed 45,000-Frame Soak (`750s` Virtual Combat / Seed)

| Seed | Frames Simulated | NaN / Infinity Check | Max Active Enemies (`≤ 240` Cap) | Boss Spawns Verified | Memory / Entity Leak | Result |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `1001` | `45,000` | `0` | Within soft cap | Deterministic exact | None | **PASS** |
| `2002` | `45,000` | `0` | Within soft cap | Deterministic exact | None | **PASS** |
| `3003` | `45,000` | `0` | Within soft cap | Deterministic exact | None | **PASS** |

### 2.2 Five-Stage Campaign Progression (`Seed = 7777`) & Clean Reset Audit
- **All 5 Stages (`stage_1` → `stage_5`)**: Verified stage-gated enemy spawns, exact Boss cadence, slot cap enforcement (`2+1 → 4+4`), fallback draft cards when slots max out, and deterministic `VICTORY` / `TIMEOUT` transitions.
- **20× Consecutive Clean Reset Check**: Confirmed `elapsedSec === 0`, `enemies.length === 0`, `projectiles.length === 0`, `bossesSpawned === 0`, `bossesDefeated === 0`, and zero residual spatial hash buckets or queued modals across 20 rapid restart cycles.

---

## 3. Playwright Real-Browser E2E Regression Coverage

1. **Full Gameplay & Build Draft Flow**: Boots app cleanly with zero uncaught `pageerror` / `console.error`, verifies Canvas rendering, deploys into Stage 1, triggers level-up draft (`1/2/3` & Reroll), verifies Pause (`Esc`) / Resume & `PAUSED_OVER_MODAL` layering.
2. **Boss Victory & Stage Progression Flow**: Verifies Boss spawn, Boss HP HUD bar, Boss defeat triggering immediate `VICTORY_MODAL` settlement, crystal accrual, and level advancement persisted across full page reload.
3. **Timeout Defeat, Talent Upgrade, Refund & Career Reset Flow**: Verifies `TIMEOUT` defeat preserves level & crystals, verifies permanent Talent purchase + free 100% refund, and verifies `resetCareer()` cleanly restores Level 1 / Form I.

---

## 4. Quick Verification Commands

```bash
# Run all headless checks + production build in one command
npm run check

# Run Playwright real-browser E2E suite
npm run test:e2e
```
