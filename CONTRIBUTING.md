# 参与贡献（Contributing to VOID RUNNER）

感谢你对 **《黑潮突围（VOID RUNNER）》** 及其 **SDD-G（规格驱动游戏开发）** 工程实践的兴趣！欢迎提交 Issue、数值/美术调优建议与 Pull Request。

---

## 本地开发环境

- **Node.js**：`>= 20.0.0`
- **安装依赖与启动开发服**：

```bash
npm ci
npm run dev
```

打开浏览器访问 `http://localhost:5173`（追加 `?debug=1` 可开启开发调试桥）。

---

## 核心工程红线（务必遵守）

本项目严格遵循 `CLAUDE.md` 与 `docs/` 冻结规格，请确保所有提交满足以下不变量：

1. **逻辑与表现彻底解耦**：
   - `src/core/**` 为纯无头 TypeScript 确定性仿真内核，**严禁引入** `window`、`document`、`Canvas`、`AudioContext`、`localStorage` 或 `Math.random()`（统一使用可复现 `SeededRng`）。
   - 所有渲染、音效与 DOM 交互仅通过 `RenderSnapshot` 与 `GameEvent` 单向只读消费。
2. **静态配置强契约（Zod）**：
   - 所有关卡、武器、被动、超武、敌怪与天赋数值均集中在 `src/config/gameConfig.ts`，并经 `schemas/config.schema.ts` 启动强校验。
   - 若修改了阶段时长、Boss 节拍或槽位规则，请同步更新 `schemas/config.schema.ts` 及对应单元测试。
3. **60 FPS 渲染性能红线**：
   - `src/presentation/render/CanvasRenderer.ts` 中 300+ 实体热路径严禁开启 `ctx.shadowBlur`，粒子/残影/飘字统一复用预分配对象池。

---

## 提交前必跑质量门禁

在发起 Pull Request 前，请确认以下 6 项质量门禁全部通过（与 `.github/workflows/ci.yml` 完全一致）：

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:sim
npm run test:e2e
npm run build
```

---

## 提交规范建议

- 推荐使用 Conventional Commits：`feat:`、`fix:`、`perf:`、`balance:`、`art:`、`docs:`、`ci:`、`test:`。
- 如涉及视觉或玩法手感改动，欢迎在 PR 描述中附上实机截图或录屏对比。
