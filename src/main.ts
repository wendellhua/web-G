/**
 * 《黑潮突围（VOID RUNNER）》浏览器宿主装配入口（BrowserLoopAdapter · V2.0）
 * - 固定时间步长 FIXED_DT_SEC = 1/60s，rawDt <= 0.05s 钳制，MAX_SUBSTEPS = 5；
 * - 监听 visibilitychange / blur 自动暂停、清空按键状态、重置时间戳与挂起 BGM；
 * - 仅在开发或 ?debug=1 模式下挂载 window.__VOID_RUNNER_DEBUG__ 受控测试桥。
 */
import './ui/styles.css';
import { GameController } from './controller/GameController';
import type { HudSnapshot, InputCommandFrame } from './core/contracts/gameContracts';
import { FIXED_DT_SEC } from './core/engine/SimulationWorld';
import { InputNormalizer, type HotkeyAction } from './input/InputNormalizer';
import { SynthAudioEngine } from './presentation/audio/SynthAudioEngine';
import { CanvasRenderer } from './presentation/render/CanvasRenderer';
import { UiOverlayManager } from './ui/UiOverlayManager';

const MAX_RAW_DT_SEC = 0.05;
const MAX_SUBSTEPS = 5;

export interface VoidRunnerDebugBridge {
  getHudSnapshot: () => HudSnapshot;
  getEntityCounts: () => ReturnType<GameController['world']['getEntityCounts']> & { particles: number };
  getSaveSnapshot: () => ReturnType<GameController['getSaveSnapshot']>;
  startSeededRun: (seed: number) => void;
  setClearedLevels: (clearedCount: number) => void;
  setPlayerInvincible: (enabled: boolean) => void;
  setTimeScale: (scale: 1 | 2 | 3) => void;
  stepFrames: (frameCount: number, input?: InputCommandFrame) => void;
  injectTestAction: (
    action:
      | 'level_up'
      | 'spawn_elite'
      | 'spawn_altar'
      | 'spawn_chest'
      | 'jump_to_next_boss'
      | 'jump_to_timeout'
      | 'kill_all_bosses'
      | 'kill_player'
      | 'grant_crystals',
  ) => void;
}

declare global {
  interface Window {
    __VOID_RUNNER_DEBUG__?: VoidRunnerDebugBridge;
  }
}

function bootstrap(): void {
  const appRoot = document.getElementById('app');
  if (!appRoot) throw new Error('Missing #app root container');

  const stageWrap = document.createElement('div');
  stageWrap.id = 'stage-wrap';
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.setAttribute('data-testid', 'game-canvas');
  stageWrap.appendChild(canvas);
  appRoot.innerHTML = '';
  appRoot.appendChild(stageWrap);

  const controller = new GameController();
  const renderer = new CanvasRenderer(canvas);
  const audio = new SynthAudioEngine();

  const syncSettingsToPresentation = (): void => {
    const s = controller.getSettings();
    renderer.updateSettings(s);
    audio.updateSettings(s);
  };
  syncSettingsToPresentation();

  const onRunRestarted = (): void => {
    input.clearMovementKeys();
    renderer.resetVisualPools();
    audio.resetRunAudioState();
  };

  const ui = new UiOverlayManager(
    stageWrap,
    controller,
    () => syncSettingsToPresentation(),
    onRunRestarted,
  );

  const handleHotkey = (action: HotkeyAction): void => {
    const st = controller.world.appState;
    switch (action) {
      case 'SELECT_0':
        controller.selectModalChoice(0);
        break;
      case 'SELECT_1':
        controller.selectModalChoice(1);
        break;
      case 'SELECT_2':
        controller.selectModalChoice(2);
        break;
      case 'REROLL':
        controller.rerollLevelUp();
        break;
      case 'TOGGLE_PAUSE':
        if (st === 'TITLE') {
          controller.navigateTitleSubView('MAIN_MENU');
        } else if (st === 'PAUSED') {
          controller.resume();
        } else if (st === 'RUN_NORMAL' || st === 'RUN_BOSS' || st === 'RUN_ENDLESS') {
          input.clearMovementKeys();
          controller.pause('manual');
        }
        break;
      case 'CONFIRM':
        if (st === 'CHEST_MODAL') {
          controller.confirmChestModal();
        } else if (st === 'PAUSED_OVER_MODAL') {
          controller.resume();
        }
        break;
    }
  };

  const input = new InputNormalizer(handleHotkey, () => audio.unlock());

  window.addEventListener('resize', () => renderer.resize());

  let lastTimestampMs = performance.now();
  let accumulatorSec = 0;

  const handleBackgroundPause = (reason: 'blur' | 'hidden'): void => {
    input.clearMovementKeys();
    accumulatorSec = 0;
    lastTimestampMs = performance.now();
    audio.suspendForBackground();
    controller.pause(reason);
  };

  window.addEventListener('blur', () => handleBackgroundPause('blur'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      handleBackgroundPause('hidden');
    } else {
      lastTimestampMs = performance.now();
    }
  });

  const enableDebugBridge = import.meta.env.DEV || window.location.search.includes('debug=1');
  if (enableDebugBridge) {
    window.__VOID_RUNNER_DEBUG__ = {
      getHudSnapshot: () => controller.getHudSnapshot(),
      getEntityCounts: () => ({
        ...controller.world.getEntityCounts(),
        particles: renderer.getActiveParticleCount(),
      }),
      getSaveSnapshot: () => controller.getSaveSnapshot(),
      startSeededRun: (seed: number) => {
        if (controller.world.appState !== 'TITLE') {
          controller.world.resetToTitle();
        }
        controller.startRun(seed);
        onRunRestarted();
        ui.sync(controller.getHudSnapshot());
      },
      setClearedLevels: (clearedCount: number) => {
        controller.debugSetClearedLevels(clearedCount);
        ui.sync(controller.getHudSnapshot());
      },
      setPlayerInvincible: (enabled: boolean) => {
        controller.setDebugPlayerInvincible(Boolean(enabled));
        ui.sync(controller.getHudSnapshot());
      },
      setTimeScale: (scale: 1 | 2 | 3) => {
        const safeScale = scale === 3 ? 3 : scale === 2 ? 2 : 1;
        controller.setDebugTimeScale(safeScale);
        ui.sync(controller.getHudSnapshot());
      },
      stepFrames: (frameCount: number, moveInput: InputCommandFrame = { moveX: 0, moveY: 0 }) => {
        const safeCount = Math.max(0, Math.min(10000, Math.floor(frameCount)));
        for (let i = 0; i < safeCount; i++) {
          if (!controller.world.isRunningPhase()) break;
          controller.step(FIXED_DT_SEC, moveInput);
          const events = controller.getFrameEvents();
          renderer.consumeEvents(events);
          controller.clearFrameEvents();
        }
        ui.sync(controller.getHudSnapshot());
      },
      injectTestAction: (action) => {
        switch (action) {
          case 'level_up':
            controller.world.debugForceLevelUp();
            break;
          case 'spawn_elite':
            controller.world.spawnEnemy('elite_vanguard');
            break;
          case 'spawn_altar':
            controller.world.spawnAltarNearPlayer();
            break;
          case 'spawn_chest':
            controller.world.debugSpawnChestAtPlayer();
            break;
          case 'jump_to_next_boss':
            controller.world.debugJumpToNextBoss();
            break;
          case 'jump_to_timeout':
            controller.world.debugJumpToTimeout();
            controller.debugFlushSettlement();
            break;
          case 'kill_all_bosses':
            controller.world.debugKillAllStageBosses();
            controller.debugFlushSettlement();
            break;
          case 'kill_player':
            controller.world.debugDamagePlayer(99999);
            controller.debugFlushSettlement();
            break;
          case 'grant_crystals':
            controller.debugGrantCrystals(600);
            break;
        }
        ui.sync(controller.getHudSnapshot());
      },
    };
  }

  const frame = (nowMs: number): void => {
    const rawDtSec = Math.min(MAX_RAW_DT_SEC, Math.max(0, (nowMs - lastTimestampMs) / 1000));
    lastTimestampMs = nowMs;
    const timeScale = controller.getEffectiveTimeScale();

    if (controller.world.isRunningPhase()) {
      accumulatorSec += rawDtSec * timeScale;
      let substeps = 0;
      const maxSubsteps = MAX_SUBSTEPS * timeScale;
      const moveCmd = input.pollMovement();
      while (accumulatorSec >= FIXED_DT_SEC && substeps < maxSubsteps) {
        controller.step(FIXED_DT_SEC, moveCmd);
        const events = controller.getFrameEvents();
        if (events.length > 0) {
          renderer.consumeEvents(events);
          audio.consumeEvents(events);
          controller.clearFrameEvents();
        }
        accumulatorSec -= FIXED_DT_SEC;
        substeps += 1;
        if (!controller.world.isRunningPhase()) {
          accumulatorSec = 0;
          input.clearMovementKeys();
          break;
        }
      }
      audio.setBgmState(controller.world.isRunningPhase(), controller.world.activeRunPhase === 'RUN_BOSS');
    } else {
      accumulatorSec = 0;
      audio.setBgmState(false, false);
    }

    const isTitleBg = controller.world.appState === 'TITLE' || controller.world.appState === 'BOOT';
    const renderDtSec = controller.world.isRunningPhase() ? rawDtSec * timeScale : rawDtSec;
    renderer.render(controller.getRenderSnapshot(), renderDtSec, isTitleBg);
    ui.sync(controller.getHudSnapshot());

    requestAnimationFrame(frame);
  };

  ui.sync(controller.getHudSnapshot());
  requestAnimationFrame(frame);
}

bootstrap();
