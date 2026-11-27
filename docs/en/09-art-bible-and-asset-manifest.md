# 09. Art Style Bible & Production Asset Manifest

> 🌐 **Language**: [简体中文](../09.美术风格圣经与资产清单规范.md) | **English**

> **Document Purpose**: Establish visual art direction, faction contrast rules, 6-layer Z-order depth hierarchy, stage nebula palettes, and the complete production asset manifest for **VOID RUNNER (`《黑潮突围》`)**.

> **Live Implementation Note (Painted PNG Production Pipeline)**: All 23 combat sprites, 26 UI skill/talent icons, key art, and 5 seamless stage backdrops have been upgraded from legacy vector placeholders to cohesive **hard-surface painted transparent PNGs** under `public/assets/` (with all 49 legacy unused `.svg` files cleanly removed).

---

## 1. Core Art Direction

- **Visual Theme**: **Hard-Surface Sci-Fi Mecha vs. Biomechanical Void Swarm** set against high-contrast deep-space nebulae.
- **Hybrid Rendering Pipeline**: Pre-painted transparent PNG assets + offscreen bitmap & white-silhouette hit-flash caching, layered with crisp procedural holographic VFX (laser warning corridors, Boss charge tendrils, pooled dash afterimages, feathered plasma thruster plumes) and a built-in **Low-Particle fallback mode**.
- **Readability First**: In 200-entity bullet-heaven combat, **silhouette clarity and color-temperature separation** always outrank background detail.

---

## 2. Faction Contrast Matrix (Zero Visual Ambiguity)

| Faction / Category | Color Temperature | Dominant Palette | Silhouette Language |
| :--- | :--- | :--- | :--- |
| **Player Starfighter & Allied Fire** | **Cool High-Luminance** | Cyan (`#22D3EE`), Ice Blue (`#60A5FA`), Radiant Gold (`#FACC15` for Evolutions) | Sharp geometric hard-surface armor, forward-swept wings, bright ion plumes |
| **Void Swarm & Boss** | **Warm Crimson / Abyssal Magenta** | Crimson (`#F43F5E`), Void Violet (`#A855F7`), Warning Red (`#EF4444`) | Organic/spiked biomechanical hulls, dark obsidian carapaces, pulsing cores |
| **Collectibles & Beacons** | **High-Saturation Signal Hues** | Emerald/Cyan XP Gems, Gold Void Crystals, Holographic Jade Altars | Compact faceted diamonds & rotating holographic rings |
| **Deep-Space Backdrops** | **Low-Value Muted Space** | Deep Navy/Indigo/Plum (`< 18%` luminance) | Soft parallax starfields & subtle nebula dust (never competes with bullets) |

---

## 3. Six-Layer Z-Order Depth Hierarchy

1. **Layer 0 · Deep-Space Backdrop**: Stage-themed seamless tiled nebula + 2-depth parallax starfield (`#060914` base).
2. **Layer 1 · Ground / Arena Overlays**: Charging Altar holographic energy zones, Boss/Elite crimson laser warning corridors (translucent corridors with scrolling chevrons `>>>`), radial lock-on reticles.
3. **Layer 2 · Pickups & World Props**: XP gems, Void Crystals, Magnet/Overload beacons, Supply Crates, Medkits.
4. **Layer 3 · Combat Entities**: Standard swarm → Elites → Multi-Phase Boss → Player Starfighter (with pooled dash ghosts & feathered thruster plumes).
5. **Layer 4 · Active Weapons & VFX**: Projectiles, Orbital Blades, Rift/Annihilation Beams, Chain Lightning, Nova Shockwaves, Hit Sparks & Detonation Rings.
6. **Layer 5 · Telemetry & DOM HUD**: Floating damage numbers (pooled, toggleable), Edge Beacon Arrows, and crisp DOM HUD overlay.

---

## 4. Five-Stage Deep-Space Nebula Palette Table

| Stage | Backdrop Asset | Dominant Space Mood | Primary Accent |
| :---: | :--- | :--- | :--- |
| **Stage 1** | `bg_stage1.png` | Cold Orbital Frontier (Deep Cobalt) | Ice Cyan |
| **Stage 2** | `bg_stage2.png` | Ionized Dust Belt (Indigo / Teal) | Electric Blue |
| **Stage 3** | `bg_stage3.png` | Crimson Rift Horizon (Dark Violet / Wine) | Magenta-Red |
| **Stage 4** | `bg_stage4.png` | Singularity Graveyard (Obsidian / Amber Rim) | Burnt Gold |
| **Stage 5** | `bg_stage5.png` | Abyssal Void Core (Deep Ultraviolet) | Astral Violet-Gold |

---

## 5. Production Asset Manifest (53 Core Assets under `public/assets/`)

- **Key Art & Stage Backdrops (`bg/`)**:
  - `title_keyart.png` (Asymmetric sci-fi command title illustration)
  - `bg_stage1.png` ~ `bg_stage5.png` (5 seamless deep-space backdrops)
- **Player Starfighter Forms (`sprites/player/`)**:
  - `player_form_1.png` ~ `player_form_5.png` (5 progressively armored starfighter hulls)
- **Enemies, Elites & Boss (`sprites/enemies/`)**:
  - Standard (7): `enemy_drifter.png`, `enemy_runner.png`, `enemy_charger.png`, `enemy_spitter.png`, `enemy_heavy_tank.png`, `enemy_bomber.png`, `enemy_splitter.png`
  - Elites & Boss (4): `enemy_elite_charger.png`, `enemy_elite_striker.png`, `enemy_elite_prism.png`, `enemy_boss_void_weaver.png`
- **Tactical Props & Pickups (`sprites/props/`)**:
  - `prop_xp_gem_small.png`, `prop_xp_gem_large.png`, `prop_crystal.png`, `prop_medkit.png`, `prop_crate.png`, `prop_beacon_magnet.png`, `prop_beacon_overload.png`, `prop_beacon_altar.png`
- **UI Icons (`ui/icons/`, 26 painted icons)**:
  - 6 Active Weapons (`icon_weapon_*.png`), 6 Passives (`icon_passive_*.png`), 6 Evolutions (`icon_evo_*.png`), and 8 Permanent Talents (`icon_talent_*.png`).

---

## 6. Offscreen Rasterization & 60fps Guarantee

- **Zero Runtime Pixel Manipulation**: On asset load, `AssetStore` pre-generates a cached pure-white offscreen silhouette canvas (`source-in` composite) for every enemy and player sprite. Hit flashes simply stamp the cached white bitmap in `O(1)` draw time without `getImageData` or `filter` stalls.
- **Zero `shadowBlur` in Hot Loops**: Glow halos use additive concentric gradients (`globalCompositeOperation = 'lighter'`) or pre-baked sprites, sustaining locked 60 FPS even during dense Stage 5 swarm + Boss battles.
