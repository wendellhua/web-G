import { describe, expect, it } from 'vitest';
import { GameConfigBundleSchema } from '../../schemas';
import {
  ENEMY_BY_ID,
  GAME_CONFIG,
  WEAPON_BY_ID,
  resolveStageByClearedCount,
  resolveStageByLevelNumber,
} from '../../src/config/gameConfig';
import { clampWeaponCooldownMs, computeEndlessMultipliers } from '../../src/core/engine/MathUtils';

describe('V2.0 GAME_CONFIG 五大阶段/五形态静态配置表与 Zod 强校验', () => {
  it('全量配置表必须 100% 通过 GameConfigBundleSchema（含五阶段严格绑定校验）', () => {
    const res = GameConfigBundleSchema.safeParse(GAME_CONFIG);
    expect(res.success).toBe(true);
    expect(GAME_CONFIG.stages.map((s) => s.durationLimitSec)).toEqual([180, 300, 420, 540, 540]);
    expect(GAME_CONFIG.stages.map((s) => s.bossSpawnTimesSec.length)).toEqual([1, 2, 3, 4, 5]);
    expect(GAME_CONFIG.stages.map((s) => s.bossSpawnTimesSec)).toEqual([
      [120],
      [120, 180],
      [120, 180, 240],
      [120, 180, 240, 300],
      [120, 180, 240, 300, 360],
    ]);
    expect(GAME_CONFIG.stages.map((s) => s.bossSequence)).toEqual([
      ['boss_void_weaver'],
      ['boss_void_weaver', 'boss_pulsar_bastion'],
      ['boss_void_weaver', 'boss_pulsar_bastion', 'boss_phase_hydra'],
      ['boss_void_weaver', 'boss_pulsar_bastion', 'boss_phase_hydra', 'boss_solar_leviathan'],
      [
        'boss_void_weaver',
        'boss_pulsar_bastion',
        'boss_phase_hydra',
        'boss_solar_leviathan',
        'boss_void_empress',
      ],
    ]);
    expect(GAME_CONFIG.forms.map((f) => f.requiredTotalClears)).toEqual([0, 3, 8, 16, 25]);
    expect(GAME_CONFIG.forms.map((f) => `${f.maxActiveSlots}+${f.maxPassiveSlots}`)).toEqual([
      '2+1',
      '2+2',
      '3+2',
      '3+3',
      '4+4',
    ]);
    expect(GAME_CONFIG.forms.map((f) => f.starterWeaponLevel)).toEqual([1, 2, 3, 4, 5]);
    expect(GAME_CONFIG.forms.map((f) => f.baseAttackBonusRatio)).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
  });

  it('关卡号与累计通关数映射至五大阶段边界 100% 精准', () => {
    expect(resolveStageByClearedCount(0).id).toBe('stage_1');
    expect(resolveStageByClearedCount(2).id).toBe('stage_1');
    expect(resolveStageByClearedCount(3).id).toBe('stage_2');
    expect(resolveStageByClearedCount(7).id).toBe('stage_2');
    expect(resolveStageByClearedCount(8).id).toBe('stage_3');
    expect(resolveStageByClearedCount(15).id).toBe('stage_3');
    expect(resolveStageByClearedCount(16).id).toBe('stage_4');
    expect(resolveStageByClearedCount(24).id).toBe('stage_4');
    expect(resolveStageByClearedCount(25).id).toBe('stage_5');
    expect(resolveStageByLevelNumber(1).id).toBe('stage_1');
    expect(resolveStageByLevelNumber(4).id).toBe('stage_2');
    expect(resolveStageByLevelNumber(9).id).toBe('stage_3');
    expect(resolveStageByLevelNumber(17).id).toBe('stage_4');
    expect(resolveStageByLevelNumber(26).id).toBe('stage_5');
  });

  it('必须严格锚定阶段 2 灰盒实测手感基线参数与移速红线', () => {
    expect(GAME_CONFIG.balance.basePlayerMoveSpeedPxPerSec).toBe(150);
    expect(GAME_CONFIG.balance.basePlayerPickupRadiusPx).toBe(100);
    expect(GAME_CONFIG.balance.baseKnockbackPxPerSec).toBe(195);
    expect(WEAPON_BY_ID.tracking_pulse.levels[0]?.cooldownMs).toBe(420);
    expect(ENEMY_BY_ID.swarm.baseMoveSpeedPxPerSec).toBe(92);
    expect(ENEMY_BY_ID.runner.baseMoveSpeedPxPerSec).toBeLessThan(
      GAME_CONFIG.balance.basePlayerMoveSpeedPxPerSec,
    );
  });

  it('当误配 runner 移速 >= 玩家初速或 Boss 间隔非法时，Zod 校验必须精准拦截失败', () => {
    const brokenSpeed = structuredClone(GAME_CONFIG);
    const runner = brokenSpeed.enemies.find((e) => e.id === 'runner');
    if (runner) runner.baseMoveSpeedPxPerSec = 160;
    expect(GameConfigBundleSchema.safeParse(brokenSpeed).success).toBe(false);

    const brokenStage = structuredClone(GAME_CONFIG);
    brokenStage.stages[0]!.durationLimitSec = 999;
    expect(GameConfigBundleSchema.safeParse(brokenStage).success).toBe(false);

    const brokenBossInterval = structuredClone(GAME_CONFIG);
    brokenBossInterval.stages[1]!.bossSpawnTimesSec = [120, 240];
    expect(GameConfigBundleSchema.safeParse(brokenBossInterval).success).toBe(false);

    const brokenBossSeq = structuredClone(GAME_CONFIG);
    brokenBossSeq.stages[4]!.bossSequence = [
      'boss_void_weaver',
      'boss_void_weaver',
      'boss_void_weaver',
      'boss_void_weaver',
      'boss_void_weaver',
    ];
    expect(GameConfigBundleSchema.safeParse(brokenBossSeq).success).toBe(false);
  });

  it('数值护栏：冷却缩减钳制与无尽模式封顶防溢出', () => {
    expect(clampWeaponCooldownMs(420, 0.99, 120, 0.6)).toBe(168);
    expect(clampWeaponCooldownMs(200, 0.6, 120, 0.6)).toBe(120);

    const early = computeEndlessMultipliers(500, 540, 1000, 20, 1.55);
    expect(early).toEqual({ hpMult: 1, dmgMult: 1, speedMult: 1 });

    const extreme = computeEndlessMultipliers(540 + 60 * 500, 540, 1000, 20, 1.55);
    expect(extreme.hpMult).toBe(1000);
    expect(extreme.dmgMult).toBe(20);
    expect(extreme.speedMult).toBe(1.55);
  });
});
