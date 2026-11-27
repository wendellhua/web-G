/**
 * Web Audio 程序化科幻合成音频引擎（遵守 docs/06 第 5.2 节规范）
 * - 零外部音频文件依赖，首次用户手势安全解锁 AudioContext；
 * - 严格 MAX_CONCURRENT_VOICES = 12 并发上限 + 逐事件最小节流间隔防破音；
 * - 多层深空氛围 BGM（双微调低频脉冲 + LFO 呼吸滤波 + 常规/Boss 动态节奏脉冲音序）；
 * - 预烘焙零 GC 噪声缓冲 + 6 类武器独立声纹 + 暴击清脆金属共鸣 + 精英/Boss 分层爆炸冲击。
 */
import type { GameSettings } from '../../../schemas';
import type { GameEvent } from '../../core/contracts/gameContracts';

const MAX_CONCURRENT_VOICES = 12;
const PENTATONIC_HZ = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51] as const;
const NORMAL_PULSE_ARP_HZ = [110.0, 164.81, 130.81, 196.0, 110.0, 146.83, 164.81, 130.81] as const;
const BOSS_PULSE_ARP_HZ = [130.81, 155.56, 196.0, 155.56, 130.81, 185.0, 196.0, 233.08] as const;

export class SynthAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private activeVoices = 0;
  private readonly lastPlayedMs = new Map<string, number>();
  private xpStreak = 0;
  private lastXpTimeMs = 0;

  // 多层 BGM 节点
  private bgmOscA: OscillatorNode | null = null;
  private bgmOscB: OscillatorNode | null = null;
  private bgmLfo: OscillatorNode | null = null;
  private bgmLfoGain: GainNode | null = null;
  private bgmFilter: BiquadFilterNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmPulseTimer: number | null = null;
  private bgmPulseStep = 0;
  private bgmWanted = false;
  private bgmBossMode = false;
  private bgmSuspended = false;

  private settings: GameSettings = {
    masterVolumeRatio: 0.8,
    bgmVolumeRatio: 0.45,
    sfxVolumeRatio: 0.85,
    isMuted: false,
    disableScreenShake: false,
    disableDamageText: false,
    lowParticleMode: false,
    debugPlayerInvincible: false,
    debugTimeScale: 1,
  };

  public updateSettings(next: GameSettings): void {
    this.settings = { ...next };
    this.syncBgmGain();
  }

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      try {
        this.ctx = new AudioCtor();
      } catch {
        return;
      }
    }
    if (!this.noiseBuffer && this.ctx) {
      this.noiseBuffer = this.buildNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // 浏览器策略拒绝自动播放时静默等待下一次手势
      });
    }
    this.bgmSuspended = false;
    if (this.bgmWanted && !this.bgmOscA) {
      this.startAmbientBgm();
    }
  }

  public setBgmState(active: boolean, isBoss: boolean): void {
    const bossChanged = this.bgmBossMode !== isBoss;
    this.bgmWanted = active;
    this.bgmBossMode = isBoss;
    this.bgmSuspended = false;
    if (!this.ctx) return;
    if (active && !this.bgmOscA && this.ctx.state === 'running') {
      this.startAmbientBgm();
    }
    if (bossChanged && this.bgmPulseTimer !== null) {
      this.restartPulseSequencer();
    }
    this.syncBgmGain();
  }

  public suspendForBackground(): void {
    this.bgmSuspended = true;
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
    }
  }

  public resetRunAudioState(): void {
    this.xpStreak = 0;
    this.lastXpTimeMs = 0;
    this.bgmPulseStep = 0;
    this.lastPlayedMs.clear();
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.65));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 2463534242;
    for (let i = 0; i < len; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 4294967295) * 2 - 1;
    }
    return buf;
  }

  private startAmbientBgm(): void {
    if (!this.ctx || this.bgmOscA) return;
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    oscA.frequency.value = 55;
    oscB.frequency.value = 55.45;

    filter.type = 'lowpass';
    filter.frequency.value = 185;
    filter.Q.value = 2.4;

    // 缓慢深空呼吸 LFO 调制低通截止频率
    lfo.type = 'sine';
    lfo.frequency.value = 0.16;
    lfoGain.gain.value = 55;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    gain.gain.value = 0.0001;

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    oscA.start();
    oscB.start();
    lfo.start();

    this.bgmOscA = oscA;
    this.bgmOscB = oscB;
    this.bgmLfo = lfo;
    this.bgmLfoGain = lfoGain;
    this.bgmFilter = filter;
    this.bgmGain = gain;

    this.restartPulseSequencer();
    this.syncBgmGain();
  }

  private restartPulseSequencer(): void {
    if (this.bgmPulseTimer !== null) {
      window.clearInterval(this.bgmPulseTimer);
      this.bgmPulseTimer = null;
    }
    if (typeof window === 'undefined') return;
    const stepMs = this.bgmBossMode ? 215 : 350;
    this.bgmPulseTimer = window.setInterval(() => {
      this.triggerBgmPulseNote();
    }, stepMs);
  }

  private triggerBgmPulseNote(): void {
    if (
      !this.ctx ||
      this.ctx.state !== 'running' ||
      !this.bgmWanted ||
      this.bgmSuspended ||
      this.settings.isMuted ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }
    const vol = this.settings.masterVolumeRatio * this.settings.bgmVolumeRatio * (this.bgmBossMode ? 0.036 : 0.024);
    if (vol <= 0.0006) return;

    const seq = this.bgmBossMode ? BOSS_PULSE_ARP_HZ : NORMAL_PULSE_ARP_HZ;
    const hz = seq[this.bgmPulseStep % seq.length] ?? 110;
    this.bgmPulseStep = (this.bgmPulseStep + 1) % seq.length;

    const now = this.ctx.currentTime;
    const dur = this.bgmBossMode ? 0.16 : 0.26;
    const osc = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = this.bgmBossMode ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(hz, now);

    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(this.bgmBossMode ? 720 : 420, now);
    flt.frequency.exponentialRampToValueAtTime(160, now + dur);

    g.gain.setValueAtTime(0.0004, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0004, now + dur);

    osc.connect(flt);
    flt.connect(g);
    g.connect(this.ctx.destination);

    osc.onended = () => {
      osc.disconnect();
      flt.disconnect();
      g.disconnect();
    };
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private syncBgmGain(): void {
    if (!this.ctx || !this.bgmGain || !this.bgmOscA || !this.bgmOscB || !this.bgmFilter) return;
    const targetVol =
      !this.bgmWanted || this.bgmSuspended || this.settings.isMuted
        ? 0.0001
        : Math.max(0.0001, this.settings.masterVolumeRatio * this.settings.bgmVolumeRatio * 0.048);
    this.bgmGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.12);
    const rootHz = this.bgmBossMode ? 65.41 : 55;
    this.bgmOscA.frequency.setTargetAtTime(rootHz, this.ctx.currentTime, 0.25);
    this.bgmOscB.frequency.setTargetAtTime(rootHz * 1.008, this.ctx.currentTime, 0.25);
    this.bgmFilter.frequency.setTargetAtTime(this.bgmBossMode ? 275 : 175, this.ctx.currentTime, 0.25);
    if (this.bgmLfo && this.bgmLfoGain) {
      this.bgmLfo.frequency.setTargetAtTime(this.bgmBossMode ? 0.42 : 0.16, this.ctx.currentTime, 0.25);
      this.bgmLfoGain.gain.setTargetAtTime(this.bgmBossMode ? 95 : 52, this.ctx.currentTime, 0.25);
    }
  }

  private getSfxGain(baseVolume: number): number {
    if (this.settings.isMuted) return 0;
    return baseVolume * this.settings.masterVolumeRatio * this.settings.sfxVolumeRatio;
  }

  private canTrigger(key: string, minGapMs: number, highPriority: boolean): boolean {
    if (this.settings.isMuted || !this.ctx || this.ctx.state !== 'running') return false;
    if (!highPriority && this.activeVoices >= MAX_CONCURRENT_VOICES) return false;
    if (minGapMs > 0) {
      const now = performance.now();
      const prev = this.lastPlayedMs.get(key) ?? 0;
      if (now - prev < minGapMs) return false;
      this.lastPlayedMs.set(key, now);
    }
    return true;
  }

  private playTone(
    freqStart: number,
    durationSec: number,
    type: OscillatorType,
    baseVol: number,
    freqEnd?: number,
    delaySec: number = 0,
  ): void {
    if (!this.ctx) return;
    const gainVal = this.getSfxGain(baseVol);
    if (gainVal <= 0.0005) return;

    const now = this.ctx.currentTime + delaySec;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freqStart), now);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now + durationSec);
    }

    gain.gain.setValueAtTime(0.0005, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + durationSec);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    this.activeVoices += 1;
    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  private playNoiseBurst(
    durationSec: number,
    baseVol: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    q: number = 1.2,
    delaySec: number = 0,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const gainVal = this.getSfxGain(baseVol);
    if (gainVal <= 0.0005) return;

    const now = this.ctx.currentTime + delaySec;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(Math.max(40, freqStart), now);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + durationSec);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0005, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + durationSec);

    src.connect(flt);
    flt.connect(gain);
    gain.connect(this.ctx.destination);

    this.activeVoices += 1;
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      src.disconnect();
      flt.disconnect();
      gain.disconnect();
    };
    src.start(now, 0, Math.min(durationSec + 0.02, this.noiseBuffer.duration));
  }

  public consumeEvents(events: readonly GameEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev) continue;
      switch (ev.type) {
        case 'WEAPON_FIRED': {
          if (!this.canTrigger(`fire:${ev.weaponId}`, 65, false)) break;
          if (ev.weaponId === 'void_lightning') {
            this.playNoiseBurst(0.11, ev.isEvolution ? 0.085 : 0.06, 'bandpass', 3200, 760, 2.2);
            this.playTone(ev.isEvolution ? 1120 : 880, 0.08, 'sawtooth', 0.04, 240);
          } else if (ev.weaponId === 'gravity_nova') {
            this.playTone(ev.isEvolution ? 210 : 175, 0.24, 'sine', 0.12, 38);
            this.playNoiseBurst(0.18, 0.055, 'lowpass', 620, 110, 1.8);
          } else if (ev.weaponId === 'rift_beam') {
            this.playTone(ev.isEvolution ? 760 : 620, 0.16, 'sawtooth', 0.065, 290);
            this.playTone(ev.isEvolution ? 1520 : 1240, 0.14, 'triangle', 0.035, 580);
          } else if (ev.weaponId === 'boomerang_matrix') {
            this.playTone(340, 0.09, 'triangle', 0.055, ev.isEvolution ? 780 : 620);
          } else {
            // tracking_pulse / orbital_blade
            const f0 = ev.isEvolution ? 720 : 580;
            this.playTone(f0, 0.065, 'triangle', 0.05, f0 * 0.36);
            if (ev.isEvolution) {
              this.playTone(f0 * 1.5, 0.06, 'sine', 0.028, f0 * 0.72);
            }
          }
          break;
        }
        case 'ENEMY_HIT': {
          if (!this.canTrigger('enemy_hit', 48, false)) break;
          if (ev.isCrit) {
            this.playTone(320, 0.055, 'triangle', 0.048, 120);
            this.playTone(1174, 0.075, 'sine', 0.036, 1568);
          } else {
            this.playTone(190, 0.042, 'square', 0.024, 92);
          }
          break;
        }
        case 'ENEMY_KILLED': {
          const isBig = ev.tier === 'elite' || ev.tier === 'boss';
          if (!this.canTrigger('enemy_kill', isBig ? 0 : 55, isBig)) break;
          if (ev.tier === 'boss') {
            this.playTone(125, 0.62, 'sawtooth', 0.16, 32);
            this.playNoiseBurst(0.55, 0.16, 'lowpass', 1400, 95, 1.4);
            this.playTone(260, 0.48, 'triangle', 0.11, 58, 0.06);
          } else if (ev.tier === 'elite') {
            this.playTone(185, 0.28, 'sawtooth', 0.11, 48);
            this.playNoiseBurst(0.24, 0.095, 'lowpass', 1600, 180, 1.3);
          } else {
            this.playTone(235, 0.065, 'triangle', 0.038, 72);
            this.playNoiseBurst(0.055, 0.03, 'bandpass', 1500, 420, 1.1);
          }
          break;
        }
        case 'XP_PICKED': {
          if (!this.canTrigger('xp_pick', 38, false)) break;
          const now = performance.now();
          if (now - this.lastXpTimeMs > 480) this.xpStreak = 0;
          else this.xpStreak = Math.min(this.xpStreak + 1, PENTATONIC_HZ.length - 1);
          this.lastXpTimeMs = now;
          const hz = PENTATONIC_HZ[this.xpStreak] ?? 523.25;
          this.playTone(hz, 0.085, 'sine', 0.06, hz * 1.06);
          break;
        }
        case 'PLAYER_HIT': {
          if (!this.canTrigger('player_hit', 150, true)) break;
          this.playTone(145, 0.2, 'sawtooth', 0.14, 48);
          this.playNoiseBurst(0.14, 0.09, 'lowpass', 900, 140, 1.6);
          break;
        }
        case 'PLAYER_HEALED': {
          if (!this.canTrigger('player_heal', 120, false)) break;
          this.playTone(440, 0.13, 'sine', 0.07, 660);
          this.playTone(660, 0.15, 'triangle', 0.055, 880, 0.05);
          break;
        }
        case 'LEVEL_UP': {
          if (!this.canTrigger('level_up', 0, true)) break;
          [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
            this.playTone(f, 0.22, 'triangle', 0.085, undefined, idx * 0.052);
          });
          break;
        }
        case 'CHEST_OPENED': {
          if (!this.canTrigger('chest', 0, true)) break;
          const notes = ev.evolvedTo
            ? [440, 554.37, 659.25, 880, 1108.73, 1318.51]
            : [523.25, 659.25, 783.99];
          notes.forEach((f, idx) => {
            this.playTone(f, 0.28, 'triangle', 0.095, undefined, idx * 0.05);
          });
          break;
        }
        case 'ALTAR_COMPLETED': {
          if (!this.canTrigger('altar', 100, true)) break;
          this.playTone(115, 0.42, 'sine', 0.14, 42);
          [440, 554.37, 659.25, 880].forEach((f, idx) => {
            this.playTone(f, 0.25, 'sine', 0.08, undefined, idx * 0.045);
          });
          break;
        }
        case 'BEACON_TRIGGERED': {
          if (!this.canTrigger('beacon', 100, true)) break;
          if (ev.kind === 'beacon_nuke') {
            this.playTone(180, 0.45, 'sawtooth', 0.14, 36);
            this.playNoiseBurst(0.4, 0.13, 'lowpass', 1800, 110, 1.5);
          } else {
            this.playTone(340, 0.22, 'sine', 0.095, 820);
          }
          break;
        }
        case 'BOSS_SPAWNED':
        case 'BOSS_PHASE_CHANGED': {
          if (!this.canTrigger('boss_alert', 200, true)) break;
          // 深空科幻铜管压迫警报（Braam）
          this.playTone(65.41, 0.6, 'sawtooth', 0.14, 58);
          this.playTone(98.0, 0.55, 'sawtooth', 0.1, 88, 0.06);
          this.playNoiseBurst(0.32, 0.075, 'lowpass', 780, 160, 1.8);
          break;
        }
        case 'BOSS_DEATH_OUTRO_STARTED': {
          if (!this.canTrigger('boss_death_outro', 0, true)) break;
          // 第一幕（0.00s – 1.25s）：结构过载低频轰鸣 + 5 次递进连锁殉爆
          this.playTone(68, 1.25, 'sawtooth', 0.11, 46, 0);
          [0.12, 0.34, 0.58, 0.82, 1.06].forEach((delay, idx) => {
            this.playNoiseBurst(0.22, 0.085 + idx * 0.01, 'lowpass', 1200 + idx * 140, 140, 1.5, delay);
            this.playTone(135 + idx * 18, 0.18, 'sawtooth', 0.075, 52, delay);
          });
          // 第二幕（1.25s – 1.65s）：奇点核心内爆拉升啸叫
          this.playTone(140, 0.4, 'sine', 0.095, 620, 1.25);
          this.playNoiseBurst(0.38, 0.08, 'bandpass', 420, 2400, 2.2, 1.25);
          // 第三幕（1.65s）：超新星终极瓦解冲击波 + 舒缓金辉释放和弦（1.80s – 2.85s）
          this.playTone(96, 0.85, 'sine', 0.16, 32, 1.65);
          this.playNoiseBurst(0.75, 0.14, 'lowpass', 2400, 95, 1.2, 1.65);
          [523.25, 659.25, 783.99, 987.77, 1046.5].forEach((f, idx) => {
            this.playTone(f, 0.72, 'triangle', 0.065, undefined, 1.82 + idx * 0.11);
          });
          break;
        }
        case 'RUN_VICTORY': {
          if (!this.canTrigger('victory', 0, true)) break;
          [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, idx) => {
            this.playTone(f, 0.38, 'triangle', 0.1, undefined, idx * 0.075);
          });
          break;
        }
        case 'RUN_GAME_OVER': {
          if (!this.canTrigger('gameover', 0, true)) break;
          [330, 293.66, 246.94, 196].forEach((f, idx) => {
            this.playTone(f, 0.32, 'sawtooth', 0.08, undefined, idx * 0.1);
          });
          break;
        }
      }
    }
  }
}
