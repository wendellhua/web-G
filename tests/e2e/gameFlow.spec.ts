import { expect, test } from '@playwright/test';

interface DebugBridgeHandle {
  getHudSnapshot: () => {
    appState: string;
    activeRunPhase: string;
    currentLevel: number;
    stageNumber: number;
    formId: string;
    maxActiveSlots: number;
    maxPassiveSlots: number;
    level: number;
    kills: number;
    elapsedSec: number;
    durationLimitSec: number;
    rerollsLeft: number;
    weaponSlots: { weaponId: string; level: number }[];
    passiveSlots: { passiveId: string; level: number }[];
    meta: {
      voidCrystals: number;
      spentCrystals: number;
      career: { currentLevel: number; clearedLevelsCount: number; unlockedFormId: string };
    };
    storageStatus: string;
  };
  getEntityCounts: () => { enemies: number; projectiles: number; xpGems: number; particles: number };
  stepFrames: (frameCount: number, input?: { moveX: number; moveY: number }) => void;
  setClearedLevels: (clearedCount: number) => void;
  setPlayerInvincible: (enabled: boolean) => void;
  setTimeScale: (scale: 1 | 2 | 3) => void;
  injectTestAction: (action: string) => void;
}

test.describe('VOID RUNNER V2.0 Real-Browser E2E Regression Suite', () => {
  test('1. Title career display, Form Codex, talent buy & free reset, reload persistence, and 2-step Career Reset', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?debug=1');
    await expect(page.getByTestId('screen-main-menu')).toBeVisible();
    await expect(page.getByTestId('career-summary')).toContainText('第 1 关');
    await expect(page.getByTestId('career-summary')).toContainText('2+1');
    await expect(page.getByTestId('game-canvas')).toBeVisible();

    // 注入 600 晶体验证局外天赋、100% 免费洗点与刷新持久化
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.injectTestAction('grant_crystals');
    });
    await expect(page.getByTestId('title-crystals')).toContainText('600');

    await page.getByTestId('btn-nav-talents').click();
    await expect(page.getByTestId('screen-talent-tree')).toBeVisible();
    await page.getByTestId('btn-buy-talent-warp_engine').click();
    await page.getByTestId('btn-buy-talent-gravity_horizon').click();

    await page.getByTestId('btn-reset-talents').click();
    await expect(page.getByTestId('talent-crystals')).toContainText('600');

    // 重新购买 1 级移速天赋（80）
    await page.getByTestId('btn-buy-talent-warp_engine').click();
    await page.getByTestId('btn-back-main').click();

    // 浏览「角色形态图鉴」核验五大形态与 2+1 → 4+4 规则
    await page.getByTestId('btn-nav-forms').click();
    await expect(page.getByTestId('screen-form-codex')).toBeVisible();
    await expect(page.getByTestId('screen-form-codex')).toContainText('形态 I · 初始机体');
    await expect(page.getByTestId('screen-form-codex')).toContainText('形态 V · 虚空终焉体');
    await page.getByTestId('btn-back-main').click();

    // 刷新页面验证 localStorage 持久化（600 - 80 = 520）
    await page.reload();
    await expect(page.getByTestId('screen-main-menu')).toBeVisible();
    await expect(page.getByTestId('title-crystals')).toContainText('520');

    // 执行二次确认「重置生涯进度」并验证彻底清空回第 1 关 + 0 晶体
    await page.getByTestId('btn-nav-reset-career').click();
    await expect(page.getByTestId('screen-reset-confirm')).toBeVisible();
    await page.getByTestId('btn-confirm-reset-career').click();
    await expect(page.getByTestId('screen-main-menu')).toBeVisible();
    await expect(page.getByTestId('title-crystals')).toContainText('0');
    await expect(page.getByTestId('career-summary')).toContainText('第 1 关');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('2. Stage 1 in-run loop: 2+1 locked slots, blur PAUSED_OVER_MODAL, strategy pause & Timeout Defeat keeping level unchanged', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?debug=1');
    await page.getByTestId('btn-start-run').click();
    await expect(page.getByTestId('hud-timer')).toContainText('03:00');
    await expect(page.getByTestId('hud-boss-progress')).toContainText('0/1');
    await expect(page.getByTestId('weapon-slot-locked-2')).toBeVisible();
    await expect(page.getByTestId('passive-slot-locked-1')).toBeVisible();

    // 推进 120 帧验证战斗与刷怪
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.stepFrames(120, { moveX: 1, moveY: 0 });
    });

    // 升级弹窗 + 失焦 PAUSED_OVER_MODAL 保护 + 重随 + 选卡
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.injectTestAction('level_up');
    });
    await expect(page.getByTestId('modal-levelup')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByTestId('modal-paused-over')).toBeVisible();
    await page.getByTestId('btn-resume-over-modal').click();
    await expect(page.getByTestId('modal-levelup')).toBeVisible();
    await page.keyboard.press('KeyR');
    await page.keyboard.press('Digit1');
    await expect(page.getByTestId('modal-levelup')).toBeHidden();

    // 暂停面板含超武速查表与动态槽位说明
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal-paused')).toBeVisible();
    await expect(page.getByTestId('modal-paused')).toContainText('超武合成速查表');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal-paused')).toBeHidden();

    // 触发时间耗尽超时判败 -> 展示超时提示且生涯仍停留在第 1 关
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.injectTestAction('jump_to_timeout');
    });
    await expect(page.getByTestId('modal-gameover')).toBeVisible();
    await expect(page.getByTestId('modal-gameover')).toContainText('超时失败');

    const afterTimeout = await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      return bridge.getHudSnapshot().meta.career;
    });
    expect(afterTimeout.currentLevel).toBe(1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('3. Form II auto-unlock announcement at Clear #3, Stage 5 (Lv.5 starter + 5 distinct Bosses) -> Endless Mode & corrupted save recovery', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/?debug=1');
    // 将累计通关设为 2（即将打第 3 关），击败第 3 关 Boss 触发形态 II 自动进阶解锁公告！
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.setClearedLevels(2);
    });
    await expect(page.getByTestId('career-summary')).toContainText('第 3 关');
    await page.getByTestId('btn-start-run').click();
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.injectTestAction('kill_all_bosses');
    });
    // Boss 死亡后先进入 3 秒过渡演出（展示非遮挡横幅、胜利弹窗尚未弹出）
    await expect(page.getByTestId('banner-boss-defeated')).toBeVisible();
    await expect(page.getByTestId('modal-victory')).toHaveCount(0);
    // 经过完整 3 秒真实演出后自动弹出胜利弹窗与形态 II 解锁公告
    await expect(page.getByTestId('modal-victory')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('banner-form-unlocked')).toBeVisible();
    await expect(page.getByTestId('banner-form-unlocked')).toContainText('形态 II · 脉冲强化体');
    // 阶段 1~4 不显示无尽模式按钮
    await expect(page.getByTestId('btn-continue-endless')).toHaveCount(0);

    // 返回主菜单并切至阶段 5（累计通关 25，第 26 关，形态 V：4+4 槽位 + Lv.5 主武 + 4 Boss + 无尽模式）
    await page.getByTestId('btn-settlement-title').click();
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.setClearedLevels(25);
    });
    await expect(page.getByTestId('career-summary')).toContainText('第 26 关');
    await expect(page.getByTestId('career-summary')).toContainText('4+4');

    await page.getByTestId('btn-start-run').click();
    await expect(page.getByTestId('hud-timer')).toContainText('09:00');
    await expect(page.getByTestId('hud-boss-progress')).toContainText('0/5');

    // 校验阶段 5 开局追踪脉冲枪直接满级 Lv.5
    const stage5Hud = await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      return bridge.getHudSnapshot();
    });
    expect(stage5Hud.weaponSlots[0]?.level).toBe(5);

    // 击破阶段 5 全部 4 只 Boss -> 经过 3 秒 Boss 死亡过渡动画 -> 胜利弹窗展示「进入无尽深渊」 -> 进入无尽 -> 战死二段结算
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.injectTestAction('kill_all_bosses');
    });
    await expect(page.getByTestId('banner-boss-defeated')).toBeVisible();
    await expect(page.getByTestId('modal-victory')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('btn-continue-endless')).toBeVisible();

    await page.getByTestId('btn-continue-endless').click();
    await expect(page.getByTestId('hud-timer')).toContainText('无尽');
    // 先将倍速归位至 1×（兼容本地调试配置），再验证局内快捷倍速按钮 1× -> 2× -> 3× -> 1× 实时切换
    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.setTimeScale(1);
    });
    const speedBtn = page.getByTestId('btn-hud-timescale');
    await expect(speedBtn).toHaveText('1×');
    await speedBtn.click();
    await expect(speedBtn).toHaveText('2×');
    await expect(page.getByTestId('hud-timer')).toContainText('[2×]');
    await speedBtn.click();
    await expect(speedBtn).toHaveText('3×');
    await expect(page.getByTestId('hud-timer')).toContainText('[3×]');
    await speedBtn.click();
    await expect(speedBtn).toHaveText('1×');

    await page.evaluate(() => {
      const bridge = (window as unknown as { __VOID_RUNNER_DEBUG__: DebugBridgeHandle }).__VOID_RUNNER_DEBUG__;
      bridge.setPlayerInvincible(false);
      bridge.stepFrames(90, { moveX: 0, moveY: 1 });
      bridge.injectTestAction('kill_player');
    });
    await expect(page.getByTestId('modal-gameover')).toBeVisible();

    // 破坏 localStorage JSON 并重新加载，验证优雅降级容错且零白屏
    await page.evaluate(() => {
      window.localStorage.setItem('void_runner_save_v1', '{CORRUPTED_JSON!!!');
    });
    await page.reload();
    await expect(page.getByTestId('screen-main-menu')).toBeVisible();
    await expect(page.getByTestId('storage-warning')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
