/**
 * 本地持久化与版本迁移管理器（V2.0 升级：SaveDataV2 + V1→V2 无损迁移 + 完整重置生涯）
 * - 纯浏览器缓存（localStorage）+ 异常降级 memory_fallback，绝不白屏；
 * - 严禁在 60FPS 主循环内调用 persist()，仅在低频安全节点落盘。
 */
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
  SaveDataV2Schema,
  TALENT_IDS,
  createEmptyTalentRecord,
  type SaveDataV2,
  type SaveLoadResult,
  type StorageHealthStatus,
} from '../../schemas';
import { GAME_CONFIG, resolveStageByClearedCount, TALENT_BY_ID } from '../config/gameConfig';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

class BrowserLocalStorageAdapter implements StorageAdapter {
  public getItem(key: string): string | null {
    if (typeof globalThis.localStorage === 'undefined') {
      throw new Error('localStorage unavailable in current runtime');
    }
    return globalThis.localStorage.getItem(key);
  }

  public setItem(key: string, value: string): void {
    if (typeof globalThis.localStorage === 'undefined') {
      throw new Error('localStorage unavailable in current runtime');
    }
    globalThis.localStorage.setItem(key, value);
  }
}

export function createDefaultSaveData(nowMs: number = Date.now()): SaveDataV2 {
  return {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    updatedAtMs: Math.max(0, Math.floor(nowMs)),
    career: {
      currentLevel: 1,
      clearedLevelsCount: 0,
      currentStageId: 'stage_1',
      unlockedFormId: 'form_1_initiate',
    },
    metaProgress: {
      voidCrystals: 0,
      spentCrystals: 0,
      talents: createEmptyTalentRecord(),
    },
    unlocks: {
      discoveredEvolutions: [],
    },
    runRecords: {
      totalRuns: 0,
      totalVictories: 0,
      totalKills: 0,
      bestSurvivalSec: 0,
      bestEndlessSec: 0,
      bestSingleRunKills: 0,
    },
    settings: {
      masterVolumeRatio: 0.8,
      bgmVolumeRatio: 0.45,
      sfxVolumeRatio: 0.85,
      isMuted: false,
      disableScreenShake: false,
      disableDamageText: false,
      lowParticleMode: false,
      debugPlayerInvincible: false,
      debugTimeScale: 1,
    },
  };
}

/**
 * 存档迁移与自愈管线（支持 V1 → V2 无损升级）：
 * 1. 自动把旧版 schemaVersion === 1 存档迁移至 SaveDataV2（保留晶体、天赋、图鉴、战绩、设置并初始化生涯进度）；
 * 2. 根据 clearedLevelsCount 强制同步 currentLevel / currentStageId / unlockedFormId，防止存档篡改错位；
 * 3. 天赋超上限自动钳制并精准退还多余晶体。
 */
export function migrateAndHealSave(raw: unknown, nowMs: number = Date.now()): SaveDataV2 | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = structuredClone(raw) as Record<string, unknown>;
  const version = candidate['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return null;
  }
  if (version > CURRENT_SAVE_SCHEMA_VERSION) {
    return null;
  }

  // V1 -> V2 无损迁移
  const maxLevels = GAME_CONFIG.balance.maxTotalLevels;
  if (version === 1) {
    const oldRecords = (candidate['runRecords'] as Record<string, unknown> | undefined) ?? {};
    const oldVictories =
      typeof oldRecords['totalVictories'] === 'number' && Number.isInteger(oldRecords['totalVictories'])
        ? Math.min(maxLevels, Math.max(0, oldRecords['totalVictories']))
        : 0;
    const stage = resolveStageByClearedCount(oldVictories);
    const oldUnlocks = (candidate['unlocks'] as Record<string, unknown> | undefined) ?? {};
    candidate['schemaVersion'] = 2;
    candidate['career'] = {
      currentLevel: Math.min(maxLevels, oldVictories + 1),
      clearedLevelsCount: oldVictories,
      currentStageId: stage.id,
      unlockedFormId: stage.formId,
    };
    candidate['unlocks'] = {
      discoveredEvolutions: Array.isArray(oldUnlocks['discoveredEvolutions'])
        ? oldUnlocks['discoveredEvolutions']
        : [],
    };
  }

  const parsed = SaveDataV2Schema.safeParse(candidate);
  if (!parsed.success) return null;

  // 按累计通关数严格同步所属阶段与角色形态（不可逆一致性守卫，并钳制在总关卡上限内）
  const cleared = Math.min(maxLevels, parsed.data.career.clearedLevelsCount);
  const syncedStage = resolveStageByClearedCount(cleared);

  const healed: SaveDataV2 = {
    ...parsed.data,
    updatedAtMs: Math.max(0, Math.floor(parsed.data.updatedAtMs || nowMs)),
    career: {
      clearedLevelsCount: cleared,
      currentLevel: Math.min(maxLevels, Math.max(1, cleared + 1)),
      currentStageId: syncedStage.id,
      unlockedFormId: syncedStage.formId,
    },
    metaProgress: {
      ...parsed.data.metaProgress,
      talents: { ...parsed.data.metaProgress.talents },
    },
    unlocks: {
      discoveredEvolutions: Array.from(new Set(parsed.data.unlocks.discoveredEvolutions)),
    },
    runRecords: { ...parsed.data.runRecords },
    settings: { ...parsed.data.settings },
  };

  let expectedSpent = 0;
  for (const talentId of TALENT_IDS) {
    const cfg = TALENT_BY_ID[talentId];
    const currentLevel = healed.metaProgress.talents[talentId];
    const clampedLevel = Math.min(currentLevel, cfg.maxLevel);
    healed.metaProgress.talents[talentId] = clampedLevel;
    for (let lv = 0; lv < clampedLevel; lv++) {
      expectedSpent += cfg.costsByLevel[lv] ?? 0;
    }
  }
  if (healed.metaProgress.spentCrystals > expectedSpent) {
    const refund = healed.metaProgress.spentCrystals - expectedSpent;
    healed.metaProgress.voidCrystals += refund;
    healed.metaProgress.spentCrystals = expectedSpent;
  } else if (healed.metaProgress.spentCrystals < expectedSpent) {
    healed.metaProgress.spentCrystals = expectedSpent;
  }

  return healed;
}

export class SaveManager {
  private readonly adapter: StorageAdapter;
  private memoryCopy: SaveDataV2;
  private status: StorageHealthStatus = 'ok';
  private warningMessage: string | null = null;

  constructor(adapter: StorageAdapter = new BrowserLocalStorageAdapter()) {
    this.adapter = adapter;
    this.memoryCopy = createDefaultSaveData();
  }

  public load(nowMs: number = Date.now()): SaveLoadResult {
    let rawString: string | null = null;
    try {
      rawString = this.adapter.getItem(SAVE_STORAGE_KEY);
    } catch {
      this.memoryCopy = createDefaultSaveData(nowMs);
      this.status = 'memory_fallback';
      this.warningMessage = '当前浏览器限制本地存储（如无痕模式），进度将仅在本次会话内存中保留。';
      return this.getSnapshot();
    }

    if (rawString === null) {
      this.memoryCopy = createDefaultSaveData(nowMs);
      this.status = 'ok';
      this.warningMessage = null;
      return this.getSnapshot();
    }

    try {
      const parsedJson: unknown = JSON.parse(rawString);
      const migrated = migrateAndHealSave(parsedJson, nowMs);
      if (!migrated) {
        this.memoryCopy = createDefaultSaveData(nowMs);
        this.status = 'corrupted_reset';
        this.warningMessage = '检测到旧存档数据损坏或不兼容，已自动安全重置为默认存档。';
        this.persist(this.memoryCopy, nowMs);
        return this.getSnapshot();
      }
      this.memoryCopy = migrated;
      this.status = 'ok';
      this.warningMessage = null;
      return this.getSnapshot();
    } catch {
      this.memoryCopy = createDefaultSaveData(nowMs);
      this.status = 'corrupted_reset';
      this.warningMessage = '本地存档格式异常，已安全恢复为初始存档以防止启动失败。';
      this.persist(this.memoryCopy, nowMs);
      return this.getSnapshot();
    }
  }

  public persist(data: SaveDataV2, nowMs: number = Date.now()): boolean {
    const nextData: SaveDataV2 = {
      ...data,
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      updatedAtMs: Math.max(0, Math.floor(nowMs)),
    };
    this.memoryCopy = nextData;
    try {
      this.adapter.setItem(SAVE_STORAGE_KEY, JSON.stringify(nextData));
      if (this.status === 'memory_fallback') {
        this.status = 'ok';
        this.warningMessage = null;
      }
      return true;
    } catch {
      this.status = 'memory_fallback';
      this.warningMessage = '无法写入本地存储（隐私模式或空间已满），本次进度暂存于内存中。';
      return false;
    }
  }

  public getSnapshot(): SaveLoadResult {
    return {
      data: structuredClone(this.memoryCopy),
      status: this.status,
      warningMessage: this.warningMessage,
    };
  }
}
