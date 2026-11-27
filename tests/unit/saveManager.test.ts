import { describe, expect, it } from 'vitest';
import { SAVE_STORAGE_KEY } from '../../schemas';
import {
  SaveManager,
  createDefaultSaveData,
  type StorageAdapter,
} from '../../src/storage/SaveManager';

class MemoryStorageMock implements StorageAdapter {
  public store = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class ThrowingStorageMock implements StorageAdapter {
  public getItem(): string | null {
    throw new Error('SecurityError: storage disabled in incognito');
  }
  public setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

describe('SaveManager V2 本地存档、V1→V2 无损迁移与无痕降级', () => {
  it('正常读写往返完全一致（含生涯关卡与形态进度）', () => {
    const mock = new MemoryStorageMock();
    const mgr = new SaveManager(mock);
    const save = createDefaultSaveData(1_700_000_000_000);
    save.career.clearedLevelsCount = 8;
    save.career.currentLevel = 9;
    save.career.currentStageId = 'stage_3';
    save.career.unlockedFormId = 'form_3_phase';
    save.metaProgress.voidCrystals = 420;
    save.metaProgress.talents.warp_engine = 2;
    save.metaProgress.spentCrystals = 240;

    expect(mgr.persist(save, 1_700_000_001_000)).toBe(true);

    const mgr2 = new SaveManager(mock);
    const loaded = mgr2.load(1_700_000_002_000);
    expect(loaded.status).toBe('ok');
    expect(loaded.data.career.currentLevel).toBe(9);
    expect(loaded.data.career.unlockedFormId).toBe('form_3_phase');
    expect(loaded.data.metaProgress.voidCrystals).toBe(420);
    expect(loaded.data.metaProgress.talents.warp_engine).toBe(2);
  });

  it('旧版 V1 存档（含缺键天赋与历史通关数）自动无损迁移至 V2 并补全默认键', () => {
    const mock = new MemoryStorageMock();
    mock.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        updatedAtMs: 12345,
        metaProgress: {
          voidCrystals: 300,
          spentCrystals: 60,
          talents: { void_hull: 1 },
        },
        unlocks: {
          unlockedCharacters: ['v01_ranger', 'v02_shadow'],
          selectedCharacterId: 'v02_shadow',
          discoveredEvolutions: ['evo_star_cluster'],
        },
        runRecords: { totalVictories: 3 },
        settings: {},
      }),
    );

    const mgr = new SaveManager(mock);
    const loaded = mgr.load();
    expect(loaded.status).toBe('ok');
    expect(loaded.data.schemaVersion).toBe(2);
    expect(loaded.data.career.clearedLevelsCount).toBe(3);
    expect(loaded.data.career.currentLevel).toBe(4);
    expect(loaded.data.career.currentStageId).toBe('stage_2');
    expect(loaded.data.career.unlockedFormId).toBe('form_2_pulse');
    expect(loaded.data.metaProgress.talents.void_hull).toBe(1);
    expect(loaded.data.metaProgress.talents.fate_reroll).toBe(0);
    expect(loaded.data.unlocks.discoveredEvolutions).toEqual(['evo_star_cluster']);
  });

  it('天赋超上限存档自愈：自动钳制并精确退还多余虚空晶体', () => {
    const mock = new MemoryStorageMock();
    const raw = createDefaultSaveData();
    raw.metaProgress.talents.fate_reroll = 5;
    raw.metaProgress.spentCrystals = 1500;
    raw.metaProgress.voidCrystals = 50;
    mock.setItem(SAVE_STORAGE_KEY, JSON.stringify(raw));

    const mgr = new SaveManager(mock);
    const loaded = mgr.load();
    expect(loaded.status).toBe('ok');
    expect(loaded.data.metaProgress.talents.fate_reroll).toBe(3);
    expect(loaded.data.metaProgress.spentCrystals).toBe(920);
    expect(loaded.data.metaProgress.voidCrystals).toBe(50 + (1500 - 920));
  });

  it('JSON 损坏时安全重置为默认存档，绝不崩溃白屏', () => {
    const mock = new MemoryStorageMock();
    mock.setItem(SAVE_STORAGE_KEY, '{corrupted_json!!!');

    const mgr = new SaveManager(mock);
    const loaded = mgr.load();
    expect(loaded.status).toBe('corrupted_reset');
    expect(loaded.data.career.currentLevel).toBe(1);
    expect(loaded.data.career.unlockedFormId).toBe('form_1_initiate');
  });

  it('无痕模式或禁用存储时优雅降级为 memory_fallback，绝不抛异常', () => {
    const mgr = new SaveManager(new ThrowingStorageMock());
    const loaded = mgr.load();
    expect(loaded.status).toBe('memory_fallback');
    expect(loaded.warningMessage).toBeTruthy();

    const ok = mgr.persist(loaded.data);
    expect(ok).toBe(false);
    expect(mgr.getSnapshot().status).toBe('memory_fallback');
  });
});
