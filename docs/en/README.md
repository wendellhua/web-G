# VOID RUNNER — SDD-G Engineering Documentation (English)

> 🌐 **Language**: [简体中文主文档](../../README.md) | **English** ([English README](../../README.en.md))

Welcome to the English documentation archive for **VOID RUNNER (《黑潮突围》)**—a complete, stage-by-stage **Spec-Driven Development for Games (SDD-G)** case study.

The stage specs in this folder are frozen outputs. The rules that produce them live in two Chinese documents (summarized in the [English README](../../README.en.md#-sdd-g-spec-driven-game-development-reference)):

| Document | Role |
| :--- | :--- |
| [`CLAUDE.md`](../CLAUDE.md) | Project constitution: what each stage may and may not do, including the headless-core, save, interface, and release-gate red lines. |
| [`SDD-G工作流提示词手册.md`](../SDD-G工作流提示词手册.md) | Nine-stage prompt handbook. Each prompt reads a matching section of `CLAUDE.md`. Stage 8 is split into L1–L5 so one session never generates the whole game. |

> **Note on Living Balance Updates**: Documents `01`–`09` preserve the authentic historical SDD-G freeze artifacts from V2.0 development. Where subsequent post-launch balance or visual polish updates refined live values (such as compact `1/2/3/4/4` Boss counts, `3/5/7/9/9 min` stage timers, `-20%` evolution damage tuning, `+20%` late-game/Boss skill damage, and upgrading all 23 sprites + 26 UI icons to hard-surface painted PNGs), each affected document includes a concise **`Live Implementation Note`** pointing to the single source of truth in `src/config/gameConfig.ts` and `schemas/config.schema.ts`.

| Stage | English Document | Chinese Original | Scope |
| :---: | :--- | :--- | :--- |
| **01** | [Game Design Specification (GDD-Lite)](./01-game-design-spec.md) | [`01.游戏设计规格书(GDD-Lite).md`](../01.游戏设计规格书%28GDD-Lite%29.md) | Core loop, 5-stage campaign, 5 starfighter forms, 6+6+6 build system |
| **02** | [Greybox Prototype Validation](./02-greybox-validation.md) | [`02.灰盒原型验证结论.md`](../02.灰盒原型验证结论.md) | Playable feel validation & locked initial movement/speed baselines |
| **03** | [System Modules & Lifecycle FSM](./03-system-modules-and-fsm.md) | [`03.系统模块与状态流转设计.md`](../03.系统模块与状态流转设计.md) | Module boundaries, macro FSM, race arbitration & Clean Reset |
| **04** | [Tech Stack & Runtime Architecture](./04-tech-stack-and-runtime-arch.md) | [`04.技术选型与运行时架构设计.md`](../04.技术选型与运行时架构设计.md) | Headless decoupling, `1/60s` fixed timestep, SpatialHashGrid & 60fps budgets |
| **05** | [Data Models, Configs & Persistence](./05-data-models-and-configs.md) | [`05.数据模型与配置表设计.md`](../05.数据模型与配置表设计.md) | Zod schemas, static config tables, Save V2 & V1→V2 migration |
| **06** | [Module Interfaces & AV Spec](./06-interfaces-and-av-spec.md) | [`06.模块接口与资源视听规范.md`](../06.模块接口与资源视听规范.md) | Readonly snapshots, controller contracts, test bridge & visual tiers |
| **07** | [Design Review & Spec Freeze Report](./07-design-review-and-freeze.md) | [`07.设计方案评审与冻结报告.md`](../07.设计方案评审与冻结报告.md) | Cross-document consistency audit & layered rollout plan |
| **08** | [QA Acceptance & Tuning Report](./08-qa-and-tuning-report.md) | [`08.质量验收与调优报告.md`](../08.质量验收与调优报告.md) | 6 automated gates, 45,000-frame headless soak & Playwright E2E coverage |
| **09** | [Art Style Bible & Asset Manifest](./09-art-bible-and-asset-manifest.md) | [`09.美术风格圣经与资产清单规范.md`](../09.美术风格圣经与资产清单规范.md) | Faction contrast rules, 6-layer Z-order, stage palettes & 53-asset catalog |
