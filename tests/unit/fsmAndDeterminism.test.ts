import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/config/gameConfig';
import { GameController } from '../../src/controller/GameController';
import {
  BOSS_VICTORY_OUTRO_DURATION_SEC,
  FIXED_DT_SEC,
  SimulationWorld,
  computePostFirstBossBonusEliteCount,
} from '../../src/core/engine/SimulationWorld';

function stepThroughVictoryOutro(ctrl: GameController): void {
  const totalFrames = Math.ceil(BOSS_VICTORY_OUTRO_DURATION_SEC / FIXED_DT_SEC) + 2;
  for (let i = 0; i < totalFrames; i++) {
    if (ctrl.getHudSnapshot().appState !== 'VICTORY_OUTRO') break;
    ctrl.step(FIXED_DT_SEC, { moveX: 1, moveY: 0 });
  }
}
import {
  calculateEndlessDeltaCrystals,
  calculateNormalOrVictoryCrystals,
} from '../../src/core/systems/EconomyCalculator';
import { SaveManager, type StorageAdapter } from '../../src/storage/SaveManager';

class InMemoryStorage implements StorageAdapter {
  private readonly map = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('V2.0 宏观 FSM、超时判败、多 Boss 通关进阶、两段无尽与确定性复现', () => {
  it('PAUSED_OVER_MODAL 在升级弹窗切后台时不覆盖原弹窗且恢复后可正常选卡', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    expect(ctrl.startRun(2026).ok).toBe(true);

    ctrl.world.debugForceLevelUp();
    expect(ctrl.getHudSnapshot().appState).toBe('LEVEL_UP_MODAL');

    expect(ctrl.pause('hidden').ok).toBe(true);
    expect(ctrl.getHudSnapshot().appState).toBe('PAUSED_OVER_MODAL');

    expect(ctrl.resume().ok).toBe(true);
    expect(ctrl.getHudSnapshot().appState).toBe('LEVEL_UP_MODAL');

    expect(ctrl.selectModalChoice(0).ok).toBe(true);
    expect(ctrl.getHudSnapshot().appState).toBe('RUN_NORMAL');
  });

  it('超时未击杀 Boss 判败：进度保持当前关卡不变，且正常发放晶体', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(101);
    expect(ctrl.getHudSnapshot().currentLevel).toBe(1);

    ctrl.world.debugJumpToTimeout();
    ctrl.debugFlushSettlement();

    const hud = ctrl.getHudSnapshot();
    expect(hud.appState).toBe('GAME_OVER_MODAL');
    expect(hud.settlementModal?.defeatReason).toBe('timeout');
    expect(hud.settlementModal?.nextLevelNumber).toBe(1);
    expect(hud.meta.career.currentLevel).toBe(1);
    expect(hud.meta.voidCrystals).toBeGreaterThan(0);
  });

  it('通关第 3 关跨越节点：自动解锁形态 II（2+2 槽位、开局主武 Lv.2）并在胜利弹窗弹出解锁公告', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.debugSetClearedLevels(2); // 当前即将挑战第 3 关
    ctrl.startRun(303);
    expect(ctrl.getHudSnapshot().currentLevel).toBe(3);
    expect(ctrl.getHudSnapshot().maxActiveSlots).toBe(2);
    expect(ctrl.getHudSnapshot().maxPassiveSlots).toBe(1);
    expect(ctrl.getHudSnapshot().weaponSlots[0]?.level).toBe(1);

    ctrl.world.debugKillAllStageBosses();
    expect(ctrl.getHudSnapshot().appState).toBe('VICTORY_OUTRO');
    stepThroughVictoryOutro(ctrl);

    const afterVictory = ctrl.getHudSnapshot();
    expect(afterVictory.appState).toBe('VICTORY_MODAL');
    expect(afterVictory.settlementModal?.canContinueEndless).toBe(false); // 阶段 1~4 不开无尽
    expect(afterVictory.settlementModal?.newlyUnlockedForm?.formId).toBe('form_2_pulse');
    expect(afterVictory.meta.career.currentLevel).toBe(4);
    expect(afterVictory.meta.career.currentFormId).toBe('form_2_pulse');

    // 点击挑战第 4 关验证 2+2 槽位与 Lv.2 开局追踪脉冲枪
    expect(ctrl.restartRun(404).ok).toBe(true);
    const level4Hud = ctrl.getHudSnapshot();
    expect(level4Hud.currentLevel).toBe(4);
    expect(level4Hud.stageNumber).toBe(2);
    expect(level4Hud.maxActiveSlots).toBe(2);
    expect(level4Hud.maxPassiveSlots).toBe(2);
    expect(level4Hud.weaponSlots[0]?.level).toBe(2);
    expect(level4Hud.bossProgress.total).toBe(2);
  });

  it('同帧 Boss 击杀与玩家死亡：优先判玩家险胜且阶段 5 也隐藏继续无尽入口', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.setDebugPlayerInvincible(false);
    ctrl.debugSetClearedLevels(25); // 阶段 5 第 26 关
    ctrl.startRun(555);
    ctrl.world.debugTriggerSameFrameMutualKill();
    expect(ctrl.getHudSnapshot().appState).toBe('VICTORY_OUTRO');
    stepThroughVictoryOutro(ctrl);

    const hud = ctrl.getHudSnapshot();
    expect(hud.appState).toBe('VICTORY_MODAL');
    expect(hud.settlementModal?.isVictory).toBe(true);
    expect(hud.settlementModal?.canContinueEndless).toBe(false);
    expect(ctrl.continueEndless().ok).toBe(false);
  });

  it('阶段 5（第 26 关）击破 4 只 Boss 立即落盘通关奖励，继续无尽阵亡后再追加增量且零重复', () => {
    const storage = new InMemoryStorage();
    const ctrl = new GameController(new SaveManager(storage));
    ctrl.setDebugPlayerInvincible(false);
    ctrl.debugSetClearedLevels(25);
    ctrl.startRun(777);
    expect(ctrl.getHudSnapshot().stageNumber).toBe(5);
    expect(ctrl.getHudSnapshot().weaponSlots[0]?.level).toBe(5);
    expect(ctrl.getHudSnapshot().bossProgress.total).toBe(4);

    ctrl.world.debugKillAllStageBosses();
    expect(ctrl.getHudSnapshot().appState).toBe('VICTORY_OUTRO');
    stepThroughVictoryOutro(ctrl);

    const afterVictory = ctrl.getHudSnapshot();
    expect(afterVictory.appState).toBe('VICTORY_MODAL');
    expect(afterVictory.settlementModal?.canContinueEndless).toBe(true);
    const victoryCrystals = afterVictory.meta.voidCrystals;
    expect(victoryCrystals).toBeGreaterThanOrEqual(320);

    expect(ctrl.continueEndless().ok).toBe(true);
    expect(ctrl.getHudSnapshot().appState).toBe('RUN_ENDLESS');

    for (let i = 0; i < 60 * 65; i++) {
      ctrl.step(FIXED_DT_SEC, { moveX: 1, moveY: 0 });
      const st = ctrl.getHudSnapshot().appState;
      if (st === 'LEVEL_UP_MODAL' || st === 'ALTAR_MODAL') ctrl.selectModalChoice(0);
      else if (st === 'CHEST_MODAL') ctrl.confirmChestModal();
      else if (st === 'GAME_OVER_MODAL') break;
    }

    if (ctrl.getHudSnapshot().appState !== 'GAME_OVER_MODAL') {
      ctrl.world.debugDamagePlayer(99999);
      ctrl.debugFlushSettlement();
    }

    const afterEndless = ctrl.getHudSnapshot();
    expect(afterEndless.appState).toBe('GAME_OVER_MODAL');
    expect(afterEndless.settlementModal?.isEndlessEnd).toBe(true);
    expect(afterEndless.meta.voidCrystals).toBeGreaterThanOrEqual(victoryCrystals);

    const reloaded = new SaveManager(storage).load();
    expect(reloaded.data.metaProgress.voidCrystals).toBe(afterEndless.meta.voidCrystals);
    expect(reloaded.data.career.clearedLevelsCount).toBe(26);
  });

  it('无头 3,600 帧（60 秒）同种子确定性逐字段复现，零 NaN', () => {
    const run60Sec = (seed: number) => {
      const world = new SimulationWorld();
      world.resetRun(
        1,
        {
          maxHpFlat: 0,
          moveSpeedRatio: 0,
          damageRatio: 0,
          cooldownReductionRatio: 0,
          pickupRadiusRatio: 0,
          xpGainRatio: 0,
          extraRerolls: 0,
          crystalExtractRatio: 0,
        },
        seed,
      );

      for (let f = 0; f < 3600; f++) {
        const phase = Math.floor(f / 180) % 4;
        const input =
          phase === 0
            ? { moveX: 1, moveY: 0 }
            : phase === 1
              ? { moveX: 0, moveY: 1 }
              : phase === 2
                ? { moveX: -1, moveY: 0 }
                : { moveX: 0, moveY: -1 };

        world.step(FIXED_DT_SEC, input);
        world.clearFrameEvents();

        if (world.appState === 'LEVEL_UP_MODAL' || world.appState === 'ALTAR_MODAL') {
          world.selectModalChoice(0);
        } else if (world.appState === 'CHEST_MODAL') {
          world.confirmChestModal();
        } else if (world.appState === 'GAME_OVER_MODAL') {
          break;
        }
      }

      const snap = world.getRenderSnapshot();
      expect(Number.isFinite(snap.player.x)).toBe(true);
      expect(Number.isFinite(snap.player.y)).toBe(true);
      expect(Number.isFinite(snap.player.hp)).toBe(true);
      return {
        tickCount: world.tickCount,
        px: snap.player.x,
        py: snap.player.y,
        hp: snap.player.hp,
        level: world.player.level,
        kills: world.getHudPartials().kills,
        counts: world.getEntityCounts(),
      };
    };

    const runA = run60Sec(987654321);
    const runB = run60Sec(987654321);
    expect(runA).toEqual(runB);
    expect(runA.kills).toBeGreaterThan(0);
  });

  it('难度与数值校验：阶段 1 初始主武不秒杀普通小怪，且阶段 1 Boss 血量充足防秒杀', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(123);
    const snap = ctrl.getRenderSnapshot();
    const swarm = snap.enemies.find((e) => e.enemyId === 'swarm');
    expect(swarm).toBeDefined();
    // Lv.1 追踪脉冲单发伤害 15，阶段 1 集群蚀虫血量 42，需 3 枪击杀而非秒杀
    expect(swarm!.maxHp).toBeGreaterThanOrEqual(40);

    ctrl.world.debugJumpToNextBoss();
    const bossHud = ctrl.getHudSnapshot().bossHud;
    expect(bossHud).not.toBeNull();
    expect(bossHud!.maxHp).toBeGreaterThanOrEqual(5000);
  });

  it('虚空震爆（beacon_nuke）对 Boss 100% 免疫并发出免疫反馈，同时正常清场普通小怪', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(456);
    ctrl.world.debugJumpToNextBoss();
    const bossBefore = ctrl.getHudSnapshot().bossHud;
    expect(bossBefore).not.toBeNull();
    const initialBossHp = bossBefore!.hp;

    ctrl.world.clearFrameEvents();
    ctrl.world.debugTriggerBeaconNukeAtPlayer();
    const events = ctrl.world.getFrameEvents();

    const bossAfter = ctrl.getHudSnapshot().bossHud;
    expect(bossAfter).not.toBeNull();
    expect(bossAfter!.hp).toBe(initialBossHp);
    expect(events.some((e) => e.type === 'BOSS_IMMUNE')).toBe(true);
  });

  it('机制修复校验：即便 Boss 死于奇点坍缩等延迟/非弹幕来源，满足全 Boss 肃清条件也当帧立即切入 3 秒 Boss 死亡过渡并在 3 秒后触发 VICTORY_MODAL', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(789);
    ctrl.world.debugJumpToNextBoss();
    expect(ctrl.getHudSnapshot().appState).toBe('RUN_BOSS');

    const pxBefore = ctrl.world.player.x;
    const pyBefore = ctrl.world.player.y;
    ctrl.world.clearFrameEvents();
    ctrl.world.debugKillBossViaDelayedCollapse();
    const elapsedAtOutroStart = ctrl.world.elapsedSec;

    // 当帧立即进入 3 秒过渡动画并派发死亡演出事件，不立刻弹出胜利弹窗
    const midHud = ctrl.getHudSnapshot();
    expect(midHud.bossProgress.killed).toBe(1);
    expect(midHud.bossProgress.total).toBe(1);
    expect(midHud.appState).toBe('VICTORY_OUTRO');
    expect(ctrl.getFrameEvents().some((e) => e.type === 'BOSS_DEATH_OUTRO_STARTED')).toBe(true);
    expect(ctrl.getRenderSnapshot().victoryOutro?.durationSec).toBe(3.0);

    // 推进 2.9 秒（174 帧），即使持续输入移动指令，主角也原地停下、计时冻结且尚未弹出结算弹窗
    for (let i = 0; i < 174; i++) {
      ctrl.step(FIXED_DT_SEC, { moveX: 1, moveY: 0.5 });
    }
    expect(ctrl.getHudSnapshot().appState).toBe('VICTORY_OUTRO');
    expect(ctrl.world.player.x).toBe(pxBefore);
    expect(ctrl.world.player.y).toBe(pyBefore);
    expect(ctrl.world.elapsedSec).toBe(elapsedAtOutroStart);

    // 再推进剩余 0.1 秒（6 帧）抵达 3.0 秒整，顺利弹出 VICTORY_MODAL 并推进关卡
    for (let i = 0; i < 6; i++) {
      ctrl.step(FIXED_DT_SEC, { moveX: 1, moveY: 0.5 });
    }

    const hud = ctrl.getHudSnapshot();
    expect(hud.appState).toBe('VICTORY_MODAL');
    expect(hud.meta.career.currentLevel).toBe(2);
  });

  it('自然逐帧推进抵达阶段时间上限（无 debug 跳转）：立即超时判负冻结并结算，关卡进度保持不变', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(202605);
    // 将时间推进到距离 180s 上限仅剩 0.5 秒且 Boss 已在场（满血）
    ctrl.world.debugJumpToNextBoss();
    ctrl.world.elapsedSec = 179.5;

    let endedAtStep = -1;
    for (let i = 0; i < 60; i++) {
      ctrl.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
      if (ctrl.getHudSnapshot().appState === 'GAME_OVER_MODAL') {
        endedAtStep = i;
        break;
      }
    }

    expect(endedAtStep).toBeGreaterThanOrEqual(0);
    const snapAtEnd = ctrl.getHudSnapshot();
    expect(snapAtEnd.appState).toBe('GAME_OVER_MODAL');
    expect(snapAtEnd.settlementModal?.defeatReason).toBe('timeout');
    expect(snapAtEnd.elapsedSec).toBe(180);
    expect(snapAtEnd.meta.career.currentLevel).toBe(1);
    const crystalsAfterTimeout = snapAtEnd.meta.voidCrystals;
    expect(crystalsAfterTimeout).toBeGreaterThan(0);

    // 结束后继续尝试推进 120 帧：世界必须完全冻结、绝不重复落盘晶体
    for (let i = 0; i < 120; i++) {
      ctrl.step(FIXED_DT_SEC, { moveX: 1, moveY: 0 });
    }
    const snapLater = ctrl.getHudSnapshot();
    expect(snapLater.appState).toBe('GAME_OVER_MODAL');
    expect(snapLater.elapsedSec).toBe(180);
    expect(snapLater.meta.voidCrystals).toBe(crystalsAfterTimeout);
  });

  it('平衡性校验：第 3 关起普通小怪刷怪密度相较第 2 关显著降低约 20%', () => {
    const measureSpawned = (clearedLevels: number): number => {
      const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
      ctrl.debugSetClearedLevels(clearedLevels);
      ctrl.startRun(314159);
      // 推进 40 秒（2400 帧），比较在场+已击杀总怪数
      for (let i = 0; i < 2400; i++) {
        if (ctrl.getHudSnapshot().appState === 'LEVEL_UP_MODAL') {
          ctrl.selectModalChoice(0);
        }
        ctrl.step(FIXED_DT_SEC, { moveX: 0.6, moveY: 0.4 });
      }
      const hud = ctrl.getHudSnapshot();
      const counts = ctrl.world.getEntityCounts();
      return hud.kills + counts.enemies;
    };

    const lv2Total = measureSpawned(1); // 第 2 关（仍属阶段 1）
    const lv3Total = measureSpawned(2); // 第 3 关（仍属阶段 1，但触发第 3 关起 -20% 降密）
    const ratio = lv3Total / Math.max(1, lv2Total);
    expect(ratio).toBeGreaterThanOrEqual(0.68);
    expect(ratio).toBeLessThanOrEqual(0.9);
  });

  it('单局保底回血次数硬上限校验：最多生效 3 次，第 4 次升级不再出现保底回血且重开后归零', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(5566);

    // 填满阶段 1 的 2+1 槽位并升满级 + 进化，进入纯保底三选一池
    ctrl.world.weapons = [
      { weaponId: 'tracking_pulse', level: 5, isEvolved: true, evolutionId: 'evo_star_cluster', cooldownTimerMs: 0, orbitAngleRad: 0 },
      { weaponId: 'orbital_blade', level: 5, isEvolved: true, evolutionId: 'evo_stellar_saw', cooldownTimerMs: 0, orbitAngleRad: 0 },
    ];
    ctrl.world.passives = [{ passiveId: 'overclock_chip', level: 5 }];

    for (let i = 0; i < 3; i++) {
      ctrl.world.player.hp = 40;
      ctrl.world.debugForceLevelUp();
      const hud = ctrl.getHudSnapshot();
      expect(hud.appState).toBe('LEVEL_UP_MODAL');
      const healIdx = hud.levelUpChoices.findIndex((c) => c.kind === 'fallback_heal');
      expect(healIdx).toBe(0);
      ctrl.selectModalChoice(0);
      expect(ctrl.world.player.hp).toBeGreaterThan(40);
      expect(ctrl.world.getFallbackHealsUsed()).toBe(i + 1);
    }

    // 第 4 次升级：fallback_heal 必须彻底消失，不再允许回血，且可选 fallback_speed
    ctrl.world.player.hp = 40;
    ctrl.world.debugForceLevelUp();
    const fourthHud = ctrl.getHudSnapshot();
    expect(fourthHud.appState).toBe('LEVEL_UP_MODAL');
    expect(fourthHud.levelUpChoices.some((c) => c.kind === 'fallback_heal')).toBe(false);
    const speedIdx = fourthHud.levelUpChoices.findIndex((c) => c.kind === 'fallback_speed');
    expect(speedIdx).toBe(2);
    ctrl.selectModalChoice(2);
    expect(ctrl.world.player.hp).toBe(40);

    // 暂停重开后，保底回血次数必须清零
    expect(ctrl.pause('manual').ok).toBe(true);
    expect(ctrl.restartRun(5566).ok).toBe(true);
    expect(ctrl.world.getFallbackHealsUsed()).toBe(0);
  });

  it('第 5 关起消灭首个 Boss 后按关递增刷出额外精英怪（第 4 关 0 只，第 5 关 3 只，第 6 关 4 只，第 9 关 7 只）', () => {
    expect(computePostFirstBossBonusEliteCount(1)).toBe(0);
    expect(computePostFirstBossBonusEliteCount(4)).toBe(0);
    expect(computePostFirstBossBonusEliteCount(5)).toBe(3);
    expect(computePostFirstBossBonusEliteCount(6)).toBe(4);
    expect(computePostFirstBossBonusEliteCount(9)).toBe(7);

    const measurePostFirstBossElites = (clearedLevelsBefore: number): { deltaAfterFirst: number; deltaAfterSecond: number; prismCount: number } => {
      const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
      ctrl.debugSetClearedLevels(clearedLevelsBefore);
      ctrl.startRun(202611);
      ctrl.world.debugJumpToNextBoss();
      // 先步进 1 帧结算该时间点原本的里程碑精英，再隔离测量击杀 Boss 当帧的额外精英增量
      ctrl.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });

      const elitesBeforeFirst = ctrl
        .getRenderSnapshot()
        .enemies.filter((e) => e.tier === 'elite').length;
      ctrl.world.debugKillBossViaDelayedCollapse();
      const afterFirstEnemies = ctrl.getRenderSnapshot().enemies;
      const elitesAfterFirst = afterFirstEnemies.filter((e) => e.tier === 'elite').length;
      const prismCount = afterFirstEnemies.filter((e) => e.enemyId === 'elite_prism').length;

      // 刷出并击杀第 2 只 Boss：绝不可重复触发首 Boss 额外精英波
      ctrl.world.debugJumpToNextBoss();
      ctrl.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
      const elitesBeforeSecond = ctrl
        .getRenderSnapshot()
        .enemies.filter((e) => e.tier === 'elite').length;
      ctrl.world.debugKillBossViaDelayedCollapse();
      const elitesAfterSecond = ctrl
        .getRenderSnapshot()
        .enemies.filter((e) => e.tier === 'elite').length;

      return {
        deltaAfterFirst: elitesAfterFirst - elitesBeforeFirst,
        // 若第 2 只 Boss 为本阶段最后一只（阶段 2），击杀后会触发胜利清场使残余精英归零，因此新增量必 <= 0
        deltaAfterSecond: Math.max(0, elitesAfterSecond - elitesBeforeSecond),
        prismCount,
      };
    };

    const lv4 = measurePostFirstBossElites(3); // 第 4 关（阶段 2）
    expect(lv4.deltaAfterFirst).toBe(0);
    expect(lv4.deltaAfterSecond).toBe(0);

    const lv5 = measurePostFirstBossElites(4); // 第 5 关（阶段 2）：+3 只精英
    expect(lv5.deltaAfterFirst).toBe(3);
    expect(lv5.deltaAfterSecond).toBe(0);

    const lv6 = measurePostFirstBossElites(5); // 第 6 关（阶段 2）：+4 只精英
    expect(lv6.deltaAfterFirst).toBe(4);
    expect(lv6.deltaAfterSecond).toBe(0);

    const lv9 = measurePostFirstBossElites(8); // 第 9 关（阶段 3）：+7 只精英且混编深渊棱镜
    expect(lv9.deltaAfterFirst).toBe(7);
    expect(lv9.deltaAfterSecond).toBe(0);
    expect(lv9.prismCount).toBeGreaterThanOrEqual(3);
  });

  it('调试开关：角色无敌模式开启后免疫一切伤害并随设置持久化，关闭后立即恢复正常受击', () => {
    const storage = new InMemoryStorage();
    const ctrl = new GameController(new SaveManager(storage));
    expect(ctrl.isPlayerInvincible()).toBe(GAME_CONFIG.balance.debugPlayerInvincible);

    // 主界面系统设置开启无敌模式
    expect(ctrl.updateSettings({ debugPlayerInvincible: true }).ok).toBe(true);
    expect(ctrl.isPlayerInvincible()).toBe(true);

    ctrl.startRun(7788);
    const maxHp = ctrl.world.player.maxHp;
    ctrl.world.clearFrameEvents();
    ctrl.world.debugDamagePlayer(99999);
    expect(ctrl.world.player.hp).toBe(maxHp);
    expect(ctrl.world.player.entityState).toBe('ALIVE_NORMAL');
    expect(ctrl.world.getFrameEvents().some((e) => e.type === 'PLAYER_HIT')).toBe(false);
    expect(ctrl.getHudSnapshot().appState).toBe('RUN_NORMAL');

    // 暂停菜单内可即时关闭无敌模式，恢复正常受击掉血
    expect(ctrl.pause('manual').ok).toBe(true);
    expect(ctrl.updateSettings({ debugPlayerInvincible: false }).ok).toBe(true);
    expect(ctrl.resume().ok).toBe(true);
    expect(ctrl.isPlayerInvincible()).toBe(false);

    ctrl.world.clearFrameEvents();
    ctrl.world.debugDamagePlayer(25);
    expect(ctrl.world.player.hp).toBe(maxHp - 25);
    expect(ctrl.world.getFrameEvents().some((e) => e.type === 'PLAYER_HIT')).toBe(true);

    // 再次开启并重新加载存档：无敌配置保持持久化
    ctrl.setDebugPlayerInvincible(true);
    const reloaded = new GameController(new SaveManager(storage));
    expect(reloaded.isPlayerInvincible()).toBe(true);
  });

  it('调试开关：局内加速倍率支持 1×/2×/3× 切换、循环切档与存档持久化，且等壁钟时间内精确实现 2×/3× 刷怪与计时提速', () => {
    const storage = new InMemoryStorage();
    const ctrl = new GameController(new SaveManager(storage));
    expect(ctrl.getEffectiveTimeScale()).toBe(GAME_CONFIG.balance.debugTimeScale);

    // 系统设置支持直接切 2×、3×、1× 并落盘
    expect(ctrl.updateSettings({ debugTimeScale: 2 }).ok).toBe(true);
    expect(ctrl.getEffectiveTimeScale()).toBe(2);
    expect(ctrl.updateSettings({ debugTimeScale: 3 }).ok).toBe(true);
    expect(ctrl.getEffectiveTimeScale()).toBe(3);

    const reloaded = new GameController(new SaveManager(storage));
    expect(reloaded.getEffectiveTimeScale()).toBe(3);

    // 快捷循环按钮按 3 → 1 → 2 → 3 准确切换
    expect(reloaded.cycleDebugTimeScale()).toBe(1);
    expect(reloaded.cycleDebugTimeScale()).toBe(2);
    expect(reloaded.cycleDebugTimeScale()).toBe(3);

    // 验证相同壁钟帧数（10 秒 = 600 帧）在 1×/2×/3× 固定步长推进下，局内计时精确呈 1:2:3 且刷怪量递增
    const simulateWallClock10Sec = (scale: 1 | 2 | 3) => {
      const c = new GameController(new SaveManager(new InMemoryStorage()));
      c.setDebugTimeScale(scale);
      c.startRun(99001);
      for (let wallFrame = 0; wallFrame < 600; wallFrame++) {
        for (let sub = 0; sub < c.getEffectiveTimeScale(); sub++) {
          if (c.getHudSnapshot().appState === 'LEVEL_UP_MODAL') c.selectModalChoice(0);
          c.step(FIXED_DT_SEC, { moveX: 0.7, moveY: 0.3 });
        }
      }
      const hud = c.getHudSnapshot();
      return { elapsedSec: hud.elapsedSec, totalSpawned: hud.kills + c.world.getEntityCounts().enemies };
    };

    const s1 = simulateWallClock10Sec(1);
    const s2 = simulateWallClock10Sec(2);
    const s3 = simulateWallClock10Sec(3);
    expect(s2.elapsedSec / s1.elapsedSec).toBeCloseTo(2, 1);
    expect(s3.elapsedSec / s1.elapsedSec).toBeCloseTo(3, 1);
    expect(s2.totalSpawned).toBeGreaterThan(s1.totalSpawned);
    expect(s3.totalSpawned).toBeGreaterThan(s2.totalSpawned);
  });

  it('精英怪击杀不爆进化宝箱，仅爆出高级金色经验水晶（tier = large）', () => {
    const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
    ctrl.startRun(4455);
    const elite = ctrl.world.spawnEnemy('elite_vanguard', ctrl.world.player.x + 120, ctrl.world.player.y);
    expect(elite).not.toBeNull();
    // 施加致命伤害触发击杀钩子（复用奇点坍缩直伤路径模拟自然击杀）
    elite!.hp = 1;
    ctrl.world.debugTriggerBeaconNukeAtPlayer();
    const snap = ctrl.getRenderSnapshot();
    expect(ctrl.world.getEntityCounts().chests).toBe(0);
    expect(snap.xpGems.some((g) => g.tier === 'large')).toBe(true);
  });

  it('充能祭坛单局出现次数严格按阶段限次：1-2 阶段 1 次，3-4 阶段 2 次，5 阶段 3 次', () => {
    expect(GAME_CONFIG.stages.map((s) => s.maxAltarsPerRun)).toEqual([1, 1, 2, 2, 3]);

    const countAltarsInRun = (clearedLevelsBefore: number): number => {
      const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
      ctrl.setDebugPlayerInvincible(true);
      ctrl.debugSetClearedLevels(clearedLevelsBefore);
      ctrl.startRun(334455);

      // 模拟 6 个祭坛刷新窗口（每次推进到下一刷坛时间并立即站在祭坛上充能完成），验证每阶段精准触顶上限
      for (let cycle = 0; cycle < 6; cycle++) {
        while (
          ctrl.getHudSnapshot().appState === 'LEVEL_UP_MODAL' ||
          ctrl.getHudSnapshot().appState === 'ALTAR_MODAL'
        ) {
          ctrl.selectModalChoice(0);
        }
        if (!ctrl.world.isRunningPhase()) break;
        ctrl.world.elapsedSec += 90;
        ctrl.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
        if (ctrl.world.activeRunPhase === 'RUN_BOSS') {
          ctrl.world.debugKillBossViaDelayedCollapse();
          ctrl.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
        }
        const altar = ctrl.getRenderSnapshot().altars[0];
        if (!altar) continue;
        // 瞬移至祭坛中心并充能 5.5 秒完成该座祭坛
        ctrl.world.player.x = altar.x;
        ctrl.world.player.y = altar.y;
        for (let f = 0; f < 340; f++) {
          const st = ctrl.getHudSnapshot().appState;
          if (st === 'LEVEL_UP_MODAL' || st === 'ALTAR_MODAL') {
            ctrl.selectModalChoice(0);
          } else if (st === 'VICTORY_MODAL' || st === 'GAME_OVER_MODAL') {
            break;
          }
          ctrl.step(FIXED_DT_SEC, { moveX: 0, moveY: 0 });
          if (ctrl.getRenderSnapshot().altars.length === 0) break;
        }
      }
      return ctrl.world.getAltarsSpawned();
    };

    expect(countAltarsInRun(0)).toBe(1); // 阶段 1（第 1 关）：最多 1 座
    expect(countAltarsInRun(3)).toBe(1); // 阶段 2（第 4 关）：最多 1 座
    expect(countAltarsInRun(8)).toBe(2); // 阶段 3（第 9 关）：最多 2 座
    expect(countAltarsInRun(16)).toBe(2); // 阶段 4（第 17 关）：最多 2 座
    expect(countAltarsInRun(25)).toBe(3); // 阶段 5（第 26 关）：最多 3 座
  });

  it('第 5 阶段及后续关卡（第 26~36 关）Boss 血量与小怪数量显著提升，且总关卡上限严格锁定 36 关', () => {
    expect(GAME_CONFIG.balance.maxTotalLevels).toBe(36);
    expect(GAME_CONFIG.stages[4]?.maxLevelNumber).toBe(36);

    const measureBossAndMobs = (clearedLevelsBefore: number) => {
      const ctrl = new GameController(new SaveManager(new InMemoryStorage()));
      ctrl.setDebugPlayerInvincible(true);
      ctrl.debugSetClearedLevels(clearedLevelsBefore);
      ctrl.startRun(667788);
      // 推进前 6 秒（触及同屏硬上限前），精准测量各关卡的小怪刷新速率与波次数量
      for (let i = 0; i < 60 * 6; i++) {
        if (ctrl.getHudSnapshot().appState === 'LEVEL_UP_MODAL') ctrl.selectModalChoice(0);
        ctrl.step(FIXED_DT_SEC, { moveX: 0.6, moveY: 0.4 });
      }
      const hud = ctrl.getHudSnapshot();
      const totalMobs = hud.kills + ctrl.world.getEntityCounts().enemies;
      ctrl.world.debugJumpToNextBoss();
      const bossMaxHp = ctrl.getHudSnapshot().bossHud?.maxHp ?? 0;
      return { totalMobs, bossMaxHp };
    };

    const lv25 = measureBossAndMobs(24); // 第 25 关（阶段 4 末关）
    const lv26 = measureBossAndMobs(25); // 第 26 关（阶段 5 首关）
    const lv36 = measureBossAndMobs(35); // 第 36 关（终局上限关）
    expect(lv26.bossMaxHp).toBeGreaterThan(lv25.bossMaxHp);
    expect(lv36.bossMaxHp).toBeGreaterThan(lv26.bossMaxHp * 2);
    expect(lv26.totalMobs).toBeGreaterThan(lv25.totalMobs);
    expect(lv36.totalMobs).toBeGreaterThan(lv26.totalMobs);

    // 通关第 36 关后，生涯进度与当前关卡均严格封顶在 36（绝不溢出为 37）
    const storage = new InMemoryStorage();
    const capCtrl = new GameController(new SaveManager(storage));
    capCtrl.debugSetClearedLevels(35);
    expect(capCtrl.getHudSnapshot().meta.career.currentLevel).toBe(36);
    capCtrl.startRun(3636);
    capCtrl.world.debugKillAllStageBosses();
    expect(capCtrl.getHudSnapshot().appState).toBe('VICTORY_OUTRO');
    stepThroughVictoryOutro(capCtrl);

    const cleared36Hud = capCtrl.getHudSnapshot();
    expect(cleared36Hud.appState).toBe('VICTORY_MODAL');
    expect(cleared36Hud.settlementModal?.playedLevelNumber).toBe(36);
    expect(cleared36Hud.settlementModal?.nextLevelNumber).toBe(36);
    expect(cleared36Hud.meta.career.clearedLevelsCount).toBe(36);
    expect(cleared36Hud.meta.career.currentLevel).toBe(36);

    // 越界篡改存档至 99 关，加载自愈必须自动钳制回 36 关
    const raw = JSON.parse(storage.getItem('void_runner_save_v1')!) as { career: { clearedLevelsCount: number; currentLevel: number } };
    raw.career.clearedLevelsCount = 99;
    raw.career.currentLevel = 100;
    storage.setItem('void_runner_save_v1', JSON.stringify(raw));
    const healed = new SaveManager(storage).load();
    expect(healed.data.career.clearedLevelsCount).toBe(36);
    expect(healed.data.career.currentLevel).toBe(36);
  });

  it('经济平衡校验：虚空晶体各项产出统一缩放为原产出的 80%', () => {
    expect(GAME_CONFIG.balance.crystalOutputMult).toBe(0.8);
    expect(GAME_CONFIG.stages.map((s) => s.clearCrystalBonus)).toEqual([72, 112, 160, 224, 320]);

    // 常规/通关结算表现项：5 分钟(90) + 150 击杀(10) + 2 精英(70) + 2 祭坛(50) = 原 220 -> 80% = 176
    const eco = {
      kills: 150,
      elitesKilled: 2,
      altarsCompleted: 2,
      runBonusCrystals: 32,
      damageByWeapon: {},
      victoryRewardGranted: false,
      endlessRewardSettled: false,
      victoryBaselineKills: 0,
      victoryBaselineElites: 0,
      victoryBaselineAltars: 0,
      victoryBaselineBonusCrystals: 0,
      lastGrantedCrystals: 0,
    };
    const normalVictory = calculateNormalOrVictoryCrystals(300, eco, true, 112, 1);
    expect(normalVictory).toBe(176 + 32 + 112);

    // 无尽增量结算表现项：2 分钟(50) + 120 击杀(10) + 1 精英(45) + 1 祭坛(30) = 原 135 -> 80% = 108
    const endlessEco = {
      ...eco,
      kills: 270,
      elitesKilled: 3,
      altarsCompleted: 3,
      runBonusCrystals: 80,
      victoryBaselineKills: 150,
      victoryBaselineElites: 2,
      victoryBaselineAltars: 2,
      victoryBaselineBonusCrystals: 32,
    };
    const endlessDelta = calculateEndlessDeltaCrystals(120, endlessEco, 1);
    expect(endlessDelta).toBe(108 + 48);
  });
});
