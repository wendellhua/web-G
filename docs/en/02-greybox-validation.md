# 02. Greybox Prototype Validation Conclusions

> 🌐 **Language**: [简体中文](../02.灰盒原型验证结论.md) | **English**

> **Artifact Status**: Stage 2 Complete (`prototype/index.html` archived as a standalone zero-dependency playable reference)  
> **Scope**: Validate the core 30–60s combat loop, movement feel, enemy pursuit ratio, knockback readability, and 3-choice upgrade cadence before committing to full production architecture.

---

## 1. Validation Objective & Method

Before writing a single line of production TypeScript (`src/`), a **single-file, zero-dependency HTML5 Canvas greybox prototype** (`prototype/index.html`) was built and playtested across repeated 60–180s runs. All entities were intentionally rendered as crisp geometric primitives (circles, triangles, rings) so gameplay feel could be judged strictly on **speed, spacing, hit feedback, and decision pressure** without visual distraction.

---

## 2. Core Findings — The "Restrained Baseline Principle"

Playtesting revealed that an overly fast Level-0 player (`>= 200 px/s`) trivializes early swarm waves and eliminates the incentive to invest in movement/pickup talents or defensive weapons (`Gravity Nova`). Conversely, overly fast baseline mobs cause unavoidable chip damage before the first upgrade.

Therefore, the following **Restrained Baseline Parameters** were validated and locked as the single foundation for Doc 01 & Doc 05:

| Parameter | Validated Value | Playtest Rationale |
| :--- | :---: | :--- |
| **Player Base Move Speed** | **`150 px/s`** | Deliberate, readable steering; creates genuine encirclement tension in Wave 1 and makes Warp Thruster & Move Speed Talent immediately gratifying. |
| **Baseline Drifter Speed** | **`92 px/s`** | `~0.61×` player speed—allows skilled kiting in open space while punishing cornering or greedy gem runs. |
| **Fast Runner Speed Cap** | **`≤ 1.42×` Drifter (`~130 px/s`)** | Faster than drifters to break lazy circle-strafing, yet strictly slower than an unbuffed player so fair evasion always remains possible. |
| **Starter Tracking Pulse Interval** | **`420 ms`** | Snappy rhythm (~2.38 shots/s) providing constant hit-flash and audio cadence during the opening 30 seconds. |
| **Base Knockback Impulse** | **`195 px/s`** | Visibly halts incoming drifters on hit without launching enemies uncontrollably off-screen. |
| **Base Pickup Radius** | **`100 px`** | Requires intentional movement through gem fields early, giving Pickup Radius Talent & Magnet Beacons high perceived value. |
| **Simultaneous Soft Enemy Cap** | **`240`** | Maintains bullet-heaven visual density while leaving abundant CPU/Canvas 2D headroom for 60fps on integrated GPUs. |

---

## 3. Consistency Check with GDD-Lite (Doc 01)

| Check Item | Result | Notes |
| :--- | :---: | :--- |
| Does the 30–60s opening loop feel fun without art or audio? | **PASS** | Auto-fire rhythm + XP gem magnetism + rapid first 3 level-ups establish instant momentum. |
| Are hit flashes, screen shake, and knockback readable at 60fps? | **PASS** | `60–80ms` white hit flash + micro camera impulse deliver unmistakable impact feedback. |
| Does 3-choice drafting interrupt flow smoothly? | **PASS** | Instant simulation freeze on modal open + `1/2/3` hotkeys keep build decisions under 3 seconds. |
| Do all locked numerical baselines match Doc 01 & Doc 05? | **PASS** | Exact parameter parity enforced later via Zod schemas in `schemas/config.schema.ts`. |

---

## 4. Prototype Isolation Rule

`prototype/index.html` is **permanently archived as a historical Stage 2 artifact**. Production code in `src/` must never import from, depend on, or share mutable runtime state with `prototype/`.
