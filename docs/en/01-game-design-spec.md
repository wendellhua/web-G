# 01. Game Design Specification (GDD-Lite · V2.0 Progressive Campaign Edition)

> 🌐 **Language**: [简体中文](../01.游戏设计规格书%28GDD-Lite%29.md) | **English**

> **Document Version**: V2.0 (Campaign Progression Overhaul & Slot-Evolution Architecture)  
> **Project Codename**: **VOID RUNNER (`《黑潮突围》`)**  
> **Genre**: Pure Front-End 2D Sci-Fi Top-Down Bullet-Heaven / Survivors-like Action Game  
> **Core Pillars**: Restrained Initial Baseline → 5-Stage Progressive Campaign → Auto-Awakening Starfighter Forms → Tactical Slot Scaling → Permanent Meta Talent Growth → Satisfying Late-Game Swarm Clearing

> **Live Implementation Note (V2.1 Balance Patch)**: Following post-V2.0 playtesting, Boss cadence and variety were upgraded: Boss counts per stage are now **`[1, 2, 3, 4, 5]`** with the first Boss spawning at `120s` (`02:00`) and each subsequent Boss every `60s` (`[120]`, `[120,180]`, `[120,180,240]`, `[120,180,240,300]`, `[120,180,240,300,360]`), featuring **5 unique Boss archetypes** (`boss_void_weaver`, `boss_pulsar_bastion`, `boss_phase_hydra`, `boss_solar_leviathan`, `boss_void_empress` — all 5 distinct in Stage 5), while stage time limits stay **`[3, 5, 7, 9, 9] min`** (`180 / 300 / 420 / 540 / 540 s`), and **eliminating all required Bosses immediately completes the level and enters settlement**. Evolution weapons were tuned down by 20%, while late-game mobs (Stages 3–5) and Boss skills were boosted. See `src/config/gameConfig.ts` as the live source of truth.

---

## 1. Core Experience & Progressive Campaign Loop

### 1.1 Core Loop
- **Inside a Run**: The player pilots a starfighter across an infinite deep-space arena using keyboard or mouse/touch drag; all weapons auto-aim and auto-fire. Defeating void swarms drops XP gems, Void Crystals, and tactical crates. Level-ups and Charging Altars present a **3-choice build draft** (`1/2/3` or click, with `R` reroll) that dynamically unlocks weapons, passives, and evolution awakenings within the stage's slot cap.
- **Stage Victory & Defeat Conditions**:
  - **Victory**: Every stage spawns **1–4 waves of multi-phase Bosses (*Void Weaver*)** starting at `02:00`, with each subsequent Boss arriving every 1 minute (`120s, 180s, 240s, 300s`). **Eliminating all required Bosses for the current level immediately clears the level and triggers victory settlement** (advancing to the next level, awarding a first-clear bonus, and auto-unlocking new starfighter forms when crossing stage thresholds).
  - **Defeat**: Either `HP <= 0` or **failing to eliminate all required Bosses before the stage time limit expires** (Timeout Defeat). Defeat preserves your current level progress (`unlockedLevel` / `currentLevel` stay intact) and retains **100% of Void Crystals collected in-run plus a partial survival reward**.
- **Between Runs (Meta Loop)**: Spend Void Crystals in the permanent Talent Hangar to raise 8 core stats (`Attack / Max HP / HP Regen / Move Speed / Pickup Radius / XP Gain / Crystal Bonus / Reroll Count`), with **free one-click full refund**, then redeploy immediately into the current stage.

---

## 2. Five-Stage Progressive Campaign & Five Auto-Awakening Forms

To prevent early stat inflation while giving every clear tangible progression, the game structures **25 core campaign levels + Stage 5 continuous escalation (up to 36 levels + Endless Mode)** into **5 distinct stages**. Each stage strictly binds a **Starfighter Form**, **Visual Tier**, **Starter Weapon Level**, **Active + Passive Slot Cap**, **Boss Count**, and **Time Limit**:

| Stage | Levels | Auto-Unlocked Form | Starter Weapon | Slot Cap (Active + Passive) | Boss Count (V2.0 Spec / *Live V2.1*) | Time Limit (V2.0 Spec / *Live V2.1*) | Unlocked Enemy Tiers & Map Events |
| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **Stage 1** | Lv. 1–3 | Form I · Initiate Frame | `Lv.1` | `2 + 1` | 1 / *1 (`02:00`)* | 3 min / *3 min* | Drifter, Runner, Charger, Elite Charger; 1st-run tutorial pace |
| **Stage 2** | Lv. 4–8 | Form II · Pulse Striker | `Lv.2` | `2 + 2` | 2 / *2 (`02:00, 04:00`)* | 6 min / *5 min* | + Spitter, Heavy Tank, Elite Striker; 1 Charging Altar |
| **Stage 3** | Lv. 9–16 | Form III · Phase Raider | `Lv.3` | `3 + 2` | 3 / *3 (`02:00–06:00`)* | 9 min / *7 min* | + Bomber, Elite Prism; up to 2 Charging Altars |
| **Stage 4** | Lv. 17–25 | Form IV · Astral Sovereign | `Lv.4` | `3 + 3` | 4 / *4 (`02:00–08:00`)* | 12 min / *9 min* | + Splitter; full roster + supply crates & beacons |
| **Stage 5** | Lv. 26+ | Form V · Void Apex | `Lv.5` | `4 + 4` | 5 / *4 (`02:00–08:00`)* | 15 min / *9 min* | Full roster, Lv.5 starter, unlocks **Endless Mode** on clear |

### 2.1 Five-Form Auto-Unlock & No-Switch Design
- Forms unlock **automatically** when cumulative campaign clears reach `0 / 3 / 8 / 16 / 25` (aligned with entering Stages 1 / 2 / 3 / 4 / 5).
- Players always sortie in their **highest unlocked Form** (no manual downgrade/character-select friction), keeping progression linear, clean, and directly mirrored in the starfighter's hull silhouette, twin/quad wing geometry, thruster plumes, and aura rings.

### 2.2 Restrained Initial Baseline (Talent-Driven Growth)
- **All 5 forms share the same restrained Level-0 base stats**:
  - `Max HP = 100`
  - `Move Speed = 150 px/s` (matches Stage 2 greybox feel; avoids trivial kiting before investing in talents)
  - `Pickup Radius = 100 px` (requires active gem collection early; expands substantially via Pickup Talent & Magnet Beacons)
  - `Attack Multiplier = 1.0`, `HP Regen = 0`, `Rerolls = 1`
- Higher forms grant **higher starter weapon level (`Lv.1 → Lv.5`)** and **expanded Active + Passive slot ceilings (`2+1 → 4+4`)**, while raw stat scaling flows cleanly through the 8 permanent talents.

### 2.3 Strict Slot-Cap Draft Isolation
- Whenever Active weapon slots are full (`activeCount >= maxActiveSlots`), **no unowned Active weapons may appear in the draft pool**—only upgrades for owned weapons, eligible evolutions, or passives.
- Whenever Passive slots are full (`passiveCount >= maxPassiveSlots`), **no unowned Passives may appear in the draft pool**.
- If all owned weapons & passives are maxed out and all evolutions are claimed, the draft smoothly degrades to **infinite fallback cards**: `+40% HP Restore`, `+10% Global Attack`, or `+60 Void Crystals` (never soft-locking or throwing empty-pool errors).

---

## 3. Six Active Weapons × Six Passive Cores → Six Evolutions

Each active weapon levels from `Lv.1 → Lv.5`. Reaching `Lv.5` while holding its paired passive core (`≥ Lv.1`) unlocks its **Evolution Super-Weapon** in the next eligible draft:

| Active Weapon (`id`) | Attack Pattern | Paired Passive (`id`) | Evolution (`id`) | Evolution Signature |
| :--- | :--- | :--- | :--- | :--- |
| **Tracking Pulse** (`tracking_pulse`) | Auto-aimed plasma bolts toward nearest enemy | **Overclock Chip** (`overclock_chip`, +Atk) | **Star Cluster** (`evo_star_cluster`) | 6 piercing golden lances + splash shock arcs |
| **Orbital Blade** (`orbital_blade`) | Orbiting blades shredding close-range threats | **Quantum Accel** (`quantum_accel`, -CD) | **Stellar Saw** (`evo_stellar_saw`) | Dual-ring 8 high-speed golden blades |
| **Void Lightning** (`void_lightning`) | Instant sky-strikes with area shock | **Wide Amp** (`wide_amp`, +Area) | **Thunder Storm** (`evo_thunder_storm`) | 6 violet bolts with 2-hop chain lightning |
| **Gravity Nova** (`gravity_nova`) | Radial knockback pulse clearing encirclement | **Shield Gen** (`shield_gen`, +HP & Regen) | **Singularity Ring** (`evo_singularity_ring`) | Heavy knockback shockwave + high-damage collapse |
| **Rift Beam** (`rift_beam`) | Piercing linear laser corridor | **Precision Scope** (`precision_scope`, +Crit) | **Annihilation Ray** (`evo_annihilation_ray`) | Triple-forked heavy beams + low-HP execute bonus |
| **Boomerang Matrix** (`boomerang_matrix`) | Returning curved blades slicing both ways | **Warp Thruster** (`warp_thruster`, +Move) | **Spiral Cutter** (`evo_spiral_cutter`) | 6 giant crescent chakrams scaling with move speed |

---

## 4. Enemy Roster (10 Tiers) & Multi-Phase Boss

1. **Standard Swarm (6 types)**:
   - `drifter`: Baseline swarm unit (`92 px/s`), steady encirclement pressure.
   - `runner`: High-speed flanking skirmisher (`≤ 1.42×` drifter speed, `~130 px/s`).
   - `charger`: Locks player position, shows telegraph, then lunges forward.
   - `spitter`: Stops at mid-range and fires slow dodgeable plasma orbs.
   - `heavy_tank`: High-HP armored bruiser with heavy knockback resistance.
   - `bomber`: Rushes close and detonates an area blast on contact or death.
   - `splitter`: Splits into smaller swarm fragments upon death (introduced Stage 4).
2. **Elites (3 types, stage-gated)**:
   - `elite_charger` (Stage 1+): Armored vanguard charger dropping guaranteed Supply Crates.
   - `elite_striker` (Stage 2+): Crimson vanguard firing spread salvos.
   - `elite_prism` (Stage 3+): Abyssal prism projecting radial laser warnings.
3. **Multi-Phase Boss (`boss_void_weaver`)**:
   - **Phase 1 (`100%–70% HP`)**: Radial ring barrage + directional holographic laser telegraph & dash.
   - **Phase 2 (`70%–35% HP`)**: Faster cadence, double-line barrage + sweeping laser corridors.
   - **Phase 3 (`< 35% HP`)**: Enraged pattern adding void-bomb detonations + high-speed dash chains.

---

## 5. Infinite Arena & Dynamic Map Events

- **Infinite Seamless Deep-Space Arena**: Camera tracks the starfighter smoothly across an unbounded coordinate plane with multi-layer parallax starfields and stage-themed nebulae.
- **3 Dynamic Map Events (with Edge Directional Indicators)**:
  1. **Magnet Beacon (`beacon_magnet`)**: Pulls all XP gems & crystals on the map directly to the player.
  2. **Overload Core (`beacon_overload`)**: Triggers a temporary high-fire-rate & shockwave clear buff.
  3. **Charging Altar (`beacon_altar`)**: Stand inside the holographic energy zone for `5s` to detonate a massive clearing shockwave and open a bonus 3-choice blessing draft.

---

## 6. Explicit Non-Goals (Scope Discipline)

To keep engineering quality and 60fps performance uncompromising, the following are explicitly out of scope:
- No multiplayer networking, accounts, cloud save, or backend servers.
- No 3D WebGL engine, physics engine (`Matter.js`/`Box2D`), or heavy UI framework (`React`/`Vue`).
- No loot-box gacha, daily login hooks, or pay-to-win monetization.
- No manual character-downgrade switching (players always pilot their highest unlocked Form).

---

## 7. HUD & UI Readability Requirements

- **Top Center**: Level & Stage badge, countdown timer, Boss progress pips (`Defeated / Required`), and Boss HP bar with phase markers (`70% / 35%`) when active.
- **Top Left**: HP bar with smooth trail, level & XP bar, and active/passive slot tray (displaying filled vs. locked/empty slots up to the current stage cap).
- **Top Right**: Kill counter, Void Crystals collected, `1× / 2× / 3×` battle speed toggle, and Pause (`Esc`/`P`).
- **Title Screen**: Asymmetric sci-fi command layout displaying current Stage/Level, unlocked Form Codex, Permanent Talent Hangar (with one-click Refund & Career Reset), Evolution Cheat Sheet, and instant **Deploy** button.
