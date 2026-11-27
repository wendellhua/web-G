import { describe, expect, it } from 'vitest';
import {
  applyRunSettlementToSave,
  buyTalent,
  computeMetaStatBonuses,
  resetAllTalents,
  resetCareerProgress,
} from '../../src/meta/MetaProgression';
import { createDefaultSaveData } from '../../src/storage/SaveManager';

describe('MetaProgression V2：五形态 3/8/16/25 自动进阶、免费洗点与重置生涯', () => {
  it('购买天赋扣费准确，免费一键洗点全额零损耗退还晶体', () => {
    let save = createDefaultSaveData();
    save.metaProgress.voidCrystals = 1000;

    save = buyTalent(save, 'warp_engine').nextSave;
    save = buyTalent(save, 'warp_engine').nextSave;
    save = buyTalent(save, 'fate_reroll').nextSave;

    expect(save.metaProgress.voidCrystals).toBe(640);
    expect(save.metaProgress.spentCrystals).toBe(360);

    const bonuses = computeMetaStatBonuses(save);
    expect(bonuses.moveSpeedRatio).toBeCloseTo(0.12, 6);
    expect(bonuses.extraRerolls).toBe(1);

    const resetRes = resetAllTalents(save);
    expect(resetRes.ok).toBe(true);
    expect(resetRes.nextSave.metaProgress.voidCrystals).toBe(1000);
    expect(resetRes.nextSave.metaProgress.spentCrystals).toBe(0);
    expect(resetRes.nextSave.metaProgress.talents.warp_engine).toBe(0);
  });

  it('累计通关精准达到 3 / 8 / 16 / 25 关时自动解锁对应形态并产出解锁公告', () => {
    let save = createDefaultSaveData();
    const unlockEvents: { clear: number; formId: string }[] = [];

    for (let clear = 1; clear <= 26; clear++) {
      const res = applyRunSettlementToSave(save, {
        grantedCrystals: 100,
        isVictorySettlement: true,
        isRunFinalEnd: true,
        survivedSec: 150,
        endlessSec: 0,
        totalRunKills: 120,
        deltaKillsToAdd: 120,
        newlyDiscoveredEvolutions: [],
      });
      save = res.nextSave;
      if (res.newlyUnlockedForm) {
        unlockEvents.push({ clear, formId: res.newlyUnlockedForm.id });
      }
    }

    expect(unlockEvents).toEqual([
      { clear: 3, formId: 'form_2_pulse' },
      { clear: 8, formId: 'form_3_phase' },
      { clear: 16, formId: 'form_4_astral' },
      { clear: 25, formId: 'form_5_void_apex' },
    ]);
    expect(save.career.currentLevel).toBe(27);
    expect(save.career.unlockedFormId).toBe('form_5_void_apex');
  });

  it('完整重置生涯将关卡进度、角色形态、天赋与晶体全部清空回第 1 关新玩家态', () => {
    let save = createDefaultSaveData();
    save.metaProgress.voidCrystals = 999;
    save = buyTalent(save, 'void_hull').nextSave;
    save.career.clearedLevelsCount = 16;
    save.career.currentLevel = 17;
    save.career.currentStageId = 'stage_4';
    save.career.unlockedFormId = 'form_4_astral';
    save.settings.disableScreenShake = true;

    const reset = resetCareerProgress(save);
    expect(reset.ok).toBe(true);
    expect(reset.nextSave.career.currentLevel).toBe(1);
    expect(reset.nextSave.career.clearedLevelsCount).toBe(0);
    expect(reset.nextSave.career.unlockedFormId).toBe('form_1_initiate');
    expect(reset.nextSave.metaProgress.voidCrystals).toBe(0);
    expect(reset.nextSave.metaProgress.spentCrystals).toBe(0);
    expect(reset.nextSave.metaProgress.talents.void_hull).toBe(0);
    // 保留护眼/音量偏好设置
    expect(reset.nextSave.settings.disableScreenShake).toBe(true);
  });
});
