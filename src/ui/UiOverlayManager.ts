/**
 * 轻量化 DOM/CSS HUD 与全流程界面管理器（V2.0 五大阶段生涯版）
 * - 脏标记按需刷新（Dirty-Flag Sync），只读消费 HudSnapshot，经由 GameController 派发指令；
 * - 完整支持：当前关卡/阶段与五形态进阶路线、动态 2+1→4+4 锁态槽位、Boss 进度与超时警示、
 *   跨阶段形态解锁公告、带二次确认的完整重置生涯。
 */
import type { DebugTimeScale, GameSettings, TalentId } from '../../schemas';
import {
  EVOLUTION_ICON_URL_BY_ID,
  FORM_SPRITE_URL_BY_TIER,
  ILLUSTRATION_URLS,
  PASSIVE_ICON_URL_BY_ID,
  TALENT_ICON_URL_BY_ID,
  WEAPON_ICON_URL_BY_ID,
} from '../assets/manifest';
import type { GameController } from '../controller/GameController';
import type { HudSnapshot, UpgradeCardChoice } from '../core/contracts/gameContracts';

function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = String(Math.floor(safe / 60)).padStart(2, '0');
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export class UiOverlayManager {
  private readonly controller: GameController;
  private readonly onSettingsChanged: (settings: GameSettings) => void;
  private readonly onRunRestarted: () => void;

  private readonly hudEl: HTMLElement;
  private readonly modalEl: HTMLElement;

  // HUD 高频局部节点引用
  private readonly xpFillEl: HTMLElement;
  private readonly lvEl: HTMLElement;
  private readonly hpEl: HTMLElement;
  private readonly hpFillEl: HTMLElement;
  private readonly hpGhostEl: HTMLElement;
  private readonly stageBadgeEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly bossProgEl: HTMLElement;
  private readonly killsEl: HTMLElement;
  private readonly crystalsEl: HTMLElement;
  private readonly weaponSlotsEl: HTMLElement;
  private readonly passiveSlotsEl: HTMLElement;
  private readonly bossWrapEl: HTMLElement;
  private readonly bossNameEl: HTMLElement;
  private readonly bossPhaseEl: HTMLElement;
  private readonly bossFillEl: HTMLElement;
  private readonly timeScaleBtnEl: HTMLButtonElement;

  // 脏检查缓存签名
  private lastModalSignature = '';
  private lastSlotsSignature = '';
  private lastXpPct = -1;
  private lastLv = -1;
  private lastHpText = '';
  private lastHpPct = -1;
  private lastHpState = '';
  private lastStageBadge = '';
  private lastTimerText = '';
  private lastBossProgText = '';
  private lastKills = -1;
  private lastBonusCrystals = -1;
  private lastBossSignature = '';
  private lastTimeScale = -1;

  constructor(
    stageWrap: HTMLElement,
    controller: GameController,
    onSettingsChanged: (settings: GameSettings) => void,
    onRunRestarted: () => void,
  ) {
    this.controller = controller;
    this.onSettingsChanged = onSettingsChanged;
    this.onRunRestarted = onRunRestarted;

    this.hudEl = document.createElement('div');
    this.hudEl.id = 'inrun-hud';
    this.hudEl.innerHTML = `
      <div class="xp-track"><div class="xp-fill" data-testid="hud-xp-fill"></div></div>
      <div class="hud-top-row">
        <div class="hud-player-panel">
          <div class="hud-player-head">
            <span class="hud-player-meta">
              <span class="hud-stage-tag" data-testid="hud-stage-badge">第1关 · 阶段1</span>
              <span class="hud-divider"></span>
              <span class="hud-lv-chip">LV <strong data-testid="hud-level">1</strong></span>
            </span>
            <span class="hud-hp-readout">HP <strong data-testid="hud-hp">100/100</strong></span>
          </div>
          <div class="hud-hp-track">
            <div class="hud-hp-ghost" data-testid="hud-hp-ghost"></div>
            <div class="hud-hp-fill" data-testid="hud-hp-fill"></div>
            <div class="hud-hp-ticks"></div>
          </div>
        </div>
        <div class="hud-center-cluster">
          <div class="hud-pill hud-timer" data-testid="hud-timer">00:00 / 03:00</div>
          <div class="hud-pill hud-boss-pill">BOSS <strong data-testid="hud-boss-progress">0/1</strong></div>
        </div>
        <div class="hud-pill hud-ops-pill">
          <span>击杀 <strong data-testid="hud-kills">0</strong></span>
          <span class="hud-divider"></span>
          <span>晶体 <strong class="gold" data-testid="hud-crystals">0</strong></span>
          <button class="hud-pause-btn" data-testid="btn-hud-timescale" title="点击切换局内倍速（1× / 2× / 3×）">1×</button>
          <button class="hud-pause-btn" data-testid="btn-hud-pause">Esc 暂停</button>
        </div>
      </div>
      <div class="hud-slots-wrap">
        <div class="slot-row" data-testid="hud-weapon-slots"></div>
        <div class="slot-row" data-testid="hud-passive-slots"></div>
      </div>
      <div class="boss-bar-wrap" data-testid="hud-boss-bar">
        <div class="boss-bar-head">
          <span data-testid="hud-boss-name">虚空织主</span>
          <span data-testid="hud-boss-phase">PHASE 1</span>
        </div>
        <div class="boss-bar-track">
          <div class="boss-bar-fill" data-testid="hud-boss-fill" style="width:100%"></div>
          <div class="boss-tick" style="left:65%"></div>
          <div class="boss-tick" style="left:30%"></div>
        </div>
      </div>
      <div class="hud-footer-hint">WASD / 方向键走位 · 武器全自动释放 · 倒计时结束前肃清全部 Boss 即通关 · Esc 暂停速查</div>
    `;

    this.modalEl = document.createElement('div');
    this.modalEl.id = 'modal-layer';

    stageWrap.appendChild(this.hudEl);
    stageWrap.appendChild(this.modalEl);

    this.xpFillEl = this.hudEl.querySelector('[data-testid="hud-xp-fill"]') as HTMLElement;
    this.lvEl = this.hudEl.querySelector('[data-testid="hud-level"]') as HTMLElement;
    this.hpEl = this.hudEl.querySelector('[data-testid="hud-hp"]') as HTMLElement;
    this.hpFillEl = this.hudEl.querySelector('[data-testid="hud-hp-fill"]') as HTMLElement;
    this.hpGhostEl = this.hudEl.querySelector('[data-testid="hud-hp-ghost"]') as HTMLElement;
    this.stageBadgeEl = this.hudEl.querySelector('[data-testid="hud-stage-badge"]') as HTMLElement;
    this.timerEl = this.hudEl.querySelector('[data-testid="hud-timer"]') as HTMLElement;
    this.bossProgEl = this.hudEl.querySelector('[data-testid="hud-boss-progress"]') as HTMLElement;
    this.killsEl = this.hudEl.querySelector('[data-testid="hud-kills"]') as HTMLElement;
    this.crystalsEl = this.hudEl.querySelector('[data-testid="hud-crystals"]') as HTMLElement;
    this.weaponSlotsEl = this.hudEl.querySelector('[data-testid="hud-weapon-slots"]') as HTMLElement;
    this.passiveSlotsEl = this.hudEl.querySelector('[data-testid="hud-passive-slots"]') as HTMLElement;
    this.bossWrapEl = this.hudEl.querySelector('[data-testid="hud-boss-bar"]') as HTMLElement;
    this.bossNameEl = this.hudEl.querySelector('[data-testid="hud-boss-name"]') as HTMLElement;
    this.bossPhaseEl = this.hudEl.querySelector('[data-testid="hud-boss-phase"]') as HTMLElement;
    this.bossFillEl = this.hudEl.querySelector('[data-testid="hud-boss-fill"]') as HTMLElement;
    this.timeScaleBtnEl = this.hudEl.querySelector('[data-testid="btn-hud-timescale"]') as HTMLButtonElement;

    this.timeScaleBtnEl.addEventListener('click', () => {
      this.controller.cycleDebugTimeScale();
      this.onSettingsChanged(this.controller.getSettings());
      this.sync(this.controller.getHudSnapshot());
    });

    const pauseBtn = this.hudEl.querySelector('[data-testid="btn-hud-pause"]');
    pauseBtn?.addEventListener('click', () => {
      this.controller.pause('manual');
      this.sync(this.controller.getHudSnapshot());
    });
  }

  public sync(hud: HudSnapshot): void {
    const inRunVisible = hud.appState !== 'TITLE' && hud.appState !== 'BOOT';
    this.hudEl.classList.toggle('visible', inRunVisible);

    if (inRunVisible) {
      this.syncCombatHud(hud);
    }

    const modalVisible =
      hud.appState !== 'RUN_NORMAL' &&
      hud.appState !== 'RUN_BOSS' &&
      hud.appState !== 'RUN_ENDLESS';

    this.modalEl.classList.toggle('visible', modalVisible);
    const isTitle = hud.appState === 'TITLE';
    const isMainMenu = isTitle && hud.titleSubView === 'MAIN_MENU';
    this.modalEl.classList.toggle('title-backdrop', isTitle);
    this.modalEl.style.backgroundImage = isMainMenu
      ? `linear-gradient(96deg, rgba(3, 6, 16, 0.92) 0%, rgba(5, 10, 24, 0.78) 40%, rgba(4, 8, 18, 0.2) 70%, rgba(3, 6, 14, 0.5) 100%), linear-gradient(180deg, rgba(3, 6, 14, 0.48) 0%, transparent 22%, transparent 74%, rgba(3, 6, 14, 0.84) 100%), url('${ILLUSTRATION_URLS.titleKeyArt}')`
      : isTitle
        ? `radial-gradient(circle at 50% 42%, rgba(5, 10, 22, 0.72) 0%, rgba(3, 6, 14, 0.94) 80%), url('${ILLUSTRATION_URLS.titleKeyArt}')`
        : '';

    if (!modalVisible) {
      this.lastModalSignature = '';
      return;
    }

    const sig = this.computeModalSignature(hud);
    if (sig !== this.lastModalSignature) {
      this.lastModalSignature = sig;
      this.renderModalContent(hud);
    }
  }

  private syncCombatHud(hud: HudSnapshot): void {
    const xpPct = Math.min(100, Math.round((hud.xp / Math.max(1, hud.xpToNext)) * 100));
    if (xpPct !== this.lastXpPct) {
      this.lastXpPct = xpPct;
      this.xpFillEl.style.width = `${xpPct}%`;
    }
    if (hud.level !== this.lastLv) {
      this.lastLv = hud.level;
      this.lvEl.textContent = String(hud.level);
    }
    const isInvincible = this.controller.isPlayerInvincible();
    const hpText = isInvincible
      ? `${hud.hp}/${hud.maxHp} [无敌]`
      : `${hud.hp}/${hud.maxHp}`;
    if (hpText !== this.lastHpText) {
      this.lastHpText = hpText;
      this.hpEl.textContent = hpText;
    }
    const hpPct = Math.max(0, Math.min(100, Math.round((hud.hp / Math.max(1, hud.maxHp)) * 100)));
    const hpState = isInvincible ? 'invincible' : hpPct <= 30 ? 'low' : hpPct <= 60 ? 'mid' : 'high';
    if (hpPct !== this.lastHpPct) {
      this.lastHpPct = hpPct;
      this.hpFillEl.style.width = `${hpPct}%`;
      this.hpGhostEl.style.width = `${hpPct}%`;
    }
    if (hpState !== this.lastHpState) {
      this.lastHpState = hpState;
      this.hpFillEl.className = hpState === 'high' ? 'hud-hp-fill' : `hud-hp-fill ${hpState}`;
    }
    const stageBadge = `第${hud.currentLevel}关 · 阶段${hud.stageNumber}`;
    if (stageBadge !== this.lastStageBadge) {
      this.lastStageBadge = stageBadge;
      this.stageBadgeEl.textContent = stageBadge;
    }

    const isEndless = hud.activeRunPhase === 'RUN_ENDLESS';
    const timeScale = this.controller.getEffectiveTimeScale();
    const baseTimerText = isEndless
      ? `无尽 +${formatClock(hud.endlessElapsedSec)}`
      : `${formatClock(Math.min(hud.elapsedSec, hud.durationLimitSec))} / ${formatClock(hud.durationLimitSec)}`;
    const timerText = timeScale > 1 ? `${baseTimerText} [${timeScale}×]` : baseTimerText;
    if (timerText !== this.lastTimerText || this.timerEl.classList.contains('timeout-warn') !== hud.isNearTimeout) {
      this.lastTimerText = timerText;
      this.timerEl.textContent = timerText;
      this.timerEl.classList.toggle('endless', isEndless);
      this.timerEl.classList.toggle('timeout-warn', hud.isNearTimeout);
    }

    if (timeScale !== this.lastTimeScale) {
      this.lastTimeScale = timeScale;
      this.timeScaleBtnEl.textContent = `${timeScale}×`;
      this.timeScaleBtnEl.classList.toggle('boosted', timeScale > 1);
    }

    const bossProgText = `${hud.bossProgress.killed}/${hud.bossProgress.total}`;
    if (bossProgText !== this.lastBossProgText) {
      this.lastBossProgText = bossProgText;
      this.bossProgEl.textContent = bossProgText;
    }

    if (hud.kills !== this.lastKills) {
      this.lastKills = hud.kills;
      this.killsEl.textContent = String(hud.kills);
    }
    if (hud.runBonusCrystals !== this.lastBonusCrystals) {
      this.lastBonusCrystals = hud.runBonusCrystals;
      this.crystalsEl.textContent = String(hud.runBonusCrystals);
    }

    const slotsSig =
      `${hud.maxActiveSlots}+${hud.maxPassiveSlots}|` +
      hud.weaponSlots.map((w) => `${w.weaponId}:${w.level}:${w.isEvolved ? 1 : 0}:${w.canEvolveNow ? 1 : 0}`).join(',') +
      '#' +
      hud.passiveSlots.map((p) => `${p.passiveId}:${p.level}`).join(',');

    if (slotsSig !== this.lastSlotsSignature) {
      this.lastSlotsSignature = slotsSig;
      this.renderSlots(hud);
    }

    const bossSig = hud.bossHud
      ? `${hud.bossHud.name}:${hud.bossHud.hp}/${hud.bossHud.maxHp}:P${hud.bossHud.phase}`
      : 'none';
    if (bossSig !== this.lastBossSignature) {
      this.lastBossSignature = bossSig;
      if (hud.bossHud) {
        this.bossWrapEl.classList.add('visible');
        this.bossNameEl.textContent = hud.bossHud.name;
        this.bossPhaseEl.textContent = `PHASE ${hud.bossHud.phase} · ${hud.bossHud.hp}/${hud.bossHud.maxHp}`;
        this.bossFillEl.style.width = `${Math.max(0, (hud.bossHud.hp / Math.max(1, hud.bossHud.maxHp)) * 100)}%`;
      } else {
        this.bossWrapEl.classList.remove('visible');
      }
    }
  }

  private renderSlots(hud: HudSnapshot): void {
    let wHtml = '';
    for (let i = 0; i < 4; i++) {
      if (i >= hud.maxActiveSlots) {
        wHtml += `<div class="slot-box locked" data-testid="weapon-slot-locked-${i}"><div class="slot-meta"><span class="slot-name" style="color:#64748b">🔒 未解放</span><div class="slot-pips"><span style="font-size:9px;color:#64748b">高阶解锁</span></div></div></div>`;
        continue;
      }
      const w = hud.weaponSlots[i];
      if (!w) {
        wHtml += `<div class="slot-box"><div class="slot-meta"><span class="slot-name" style="color:#475569">空武器槽</span><div class="slot-pips"></div></div></div>`;
      } else {
        const cls = w.isEvolved ? 'slot-box evolved' : w.canEvolveNow ? 'slot-box filled evo-ready' : 'slot-box filled';
        const iconUrl =
          w.isEvolved && w.evolutionId
            ? EVOLUTION_ICON_URL_BY_ID[w.evolutionId]
            : WEAPON_ICON_URL_BY_ID[w.weaponId];
        const pips = w.isEvolved
          ? `<span class="slot-evo-tag">⚡ EVO MAX</span>`
          : Array.from({ length: 5 }, (_, idx) => `<span class="pip ${idx < w.level ? 'on' : ''}"></span>`).join('');
        wHtml += `<div class="${cls}"><img class="slot-icon" src="${iconUrl}" alt="" /><div class="slot-meta"><span class="slot-name" style="color:${w.accentColorHex}">${w.isEvolved && w.evolutionName ? w.evolutionName : w.name}</span><div class="slot-pips">${pips}</div></div></div>`;
      }
    }
    this.weaponSlotsEl.innerHTML = wHtml;

    let pHtml = '';
    for (let i = 0; i < 4; i++) {
      if (i >= hud.maxPassiveSlots) {
        pHtml += `<div class="slot-box locked" data-testid="passive-slot-locked-${i}"><div class="slot-meta"><span class="slot-name" style="color:#64748b">🔒 未解放</span><div class="slot-pips"><span style="font-size:9px;color:#64748b">高阶解锁</span></div></div></div>`;
        continue;
      }
      const p = hud.passiveSlots[i];
      if (!p) {
        pHtml += `<div class="slot-box"><div class="slot-meta"><span class="slot-name" style="color:#475569">空被动槽</span><div class="slot-pips"></div></div></div>`;
      } else {
        const iconUrl = PASSIVE_ICON_URL_BY_ID[p.passiveId];
        const pips = Array.from({ length: 5 }, (_, idx) => `<span class="pip ${idx < p.level ? 'on' : ''}"></span>`).join('');
        pHtml += `<div class="slot-box filled"><img class="slot-icon" src="${iconUrl}" alt="" /><div class="slot-meta"><span class="slot-name" style="color:${p.accentColorHex}">${p.name}</span><div class="slot-pips">${pips}</div></div></div>`;
      }
    }
    this.passiveSlotsEl.innerHTML = pHtml;
  }

  private computeModalSignature(hud: HudSnapshot): string {
    if (hud.appState === 'TITLE') {
      return [
        hud.appState,
        hud.titleSubView,
        hud.meta.voidCrystals,
        hud.meta.spentCrystals,
        hud.meta.career.currentLevel,
        hud.meta.career.clearedLevelsCount,
        hud.meta.career.currentFormId,
        hud.meta.talents.map((t) => `${t.id}:${t.level}`).join(','),
        JSON.stringify(hud.meta.settings),
        hud.storageStatus,
      ].join('|');
    }
    if (hud.appState === 'LEVEL_UP_MODAL') {
      return `LU|${hud.level}|${hud.rerollsLeft}|${hud.levelUpChoices.map((c) => c.key).join(',')}`;
    }
    if (hud.appState === 'ALTAR_MODAL') {
      return `ALTAR|${hud.altarChoices.map((c) => c.key).join(',')}`;
    }
    if (hud.appState === 'CHEST_MODAL') {
      return `CHEST|${hud.chestModal?.title ?? ''}|${hud.chestModal?.evolutionId ?? ''}|${hud.chestModal?.grantedCrystals ?? 0}`;
    }
    if (hud.appState === 'PAUSED') {
      return `PAUSED|${hud.pauseReason ?? ''}|${JSON.stringify(hud.meta.settings)}|${hud.kills}`;
    }
    if (hud.appState === 'VICTORY_MODAL' || hud.appState === 'GAME_OVER_MODAL') {
      return `${hud.appState}|${hud.settlementModal?.grantedCrystals ?? 0}|${hud.settlementModal?.defeatReason ?? ''}|${hud.settlementModal?.newlyUnlockedForm?.formId ?? ''}|${hud.settlementModal?.canContinueEndless ? 1 : 0}`;
    }
    return `${hud.appState}|${hud.pauseReason ?? ''}`;
  }

  private renderModalContent(hud: HudSnapshot): void {
    switch (hud.appState) {
      case 'TITLE':
        this.renderTitleViews(hud);
        break;
      case 'LEVEL_UP_MODAL':
        this.renderChoiceModal(hud, 'LEVELUP');
        break;
      case 'ALTAR_MODAL':
        this.renderChoiceModal(hud, 'ALTAR');
        break;
      case 'CHEST_MODAL':
        this.renderChestModal(hud);
        break;
      case 'PAUSED':
        this.renderStrategyPauseModal(hud);
        break;
      case 'PAUSED_OVER_MODAL':
        this.renderPausedOverModal(hud);
        break;
      case 'VICTORY_MODAL':
      case 'GAME_OVER_MODAL':
        this.renderSettlementModal(hud);
        break;
      default:
        this.modalEl.innerHTML = '';
        break;
    }
  }

  private renderTitleViews(hud: HudSnapshot): void {
    const warnHtml = hud.storageWarning
      ? `<div class="warning-banner" data-testid="storage-warning">⚠ ${hud.storageWarning}</div>`
      : '';
    const career = hud.meta.career;

    if (hud.titleSubView === 'MAIN_MENU') {
      const pct = career.nextFormName
        ? Math.min(100, Math.round((career.clearedLevelsCount / Math.max(1, career.nextFormTargetClears)) * 100))
        : 100;
      const nextHint = career.nextFormName
        ? `累计通关 <strong>${career.clearedLevelsCount} / ${career.nextFormTargetClears}</strong> 关 → 自动解锁 <strong style="color:#facc15">${career.nextFormName}</strong>（还差 ${career.remainingClearsForNextForm} 关）`
        : career.clearedLevelsCount >= 36
          ? `<strong style="color:#facc15">🏆 已全通全部 36 关终局征程！4+4 全槽解放 · 随时挑战第 36 关与无尽深渊</strong>`
          : `<strong style="color:#facc15">已达成终极形态 V！累计通关 ${career.clearedLevelsCount} / 36 关 · 4+4 全槽解放</strong>`;

      this.modalEl.innerHTML = `
        <div class="title-hero-shell" data-testid="screen-main-menu">
          <div class="title-top-bar">
            <div class="title-sys-tag">
              <span class="title-sys-dot"></span>
              <span>VOID RUNNER // V2.0 SECTOR COMMAND</span>
            </div>
            <div class="title-top-right">
              <span class="crystal-badge" data-testid="title-crystals">◆ 虚空晶体：${hud.meta.voidCrystals}</span>
              <button class="btn-ghost-danger" data-testid="btn-nav-reset-career" title="清空本地缓存并从第 1 关重新开始">重置生涯</button>
            </div>
          </div>

          <div class="title-command-column">
            ${warnHtml}
            <div class="title-logo-block">
              <div class="title-en-kicker">VOID RUNNER · 深空弹幕生存突围</div>
              <h1 class="hero-title">黑潮突围</h1>
              <div class="hero-sub">五大阶段 36 递增关卡 · 单主角五形态进阶 · 纯自动火力割草</div>
            </div>

            <div class="career-banner" data-testid="career-summary">
              <div class="career-main-row">
                <div class="hangar-preview" title="${career.currentFormName}">
                  <img src="${FORM_SPRITE_URL_BY_TIER[career.currentFormTier] ?? FORM_SPRITE_URL_BY_TIER[1]}" alt="${career.currentFormName}" />
                </div>
                <div class="career-info-col">
                  <div class="career-level-line">
                    <span>当前挑战：<span style="color:#38bdf8" data-testid="title-current-level">第 ${career.currentLevel} 关</span> / 36</span>
                    <span style="font-size:12px;color:#94a3b8;font-weight:700;">· ${career.currentStageName}</span>
                  </div>
                  <div class="career-form-line">
                    出击机体：<strong style="color:#facc15" data-testid="title-current-form">${career.currentFormName}</strong>
                  </div>
                  <div class="career-chips">
                    <span class="career-chip">卡槽 <strong>${career.maxActiveSlots}+${career.maxPassiveSlots}</strong></span>
                    <span class="career-chip">主武 <strong>Lv.${career.starterWeaponLevel}</strong></span>
                    <span class="career-chip">时限 <strong>${Math.round(career.stageDurationLimitSec / 60)} 分钟</strong></span>
                    <span class="career-chip">Boss <strong style="color:#fda4af">${career.stageBossCount} 只</strong></span>
                  </div>
                </div>
              </div>
              <div class="career-next-hint">${nextHint}</div>
              <div class="career-progress-track"><div class="career-progress-fill" style="width:${pct}%"></div></div>
            </div>

            <div class="title-launch-wrap">
              <button class="btn-launch-cta" data-testid="btn-start-run">▶ 出击第 ${career.currentLevel} 关</button>
            </div>
          </div>

          <div class="title-bottom-dock">
            <div class="title-nav-group">
              <button class="btn" data-testid="btn-nav-forms">五形态进阶路线</button>
              <button class="btn btn-gold" data-testid="btn-nav-talents">永久天赋树</button>
              <button class="btn" data-testid="btn-nav-records">战绩与超武图鉴</button>
              <button class="btn" data-testid="btn-nav-settings">系统设置</button>
            </div>
          </div>
        </div>
      `;
      this.modalEl.querySelector('[data-testid="btn-start-run"]')?.addEventListener('click', () => {
        this.controller.startRun();
        this.onRunRestarted();
      });
      this.modalEl.querySelector('[data-testid="btn-nav-forms"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('FORM_CODEX');
      });
      this.modalEl.querySelector('[data-testid="btn-nav-talents"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('TALENT_TREE');
      });
      this.modalEl.querySelector('[data-testid="btn-nav-records"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('RECORDS');
      });
      this.modalEl.querySelector('[data-testid="btn-nav-settings"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('SETTINGS');
      });
      this.modalEl.querySelector('[data-testid="btn-nav-reset-career"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('RESET_CONFIRM');
      });
      return;
    }

    if (hud.titleSubView === 'FORM_CODEX') {
      const cardsHtml = hud.meta.forms
        .map((f) => {
          const badge = f.isCurrent
            ? `<span style="color:#34d399;font-weight:800;">● 当前激活形态</span>`
            : f.unlocked
              ? `<span style="color:#38bdf8;font-weight:700;">✓ 已解锁</span>`
              : `<span style="color:#94a3b8;">🔒 通关 ${f.requiredTotalClears} 关解锁</span>`;
          return `
            <div class="card ${f.isCurrent ? 'selected' : ''} ${f.unlocked ? '' : 'locked'}" style="--card-accent:${f.primaryColorHex}">
              <div class="form-codex-thumb" style="border-color:${f.primaryColorHex}55;">
                <img src="${FORM_SPRITE_URL_BY_TIER[f.tier] ?? FORM_SPRITE_URL_BY_TIER[1]}" alt="${f.name}" />
              </div>
              <div class="card-tag" style="color:${f.primaryColorHex}">阶段 ${f.tier} · ${f.title}</div>
              <div class="card-title" style="font-size:14px;">${f.name}</div>
              <div class="card-desc" style="font-size:11px;">${f.description}</div>
              <div class="form-stat-list">
                <div class="form-stat-row"><span>技能卡槽</span><strong style="color:#38bdf8;">${f.maxActiveSlots}+${f.maxPassiveSlots}</strong></div>
                <div class="form-stat-row"><span>开局主武</span><strong style="color:#facc15;">LV.${f.starterWeaponLevel}</strong></div>
                <div class="form-stat-row"><span>阶段挑战</span><strong style="color:#fda4af;">${Math.round(f.stageDurationSec / 60)}分 / ${f.stageBossCount} Boss</strong></div>
              </div>
              <div style="font-size:11px;margin-top:2px;">${badge}</div>
            </div>
          `;
        })
        .join('');

      this.modalEl.innerHTML = `
        <div class="screen-box" data-testid="screen-form-codex">
          <div class="panel-header">
            <div>
              <div class="panel-kicker">HANGAR EVOLUTION ARCHIVE</div>
              <h2>主角五形态自动进阶路线（基础面板统一由天赋强化）</h2>
            </div>
            <button class="btn" data-testid="btn-back-main">返回主页</button>
          </div>
          <div class="grid-5">${cardsHtml}</div>
        </div>
      `;
      this.modalEl.querySelector('[data-testid="btn-back-main"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('MAIN_MENU');
      });
      return;
    }

    if (hud.titleSubView === 'RESET_CONFIRM') {
      this.modalEl.innerHTML = `
        <div class="screen-box compact" data-testid="screen-reset-confirm">
          <h2 style="margin:0 0 10px;color:#f43f5e;">⚠ 确认重置全部生涯进度？</h2>
          <div class="warning-banner" style="text-align:left;font-size:13px;line-height:1.6;">
            本游戏采用纯浏览器本地缓存的<strong>不可逆生涯推图制</strong>。<br/>
            确认重置后，以下全部数据将<strong>永久清空并恢复为新玩家第 1 关状态</strong>：<br/>
            • 关卡进度（当前第 ${career.currentLevel} 关 → 第 1 关）与角色形态（恢复形态 I）<br/>
            • 全部永久天赋树等级与虚空晶体余额（归零）<br/>
            • 历史战绩与超武觉醒图鉴
          </div>
          <div class="btn-row">
            <button class="btn" data-testid="btn-cancel-reset-career">取消返回</button>
            <button class="btn btn-danger" data-testid="btn-confirm-reset-career">确认清空并从第 1 关重新开始</button>
          </div>
        </div>
      `;
      this.modalEl.querySelector('[data-testid="btn-cancel-reset-career"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('MAIN_MENU');
      });
      this.modalEl.querySelector('[data-testid="btn-confirm-reset-career"]')?.addEventListener('click', () => {
        this.controller.resetCareer();
      });
      return;
    }

    if (hud.titleSubView === 'TALENT_TREE') {
      const cardsHtml = hud.meta.talents
        .map((t) => {
          const isMax = t.nextCost === null;
          const canBuy = !isMax && hud.meta.voidCrystals >= t.nextCost;
          const totalBonus =
            t.unitLabel === '%'
              ? `+${Math.round(t.level * t.valuePerLevel * 100)}%`
              : `+${t.level * t.valuePerLevel} ${t.unitLabel}`;
          const pipsHtml = Array.from(
            { length: t.maxLevel },
            (_, idx) => `<span class="talent-pip ${idx < t.level ? 'on' : ''}"></span>`,
          ).join('');
          return `
            <div class="card ${canBuy ? 'gold-border' : ''}" style="--card-accent:${isMax ? '#34d399' : '#facc15'}">
              <div class="card-head-row" style="padding-right:0;">
                <img class="card-icon" src="${TALENT_ICON_URL_BY_ID[t.id]}" alt="" />
                <div>
                  <div class="card-tag">LV.${t.level} / ${t.maxLevel} · ${totalBonus}</div>
                  <div class="card-title" style="font-size:14px;">${t.name}</div>
                </div>
              </div>
              <div class="talent-level-bar">${pipsHtml}</div>
              <div class="card-desc">${t.description}</div>
              <button class="btn ${isMax ? '' : 'btn-gold'}" data-buy-talent="${t.id}" data-testid="btn-buy-talent-${t.id}" ${!canBuy ? 'disabled' : ''}>
                ${isMax ? '✓ 已满级' : `◆ ${t.nextCost} 升级`}
              </button>
            </div>
          `;
        })
        .join('');

      this.modalEl.innerHTML = `
        <div class="screen-box" data-testid="screen-talent-tree">
          <div class="panel-header">
            <h2>永久天赋树（全额免费洗点）</h2>
            <div style="display:flex;gap:10px;align-items:center;">
              <span class="crystal-badge" data-testid="talent-crystals">◆ 虚空晶体：${hud.meta.voidCrystals}</span>
              <button class="btn btn-danger" data-testid="btn-reset-talents" ${hud.meta.spentCrystals <= 0 ? 'disabled' : ''}>↺ 免费洗点 (退还 ${hud.meta.spentCrystals})</button>
              <button class="btn" data-testid="btn-back-main">返回主页</button>
            </div>
          </div>
          <div class="grid-4">${cardsHtml}</div>
        </div>
      `;
      this.modalEl.querySelector('[data-testid="btn-back-main"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('MAIN_MENU');
      });
      this.modalEl.querySelector('[data-testid="btn-reset-talents"]')?.addEventListener('click', () => {
        this.controller.resetAllTalents();
      });
      this.modalEl.querySelectorAll('[data-buy-talent]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-buy-talent') as TalentId;
          this.controller.buyTalent(id);
        });
      });
      return;
    }

    if (hud.titleSubView === 'RECORDS') {
      const r = hud.meta.runRecords;
      const evoHtml = hud.evolutionRecipesStatus
        .map((e) => {
          const unlocked = hud.meta.discoveredEvolutions.includes(e.evolutionId);
          return `
            <div class="card ${unlocked ? 'gold-border' : ''}">
              <div class="card-head-row">
                <img class="card-icon" style="${unlocked ? '' : 'filter:grayscale(1) brightness(0.45);'}" src="${EVOLUTION_ICON_URL_BY_ID[e.evolutionId]}" alt="" />
                <div>
                  <div class="card-tag">${unlocked ? '已觉醒解锁' : '尚未觉醒'}</div>
                  <div class="card-title">${unlocked ? `⚡ ${e.evolutionName}` : '???'}</div>
                </div>
              </div>
              <div class="card-desc">
                <span class="recipe-icons">
                  <img class="recipe-mini-icon" src="${WEAPON_ICON_URL_BY_ID[e.weaponId]}" alt="" />
                  <span>+</span>
                  <img class="recipe-mini-icon" src="${PASSIVE_ICON_URL_BY_ID[e.passiveId]}" alt="" />
                </span>
                ${e.weaponName} (Lv.5) + ${e.passiveName}
              </div>
            </div>
          `;
        })
        .join('');

      this.modalEl.innerHTML = `
        <div class="screen-box" data-testid="screen-records">
          <div class="panel-header">
            <h2>历史战绩与超武觉醒图鉴</h2>
            <button class="btn" data-testid="btn-back-main">返回主页</button>
          </div>
          <div class="grid-3" style="margin-bottom:16px;">
            <div class="stat-metric"><div class="val">${r.totalRuns}</div><div class="lbl">累计出击场次</div></div>
            <div class="stat-metric"><div class="val" style="color:#facc15">${career.clearedLevelsCount}</div><div class="lbl">累计通关数</div></div>
            <div class="stat-metric"><div class="val">${r.totalKills}</div><div class="lbl">累计击杀黑潮</div></div>
            <div class="stat-metric"><div class="val">${formatClock(r.bestSurvivalSec)}</div><div class="lbl">最长单局存活</div></div>
            <div class="stat-metric"><div class="val" style="color:#c084fc">${formatClock(r.bestEndlessSec)}</div><div class="lbl">最长无尽坚持</div></div>
            <div class="stat-metric"><div class="val">${r.bestSingleRunKills}</div><div class="lbl">单局最高击杀</div></div>
          </div>
          <div class="section-label">6 大超武合成图鉴 (${hud.meta.discoveredEvolutions.length}/6)</div>
          <div class="grid-3">${evoHtml}</div>
        </div>
      `;
      this.modalEl.querySelector('[data-testid="btn-back-main"]')?.addEventListener('click', () => {
        this.controller.navigateTitleSubView('MAIN_MENU');
      });
      return;
    }

    // SETTINGS
    this.modalEl.innerHTML = `
      <div class="screen-box compact" data-testid="screen-settings">
        <div class="panel-header">
          <h2>系统设置（音频与护眼/性能开关）</h2>
          <button class="btn" data-testid="btn-back-main">返回主页</button>
        </div>
        ${this.renderSettingsFieldsHtml(hud.meta.settings)}
      </div>
    `;
    this.modalEl.querySelector('[data-testid="btn-back-main"]')?.addEventListener('click', () => {
      this.controller.navigateTitleSubView('MAIN_MENU');
    });
    this.bindSettingsEvents(this.modalEl);
  }

  private renderSettingsFieldsHtml(s: GameSettings): string {
    const effectiveInvincible = this.controller.isPlayerInvincible();
    const effectiveTimeScale = this.controller.getEffectiveTimeScale();
    return `
      <div style="text-align:left;">
        <div class="setting-row"><span>主音量 (${Math.round(s.masterVolumeRatio * 100)}%)</span><input type="range" data-setting-range="masterVolumeRatio" min="0" max="1" step="0.05" value="${s.masterVolumeRatio}" /></div>
        <div class="setting-row"><span>背景氛围 BGM (${Math.round(s.bgmVolumeRatio * 100)}%)</span><input type="range" data-setting-range="bgmVolumeRatio" min="0" max="1" step="0.05" value="${s.bgmVolumeRatio}" /></div>
        <div class="setting-row"><span>战斗音效 SFX (${Math.round(s.sfxVolumeRatio * 100)}%)</span><input type="range" data-setting-range="sfxVolumeRatio" min="0" max="1" step="0.05" value="${s.sfxVolumeRatio}" /></div>
        <div class="setting-row"><span>一键静音</span><input type="checkbox" data-setting-check="isMuted" ${s.isMuted ? 'checked' : ''} /></div>
        <div class="setting-row"><span>关闭屏幕震动（护眼）</span><input type="checkbox" data-setting-check="disableScreenShake" ${s.disableScreenShake ? 'checked' : ''} /></div>
        <div class="setting-row"><span>关闭伤害飘字（清爽视野）</span><input type="checkbox" data-setting-check="disableDamageText" ${s.disableDamageText ? 'checked' : ''} /></div>
        <div class="setting-row"><span>低粒子 / 低辉光模式（极致性能）</span><input type="checkbox" data-setting-check="lowParticleMode" ${s.lowParticleMode ? 'checked' : ''} /></div>
        <div class="setting-row"><span style="color:#FACC15;">[调试] 角色无敌模式（免受一切伤害）</span><input type="checkbox" data-setting-check="debugPlayerInvincible" data-testid="setting-debug-invincible" ${effectiveInvincible ? 'checked' : ''} /></div>
        <div class="setting-row">
          <span style="color:#FACC15;">[调试] 局内加速倍率（刷怪与计时提速）</span>
          <select class="setting-select" data-setting-select="debugTimeScale" data-testid="setting-debug-timescale">
            <option value="1" ${effectiveTimeScale === 1 ? 'selected' : ''}>1× 原速</option>
            <option value="2" ${effectiveTimeScale === 2 ? 'selected' : ''}>2× 倍速</option>
            <option value="3" ${effectiveTimeScale === 3 ? 'selected' : ''}>3× 倍速</option>
          </select>
        </div>
      </div>
    `;
  }

  private bindSettingsEvents(container: HTMLElement): void {
    container.querySelectorAll<HTMLInputElement>('[data-setting-range]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-setting-range') as keyof GameSettings;
        this.controller.updateSettings({ [key]: parseFloat(input.value) });
        this.onSettingsChanged(this.controller.getSettings());
      });
    });
    container.querySelectorAll<HTMLInputElement>('[data-setting-check]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-setting-check') as keyof GameSettings;
        this.controller.updateSettings({ [key]: input.checked });
        this.onSettingsChanged(this.controller.getSettings());
      });
    });
    container.querySelectorAll<HTMLSelectElement>('[data-setting-select]').forEach((select) => {
      select.addEventListener('change', () => {
        const key = select.getAttribute('data-setting-select');
        if (key === 'debugTimeScale') {
          const parsed = Number(select.value);
          const scale: DebugTimeScale = parsed === 3 ? 3 : parsed === 2 ? 2 : 1;
          this.controller.updateSettings({ debugTimeScale: scale });
          this.onSettingsChanged(this.controller.getSettings());
        }
      });
    });
  }

  private resolveChoiceIconUrl(choice: UpgradeCardChoice): string | null {
    if (choice.evolutionId) {
      return EVOLUTION_ICON_URL_BY_ID[choice.evolutionId];
    }
    if (choice.weaponId) {
      return WEAPON_ICON_URL_BY_ID[choice.weaponId];
    }
    if (choice.passiveId) {
      return PASSIVE_ICON_URL_BY_ID[choice.passiveId];
    }
    if (choice.kind === 'fallback_heal' || choice.kind === 'altar_heal_crystals') {
      return TALENT_ICON_URL_BY_ID.void_hull;
    }
    if (choice.kind === 'fallback_crystals') {
      return TALENT_ICON_URL_BY_ID.crystal_extract;
    }
    if (choice.kind === 'fallback_damage' || choice.kind === 'altar_damage') {
      return TALENT_ICON_URL_BY_ID.energy_overload;
    }
    if (choice.kind === 'altar_speed' || choice.kind === 'fallback_speed') {
      return TALENT_ICON_URL_BY_ID.warp_engine;
    }
    return null;
  }

  private renderChoiceModal(hud: HudSnapshot, kind: 'LEVELUP' | 'ALTAR'): void {
    const choices = kind === 'ALTAR' ? hud.altarChoices : hud.levelUpChoices;
    const cardsHtml = choices
      .map((c, idx) => {
        const iconUrl = this.resolveChoiceIconUrl(c);
        const iconHtml = iconUrl ? `<img class="card-icon" src="${iconUrl}" alt="" />` : '';
        return `
        <div class="card clickable ${kind === 'ALTAR' || c.kind === 'evolution' ? 'gold-border' : ''}" style="--card-accent:${c.accentColorHex}" data-choice-idx="${idx}" data-testid="choice-card-${idx}">
          <span class="card-hotkey">${idx + 1}</span>
          <div class="card-head-row">
            ${iconHtml}
            <div>
              <div class="card-tag" style="color:${c.accentColorHex}">${c.tag}</div>
              <div class="card-title">${c.title}</div>
            </div>
          </div>
          <div class="card-desc">${c.description}</div>
        </div>
      `;
      })
      .join('');

    const rerollHtml =
      kind === 'LEVELUP'
        ? `<div class="btn-row"><button class="btn btn-gold" data-testid="btn-reroll" ${hud.rerollsLeft <= 0 ? 'disabled' : ''}>R · 重随选项（剩余 ${hud.rerollsLeft} 次）</button></div>`
        : '';

    this.modalEl.innerHTML = `
      <div class="screen-box compact" data-testid="${kind === 'ALTAR' ? 'modal-altar' : 'modal-levelup'}">
        <h2 style="margin:0 0 6px;font-size:24px;">${kind === 'ALTAR' ? '⚡ 充能祭坛赐福 · 三选一' : `⬆ 等级提升 LV.${hud.level} · 三选一`}</h2>
        <div class="hero-sub" style="margin-bottom:16px;">当前形态槽位上限 ${hud.maxActiveSlots} 主动 + ${hud.maxPassiveSlots} 被动 · 点击卡片或按 1 / 2 / 3 生效</div>
        <div class="grid-3">${cardsHtml}</div>
        ${rerollHtml}
      </div>
    `;

    this.modalEl.querySelectorAll('[data-choice-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-choice-idx')) as 0 | 1 | 2;
        this.controller.selectModalChoice(idx);
      });
    });
    this.modalEl.querySelector('[data-testid="btn-reroll"]')?.addEventListener('click', () => {
      this.controller.rerollLevelUp();
    });
  }

  private renderChestModal(hud: HudSnapshot): void {
    const chest = hud.chestModal;
    if (!chest) return;

    const bodyHtml = chest.isEvolution
      ? `
        <div class="card gold-border" style="text-align:center;padding:20px;margin:14px 0;">
          <div class="card-tag">超武进化公式达成</div>
          ${chest.evolutionId ? `<img class="chest-evo-icon" src="${EVOLUTION_ICON_URL_BY_ID[chest.evolutionId]}" alt="" />` : ''}
          <div style="font-size:14px;color:#cbd5e1;margin:6px 0;">${chest.sourceWeaponName} (Lv.5) + ${chest.sourcePassiveName}</div>
          <div style="font-size:28px;font-weight:900;color:#facc15;margin:8px 0;">⚡ ${chest.evolutionName}</div>
          <div class="card-desc" style="font-size:13px;">${chest.evolutionDescription}</div>
        </div>
      `
      : `
        <div class="card" style="text-align:left;padding:16px;margin:14px 0;">
          <div class="card-tag">精英宝箱收获</div>
          ${chest.bonusUpgradeSummaries.map((s) => `<div style="font-size:14px;padding:3px 0;color:#e0f2fe;">• ${s}</div>`).join('')}
        </div>
      `;

    this.modalEl.innerHTML = `
      <div class="screen-box compact" data-testid="modal-chest">
        <h2 style="margin:0 0 6px;color:#facc15;">${chest.title}</h2>
        <div class="crystal-badge" style="margin-top:6px;">+ ${chest.grantedCrystals} 虚空晶体</div>
        ${bodyHtml}
        <div class="btn-row">
          <button class="btn btn-primary" data-testid="btn-chest-confirm">Space / 点击继续突围</button>
        </div>
      </div>
    `;
    this.modalEl.querySelector('[data-testid="btn-chest-confirm"]')?.addEventListener('click', () => {
      this.controller.confirmChestModal();
    });
  }

  private renderStrategyPauseModal(hud: HudSnapshot): void {
    const recipesHtml = hud.evolutionRecipesStatus
      .map((r) => {
        const badge =
          r.status === 'evolved'
            ? '<span style="color:#facc15;font-weight:700;">已觉醒</span>'
            : r.status === 'ready'
              ? '<span style="color:#c084fc;font-weight:700;">开箱即觉醒!</span>'
              : r.status === 'partial'
                ? '<span style="color:#38bdf8;">构筑中</span>'
                : '<span style="color:#64748b;">未持有</span>';
        return `
          <div class="recipe-item ${r.status}">
            <span style="display:inline-flex;align-items:center;gap:4px;">
              <img class="recipe-mini-icon" src="${WEAPON_ICON_URL_BY_ID[r.weaponId]}" alt="" />
              <strong>${r.weaponName}</strong> +
              <img class="recipe-mini-icon" src="${PASSIVE_ICON_URL_BY_ID[r.passiveId]}" alt="" />
              ${r.passiveName} →
              <img class="recipe-mini-icon" src="${EVOLUTION_ICON_URL_BY_ID[r.evolutionId]}" alt="" />
              <span style="color:#fef08a">${r.evolutionName}</span>
            </span>
            ${badge}
          </div>
        `;
      })
      .join('');

    const dmgHtml =
      hud.weaponDamageStats.length === 0
        ? `<div style="font-size:12px;color:#64748b;">暂无伤害数据</div>`
        : hud.weaponDamageStats
            .map(
              (d) => `
          <div class="dmg-row">
            <div class="dmg-head">
              <span style="color:${d.accentColorHex};font-weight:700;">${d.displayName}</span>
              <span>${d.totalDamage.toLocaleString()} (${Math.round(d.shareRatio * 100)}%)</span>
            </div>
            <div class="dmg-track"><div class="dmg-fill" style="width:${Math.max(2, Math.round(d.shareRatio * 100))}%;background:${d.accentColorHex}"></div></div>
          </div>
        `,
            )
            .join('');

    this.modalEl.innerHTML = `
      <div class="screen-box" data-testid="modal-paused">
        <div class="panel-header">
          <h2>战术暂停 · 第 ${hud.currentLevel} 关（${hud.formName}）· ${hud.pauseReason ?? '已暂停'}</h2>
          <button class="btn btn-primary" style="padding:8px 20px;font-size:14px;" data-testid="btn-resume">▶ 继续游戏 (Esc)</button>
        </div>
        <div class="grid-2">
          <div>
            <div class="section-label">快捷设置</div>
            ${this.renderSettingsFieldsHtml(hud.meta.settings)}
            <div class="btn-row" style="justify-content:flex-start;margin-top:16px;">
              <button class="btn btn-gold" data-testid="btn-pause-restart">↺ 重开本关</button>
              <button class="btn btn-danger" data-testid="btn-pause-title">回到主页</button>
            </div>
          </div>
          <div>
            <div class="section-label">超武合成速查表（武器 Lv.5 + 配对被动）</div>
            ${recipesHtml}
            <div class="section-label" style="margin-top:14px;">本局分武器实时伤害统计</div>
            ${dmgHtml}
          </div>
        </div>
      </div>
    `;

    this.bindSettingsEvents(this.modalEl);
    this.modalEl.querySelector('[data-testid="btn-resume"]')?.addEventListener('click', () => {
      this.controller.resume();
    });
    this.modalEl.querySelector('[data-testid="btn-pause-restart"]')?.addEventListener('click', () => {
      this.controller.restartRun();
      this.onRunRestarted();
    });
    this.modalEl.querySelector('[data-testid="btn-pause-title"]')?.addEventListener('click', () => {
      this.controller.returnToTitle('MAIN_MENU');
    });
  }

  private renderPausedOverModal(hud: HudSnapshot): void {
    this.modalEl.innerHTML = `
      <div class="screen-box compact" data-testid="modal-paused-over">
        <h2 style="margin:0 0 8px;">${hud.pauseReason ?? '页面已自动暂停'}</h2>
        <div class="hero-sub">你的升级/宝箱奖励已安全保留，点击下方按钮即可回到原抉择界面。</div>
        <button class="btn btn-primary" data-testid="btn-resume-over-modal">恢复当前抉择</button>
      </div>
    `;
    this.modalEl.querySelector('[data-testid="btn-resume-over-modal"]')?.addEventListener('click', () => {
      this.controller.resume();
    });
  }

  private renderSettlementModal(hud: HudSnapshot): void {
    const s = hud.settlementModal;
    if (!s) return;

    const title = s.isVictory
      ? s.playedLevelNumber >= 36
        ? '🏆 第 36 关终局通关！已征服全部 36 关'
        : `🏆 第 ${s.playedLevelNumber} 关通关！已解锁第 ${s.nextLevelNumber} 关`
      : s.isEndlessEnd
        ? '🌌 无尽黑潮终焉结算'
        : s.defeatReason === 'timeout'
          ? `⏱ 第 ${s.playedLevelNumber} 关超时失败（时限内未击杀全部 Boss）`
          : `💀 第 ${s.playedLevelNumber} 关核心防线失守`;

    const subNote = s.isVictory
      ? ''
      : `<div style="font-size:12px;color:#fda4af;margin-bottom:10px;">进度保持在第 ${s.playedLevelNumber} 关 · 消耗本局获得的晶体升级天赋后再战！</div>`;

    const unlockTier = s.newlyUnlockedForm
      ? (hud.meta.forms.find((f) => f.id === s.newlyUnlockedForm?.formId)?.tier ?? s.newlyUnlockedForm.starterWeaponLevel)
      : 1;
    const unlockBannerHtml = s.newlyUnlockedForm
      ? `
        <div class="form-unlock-banner" data-testid="banner-form-unlocked">
          <div class="form-unlock-ship">
            <img src="${FORM_SPRITE_URL_BY_TIER[unlockTier] ?? FORM_SPRITE_URL_BY_TIER[1]}" alt="${s.newlyUnlockedForm.formName}" />
          </div>
          <div>
            <div style="font-size:12px;font-weight:800;color:#facc15;letter-spacing:0.8px;">⚡ 角色形态自动进阶解锁！</div>
            <div style="font-size:20px;font-weight:900;color:#fff;margin:4px 0;">${s.newlyUnlockedForm.formName} · 晋级 ${s.newlyUnlockedForm.stageName}</div>
            <div style="font-size:13px;color:#e2e8f0;">
              技能卡槽解放至 <strong>${s.newlyUnlockedForm.maxActiveSlots} 主动 + ${s.newlyUnlockedForm.maxPassiveSlots} 被动</strong> ｜ 开局主武升至 <strong>LV.${s.newlyUnlockedForm.starterWeaponLevel}</strong> ｜ 新阶段时限 <strong>${Math.round(s.newlyUnlockedForm.durationLimitSec / 60)} 分钟</strong>（<strong>${s.newlyUnlockedForm.bossCount} 只 Boss</strong>）
            </div>
          </div>
        </div>
      `
      : '';

    const endlessBtn =
      s.isVictory && s.canContinueEndless
        ? `<button class="btn btn-violet" data-testid="btn-continue-endless">∞ 继续挑战无尽黑潮</button>`
        : '';

    const primaryActionText = s.isVictory
      ? `▶ 挑战第 ${s.nextLevelNumber} 关`
      : `↺ 再次挑战第 ${s.playedLevelNumber} 关`;

    this.modalEl.innerHTML = `
      <div class="screen-box compact ${s.isVictory ? 'victory-box' : 'defeat-box'}" data-testid="${s.isVictory ? 'modal-victory' : 'modal-gameover'}">
        <h2 style="margin:0 0 8px;color:${s.isVictory ? '#facc15' : '#f43f5e'};">${title}</h2>
        ${subNote}
        ${unlockBannerHtml}
        <div class="crystal-badge" style="margin-bottom:16px;" data-testid="settlement-crystals">本次落盘入账：+ ${s.grantedCrystals} 虚空晶体（当前余额 ${hud.meta.voidCrystals}）</div>
        <div class="grid-3" style="margin-bottom:14px;">
          <div class="stat-metric"><div class="val">${formatClock(s.survivedSec)}</div><div class="lbl">总存活时长</div></div>
          <div class="stat-metric"><div class="val">${s.kills}</div><div class="lbl">本局总击杀</div></div>
          <div class="stat-metric"><div class="val">LV.${s.levelReached}</div><div class="lbl">达成等级</div></div>
          <div class="stat-metric"><div class="val">${s.elitesKilled}</div><div class="lbl">击杀精英</div></div>
          <div class="stat-metric"><div class="val">${s.altarsCompleted}</div><div class="lbl">完成祭坛</div></div>
          <div class="stat-metric"><div class="val" style="color:#c084fc">${formatClock(s.endlessSec)}</div><div class="lbl">无尽坚持时长</div></div>
        </div>
        <div class="btn-row">
          ${endlessBtn}
          <button class="btn btn-primary" data-testid="btn-settlement-restart">${primaryActionText}</button>
          <button class="btn btn-gold" data-testid="btn-settlement-talents">前往永久天赋树</button>
          <button class="btn" data-testid="btn-settlement-title">返回主页</button>
        </div>
      </div>
    `;

    this.modalEl.querySelector('[data-testid="btn-continue-endless"]')?.addEventListener('click', () => {
      this.controller.continueEndless();
    });
    this.modalEl.querySelector('[data-testid="btn-settlement-restart"]')?.addEventListener('click', () => {
      this.controller.restartRun();
      this.onRunRestarted();
    });
    this.modalEl.querySelector('[data-testid="btn-settlement-talents"]')?.addEventListener('click', () => {
      this.controller.returnToTitle('TALENT_TREE');
    });
    this.modalEl.querySelector('[data-testid="btn-settlement-title"]')?.addEventListener('click', () => {
      this.controller.returnToTitle('MAIN_MENU');
    });
  }
}
