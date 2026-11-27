/**
 * 原生 HTML5 Canvas 2D 深空荧光渲染器（遵守 docs/04 与 docs/06 性能及配色规范）
 * - 固定逻辑视口 1280×720（16:9），DPR 封顶 2x；
 * - 严格只读消费 RenderSnapshot 与 GameEvents，严禁反向修改 Core 实体；
 * - 300+ 普通怪/弹幕热路径禁开 shadowBlur（双层轮廓模拟霓虹），支持低粒子/无震屏/无飘字开关。
 */
import type { GameSettings } from '../../../schemas';
import {
  ENEMY_SPRITE_KEY_BY_ID,
  STAGE_ENVIRONMENT_THEMES,
  type SpriteAssetKey,
} from '../../assets/manifest';
import type { GameEvent, RenderSnapshot } from '../../core/contracts/gameContracts';
import { SpriteAssetManager } from '../assets/SpriteAssetManager';

export const LOGICAL_WIDTH = 1280;
export const LOGICAL_HEIGHT = 720;

interface StarNode {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly alpha: number;
  readonly twinklePhase: number;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeSec: number;
  maxLifeSec: number;
  sizePx: number;
  colorHex: string;
}

interface FloatingText {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  colorHex: string;
  scale: number;
  lifeSec: number;
  maxLifeSec: number;
  isCrit: boolean;
}

interface ShockRing {
  active: boolean;
  x: number;
  y: number;
  radiusPx: number;
  maxRadiusPx: number;
  lifeSec: number;
  maxLifeSec: number;
  colorHex: string;
  lineWidth: number;
}

interface ImpactFlash {
  active: boolean;
  x: number;
  y: number;
  radiusPx: number;
  lifeSec: number;
  maxLifeSec: number;
  colorHex: string;
  rotRad: number;
}

interface TrailNode {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  ageSec: number;
}

interface DashGhost {
  active: boolean;
  spriteKey: SpriteAssetKey;
  x: number;
  y: number;
  drawSize: number;
  angleRad: number;
  tintHex: string;
  lifeSec: number;
  maxLifeSec: number;
}

interface PrevCircleTelegraph {
  x: number;
  y: number;
  radiusPx: number;
  progressRatio: number;
}

const MAX_PARTICLES = 240;
const LOW_PERF_PARTICLES = 80;
const MAX_FLOATING_TEXTS = 60;
const MAX_SHOCK_RINGS = 36;
const MAX_IMPACT_FLASHES = 28;
const MAX_TRAIL_NODES = 26;
const MAX_DASH_GHOSTS = 28;

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new SpriteAssetManager();
  private readonly farStars: StarNode[] = [];
  private readonly midStars: StarNode[] = [];
  private readonly fgDust: StarNode[] = [];
  private readonly playerTrail: TrailNode[] = [];
  private hasLastPlayerPos = false;
  private lastPlayerX = 0;
  private lastPlayerY = 0;
  private playerVelX = 0;
  private playerVelY = 0;
  private trailSampleAccumSec = 0;
  private camX = 0;
  private camY = 0;
  private shakeMagPx = 0;
  private hurtFlashAlpha = 0;
  private screenFlashAlpha = 0;
  private screenFlashRgb = '250, 204, 21';
  private muzzleFlashSec = 0;
  private muzzleFlashGold = false;
  private healAuraSec = 0;
  private thrusterSparkAccumSec = 0;
  private particleCursor = 0;
  private textCursor = 0;
  private ringCursor = 0;
  private flashCursor = 0;
  private dashGhostCursor = 0;
  private dashGhostSampleAccumSec = 0;
  private prevCircleTelegraphs: PrevCircleTelegraph[] = [];
  private vfxSeed = 1337;

  private readonly particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lifeSec: 0,
    maxLifeSec: 0.3,
    sizePx: 3,
    colorHex: '#38BDF8',
  }));

  private readonly floatingTexts: FloatingText[] = Array.from({ length: MAX_FLOATING_TEXTS }, () => ({
    active: false,
    x: 0,
    y: 0,
    vy: -42,
    text: '',
    colorHex: '#E0F2FE',
    scale: 1,
    lifeSec: 0,
    maxLifeSec: 0.5,
    isCrit: false,
  }));

  private readonly shockRings: ShockRing[] = Array.from({ length: MAX_SHOCK_RINGS }, () => ({
    active: false,
    x: 0,
    y: 0,
    radiusPx: 4,
    maxRadiusPx: 48,
    lifeSec: 0,
    maxLifeSec: 0.25,
    colorHex: '#38BDF8',
    lineWidth: 2,
  }));

  private readonly impactFlashes: ImpactFlash[] = Array.from({ length: MAX_IMPACT_FLASHES }, () => ({
    active: false,
    x: 0,
    y: 0,
    radiusPx: 18,
    lifeSec: 0,
    maxLifeSec: 0.14,
    colorHex: '#FFFFFF',
    rotRad: 0,
  }));

  private readonly dashGhosts: DashGhost[] = Array.from({ length: MAX_DASH_GHOSTS }, () => ({
    active: false,
    spriteKey: 'boss_void_weaver',
    x: 0,
    y: 0,
    drawSize: 120,
    angleRad: 0,
    tintHex: '#FF1E56',
    lifeSec: 0,
    maxLifeSec: 0.28,
  }));

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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Failed to initialize 2D rendering context');
    }
    this.ctx = context;
    this.initStarfield();
    this.sprites.preloadAll();
    this.resize();
  }

  private initStarfield(): void {
    for (let i = 0; i < 85; i++) {
      this.farStars.push({
        x: this.nextVfxRand() * LOGICAL_WIDTH,
        y: this.nextVfxRand() * LOGICAL_HEIGHT,
        size: 0.9 + this.nextVfxRand() * 1.3,
        alpha: 0.25 + this.nextVfxRand() * 0.45,
        twinklePhase: this.nextVfxRand() * Math.PI * 2,
      });
    }
    for (let i = 0; i < 40; i++) {
      this.midStars.push({
        x: this.nextVfxRand() * LOGICAL_WIDTH,
        y: this.nextVfxRand() * LOGICAL_HEIGHT,
        size: 1.5 + this.nextVfxRand() * 1.8,
        alpha: 0.35 + this.nextVfxRand() * 0.5,
        twinklePhase: this.nextVfxRand() * Math.PI * 2,
      });
    }
    for (let i = 0; i < 36; i++) {
      this.fgDust.push({
        x: this.nextVfxRand() * LOGICAL_WIDTH,
        y: this.nextVfxRand() * LOGICAL_HEIGHT,
        size: 1.4 + this.nextVfxRand() * 1.4,
        alpha: 0.24 + this.nextVfxRand() * 0.32,
        twinklePhase: this.nextVfxRand() * Math.PI * 2,
      });
    }
  }

  public resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(LOGICAL_WIDTH * dpr);
    this.canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public updateSettings(next: GameSettings): void {
    this.settings = { ...next };
    if (next.disableScreenShake) this.shakeMagPx = 0;
  }

  public resetVisualPools(): void {
    this.camX = 0;
    this.camY = 0;
    this.shakeMagPx = 0;
    this.hurtFlashAlpha = 0;
    this.screenFlashAlpha = 0;
    this.muzzleFlashSec = 0;
    this.muzzleFlashGold = false;
    this.healAuraSec = 0;
    this.thrusterSparkAccumSec = 0;
    this.hasLastPlayerPos = false;
    this.playerVelX = 0;
    this.playerVelY = 0;
    this.trailSampleAccumSec = 0;
    this.playerTrail.length = 0;
    for (const p of this.particles) p.active = false;
    for (const t of this.floatingTexts) t.active = false;
    for (const sr of this.shockRings) sr.active = false;
    for (const fl of this.impactFlashes) fl.active = false;
    for (const dg of this.dashGhosts) dg.active = false;
    this.dashGhostSampleAccumSec = 0;
    this.prevCircleTelegraphs.length = 0;
  }

  private nextVfxRand(): number {
    this.vfxSeed = (this.vfxSeed * 1664525 + 1013904223) >>> 0;
    return this.vfxSeed / 4294967296;
  }

  public consumeEvents(events: readonly GameEvent[]): void {
    const lowPerf = this.settings.lowParticleMode;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev) continue;
      switch (ev.type) {
        case 'WEAPON_FIRED': {
          this.muzzleFlashSec = 0.085;
          this.muzzleFlashGold = ev.isEvolution;
          break;
        }
        case 'ENEMY_HIT': {
          this.spawnParticles(ev.x, ev.y, ev.isCrit ? '#FACC15' : '#7DD3FC', lowPerf ? 1 : ev.isCrit ? 6 : 2);
          if (!lowPerf) {
            if (ev.isCrit) {
              this.spawnShockRing(ev.x, ev.y, 28, '#FACC15', 0.18, 2.4);
              this.spawnImpactFlash(ev.x, ev.y, 24, '#FACC15', 0.13);
            } else {
              this.spawnImpactFlash(ev.x, ev.y, 13, '#7DD3FC', 0.085);
            }
          }
          if (!this.settings.disableDamageText) {
            this.spawnText(
              ev.x + (this.nextVfxRand() - 0.5) * 18,
              ev.y - 14,
              ev.isCrit ? `✦${ev.damage}` : String(ev.damage),
              ev.isCrit ? '#FACC15' : '#E0F2FE',
              ev.isCrit ? 1.32 : 1.0,
              ev.isCrit,
            );
          }
          break;
        }
        case 'ENEMY_KILLED': {
          const baseCount = ev.tier === 'boss' ? 60 : ev.tier === 'elite' ? 30 : ev.enemyId === 'tank' ? 15 : 8;
          this.spawnParticles(ev.x, ev.y, ev.colorHex, lowPerf ? Math.max(2, Math.round(baseCount * 0.3)) : baseCount);
          if (!lowPerf) {
            if (ev.tier === 'boss') {
              this.spawnShockRing(ev.x, ev.y, 220, '#FACC15', 0.58, 5.5);
              this.spawnShockRing(ev.x, ev.y, 148, '#FF1E56', 0.44, 4.2);
              this.spawnImpactFlash(ev.x, ev.y, 92, '#FACC15', 0.28);
              this.spawnParticles(ev.x, ev.y, '#FEF08A', 22);
            } else if (ev.tier === 'elite') {
              this.spawnShockRing(ev.x, ev.y, 98, '#FACC15', 0.36, 3.4);
              this.spawnShockRing(ev.x, ev.y, 68, '#FF1E56', 0.28, 2.6);
              this.spawnImpactFlash(ev.x, ev.y, 52, '#FACC15', 0.2);
            } else {
              this.spawnShockRing(ev.x, ev.y, ev.enemyId === 'tank' ? 58 : 36, ev.colorHex, 0.22, 2.2);
              this.spawnImpactFlash(ev.x, ev.y, ev.enemyId === 'tank' ? 34 : 22, ev.colorHex, 0.14);
            }
          }
          if (!this.settings.disableScreenShake) {
            if (ev.tier === 'boss') {
              this.shakeMagPx = Math.max(this.shakeMagPx, 16);
              this.triggerScreenFlash('250, 204, 21', 0.24);
            } else if (ev.tier === 'elite') {
              this.shakeMagPx = Math.max(this.shakeMagPx, 10);
              this.triggerScreenFlash('250, 204, 21', 0.11);
            }
          }
          break;
        }
        case 'PLAYER_HIT': {
          this.hurtFlashAlpha = 0.36;
          if (!this.settings.disableScreenShake) {
            this.shakeMagPx = Math.max(this.shakeMagPx, 8);
          }
          this.spawnParticles(ev.x, ev.y, '#F43F5E', lowPerf ? 4 : 10);
          break;
        }
        case 'PLAYER_HEALED': {
          this.healAuraSec = 0.55;
          if (!this.settings.disableDamageText) {
            this.spawnText(ev.x, ev.y - 18, `+${ev.amount}`, '#34D399', 1.18, false);
          }
          if (!lowPerf) {
            this.spawnShockRing(ev.x, ev.y, 56, '#34D399', 0.36, 2.6);
          }
          this.spawnParticles(ev.x, ev.y, '#34D399', lowPerf ? 3 : 8);
          break;
        }
        case 'ALTAR_COMPLETED':
        case 'BEACON_TRIGGERED': {
          if (!this.settings.disableScreenShake) {
            this.shakeMagPx = Math.max(this.shakeMagPx, 11);
            this.triggerScreenFlash('56, 189, 248', 0.16);
          }
          if (!lowPerf) {
            this.spawnShockRing(ev.x, ev.y, 135, '#38BDF8', 0.42, 3.6);
            this.spawnImpactFlash(ev.x, ev.y, 58, '#7DD3FC', 0.2);
          }
          this.spawnParticles(ev.x, ev.y, '#38BDF8', lowPerf ? 8 : 26);
          break;
        }
        case 'BOSS_SPAWNED':
        case 'BOSS_PHASE_CHANGED': {
          if (!this.settings.disableScreenShake) {
            this.shakeMagPx = Math.max(this.shakeMagPx, 12);
            this.triggerScreenFlash('244, 63, 94', 0.16);
          }
          if (!lowPerf) {
            this.spawnShockRing(ev.x, ev.y, 165, '#FF1E56', 0.48, 4);
          }
          this.spawnParticles(ev.x, ev.y, '#FF1E56', lowPerf ? 10 : 30);
          break;
        }
        case 'BOSS_IMMUNE': {
          this.spawnText(ev.x, ev.y - 42, ev.label, '#C084FC', 1.24, true);
          this.spawnParticles(ev.x, ev.y, '#C084FC', lowPerf ? 3 : 10);
          break;
        }
        default:
          break;
      }
    }
  }

  private spawnShockRing(
    x: number,
    y: number,
    maxRadiusPx: number,
    colorHex: string,
    durationSec: number,
    lineWidth: number,
  ): void {
    const slot = this.shockRings[this.ringCursor % MAX_SHOCK_RINGS];
    this.ringCursor = (this.ringCursor + 1) % MAX_SHOCK_RINGS;
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.radiusPx = 4;
    slot.maxRadiusPx = maxRadiusPx;
    slot.lifeSec = durationSec;
    slot.maxLifeSec = durationSec;
    slot.colorHex = colorHex;
    slot.lineWidth = lineWidth;
  }

  private spawnParticles(x: number, y: number, colorHex: string, count: number): void {
    const cap = this.settings.lowParticleMode ? LOW_PERF_PARTICLES : MAX_PARTICLES;
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor % cap];
      this.particleCursor = (this.particleCursor + 1) % cap;
      if (!slot) continue;
      const ang = this.nextVfxRand() * Math.PI * 2;
      const spd = 45 + this.nextVfxRand() * 170;
      const life = 0.22 + this.nextVfxRand() * 0.24;
      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.vx = Math.cos(ang) * spd;
      slot.vy = Math.sin(ang) * spd;
      slot.lifeSec = life;
      slot.maxLifeSec = life;
      slot.sizePx = 2 + this.nextVfxRand() * 3.2;
      slot.colorHex = colorHex;
    }
  }

  private spawnImpactFlash(x: number, y: number, radiusPx: number, colorHex: string, durationSec: number): void {
    const slot = this.impactFlashes[this.flashCursor % MAX_IMPACT_FLASHES];
    this.flashCursor = (this.flashCursor + 1) % MAX_IMPACT_FLASHES;
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.radiusPx = radiusPx;
    slot.lifeSec = durationSec;
    slot.maxLifeSec = durationSec;
    slot.colorHex = colorHex;
    slot.rotRad = this.nextVfxRand() * Math.PI * 0.5;
  }

  private triggerScreenFlash(rgb: string, alpha: number): void {
    if (alpha >= this.screenFlashAlpha) {
      this.screenFlashRgb = rgb;
      this.screenFlashAlpha = alpha;
    }
  }

  private spawnText(x: number, y: number, text: string, colorHex: string, scale: number, isCrit: boolean): void {
    // 优先复用非活跃槽，若满优先淘汰普通飘字保留暴击飘字
    let target = this.floatingTexts.find((t) => !t.active);
    if (!target) {
      target = this.floatingTexts.find((t) => !t.isCrit) ?? this.floatingTexts[this.textCursor % MAX_FLOATING_TEXTS];
      this.textCursor = (this.textCursor + 1) % MAX_FLOATING_TEXTS;
    }
    if (!target) return;
    const life = isCrit ? 0.66 : 0.5;
    target.active = true;
    target.x = x;
    target.y = y;
    target.vy = isCrit ? -62 : -48;
    target.text = text;
    target.colorHex = colorHex;
    target.scale = scale;
    target.lifeSec = life;
    target.maxLifeSec = life;
    target.isCrit = isCrit;
  }

  public getActiveParticleCount(): number {
    let count = 0;
    for (const p of this.particles) if (p.active) count++;
    return count;
  }

  public render(snap: RenderSnapshot, dtSec: number, isTitleBackground: boolean): void {
    const ctx = this.ctx;
    const dt = Math.min(0.05, Math.max(0, dtSec));

    // 平滑计算玩家瞬时世界速度 + 弹性相机跟随（略带运动偏移，告别主角死钉屏幕正中央导致的眩晕感）
    if (isTitleBackground) {
      this.camX += 24 * dt;
      this.camY += 12 * dt;
      this.playerVelX = 0;
      this.playerVelY = 0;
    } else {
      if (this.hasLastPlayerPos && dt > 0.0005) {
        const instVx = (snap.player.x - this.lastPlayerX) / dt;
        const instVy = (snap.player.y - this.lastPlayerY) / dt;
        const jumpDist = Math.hypot(snap.player.x - this.lastPlayerX, snap.player.y - this.lastPlayerY);
        if (jumpDist > 260) {
          // 换关/重开瞬移时重置轨迹与相机，避免拉丝
          this.playerTrail.length = 0;
          this.camX = snap.cameraTargetX;
          this.camY = snap.cameraTargetY;
          this.playerVelX = 0;
          this.playerVelY = 0;
        } else {
          const velBlend = Math.min(1, dt * 12);
          this.playerVelX += (instVx - this.playerVelX) * velBlend;
          this.playerVelY += (instVy - this.playerVelY) * velBlend;
        }
      } else if (!this.hasLastPlayerPos) {
        this.camX = snap.cameraTargetX;
        this.camY = snap.cameraTargetY;
      }
      this.lastPlayerX = snap.player.x;
      this.lastPlayerY = snap.player.y;
      this.hasLastPlayerPos = true;

      // 相机轻微滞后偏移（最多 ~36px），让飞船朝移动方向在画面内肉眼可见地滑出中心，清晰感知速度与转向
      const speed = Math.hypot(this.playerVelX, this.playerVelY);
      const offsetRatio = Math.min(1, speed / 260);
      const dirX = speed > 5 ? this.playerVelX / speed : 0;
      const dirY = speed > 5 ? this.playerVelY / speed : 0;
      const desiredCamX = snap.cameraTargetX - dirX * 36 * offsetRatio;
      const desiredCamY = snap.cameraTargetY - dirY * 26 * offsetRatio;

      this.camX += (desiredCamX - this.camX) * Math.min(1, dt * 6.5);
      this.camY += (desiredCamY - this.camY) * Math.min(1, dt * 6.5);

      // 更新玩家世界坐标飞行轨迹光带
      for (let i = this.playerTrail.length - 1; i >= 0; i--) {
        const node = this.playerTrail[i];
        if (!node) continue;
        node.ageSec += dt;
        if (node.ageSec > 0.44) {
          this.playerTrail.splice(i, 1);
        }
      }
      this.trailSampleAccumSec += dt;
      if (snap.player.isAlive && this.trailSampleAccumSec >= 0.016) {
        this.trailSampleAccumSec = 0;
        const last = this.playerTrail[this.playerTrail.length - 1];
        const moved = !last || Math.hypot(snap.player.x - last.x, snap.player.y - last.y) >= 4;
        if (moved) {
          this.playerTrail.push({
            x: snap.player.x,
            y: snap.player.y,
            dirX: snap.player.dirX,
            dirY: snap.player.dirY,
            ageSec: 0,
          });
          if (this.playerTrail.length > MAX_TRAIL_NODES) {
            this.playerTrail.shift();
          }
        }
      }
    }

    if (this.shakeMagPx > 0) this.shakeMagPx = Math.max(0, this.shakeMagPx - dt * 30);
    if (this.hurtFlashAlpha > 0) this.hurtFlashAlpha = Math.max(0, this.hurtFlashAlpha - dt * 1.4);
    if (this.screenFlashAlpha > 0) this.screenFlashAlpha = Math.max(0, this.screenFlashAlpha - dt * 1.35);
    if (this.muzzleFlashSec > 0) this.muzzleFlashSec = Math.max(0, this.muzzleFlashSec - dt);
    if (this.healAuraSec > 0) this.healAuraSec = Math.max(0, this.healAuraSec - dt);

    // 移动时从主角双喷口持续逸散细腻离子微火花粒子（增强高速飞行细腻质感）
    if (!isTitleBackground && !this.settings.lowParticleMode && snap.player.isAlive) {
      const pSpeed = Math.hypot(this.playerVelX, this.playerVelY);
      if (pSpeed > 55) {
        this.thrusterSparkAccumSec += dt;
        if (this.thrusterSparkAccumSec >= 0.055) {
          this.thrusterSparkAccumSec = 0;
          const tier = snap.player.formTier;
          const sparkCol = tier >= 5 ? '#FACC15' : tier === 4 ? '#C084FC' : tier === 3 ? '#34D399' : '#7DD3FC';
          const tailX = snap.player.x - snap.player.dirX * (snap.player.radiusPx * 1.15);
          const tailY = snap.player.y - snap.player.dirY * (snap.player.radiusPx * 1.15);
          this.spawnParticles(tailX, tailY, sparkCol, 1);
        }
      }
    }

    // 1. 五阶段无限无缝卷轴深空背景 + 1:1 战术坐标网格与地标碎石
    const stageTier = Math.max(1, Math.min(5, snap.player.formTier || 1));
    const theme = STAGE_ENVIRONMENT_THEMES[stageTier] ?? STAGE_ENVIRONMENT_THEMES[1]!;
    ctx.fillStyle = snap.isEndless ? '#0D0418' : theme.baseBgHex;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const shakeX = !this.settings.disableScreenShake && this.shakeMagPx > 0 ? (this.nextVfxRand() - 0.5) * this.shakeMagPx * 2 : 0;
    const shakeY = !this.settings.disableScreenShake && this.shakeMagPx > 0 ? (this.nextVfxRand() - 0.5) * this.shakeMagPx * 2 : 0;
    const viewLeft = this.camX - LOGICAL_WIDTH / 2 + shakeX;
    const viewTop = this.camY - LOGICAL_HEIGHT / 2 + shakeY;

    this.drawCinematicBackdrop(viewLeft, viewTop, snap.worldTimeSec, stageTier, snap.isEndless, snap.isBossActive);
    this.drawParallaxGrid(viewLeft, viewTop, stageTier, snap.isEndless);

    if (isTitleBackground) {
      return;
    }

    const cullMargin = 90;
    const minX = viewLeft - cullMargin;
    const maxX = viewLeft + LOGICAL_WIDTH + cullMargin;
    const minY = viewTop - cullMargin;
    const maxY = viewTop + LOGICAL_HEIGHT + cullMargin;

    ctx.save();
    ctx.translate(-viewLeft, -viewTop);

    // 1.5 世界空间 1:1 静止地标碎石与航标（强化真实速度与位移参照）
    this.drawWorldLandmarks(viewLeft, viewTop, stageTier, snap.worldTimeSec);

    // 2. 地面事件层：充能祭坛、战术信标、进化宝箱、全息高危技能预警
    this.syncTelegraphDetonations(snap);
    this.drawAltars(snap);
    this.drawBeacons(snap);
    this.drawChests(snap);
    this.drawTelegraphs(snap);

    // 3. 震荡环与落雷特效
    this.drawNovaRings(snap);
    this.drawLightningStrikes(snap);
    this.drawBeamRays(snap);

    // 4. 经验宝石
    this.drawXpGems(snap, minX, maxX, minY, maxY);

    // 5. Boss/精英高速冲锋残影 + 敌怪与 Boss 主体
    this.stepAndDrawDashGhosts(snap, dt);
    this.drawEnemies(snap, minX, maxX, minY, maxY);

    // 6. 我方弹幕、环绕相位刃与敌方炽橙弹幕
    this.drawPlayerProjectiles(snap, minX, maxX, minY, maxY);
    this.drawOrbitalBlades(snap);
    this.drawEnemyBullets(snap, minX, maxX, minY, maxY);

    // 7. 主角飞行轨迹双离子光带 + 主角机甲
    this.drawPlayerTrajectoryTrail(snap);
    this.drawPlayer(snap);

    // 8. 粒子池与伤害飘字池
    this.stepAndDrawParticles(dt);
    this.stepAndDrawTexts(dt);

    ctx.restore();

    // 8.5 前景高速视差星尘速度线（1.24x 视差，随飞行速度拉出流光速度丝）
    if (!this.settings.lowParticleMode) {
      this.drawForegroundSpeedDust(viewLeft, viewTop, stageTier, snap.isEndless);
    }

    // 9. 屏幕空间层：电影级氛围暗角（Boss 战红脉冲） + 全屏高能闪光 + 受击红晕 + 事件边缘指示器
    this.drawAtmosphericVignette(snap.worldTimeSec, snap.isBossActive, snap.isEndless);
    if (this.screenFlashAlpha > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(${this.screenFlashRgb}, ${this.screenFlashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();
    }
    if (this.hurtFlashAlpha > 0.01) {
      ctx.save();
      const grad = ctx.createRadialGradient(
        LOGICAL_WIDTH / 2,
        LOGICAL_HEIGHT / 2,
        LOGICAL_HEIGHT * 0.32,
        LOGICAL_WIDTH / 2,
        LOGICAL_HEIGHT / 2,
        LOGICAL_WIDTH * 0.62,
      );
      grad.addColorStop(0, 'rgba(244, 63, 94, 0)');
      grad.addColorStop(1, `rgba(244, 63, 94, ${this.hurtFlashAlpha.toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();
    }
    this.drawEdgeIndicators(snap);
  }

  private drawAtmosphericVignette(worldTimeSec: number, isBossActive: boolean, isEndless: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    const grad = ctx.createRadialGradient(
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_HEIGHT * 0.38,
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_WIDTH * 0.68,
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    if (isBossActive) {
      const bossPulse = 0.24 + 0.08 * Math.sin(worldTimeSec * 4.2);
      grad.addColorStop(1, `rgba(110, 12, 36, ${bossPulse.toFixed(3)})`);
    } else if (isEndless) {
      grad.addColorStop(1, 'rgba(46, 12, 78, 0.28)');
    } else {
      grad.addColorStop(1, 'rgba(2, 6, 16, 0.32)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.restore();
  }

  private drawCinematicBackdrop(
    viewLeft: number,
    viewTop: number,
    worldTimeSec: number,
    stageTier: number,
    isEndless: boolean,
    isBossActive: boolean,
  ): void {
    const ctx = this.ctx;
    const theme = STAGE_ENVIRONMENT_THEMES[stageTier] ?? STAGE_ENVIRONMENT_THEMES[1]!;

    // 1. 五阶段 2x2 镜像无缝星空背景：严格单调真实视差卷轴（0.25x 世界速度，绝不反向摆动致晕）
    const stageBg = this.sprites.getStageBackground(stageTier);
    if (stageBg) {
      const tw = stageBg.width;
      const th = stageBg.height;
      const parallax = 0.25;
      const offX = -(((viewLeft * parallax) % tw) + tw) % tw;
      const offY = -(((viewTop * parallax) % th) + th) % th;

      for (let x = offX; x < LOGICAL_WIDTH; x += tw) {
        for (let y = offY; y < LOGICAL_HEIGHT; y += th) {
          ctx.drawImage(stageBg, x, y);
        }
      }

      // 柔和暗角对比幕布，确保子弹与敌怪永远高对比一眼可读
      ctx.fillStyle = isEndless
        ? 'rgba(20, 6, 36, 0.34)'
        : isBossActive
          ? 'rgba(24, 4, 12, 0.24)'
          : 'rgba(3, 6, 14, 0.24)';
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    } else if (!this.settings.lowParticleMode) {
      // 贴图加载前程序化深空星云兜底
      const driftX1 = (((-viewLeft * 0.08) % LOGICAL_WIDTH) + LOGICAL_WIDTH) % LOGICAL_WIDTH;
      const driftY1 = (((-viewTop * 0.08) % LOGICAL_HEIGHT) + LOGICAL_HEIGHT) % LOGICAL_HEIGHT;
      const g1 = ctx.createRadialGradient(driftX1, driftY1, 40, driftX1, driftY1, 520);
      g1.addColorStop(0, isEndless ? 'rgba(168, 85, 247, 0.22)' : theme.nebulaPrimaryRgba);
      g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    }

    // 2. 双层视差动态星尘（远景 0.16x + 中景 0.56x，与背景形成清晰景深速度差）
    const drawLayer = (stars: readonly StarNode[], factor: number, maxCount: number): void => {
      ctx.fillStyle = isEndless ? '#E9D5FF' : theme.starTintHex;
      const count = Math.min(stars.length, maxCount);
      for (let i = 0; i < count; i++) {
        const s = stars[i];
        if (!s) continue;
        const sx = (((s.x - viewLeft * factor) % LOGICAL_WIDTH) + LOGICAL_WIDTH) % LOGICAL_WIDTH;
        const sy = (((s.y - viewTop * factor) % LOGICAL_HEIGHT) + LOGICAL_HEIGHT) % LOGICAL_HEIGHT;
        const twinkle = 0.55 + 0.45 * Math.sin(worldTimeSec * 2.6 + s.twinklePhase);
        ctx.globalAlpha = s.alpha * twinkle;
        ctx.fillRect(sx, sy, s.size, s.size);
      }
    };

    const low = this.settings.lowParticleMode;
    drawLayer(this.farStars, 0.16, low ? 32 : 85);
    drawLayer(this.midStars, 0.56, low ? 16 : 40);
    ctx.globalAlpha = 1;
  }

  private drawParallaxGrid(viewLeft: number, viewTop: number, stageTier: number, isEndless: boolean): void {
    const ctx = this.ctx;
    const theme = STAGE_ENVIRONMENT_THEMES[stageTier] ?? STAGE_ENVIRONMENT_THEMES[1]!;
    const hasBg = this.sprites.getStageBackground(stageTier) !== null;
    ctx.save();

    // 1:1 世界空间轻量化全息战术网格：克制低调不抢星空星云，同时保留真实 1:1 位移速度参照
    const fine = 64;
    const offX = -((viewLeft % fine) + fine) % fine;
    const offY = -((viewTop % fine) + fine) % fine;

    ctx.globalAlpha = hasBg ? 0.14 : 0.52;
    ctx.strokeStyle = isEndless ? 'rgba(139, 92, 246, 0.16)' : theme.fineGridRgba;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offX; x < LOGICAL_WIDTH; x += fine) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOGICAL_HEIGHT);
    }
    for (let y = offY; y < LOGICAL_HEIGHT; y += fine) {
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_WIDTH, y);
    }
    ctx.stroke();

    const major = 256;
    const mOffX = -((viewLeft % major) + major) % major;
    const mOffY = -((viewTop % major) + major) % major;
    ctx.globalAlpha = hasBg ? 0.28 : 0.72;
    ctx.strokeStyle = isEndless ? 'rgba(192, 132, 252, 0.22)' : theme.majorGridRgba;
    ctx.beginPath();
    for (let x = mOffX; x < LOGICAL_WIDTH; x += major) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOGICAL_HEIGHT);
    }
    for (let y = mOffY; y < LOGICAL_HEIGHT; y += major) {
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_WIDTH, y);
    }
    ctx.stroke();

    // 256px 交叉点微光十字锚点与极淡星区编号
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = isEndless ? '#C084FC' : theme.starTintHex;
    ctx.fillStyle = isEndless ? 'rgba(216, 180, 254, 0.34)' : 'rgba(186, 230, 253, 0.26)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    const startCol = Math.floor(viewLeft / major);
    const startRow = Math.floor(viewTop / major);
    for (let x = mOffX, c = 0; x < LOGICAL_WIDTH + major; x += major, c++) {
      for (let y = mOffY, r = 0; y < LOGICAL_HEIGHT + major; y += major, r++) {
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.stroke();
        ctx.fillText(`S${startCol + c},${startRow + r}`, x + 6, y - 4);
      }
    }
    ctx.restore();
  }

  private drawWorldLandmarks(viewLeft: number, viewTop: number, stageTier: number, worldTimeSec: number): void {
    const ctx = this.ctx;
    const theme = STAGE_ENVIRONMENT_THEMES[stageTier] ?? STAGE_ENVIRONMENT_THEMES[1]!;
    const cell = 256;
    const minCol = Math.floor(viewLeft / cell) - 1;
    const maxCol = Math.floor((viewLeft + LOGICAL_WIDTH) / cell) + 1;
    const minRow = Math.floor(viewTop / cell) - 1;
    const maxRow = Math.floor((viewTop + LOGICAL_HEIGHT) / cell) + 1;

    ctx.save();
    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        // 确定性空间哈希：每个 256x256 格子生成 1~2 枚 1:1 世界静止小陨石碎片或微弱航标点
        const h1 = Math.sin(col * 127.1 + row * 311.7) * 43758.5453;
        const f1 = h1 - Math.floor(h1);
        const h2 = Math.sin(col * 269.5 + row * 183.3) * 43758.5453;
        const f2 = h2 - Math.floor(h2);
        const h3 = Math.sin(col * 419.2 + row * 371.9) * 43758.5453;
        const f3 = h3 - Math.floor(h3);

        const wx = col * cell + 36 + f1 * (cell - 72);
        const wy = row * cell + 36 + f2 * (cell - 72);

        if (f3 > 0.72) {
          // 1:1 微型深空航标灯（缓慢呼吸闪烁，强化位置参照）
          const pulse = 0.35 + 0.35 * Math.sin(worldTimeSec * 2.5 + f1 * 6.28);
          ctx.strokeStyle = theme.starTintHex;
          ctx.globalAlpha = pulse * 0.55;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(wx, wy, 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = theme.starTintHex;
          ctx.globalAlpha = pulse;
          ctx.beginPath();
          ctx.arc(wx, wy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 1:1 暗色多边形悬浮小碎石（低调不抢眼，飞过时速度感极强）
          const rad = 5 + f3 * 8;
          ctx.save();
          ctx.translate(wx, wy);
          ctx.rotate(f1 * Math.PI * 2);
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = '#1E293B';
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
          ctx.lineWidth = 1;
          this.drawRegularPolygon(ctx, 5 + (Math.floor(f2 * 3) % 3), rad, 0);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  private drawPlayerTrajectoryTrail(snap: RenderSnapshot): void {
    if (!snap.player.isAlive || this.playerTrail.length < 2) return;
    const ctx = this.ctx;
    const tier = Math.max(1, Math.min(5, snap.player.formTier));
    const ribbonColor =
      tier >= 5
        ? '#FACC15'
        : tier === 4
          ? '#C084FC'
          : tier === 3
            ? '#34D399'
            : '#38BDF8';
    const wingSpan = snap.player.radiusPx * (0.55 + tier * 0.08);

    ctx.save();
    if (!this.settings.lowParticleMode) {
      ctx.globalCompositeOperation = 'lighter';
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 绘制左右双翼尖离子飞行轨迹光带（世界坐标 1:1 留痕，清晰呈现飞行速度与曲线轨迹）
    for (const side of [-1, 1]) {
      for (let i = 1; i < this.playerTrail.length; i++) {
        const prev = this.playerTrail[i - 1];
        const curr = this.playerTrail[i];
        if (!prev || !curr) continue;
        const lifeRatio = Math.max(0, 1 - curr.ageSec / 0.44);
        const idxRatio = i / this.playerTrail.length;
        const alpha = lifeRatio * idxRatio * 0.62;
        if (alpha <= 0.02) continue;

        const pPerpX = -prev.dirY * side * wingSpan;
        const pPerpY = prev.dirX * side * wingSpan;
        const cPerpX = -curr.dirY * side * wingSpan;
        const cPerpY = curr.dirX * side * wingSpan;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ribbonColor;
        ctx.lineWidth = Math.max(1.2, idxRatio * 4.2);
        ctx.beginPath();
        ctx.moveTo(prev.x + pPerpX - prev.dirX * 12, prev.y + pPerpY - prev.dirY * 12);
        ctx.lineTo(curr.x + cPerpX - curr.dirX * 12, curr.y + cPerpY - curr.dirY * 12);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawForegroundSpeedDust(viewLeft: number, viewTop: number, stageTier: number, isEndless: boolean): void {
    const ctx = this.ctx;
    const theme = STAGE_ENVIRONMENT_THEMES[stageTier] ?? STAGE_ENVIRONMENT_THEMES[1]!;
    const speed = Math.hypot(this.playerVelX, this.playerVelY);
    const streakScale = Math.min(1, speed / 240);
    const streakX = -this.playerVelX * 0.045 * streakScale;
    const streakY = -this.playerVelY * 0.045 * streakScale;

    ctx.save();
    ctx.strokeStyle = isEndless ? '#E9D5FF' : theme.starTintHex;
    ctx.lineCap = 'round';
    const factor = 1.24;
    for (let i = 0; i < this.fgDust.length; i++) {
      const s = this.fgDust[i];
      if (!s) continue;
      const sx = (((s.x - viewLeft * factor) % LOGICAL_WIDTH) + LOGICAL_WIDTH) % LOGICAL_WIDTH;
      const sy = (((s.y - viewTop * factor) % LOGICAL_HEIGHT) + LOGICAL_HEIGHT) % LOGICAL_HEIGHT;
      ctx.globalAlpha = s.alpha * (0.45 + streakScale * 0.55);
      ctx.lineWidth = s.size * 0.72;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + streakX + 1.2, sy + streakY + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawAltars(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    const t = snap.worldTimeSec;
    for (const a of snap.altars) {
      const r = a.radiusPx;
      const cr = Math.max(0, Math.min(1, a.chargeRatio));
      ctx.save();

      // 1. 中心通透、边缘聚光的径向全息能量力场（充能时向金青色渐变升温）
      const fieldGrad = ctx.createRadialGradient(a.x, a.y, r * 0.12, a.x, a.y, r);
      fieldGrad.addColorStop(0, `rgba(56, 189, 248, ${(0.03 + cr * 0.06).toFixed(3)})`);
      fieldGrad.addColorStop(0.7, `rgba(56, 189, 248, ${(0.06 + cr * 0.08).toFixed(3)})`);
      fieldGrad.addColorStop(
        0.95,
        cr > 0.65
          ? `rgba(125, 211, 252, ${(0.22 + cr * 0.16).toFixed(3)})`
          : `rgba(56, 189, 248, ${(0.18 + cr * 0.14).toFixed(3)})`,
      );
      fieldGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = fieldGrad;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fill();

      // 2. 旋转分段全息科技外环与内指刻度
      ctx.save();
      if (!low) ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(56, 189, 248, ${(0.34 + cr * 0.24).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.stroke();

      const rot = t * (0.45 + cr * 1.35);
      ctx.strokeStyle = cr > 0 ? 'rgba(125, 211, 252, 0.82)' : 'rgba(56, 189, 248, 0.68)';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        const base = rot + (k * Math.PI) / 3;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r + 2, base + 0.12, base + Math.PI / 3 - 0.18);
        ctx.stroke();
      }
      if (!low) {
        ctx.strokeStyle = `rgba(186, 230, 253, ${(0.38 + cr * 0.42).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 6; k++) {
          const ang = -rot * 0.7 + (k * Math.PI) / 3;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          ctx.beginPath();
          ctx.moveTo(a.x + ca * (r - 2), a.y + sa * (r - 2));
          ctx.lineTo(a.x + ca * (r - 11), a.y + sa * (r - 11));
          ctx.stroke();
        }
      }

      // 3. 站入充能双层流光进度弧 + 进度前沿光核
      if (cr > 0) {
        const startAng = -Math.PI / 2;
        const endAng = startAng + cr * Math.PI * 2;
        const progR = r - 7;
        if (!low) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 9;
          ctx.beginPath();
          ctx.arc(a.x, a.y, progR, startAng, endAng);
          ctx.stroke();
        }
        ctx.strokeStyle = cr > 0.8 ? '#FEF08A' : '#7DD3FC';
        ctx.lineWidth = 3.8;
        ctx.beginPath();
        ctx.arc(a.x, a.y, progR, startAng, endAng);
        ctx.stroke();

        // 进度前沿高光能量珠
        const hx = a.x + Math.cos(endAng) * progR;
        const hy = a.y + Math.sin(endAng) * progR;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const altarSprite = this.sprites.get('prop_altar');
      if (altarSprite) {
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(t * (0.45 + cr * 1.4));
        const sz = 92;
        ctx.drawImage(altarSprite.normal, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }

      // 4. 祭坛提示标签（带暗玻璃微底衬，复杂星云下依然锐利）
      const label = cr > 0 ? `充能祭坛 ${Math.round(cr * 100)}%` : '充能祭坛 · 站入 5 秒';
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width;
      const ly = a.y - r - 14;
      ctx.fillStyle = 'rgba(4, 10, 22, 0.72)';
      ctx.beginPath();
      ctx.roundRect(a.x - tw / 2 - 9, ly - 12, tw + 18, 18, 9);
      ctx.fill();
      ctx.strokeStyle = cr > 0 ? 'rgba(125, 211, 252, 0.6)' : 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#E0F2FE';
      ctx.fillText(label, a.x, ly + 1);
      ctx.restore();
    }
  }

  private drawBeacons(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(snap.worldTimeSec * 5) * 0.1;
    for (const b of snap.beacons) {
      const color = b.kind === 'beacon_heal' ? '#34D399' : b.kind === 'beacon_nuke' ? '#FACC15' : '#22D3EE';
      const label = b.kind === 'beacon_heal' ? '修复核心' : b.kind === 'beacon_nuke' ? '虚空震爆' : '全域磁核';
      const key: SpriteAssetKey =
        b.kind === 'beacon_heal'
          ? 'prop_beacon_heal'
          : b.kind === 'beacon_nuke'
            ? 'prop_beacon_nuke'
            : 'prop_beacon_magnet';
      const sp = this.sprites.get(key);
      ctx.save();
      ctx.translate(b.x, b.y);
      if (sp) {
        const sz = b.radiusPx * 2.75 * pulse;
        ctx.drawImage(sp.normal, -sz / 2, -sz / 2, sz, sz);
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, b.radiusPx * pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(10, 0);
        ctx.lineTo(0, 10);
        ctx.lineTo(-10, 0);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, -b.radiusPx - 14);
      ctx.restore();
    }
  }

  private drawChests(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(snap.worldTimeSec * 6.5) * 0.1;
    const sp = this.sprites.get('prop_chest');
    for (const c of snap.chests) {
      ctx.save();
      ctx.translate(c.x, c.y);
      if (sp) {
        const sz = c.radiusPx * 3.1 * pulse;
        ctx.drawImage(sp.normal, -sz / 2, -sz / 2, sz, sz);
      } else {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, c.radiusPx * 1.25 * pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#FACC15';
        ctx.fillRect(-11, -11, 22, 22);
        ctx.fillStyle = '#FEF9C3';
        ctx.fillRect(-5, -5, 10, 10);
      }
      ctx.fillStyle = '#FEF08A';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('进化宝箱', 0, -c.radiusPx - 14);
      ctx.restore();
    }
  }

  /**
   * 表现层检测刚蓄满释放的圆形技能预警（如 Boss P3 虚空震爆、棱镜精英环弹），
   * 在消失瞬间自动补足高能冲击波与星芒闪爆，避免大招落地“静默消失”。
   */
  private syncTelegraphDetonations(snap: RenderSnapshot): void {
    const low = this.settings.lowParticleMode;
    const currCircles: PrevCircleTelegraph[] = [];
    for (const t of snap.telegraphs) {
      if (t.shape === 'circle') {
        currCircles.push({
          x: t.x,
          y: t.y,
          radiusPx: t.radiusPx,
          progressRatio: t.progressRatio,
        });
      }
    }

    for (const prev of this.prevCircleTelegraphs) {
      if (prev.progressRatio < 0.72) continue;
      // 判断上一帧高进度圆圈是否已在本帧释放结束
      const stillActive = currCircles.some(
        (c) => Math.hypot(c.x - prev.x, c.y - prev.y) < 18 && Math.abs(c.radiusPx - prev.radiusPx) < 14,
      );
      if (!stillActive) {
        const isHeavyBossBlast = prev.radiusPx >= 95;
        if (!low) {
          this.spawnShockRing(
            prev.x,
            prev.y,
            prev.radiusPx * (isHeavyBossBlast ? 1.18 : 1.08),
            isHeavyBossBlast ? '#FF1E56' : '#FB7185',
            isHeavyBossBlast ? 0.36 : 0.26,
            isHeavyBossBlast ? 4.4 : 3.0,
          );
          this.spawnShockRing(
            prev.x,
            prev.y,
            prev.radiusPx * 0.72,
            isHeavyBossBlast ? '#FDE047' : '#F0ABFC',
            0.22,
            2.2,
          );
          this.spawnImpactFlash(
            prev.x,
            prev.y,
            Math.min(76, prev.radiusPx * 0.62),
            isHeavyBossBlast ? '#FDA4AF' : '#E879F9',
            0.18,
          );
        }
        this.spawnParticles(prev.x, prev.y, isHeavyBossBlast ? '#FF1E56' : '#E879F9', low ? 4 : isHeavyBossBlast ? 18 : 10);
        if (isHeavyBossBlast && !this.settings.disableScreenShake) {
          this.shakeMagPx = Math.max(this.shakeMagPx, 7.5);
        }
      }
    }

    this.prevCircleTelegraphs = currCircles;
  }

  /**
   * 采样并绘制 Boss 与精英先锋在 SKILL_EXECUTE 冲锋阶段的高能全息残影
   */
  private stepAndDrawDashGhosts(snap: RenderSnapshot, dt: number): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;

    if (!low) {
      this.dashGhostSampleAccumSec += dt;
      if (this.dashGhostSampleAccumSec >= 0.036) {
        this.dashGhostSampleAccumSec = 0;
        const px = snap.player.x;
        const py = snap.player.y;
        for (const e of snap.enemies) {
          if ((e.tier !== 'boss' && e.tier !== 'elite') || e.entityState !== 'SKILL_EXECUTE') continue;
          const slot = this.dashGhosts[this.dashGhostCursor % MAX_DASH_GHOSTS];
          this.dashGhostCursor = (this.dashGhostCursor + 1) % MAX_DASH_GHOSTS;
          if (!slot) continue;
          const isBoss = e.tier === 'boss';
          const scaleMult = isBoss ? 4.25 : e.enemyId === 'elite_vanguard' ? 3.85 : 3.65;
          slot.active = true;
          slot.spriteKey = ENEMY_SPRITE_KEY_BY_ID[e.enemyId];
          slot.x = e.x;
          slot.y = e.y;
          slot.drawSize = e.radiusPx * scaleMult;
          slot.angleRad = Math.atan2(py - e.y, px - e.x);
          slot.tintHex =
            isBoss && e.bossPhase === 3
              ? '#FACC15'
              : isBoss && e.bossPhase === 2
                ? '#D946EF'
                : '#FF1E56';
          slot.lifeSec = isBoss ? 0.3 : 0.24;
          slot.maxLifeSec = slot.lifeSec;
        }
      }
    }

    for (let i = 0; i < this.dashGhosts.length; i++) {
      const g = this.dashGhosts[i];
      if (!g || !g.active) continue;
      g.lifeSec -= dt;
      if (g.lifeSec <= 0) {
        g.active = false;
        continue;
      }
      if (low) continue;
      const ratio = Math.max(0, g.lifeSec / g.maxLifeSec);
      const cached = this.sprites.get(g.spriteKey);
      if (!cached) continue;

      const half = g.drawSize / 2;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angleRad);
      ctx.globalCompositeOperation = 'lighter';

      // 柔和全息能量光环拖影
      const halo = ctx.createRadialGradient(0, 0, half * 0.1, 0, 0, half * 0.92);
      halo.addColorStop(
        0,
        g.tintHex === '#FACC15'
          ? `rgba(250, 204, 21, ${(ratio * 0.26).toFixed(3)})`
          : g.tintHex === '#D946EF'
            ? `rgba(217, 70, 239, ${(ratio * 0.26).toFixed(3)})`
            : `rgba(255, 30, 86, ${(ratio * 0.28).toFixed(3)})`,
      );
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.92, 0, Math.PI * 2);
      ctx.fill();

      // 半透明本体轮廓残影
      ctx.globalAlpha = ratio * 0.36;
      ctx.drawImage(cached.normal, -half, -half, g.drawSize, g.drawSize);
      if (cached.whiteFlash) {
        ctx.globalAlpha = ratio * 0.18;
        ctx.drawImage(cached.whiteFlash, -half, -half, g.drawSize, g.drawSize);
      }
      ctx.restore();
    }
  }

  private drawTelegraphs(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    const now = snap.worldTimeSec;

    for (const t of snap.telegraphs) {
      const p = Math.max(0, Math.min(1, t.progressRatio));
      const urgent = p > 0.78;
      const urgentBlink = urgent ? 0.72 + 0.28 * Math.sin(now * 46) : 1;

      ctx.save();
      if (!low) {
        ctx.globalCompositeOperation = 'lighter';
      }

      if (t.shape === 'line') {
        const dx = t.endX - t.x;
        const dy = t.endY - t.y;
        const len = Math.hypot(dx, dy);
        if (len < 6) {
          ctx.restore();
          continue;
        }
        const ang = Math.atan2(dy, dx);
        const halfW = Math.max(12, t.radiusPx * 0.72);
        const tipInset = Math.min(26, len * 0.12);

        ctx.translate(t.x, t.y);
        ctx.rotate(ang);

        // 1. 全息激光警戒通道光幕（两侧边缘聚光，中轴通透不糊屏，前端尖锥切角）
        const laneGrad = ctx.createLinearGradient(0, -halfW, 0, halfW);
        const edgeAlpha = (0.17 + p * 0.13) * urgentBlink;
        const centerAlpha = (0.04 + p * 0.05) * urgentBlink;
        laneGrad.addColorStop(0, 'rgba(255, 30, 86, 0)');
        laneGrad.addColorStop(0.11, `rgba(255, 46, 99, ${edgeAlpha.toFixed(3)})`);
        laneGrad.addColorStop(0.32, `rgba(225, 29, 72, ${centerAlpha.toFixed(3)})`);
        laneGrad.addColorStop(0.5, `rgba(190, 18, 60, ${(centerAlpha * 0.85).toFixed(3)})`);
        laneGrad.addColorStop(0.68, `rgba(225, 29, 72, ${centerAlpha.toFixed(3)})`);
        laneGrad.addColorStop(0.89, `rgba(255, 46, 99, ${edgeAlpha.toFixed(3)})`);
        laneGrad.addColorStop(1, 'rgba(255, 30, 86, 0)');

        ctx.fillStyle = laneGrad;
        ctx.beginPath();
        ctx.moveTo(0, -halfW * 0.86);
        ctx.lineTo(len - tipInset, -halfW);
        ctx.lineTo(len, 0);
        ctx.lineTo(len - tipInset, halfW);
        ctx.lineTo(0, halfW * 0.86);
        ctx.closePath();
        ctx.fill();

        // 2. 沿冲锋方向疾速推进的蓄力充能扫光波（清晰传达释放倒计时）
        const chargeLen = Math.max(8, len * p);
        const sweepGrad = ctx.createLinearGradient(0, 0, chargeLen, 0);
        sweepGrad.addColorStop(0, 'rgba(255, 30, 86, 0.02)');
        sweepGrad.addColorStop(0.68, `rgba(255, 56, 108, ${(0.1 + p * 0.12).toFixed(3)})`);
        sweepGrad.addColorStop(
          0.95,
          urgent
            ? `rgba(254, 215, 170, ${(0.34 * urgentBlink).toFixed(3)})`
            : `rgba(255, 110, 145, ${(0.24 + p * 0.1).toFixed(3)})`,
        );
        sweepGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = sweepGrad;
        ctx.beginPath();
        ctx.moveTo(0, -halfW * 0.78);
        ctx.lineTo(Math.min(chargeLen, len - tipInset * 0.5), -halfW * 0.88);
        ctx.lineTo(Math.min(chargeLen + 10, len), 0);
        ctx.lineTo(Math.min(chargeLen, len - tipInset * 0.5), halfW * 0.88);
        ctx.lineTo(0, halfW * 0.78);
        ctx.closePath();
        ctx.fill();

        // 3. 两侧全息激光外边界导轨（细锐柔和，端部渐隐）
        const railGrad = ctx.createLinearGradient(0, 0, len, 0);
        railGrad.addColorStop(0, `rgba(255, 90, 130, ${(0.35 + p * 0.25).toFixed(3)})`);
        railGrad.addColorStop(0.78, `rgba(255, 46, 99, ${(0.62 + p * 0.26).toFixed(3)})`);
        railGrad.addColorStop(1, 'rgba(255, 30, 86, 0.1)');
        ctx.strokeStyle = railGrad;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -halfW * 0.86);
        ctx.lineTo(len - tipInset, -halfW);
        ctx.lineTo(len, 0);
        ctx.lineTo(len - tipInset, halfW);
        ctx.lineTo(0, halfW * 0.86);
        ctx.stroke();

        // 4. 随蓄力向中轴收束的双激光锁定轨（临界瞬间亮炽白金提示躲避！）
        const innerOffset = halfW * (0.86 - p * 0.62);
        ctx.strokeStyle = urgent
          ? `rgba(254, 240, 138, ${(0.65 * urgentBlink).toFixed(3)})`
          : `rgba(253, 164, 175, ${(0.34 + p * 0.36).toFixed(3)})`;
        ctx.lineWidth = urgent ? 1.8 : 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -innerOffset);
        ctx.lineTo(len - tipInset * 0.8, -innerOffset);
        ctx.moveTo(0, innerOffset);
        ctx.lineTo(len - tipInset * 0.8, innerOffset);
        ctx.stroke();

        // 5. 通道内高速前滚方向箭头阵列（>>>），清晰传达冲锋方向与紧迫感
        if (!low) {
          const spacing = 46;
          const scroll = (now * (170 + p * 160)) % spacing;
          const chevH = Math.min(halfW * 0.44, 13);
          const chevW = chevH * 0.72;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = urgent ? 2.1 : 1.6;
          for (let dist = 18 + scroll; dist < len - tipInset - 6; dist += spacing) {
            const edgeFade = Math.min(1, dist / 44) * Math.min(1, (len - dist) / 56);
            const alpha = edgeFade * (0.28 + p * 0.42) * urgentBlink;
            if (alpha < 0.04) continue;
            ctx.strokeStyle = urgent
              ? `rgba(254, 226, 226, ${alpha.toFixed(3)})`
              : `rgba(255, 92, 132, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(dist - chevW, -chevH);
            ctx.lineTo(dist, 0);
            ctx.lineTo(dist - chevW, chevH);
            ctx.stroke();
          }
        }

        // 6. 施法舰首聚能弧 + 终点锐角锁定标
        ctx.strokeStyle = urgent
          ? `rgba(254, 240, 138, ${(0.85 * urgentBlink).toFixed(3)})`
          : `rgba(255, 120, 150, ${(0.45 + p * 0.35).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, halfW * 0.62, -Math.PI * 0.45, Math.PI * 0.45);
        ctx.stroke();

        const lockX = len - 4;
        ctx.beginPath();
        ctx.moveTo(lockX - 10, -8);
        ctx.lineTo(lockX, 0);
        ctx.lineTo(lockX - 10, 8);
        ctx.stroke();
      } else {
        const r = Math.max(12, t.radiusPx);
        ctx.translate(t.x, t.y);

        // 1. 中心通透、边缘高亮的全息力场底晕（绝不平涂糊死主角视野）
        const fieldGrad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
        fieldGrad.addColorStop(0, `rgba(255, 30, 86, ${(0.03 + p * 0.04).toFixed(3)})`);
        fieldGrad.addColorStop(0.66, `rgba(244, 63, 94, ${(0.07 + p * 0.09).toFixed(3)})`);
        fieldGrad.addColorStop(0.93, `rgba(255, 46, 99, ${((0.22 + p * 0.22) * urgentBlink).toFixed(3)})`);
        fieldGrad.addColorStop(1, 'rgba(255, 30, 86, 0)');
        ctx.fillStyle = fieldGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // 2. 随蓄力进度向外膨胀的渐变能量波（前缘带炽热高光）
        const waveR = Math.max(4, r * p);
        const waveInner = Math.max(0, waveR - Math.max(14, r * 0.24));
        const waveGrad = ctx.createRadialGradient(0, 0, waveInner, 0, 0, waveR);
        waveGrad.addColorStop(0, 'rgba(255, 30, 86, 0)');
        waveGrad.addColorStop(
          0.72,
          urgent
            ? `rgba(251, 146, 60, ${(0.22 * urgentBlink).toFixed(3)})`
            : `rgba(255, 46, 99, ${(0.14 + p * 0.14).toFixed(3)})`,
        );
        waveGrad.addColorStop(
          0.96,
          urgent
            ? `rgba(254, 240, 138, ${(0.58 * urgentBlink).toFixed(3)})`
            : `rgba(254, 205, 211, ${(0.34 + p * 0.22).toFixed(3)})`,
        );
        waveGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = waveGrad;
        ctx.beginPath();
        ctx.arc(0, 0, waveR, 0, Math.PI * 2);
        ctx.fill();

        // 能量波锋线细环
        ctx.strokeStyle = urgent
          ? `rgba(254, 249, 195, ${(0.88 * urgentBlink).toFixed(3)})`
          : `rgba(254, 205, 211, ${(0.48 + p * 0.34).toFixed(3)})`;
        ctx.lineWidth = urgent ? 2.2 : 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, waveR, 0, Math.PI * 2);
        ctx.stroke();

        // 3. 外圈细全息轮廓 + 四段旋转战术警戒弧
        ctx.strokeStyle = `rgba(255, 46, 99, ${(0.42 + p * 0.34).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        const rot = now * (urgent ? 1.9 : 0.95);
        ctx.strokeStyle = urgent
          ? `rgba(254, 240, 138, ${(0.88 * urgentBlink).toFixed(3)})`
          : `rgba(255, 80, 120, ${(0.68 + p * 0.22).toFixed(3)})`;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          const base = rot + (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(0, 0, r + 2, base + 0.16, base + Math.PI * 0.5 - 0.16);
          ctx.stroke();
        }

        // 4. 四向内指锁定刻度（随蓄力向内轻微收拢）+ 中心微十字靶点
        if (!low) {
          const notchOuter = r + 5;
          const notchInner = r - (6 + p * 7);
          ctx.strokeStyle = urgent
            ? `rgba(254, 240, 138, ${(0.85 * urgentBlink).toFixed(3)})`
            : `rgba(254, 165, 185, ${(0.52 + p * 0.3).toFixed(3)})`;
          ctx.lineWidth = 1.7;
          for (let k = 0; k < 4; k++) {
            const a = -rot * 0.65 + (k * Math.PI) / 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            ctx.beginPath();
            ctx.moveTo(ca * notchOuter, sa * notchOuter);
            ctx.lineTo(ca * notchInner, sa * notchInner);
            ctx.stroke();
          }

          // 中心空心微十字标
          const crossOuter = Math.min(12, r * 0.2);
          const crossGap = Math.min(4, r * 0.06);
          ctx.strokeStyle = `rgba(255, 228, 230, ${(0.45 + p * 0.4).toFixed(3)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-crossOuter, 0);
          ctx.lineTo(-crossGap, 0);
          ctx.moveTo(crossGap, 0);
          ctx.lineTo(crossOuter, 0);
          ctx.moveTo(0, -crossOuter);
          ctx.lineTo(0, -crossGap);
          ctx.moveTo(0, crossGap);
          ctx.lineTo(0, crossOuter);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawNovaRings(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    for (const n of snap.novaRings) {
      const r = Math.max(4, n.radiusPx);
      const alpha = Math.max(0, n.lifeRatio);
      const primaryColor = n.isCollapse ? '#C084FC' : n.isEvolution ? '#FACC15' : '#34D399';
      const innerRgba = n.isCollapse
        ? `rgba(192, 132, 252, ${(alpha * 0.28).toFixed(3)})`
        : n.isEvolution
          ? `rgba(250, 204, 21, ${(alpha * 0.24).toFixed(3)})`
          : `rgba(52, 211, 153, ${(alpha * 0.22).toFixed(3)})`;

      ctx.save();
      if (!low) ctx.globalCompositeOperation = 'lighter';

      // 1. 柔和径向引力冲击场
      if (!low) {
        const grad = ctx.createRadialGradient(n.x, n.y, r * 0.55, n.x, n.y, r);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.85, innerRgba);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. 主外环冲击波 + 纯白高光锋线
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = n.isEvolution ? 8 : 5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = n.isEvolution ? 2.4 : 1.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.stroke();

      // 3. 伴生谐振内环 + 环周能量火花节点
      if (r > 18) {
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.82, 0, Math.PI * 2);
        ctx.stroke();

        if (!low) {
          const rot = snap.worldTimeSec * (n.isCollapse ? -3.2 : 2.2);
          ctx.fillStyle = '#FFFFFF';
          for (let k = 0; k < 8; k++) {
            const a = rot + (k * Math.PI) / 4;
            ctx.beginPath();
            ctx.arc(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r, n.isEvolution ? 3.2 : 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  private drawLightningStrikes(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    for (const l of snap.lightningStrikes) {
      const alpha = Math.max(0, l.lifeRatio);
      const outerColor = l.isEvolution ? '#C084FC' : '#38BDF8';
      const glowColor = l.isEvolution ? 'rgba(217, 70, 239, 0.42)' : 'rgba(56, 189, 248, 0.40)';
      // 基于落点坐标确定性抖动，产生真实多分支锯齿电弧
      const seed = Math.sin(l.x * 12.9898 + l.y * 78.233);
      const j1 = Math.sin(seed * 41.3) * 26;
      const j2 = Math.cos(seed * 27.9) * 32;
      const j3 = Math.sin(seed * 63.7) * 22;

      ctx.save();
      if (!low) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 宽光晕外层电弧
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = l.isEvolution ? 15 : 10;
      ctx.beginPath();
      ctx.moveTo(l.x + j1, l.y - 310);
      ctx.lineTo(l.x + j2, l.y - 210);
      ctx.lineTo(l.x - j1 * 0.8, l.y - 125);
      ctx.lineTo(l.x + j3, l.y - 52);
      ctx.lineTo(l.x, l.y);
      ctx.stroke();

      // 主高压霓虹电弧
      ctx.strokeStyle = outerColor;
      ctx.lineWidth = l.isEvolution ? 5.5 : 3.8;
      ctx.stroke();

      // 纯白炽热电弧核心
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = l.isEvolution ? 2.4 : 1.7;
      ctx.stroke();

      // 两条分支侧电弧
      if (!low) {
        ctx.strokeStyle = outerColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(l.x + j2, l.y - 210);
        ctx.lineTo(l.x + j2 + 34, l.y - 150);
        ctx.lineTo(l.x + j2 + 22, l.y - 110);
        ctx.moveTo(l.x - j1 * 0.8, l.y - 125);
        ctx.lineTo(l.x - j1 * 0.8 - 32, l.y - 76);
        ctx.stroke();
      }

      // 落点双层电击波与星芒闪爆
      const grad = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.radiusPx);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
      grad.addColorStop(0.35, glowColor);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.radiusPx, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = outerColor;
      ctx.lineWidth = l.isEvolution ? 3.5 : 2.2;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.radiusPx * (1.15 - alpha * 0.3), 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawBeamRays(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    for (const b of snap.beamRays) {
      const alpha = Math.max(0, b.lifeRatio);
      const ex = b.x + b.dirX * b.lengthPx;
      const ey = b.y + b.dirY * b.lengthPx;
      const ang = Math.atan2(b.dirY, b.dirX);

      ctx.save();
      if (!low) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';

      // 1. 最外层宽能量扩散光鞘
      ctx.strokeStyle = b.isEvolution ? 'rgba(250, 204, 21, 0.34)' : 'rgba(56, 189, 248, 0.30)';
      ctx.lineWidth = b.widthPx * 1.9;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 2. 中层高饱和激光束
      ctx.strokeStyle = b.isEvolution ? '#FACC15' : '#38BDF8';
      ctx.lineWidth = b.widthPx * 0.92;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 3. 炽热纯白核心光芯
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(3.5, b.widthPx * 0.36);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 4. 炮口星芒爆发 + 沿光束跃动的聚能谐振环
      if (!low) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(ang);
        const flareR = b.widthPx * 1.1;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.ellipse(0, 0, flareR * 0.55, flareR * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = b.isEvolution ? '#FEF08A' : '#BAE6FD';
        ctx.lineWidth = 2;
        const phaseShift = (snap.worldTimeSec * 420) % 90;
        for (let dist = 48 + phaseShift; dist < b.lengthPx - 20; dist += 90) {
          ctx.beginPath();
          ctx.ellipse(dist, 0, b.widthPx * 0.28, b.widthPx * 0.85, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  private drawXpGems(snap: RenderSnapshot, minX: number, maxX: number, minY: number, maxY: number): void {
    const ctx = this.ctx;
    const spS = this.sprites.get('prop_xp_gem_s');
    const spM = this.sprites.get('prop_xp_gem_m');
    const spL = this.sprites.get('prop_xp_gem_l');
    const low = this.settings.lowParticleMode;
    const pulse = 0.85 + 0.15 * Math.sin(snap.worldTimeSec * 6.5);
    for (const g of snap.xpGems) {
      if (g.x < minX || g.x > maxX || g.y < minY || g.y > maxY) continue;
      if (g.tier === 'large' && !low) {
        // 精英掉落的金色高阶水晶：柔和暖金光晕 + 四向菱形星芒（与自爆怪彻底视觉区分）
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.globalCompositeOperation = 'lighter';
        const haloR = 19 * pulse;
        const hg = ctx.createRadialGradient(0, 0, 2, 0, 0, haloR);
        hg.addColorStop(0, 'rgba(254, 240, 138, 0.42)');
        hg.addColorStop(0.55, 'rgba(250, 204, 21, 0.16)');
        hg.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(0, 0, haloR, 0, Math.PI * 2);
        ctx.fill();

        const spLen = 16 * pulse;
        const spW = 2.4;
        ctx.fillStyle = 'rgba(254, 249, 195, 0.72)';
        ctx.beginPath();
        ctx.moveTo(0, -spLen);
        ctx.lineTo(spW, 0);
        ctx.lineTo(0, spLen);
        ctx.lineTo(-spW, 0);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-spLen * 0.72, 0);
        ctx.lineTo(0, spW * 0.85);
        ctx.lineTo(spLen * 0.72, 0);
        ctx.lineTo(0, -spW * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const sp = g.tier === 'large' ? spL : g.tier === 'medium' ? spM : spS;
      if (sp) {
        const sz = g.tier === 'large' ? 28 : g.tier === 'medium' ? 20 : 15;
        ctx.drawImage(sp.normal, g.x - sz / 2, g.y - sz / 2, sz, sz);
      } else {
        ctx.fillStyle = g.tier === 'large' ? '#FACC15' : g.tier === 'medium' ? '#34D399' : '#38BDF8';
        const s = g.tier === 'large' ? 7 : g.tier === 'medium' ? 5.5 : 4.5;
        ctx.beginPath();
        ctx.moveTo(g.x, g.y - s);
        ctx.lineTo(g.x + s * 0.8, g.y);
        ctx.lineTo(g.x, g.y + s);
        ctx.lineTo(g.x - s * 0.8, g.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawThrusterFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    lengthPx: number,
    widthPx: number,
    outerColor: string,
    innerColor: string,
    detailed = false,
  ): void {
    const len = Math.max(4, lengthPx);
    const w = Math.max(1.5, widthPx);

    // 1. 柔和羽化外层等离子喷流（抛物线流线尾焰 + 尾部无缝渐隐，彻底告别尖锐纸片三角）
    const outerGrad = ctx.createLinearGradient(x, y, x - len * 1.15, y);
    outerGrad.addColorStop(0, outerColor);
    outerGrad.addColorStop(0.32, outerColor);
    outerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y);
    ctx.quadraticCurveTo(x - len * 0.04, y - w * 1.02, x - len * 0.36, y - w * 0.64);
    ctx.quadraticCurveTo(x - len * 0.8, y - w * 0.22, x - len * 1.15, y);
    ctx.quadraticCurveTo(x - len * 0.8, y + w * 0.22, x - len * 0.36, y + w * 0.64);
    ctx.quadraticCurveTo(x - len * 0.04, y + w * 1.02, x + w * 0.2, y);
    ctx.closePath();
    ctx.fill();

    // 2. Boss / 精英 / 主角专属：喷口柔和热晕，让火焰自然融入金属喷口
    if (detailed) {
      const nozzleR = Math.max(w * 1.35, len * 0.22);
      const glow = ctx.createRadialGradient(x - len * 0.05, y, 0.5, x - len * 0.05, y, nozzleR);
      glow.addColorStop(0, outerColor);
      glow.addColorStop(0.45, 'rgba(255, 255, 255, 0.12)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x - len * 0.05, y, nozzleR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 炽热内层马赫光芯（丝滑渐隐）
    const coreLen = len * 0.58;
    const coreW = w * 0.4;
    const coreGrad = ctx.createLinearGradient(x, y, x - coreLen, y);
    coreGrad.addColorStop(0, innerColor);
    coreGrad.addColorStop(0.45, innerColor);
    coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.moveTo(x + coreW * 0.2, y);
    ctx.quadraticCurveTo(x - coreLen * 0.22, y - coreW, x - coreLen, y);
    ctx.quadraticCurveTo(x - coreLen * 0.22, y + coreW, x + coreW * 0.2, y);
    ctx.closePath();
    ctx.fill();
  }

  private drawEnemies(snap: RenderSnapshot, minX: number, maxX: number, minY: number, maxY: number): void {
    const ctx = this.ctx;
    const px = snap.player.x;
    const py = snap.player.y;
    const t = snap.worldTimeSec;
    const low = this.settings.lowParticleMode;

    for (const e of snap.enemies) {
      if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
      ctx.save();
      ctx.translate(e.x, e.y);

      const r = e.radiusPx;
      const angleToPlayer = Math.atan2(py - e.y, px - e.x);
      const isBoss = e.tier === 'boss';
      const isElite = e.tier === 'elite';

      // 1. 精英与 Boss 底部全息威压场、阶段裂变符文环、环绕浮游刃与技能蓄力吸能特效
      if (isElite || isBoss) {
        const isCharging = e.entityState === 'SKILL_TELEGRAPH';
        const isDashing = e.entityState === 'SKILL_EXECUTE';
        const isIntro = e.entityState === 'BOSS_SPAWN_INTRO';
        const phaseColor =
          isBoss && e.bossPhase === 3
            ? '#FACC15'
            : isBoss && e.bossPhase === 2
              ? '#D946EF'
              : e.enemyId === 'elite_prism'
                ? '#C084FC'
                : '#FF1E56';
        const phaseRgb =
          isBoss && e.bossPhase === 3
            ? '250, 204, 21'
            : isBoss && e.bossPhase === 2
              ? '217, 70, 239'
              : e.enemyId === 'elite_prism'
                ? '192, 132, 252'
                : '255, 30, 86';

        // 1a. 底部柔和能量威压光晕（蓄力/冲锋时适度增强）
        if (!low) {
          const auraBoost = isCharging ? 1.2 : isDashing ? 1.28 : 1;
          const auraR = (isBoss ? r * 2.35 : r * 1.75) * auraBoost;
          const aura = ctx.createRadialGradient(0, 0, r * 0.28, 0, 0, auraR);
          aura.addColorStop(
            0,
            `rgba(${phaseRgb}, ${(isBoss ? (isCharging ? 0.36 : 0.28) : isCharging ? 0.28 : 0.18).toFixed(3)})`,
          );
          aura.addColorStop(0.65, `rgba(${phaseRgb}, ${(isBoss ? 0.1 : 0.06).toFixed(3)})`);
          aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = aura;
          ctx.beginPath();
          ctx.arc(0, 0, auraR, 0, Math.PI * 2);
          ctx.fill();
        }

        // 1b. 分段全息战术气场环（替代僵硬的单根纯色整圆）
        ctx.save();
        if (!low) ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        const innerRingR = r + (isBoss ? 19 : 9);
        const segCount = isBoss ? 3 : 2;
        const rotSpeed = isCharging ? 3.8 : isDashing ? 5.2 : isBoss ? 1.85 : 1.65;
        const arcSpan = isBoss ? Math.PI * 0.44 : Math.PI * 0.62;
        for (let k = 0; k < segCount; k++) {
          const a0 = t * rotSpeed + (k * Math.PI * 2) / segCount;
          if (!low) {
            ctx.strokeStyle = `rgba(${phaseRgb}, 0.24)`;
            ctx.lineWidth = isBoss ? 6.5 : 4.2;
            ctx.beginPath();
            ctx.arc(0, 0, innerRingR, a0, a0 + arcSpan);
            ctx.stroke();
          }
          ctx.strokeStyle = `rgba(${phaseRgb}, ${isCharging ? 0.88 : 0.68})`;
          ctx.lineWidth = isBoss ? 2.1 : 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, innerRingR, a0 + 0.04, a0 + arcSpan - 0.04);
          ctx.stroke();
        }

        if (isBoss) {
          // 外层逆旋虚空星轨环（6段精致刻度弧 + 3枚高能锚点）
          const outerRingR = r + 31;
          const outerRot = -t * (e.bossPhase === 3 ? 2.1 : 1.35);
          ctx.strokeStyle =
            e.bossPhase === 3
              ? 'rgba(250, 204, 21, 0.56)'
              : e.bossPhase === 2
                ? 'rgba(232, 121, 249, 0.54)'
                : 'rgba(244, 63, 94, 0.48)';
          ctx.lineWidth = 1.4;
          for (let k = 0; k < 6; k++) {
            const a0 = outerRot + (k * Math.PI) / 3;
            ctx.beginPath();
            ctx.arc(0, 0, outerRingR, a0, a0 + 0.36);
            ctx.stroke();
          }
          if (!low) {
            ctx.fillStyle = '#FFF1F2';
            for (let k = 0; k < 3; k++) {
              const na = outerRot + (k * Math.PI * 2) / 3 + 0.18;
              ctx.beginPath();
              ctx.arc(Math.cos(na) * outerRingR, Math.sin(na) * outerRingR, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Boss 入场维度裂隙光环
          if (isIntro && !low) {
            const riftPulse = 0.6 + 0.4 * Math.sin(t * 14);
            ctx.strokeStyle = `rgba(217, 70, 239, ${(0.75 * riftPulse).toFixed(3)})`;
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.arc(0, 0, r * (2.15 + riftPulse * 0.25), 0, Math.PI * 2);
            ctx.stroke();
          }

          // 动态环绕浮游刀刃（P1: 4枚 / P2: 6枚 / P3: 8枚金色过载刃）+ 流光轨道拖尾
          const shardCount = e.bossPhase === 3 ? 8 : e.bossPhase === 2 ? 6 : 4;
          const orbitR = r * (isCharging ? 1.66 : 1.88);
          const orbitSpd = (e.bossPhase === 3 ? 2.8 : 1.85) * (isCharging ? 1.75 : 1);
          for (let s = 0; s < shardCount; s++) {
            const sa = t * orbitSpd + (s * Math.PI * 2) / shardCount;
            if (!low) {
              // 浮游刃后方渐隐弧形拖尾
              ctx.strokeStyle = `rgba(${phaseRgb}, 0.36)`;
              ctx.lineWidth = 2.4;
              ctx.beginPath();
              ctx.arc(0, 0, orbitR, sa - 0.34, sa);
              ctx.stroke();
            }
            const sx = Math.cos(sa) * orbitR;
            const sy = Math.sin(sa) * orbitR;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(sa + Math.PI / 2);
            ctx.fillStyle = phaseColor;
            ctx.beginPath();
            ctx.moveTo(11, 0);
            ctx.lineTo(-6, 4.2);
            ctx.lineTo(-2.5, 0);
            ctx.lineTo(-6, -4.2);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.moveTo(7, 0);
            ctx.lineTo(-1, 1.5);
            ctx.lineTo(-1, -1.5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        // 1c. Boss 与精英蓄力大招（SKILL_TELEGRAPH）时的向内坍缩吸能光丝
        if (isCharging && !low) {
          const rayCount = isBoss ? 8 : 5;
          const outerGather = r * (isBoss ? 2.75 : 2.15);
          ctx.lineWidth = isBoss ? 2 : 1.5;
          for (let k = 0; k < rayCount; k++) {
            const phase01 = (t * 2.4 + k / rayCount) % 1;
            const rayAng = (k * Math.PI * 2) / rayCount + t * 0.9;
            const headR = outerGather * (1 - phase01);
            const tailR = Math.min(outerGather, headR + r * 0.72);
            const alpha = Math.sin(phase01 * Math.PI) * 0.78;
            if (alpha < 0.05) continue;
            ctx.strokeStyle =
              k % 2 === 0
                ? `rgba(254, 240, 138, ${alpha.toFixed(3)})`
                : `rgba(${phaseRgb}, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(Math.cos(rayAng) * tailR, Math.sin(rayAng) * tailR);
            ctx.lineTo(Math.cos(rayAng) * headR, Math.sin(rayAng) * headR);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      const spriteKey = ENEMY_SPRITE_KEY_BY_ID[e.enemyId];
      const cached = this.sprites.get(spriteKey);

      if (cached) {
        ctx.save();
        const scaleMult =
          isBoss
            ? 4.25
            : e.enemyId === 'elite_vanguard'
              ? 3.85
              : e.enemyId === 'elite_prism'
                ? 3.65
                : e.enemyId === 'tank'
                  ? 4.15
                  : e.enemyId === 'runner'
                    ? 3.85
                    : e.enemyId === 'swarm'
                      ? 3.55
                      : e.enemyId === 'spitter'
                        ? 3.55
                        : e.enemyId === 'splitter'
                          ? 3.45
                          : 3.45;
        const drawSize = r * scaleMult;
        const half = drawSize / 2;

        // 2. 分原型实时动态姿态与引擎尾焰/充能细节
        const flicker = 0.72 + 0.28 * Math.sin(t * 32 + e.id * 1.7);
        if (e.enemyId === 'elite_prism') {
          // 金属棱镜异形：内体顺时针缓转 + 4片外环能量刃逆时针疾旋
          ctx.rotate(t * 0.95);
        } else if (e.enemyId === 'bomber') {
          const pulse = 1 + Math.abs(Math.sin(t * 10 + e.id)) * 0.14;
          ctx.rotate(angleToPlayer + Math.sin(t * 6 + e.id) * 0.12);
          ctx.scale(pulse, pulse);
        } else {
          // 星空战机/战舰/Boss：朝向玩家 + 细微气动横滚压坡摆动
          const bankFreq = isBoss ? 3.2 : e.enemyId === 'runner' ? 11 : 7.5;
          const bankAmp = isBoss ? 0.04 : e.enemyId === 'runner' ? 0.1 : 0.06;
          const bankScaleY = 1 - Math.abs(Math.sin(t * bankFreq * 0.5 + e.id)) * (isBoss ? 0.04 : 0.08);
          ctx.rotate(angleToPlayer + Math.sin(t * bankFreq + e.id) * bankAmp);
          ctx.scale(1, bankScaleY);
        }

        // 3. 引擎喷口动态等离子尾焰（绘制在机身底部图层）
        if (!low) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          if (e.enemyId === 'swarm') {
            this.drawThrusterFlame(ctx, -half * 0.68, -half * 0.12, half * 0.45 * flicker, half * 0.09, 'rgba(255,30,86,0.75)', '#FFF1F2');
            this.drawThrusterFlame(ctx, -half * 0.68, half * 0.12, half * 0.45 * flicker, half * 0.09, 'rgba(255,30,86,0.75)', '#FFF1F2');
          } else if (e.enemyId === 'runner') {
            this.drawThrusterFlame(ctx, -half * 0.72, 0, half * 0.72 * flicker, half * 0.13, 'rgba(217,70,239,0.85)', '#FAE8FF');
          } else if (e.enemyId === 'spitter') {
            this.drawThrusterFlame(ctx, -half * 0.76, -half * 0.18, half * 0.38 * flicker, half * 0.09, 'rgba(249,115,22,0.8)', '#FEF08A');
            this.drawThrusterFlame(ctx, -half * 0.76, half * 0.18, half * 0.38 * flicker, half * 0.09, 'rgba(249,115,22,0.8)', '#FEF08A');
          } else if (e.enemyId === 'tank') {
            // 全新狭长重装驱逐舰：双联圆形主推进喷口高能猩红尾焰
            this.drawThrusterFlame(ctx, -half * 0.72, -half * 0.21, half * 0.56 * flicker, half * 0.11, 'rgba(255,30,86,0.86)', '#FEF08A');
            this.drawThrusterFlame(ctx, -half * 0.72, half * 0.21, half * 0.56 * flicker, half * 0.11, 'rgba(255,30,86,0.86)', '#FEF08A');
          } else if (e.enemyId === 'splitter') {
            this.drawThrusterFlame(ctx, -half * 0.74, -half * 0.34, half * 0.42 * flicker, half * 0.1, 'rgba(192,132,252,0.82)', '#F5D0FE');
            this.drawThrusterFlame(ctx, -half * 0.74, half * 0.34, half * 0.42 * flicker, half * 0.1, 'rgba(192,132,252,0.82)', '#F5D0FE');
          } else if (e.enemyId === 'elite_vanguard') {
            const dashBoost = e.entityState === 'SKILL_EXECUTE' ? 1.48 : e.entityState === 'SKILL_TELEGRAPH' ? 0.85 : 1;
            this.drawThrusterFlame(ctx, -half * 0.8, -half * 0.18, half * 0.56 * flicker * dashBoost, half * 0.1, 'rgba(255,30,86,0.78)', '#FEF08A', true);
            this.drawThrusterFlame(ctx, -half * 0.8, 0, half * 0.72 * flicker * dashBoost, half * 0.125, 'rgba(250,204,21,0.82)', '#FFFFFF', true);
            this.drawThrusterFlame(ctx, -half * 0.8, half * 0.18, half * 0.56 * flicker * dashBoost, half * 0.1, 'rgba(255,30,86,0.78)', '#FEF08A', true);
          } else if (isBoss) {
            const dashBoost = e.entityState === 'SKILL_EXECUTE' ? 1.52 : e.entityState === 'SKILL_TELEGRAPH' ? 0.82 : 1;
            const jetLen = half * (0.54 + (e.bossPhase ?? 1) * 0.1) * flicker * dashBoost;
            const jetCol = e.bossPhase === 3 ? 'rgba(250,204,21,0.84)' : 'rgba(255,30,86,0.82)';
            this.drawThrusterFlame(ctx, -half * 0.54, -half * 0.34, jetLen, half * 0.115, jetCol, '#FEF9C3', true);
            this.drawThrusterFlame(ctx, -half * 0.54, half * 0.34, jetLen, half * 0.115, jetCol, '#FEF9C3', true);
            this.drawThrusterFlame(ctx, -half * 0.74, 0, jetLen * 1.12, half * 0.145, 'rgba(217,70,239,0.8)', '#FFFFFF', true);
          }
          ctx.restore();
        }

        // 4. 绘制高清离线缓存精灵主体
        ctx.drawImage(cached.normal, -half, -half, drawSize, drawSize);

        // 5. 动态局部微特效叠层（舰首护盾弧 / 翼尖频闪灯 / 轨炮电弧 / 生物孢子 / 熔核电火花 / Boss过载翼弧）
        if (!low) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          if (e.enemyId === 'swarm' || e.enemyId === 'runner') {
            // 战机双翼尖航行频闪微光点
            const strobe = Math.sin(t * 14 + e.id * 2.3);
            if (strobe > 0.35) {
              ctx.fillStyle = e.enemyId === 'runner' ? 'rgba(232, 121, 249, 0.85)' : 'rgba(255, 77, 109, 0.85)';
              ctx.beginPath();
              ctx.arc(-half * 0.25, -half * 0.62, 2.2, 0, Math.PI * 2);
              ctx.arc(-half * 0.25, half * 0.62, 2.2, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (e.enemyId === 'tank') {
            // 狭长重装驱逐舰舰首：半透明猩红动能冲角护盾弧
            const shieldPulse = 0.42 + 0.32 * Math.sin(t * 7 + e.id);
            ctx.strokeStyle = `rgba(255, 46, 99, ${shieldPulse.toFixed(2)})`;
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.arc(half * 0.38, 0, half * 0.64, -0.78, 0.78);
            ctx.stroke();
            ctx.strokeStyle = `rgba(254, 205, 211, ${(shieldPulse * 0.7).toFixed(2)})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(half * 0.42, 0, half * 0.6, -0.58, 0.58);
            ctx.stroke();
          } else if (e.enemyId === 'spitter') {
            const charge = 0.45 + 0.55 * Math.sin(t * 8 + e.id);
            ctx.fillStyle = `rgba(254, 240, 138, ${charge.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(half * 0.88, -half * 0.14, 2.8 + charge * 1.8, 0, Math.PI * 2);
            ctx.arc(half * 0.88, half * 0.14, 2.8 + charge * 1.8, 0, Math.PI * 2);
            ctx.fill();
            if (charge > 0.72) {
              ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
              ctx.lineWidth = 1.4;
              ctx.beginPath();
              ctx.moveTo(half * 0.86, -half * 0.14);
              ctx.lineTo(half * 0.94, 0);
              ctx.lineTo(half * 0.86, half * 0.14);
              ctx.stroke();
            }
          } else if (e.enemyId === 'bomber') {
            // 自爆怪：去除生硬纯黄外圈线，改为呼吸琥珀红不稳定熔核光晕与微小电弧
            const isFusing = e.entityState === 'FUSE_TELEGRAPH';
            const coreGlow = 0.4 + 0.6 * Math.abs(Math.sin(t * (isFusing ? 24 : 10) + e.id));
            const glowR = half * ((isFusing ? 0.85 : 0.66) + coreGlow * 0.18);
            const bg = ctx.createRadialGradient(-half * 0.12, 0, 1, -half * 0.12, 0, glowR);
            bg.addColorStop(0, isFusing ? 'rgba(255, 255, 255, 0.92)' : 'rgba(254, 240, 138, 0.78)');
            bg.addColorStop(
              0.45,
              isFusing
                ? `rgba(255, 46, 99, ${(0.55 + coreGlow * 0.3).toFixed(2)})`
                : `rgba(251, 146, 60, ${(0.34 + coreGlow * 0.28).toFixed(2)})`,
            );
            bg.addColorStop(1, 'rgba(255, 30, 86, 0)');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(-half * 0.12, 0, glowR, 0, Math.PI * 2);
            ctx.fill();

            // 两道微弱不稳定电弧火花
            const sparkAng = t * (isFusing ? 16 : 9) + e.id;
            ctx.strokeStyle = isFusing ? 'rgba(254, 226, 226, 0.9)' : 'rgba(254, 240, 138, 0.72)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(-half * 0.12 + Math.cos(sparkAng) * half * 0.22, Math.sin(sparkAng) * half * 0.22);
            ctx.lineTo(-half * 0.12 + Math.cos(sparkAng + 0.26) * half * 0.54, Math.sin(sparkAng + 0.26) * half * 0.54);
            ctx.moveTo(-half * 0.12 - Math.cos(sparkAng) * half * 0.2, -Math.sin(sparkAng) * half * 0.2);
            ctx.lineTo(-half * 0.12 - Math.cos(sparkAng - 0.24) * half * 0.48, -Math.sin(sparkAng - 0.24) * half * 0.48);
            ctx.stroke();
          } else if (e.enemyId === 'splitter') {
            // 母巢运输舰周围 3 枚环绕微光生物孢子
            ctx.fillStyle = 'rgba(240, 171, 252, 0.88)';
            for (let m = 0; m < 3; m++) {
              const ma = t * 3.4 + e.id + (m * Math.PI * 2) / 3;
              ctx.beginPath();
              ctx.arc(Math.cos(ma) * half * 0.58, Math.sin(ma) * half * 0.42, 2.4, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (e.enemyId === 'elite_vanguard') {
            // 帝国先锋：双联舰首炮口流光 + 对称金色指挥护盾弧 + 蓄力/冲锋专属特效
            const glint = 0.55 + 0.45 * Math.sin(t * 9 + e.id);
            ctx.fillStyle = `rgba(255, 90, 120, ${glint.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(half * 0.86, -half * 0.08, 3.6, 0, Math.PI * 2);
            ctx.arc(half * 0.86, half * 0.08, 3.6, 0, Math.PI * 2);
            ctx.fill();

            // 精致双段舰首能量护盾薄弧
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(half * 0.1, 0, half * 0.86, -0.85, -0.25);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(half * 0.1, 0, half * 0.86, 0.25, 0.85);
            ctx.stroke();

            if (e.entityState === 'SKILL_TELEGRAPH') {
              // 冲锋蓄力舰首炽热聚能光斑与十字星芒
              const flareR = half * (0.28 + 0.1 * Math.sin(t * 28));
              const fg = ctx.createRadialGradient(half * 0.72, 0, 1, half * 0.72, 0, flareR);
              fg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
              fg.addColorStop(0.45, 'rgba(250, 204, 21, 0.72)');
              fg.addColorStop(1, 'rgba(255, 30, 86, 0)');
              ctx.fillStyle = fg;
              ctx.beginPath();
              ctx.arc(half * 0.72, 0, flareR, 0, Math.PI * 2);
              ctx.fill();
            } else if (e.entityState === 'SKILL_EXECUTE') {
              // 高速冲锋舰首超音速抛物线激波弧
              ctx.lineCap = 'round';
              ctx.strokeStyle = 'rgba(255, 30, 86, 0.48)';
              ctx.lineWidth = 5.5;
              ctx.beginPath();
              ctx.moveTo(half * 0.14, -half * 0.68);
              ctx.quadraticCurveTo(half * 1.38, 0, half * 0.14, half * 0.68);
              ctx.stroke();

              ctx.strokeStyle = 'rgba(254, 240, 138, 0.88)';
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          } else if (e.enemyId === 'elite_prism') {
            // 棱镜异形：去除生硬黄色线框，改为紫金晶棱星芒折射与四段微光全息弧
            const isCasting = e.entityState === 'SKILL_TELEGRAPH';
            const shimmer = 0.55 + 0.45 * Math.sin(t * (isCasting ? 18 : 6.5) + e.id);
            const coreR = half * (isCasting ? 0.52 : 0.36);
            const pg = ctx.createRadialGradient(0, 0, 1, 0, 0, coreR);
            pg.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            pg.addColorStop(0.42, isCasting ? 'rgba(255, 46, 99, 0.65)' : 'rgba(217, 70, 239, 0.55)');
            pg.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(0, 0, coreR, 0, Math.PI * 2);
            ctx.fill();

            // 四向柔和晶棱折射光刺（无方框线）
            ctx.save();
            ctx.rotate(-t * (isCasting ? 2.6 : 1.4));
            const rayLen = half * (isCasting ? 0.98 : 0.78) * (0.85 + 0.15 * shimmer);
            const rayW = half * 0.085;
            for (let k = 0; k < 4; k++) {
              ctx.save();
              ctx.rotate((k * Math.PI) / 2);
              const rg = ctx.createLinearGradient(0, 0, rayLen, 0);
              rg.addColorStop(0, 'rgba(254, 240, 138, 0.72)');
              rg.addColorStop(0.5, isCasting ? 'rgba(255, 46, 99, 0.45)' : 'rgba(232, 121, 249, 0.45)');
              rg.addColorStop(1, 'rgba(217, 70, 239, 0)');
              ctx.fillStyle = rg;
              ctx.beginPath();
              ctx.moveTo(0, -rayW);
              ctx.lineTo(rayLen, 0);
              ctx.lineTo(0, rayW);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }

            // 四段细腻晶面全息弧刻度
            ctx.strokeStyle = isCasting
              ? `rgba(254, 240, 138, ${(0.58 + 0.3 * shimmer).toFixed(2)})`
              : `rgba(240, 171, 252, ${(0.34 + 0.22 * shimmer).toFixed(2)})`;
            ctx.lineWidth = 1.4;
            ctx.lineCap = 'round';
            for (let k = 0; k < 4; k++) {
              const a = (k * Math.PI) / 2 + 0.25;
              ctx.beginPath();
              ctx.arc(0, 0, half * 0.84, a, a + 0.52);
              ctx.stroke();
            }
            ctx.restore();
          } else if (isBoss) {
            const isCharging = e.entityState === 'SKILL_TELEGRAPH';
            const isDashing = e.entityState === 'SKILL_EXECUTE';
            const pulse = 0.55 + 0.45 * Math.sin(t * (isCharging ? 18 : e.bossPhase === 3 ? 11 : 6));
            const coreR = half * ((isCharging ? 0.34 : 0.24) + pulse * 0.08);
            const cg = ctx.createRadialGradient(0, 0, 2, 0, 0, coreR);
            cg.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
            cg.addColorStop(
              0.42,
              e.bossPhase === 3 || isCharging ? 'rgba(250, 204, 21, 0.78)' : 'rgba(255, 30, 86, 0.7)',
            );
            cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.arc(0, 0, coreR, 0, Math.PI * 2);
            ctx.fill();

            // 技能蓄力时核心十字星芒闪烁 + 舰首过载聚能光核
            if (isCharging) {
              const starR = half * (0.42 + pulse * 0.14);
              ctx.strokeStyle = 'rgba(254, 249, 195, 0.85)';
              ctx.lineWidth = 1.8;
              ctx.beginPath();
              ctx.moveTo(half * 0.52 - starR * 0.5, 0);
              ctx.lineTo(half * 0.52 + starR * 0.75, 0);
              ctx.moveTo(half * 0.52, -starR * 0.55);
              ctx.lineTo(half * 0.52, starR * 0.55);
              ctx.stroke();
            }

            // 高速冲锋瞬间：双层猩红/鎏金超音速抛物线激波弧
            if (isDashing) {
              ctx.lineCap = 'round';
              ctx.strokeStyle =
                e.bossPhase === 3
                  ? 'rgba(250, 204, 21, 0.48)'
                  : e.bossPhase === 2
                    ? 'rgba(217, 70, 239, 0.48)'
                    : 'rgba(255, 30, 86, 0.48)';
              ctx.lineWidth = 7.5;
              ctx.beginPath();
              ctx.moveTo(half * 0.08, -half * 0.84);
              ctx.quadraticCurveTo(half * 1.42, 0, half * 0.08, half * 0.84);
              ctx.stroke();

              ctx.strokeStyle = 'rgba(255, 241, 242, 0.9)';
              ctx.lineWidth = 2.1;
              ctx.stroke();
            }

            // P2/P3 Boss 能量镰翼边缘过载脉冲光弧
            if ((e.bossPhase ?? 1) >= 2) {
              ctx.lineCap = 'round';
              ctx.strokeStyle = e.bossPhase === 3 ? 'rgba(250, 204, 21, 0.78)' : 'rgba(232, 121, 249, 0.7)';
              ctx.lineWidth = 2.4;
              ctx.beginPath();
              ctx.arc(-half * 0.08, 0, half * 0.82, -1.25, -0.45);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(-half * 0.08, 0, half * 0.82, 0.45, 1.25);
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        if (e.hitFlashSec > 0 && cached.whiteFlash) {
          ctx.globalAlpha = isBoss ? 0.34 : 0.46;
          ctx.drawImage(cached.whiteFlash, -half, -half, drawSize, drawSize);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      } else {
        ctx.fillStyle = e.hitFlashSec > 0 ? '#FFFFFF' : e.colorHex;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.rotate(angleToPlayer);
        this.drawRegularPolygon(ctx, isBoss ? 8 : 6, r, 0);
        ctx.fill();
        ctx.stroke();
      }

      // 精英独立头顶战术血条（黑金边框 + 猩红高亮）
      if (isElite) {
        const bw = 58;
        const bh = 6;
        const by = -r - 24;
        ctx.fillStyle = 'rgba(6, 10, 22, 0.92)';
        ctx.fillRect(-bw / 2 - 1, by - 1, bw + 2, bh + 2);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.68)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-bw / 2 - 1, by - 1, bw + 2, bh + 2);
        const ratio = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)));
        ctx.fillStyle = '#FF1E56';
        ctx.fillRect(-bw / 2, by, bw * ratio, bh);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(-bw / 2, by, bw * ratio, 1.8);
      }

      ctx.restore();
    }
  }

  private drawRegularPolygon(ctx: CanvasRenderingContext2D, sides: number, radius: number, rot: number): void {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * Math.PI * 2) / sides;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  private drawPlayerProjectiles(snap: RenderSnapshot, minX: number, maxX: number, minY: number, maxY: number): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    ctx.save();
    if (!low) ctx.globalCompositeOperation = 'lighter';
    for (const pr of snap.playerProjectiles) {
      if (pr.x < minX || pr.x > maxX || pr.y < minY || pr.y > maxY) continue;
      ctx.save();
      ctx.translate(pr.x, pr.y);
      if (pr.sourceWeaponId === 'boomerang_matrix') {
        // 回旋矩阵刃 / 无限螺旋切刃：半透明弯月等离子斩击弧 + 锋刃高光 + 动态旋切残影（中心通透不遮挡主角）
        const r = pr.radiusPx;
        const rot = snap.worldTimeSec * (pr.isEvolution ? 19 : 14.5) + pr.id * 1.1;
        const bladeRgb = pr.isEvolution ? '250, 204, 21' : '52, 211, 153';
        const edgeHex = pr.isEvolution ? '#FEF9C3' : '#CCFBF1';

        ctx.rotate(rot);

        // 1. 柔和外围旋转气旋残影（3段半透明流光弧，彻底告别扁平实心外圆圈）
        if (!low) {
          ctx.lineCap = 'round';
          for (let b = 0; b < 3; b++) {
            const base = (b * Math.PI * 2) / 3;
            ctx.strokeStyle = `rgba(${bladeRgb}, ${pr.isEvolution ? 0.34 : 0.26})`;
            ctx.lineWidth = pr.isEvolution ? 3.2 : 2.3;
            ctx.beginPath();
            ctx.arc(0, 0, r * 1.12, base - 0.88, base + 0.08);
            ctx.stroke();
          }
        }

        // 2. 三枚纤薄弯月能量锋刃（通透渐变质感 + 炽白切割刃口）
        for (let b = 0; b < 3; b++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.fillStyle = `rgba(${bladeRgb}, ${pr.isEvolution ? 0.62 : 0.5})`;
          ctx.beginPath();
          ctx.moveTo(r * 0.26, -r * 0.16);
          ctx.quadraticCurveTo(r * 0.92, -r * 0.72, r * 1.28, 0.04 * r);
          ctx.quadraticCurveTo(r * 0.78, -r * 0.14, r * 0.24, r * 0.08);
          ctx.closePath();
          ctx.fill();

          // 弯月外锋利高光刃线
          ctx.strokeStyle = edgeHex;
          ctx.lineWidth = pr.isEvolution ? 1.5 : 1.15;
          ctx.beginPath();
          ctx.moveTo(r * 0.34, -r * 0.22);
          ctx.quadraticCurveTo(r * 0.92, -r * 0.72, r * 1.28, 0.04 * r);
          ctx.stroke();
        }

        // 3. 空心微光能量轴环 + 细小核心光点（绝不盖死战机主体）
        ctx.strokeStyle = `rgba(${bladeRgb}, 0.55)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 追踪脉冲弹 / 星穹集束炮：流线型炽金/天青等离子光矛 + 柔和曳光彗尾 + 针尖星芒
        const ang = Math.atan2(pr.vy, pr.vx);
        const r = pr.radiusPx;
        const tailLen = pr.isEvolution ? r * 6.0 : r * 4.4;
        ctx.rotate(ang);

        // 1. 流线型针尾等离子曳光（柔顺渐隐）
        const tailGrad = ctx.createLinearGradient(r * 1.1, 0, -tailLen, 0);
        tailGrad.addColorStop(0, pr.isEvolution ? 'rgba(254, 240, 138, 0.86)' : 'rgba(125, 211, 252, 0.82)');
        tailGrad.addColorStop(0.38, pr.isEvolution ? 'rgba(250, 204, 21, 0.45)' : 'rgba(56, 189, 248, 0.38)');
        tailGrad.addColorStop(0.75, pr.isEvolution ? 'rgba(249, 115, 22, 0.16)' : 'rgba(14, 165, 233, 0.12)');
        tailGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = tailGrad;
        ctx.beginPath();
        ctx.moveTo(r * 1.45, 0);
        ctx.quadraticCurveTo(r * 0.2, -r * 0.85, -tailLen, 0);
        ctx.quadraticCurveTo(r * 0.2, r * 0.85, r * 1.45, 0);
        ctx.closePath();
        ctx.fill();

        // 2. 弹头柔和椭圆光鞘
        if (!low) {
          const haloR = pr.isEvolution ? r * 1.85 : r * 1.5;
          const hg = ctx.createRadialGradient(r * 0.25, 0, 0.5, r * 0.25, 0, haloR);
          hg.addColorStop(0, pr.isEvolution ? 'rgba(254, 249, 195, 0.52)' : 'rgba(186, 230, 253, 0.44)');
          hg.addColorStop(0.55, pr.isEvolution ? 'rgba(250, 204, 21, 0.2)' : 'rgba(56, 189, 248, 0.18)');
          hg.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.arc(r * 0.25, 0, haloR, 0, Math.PI * 2);
          ctx.fill();
        }

        // 3. 锋利流线炽白矛芯
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(r * 1.32, 0);
        ctx.quadraticCurveTo(r * 0.35, -r * 0.42, -r * 1.15, 0);
        ctx.quadraticCurveTo(r * 0.35, r * 0.42, r * 1.32, 0);
        ctx.closePath();
        ctx.fill();

        // 4. 星穹集束超武：细微棱形流星芒尖（替代死板大白十字）
        if (pr.isEvolution && !low) {
          ctx.fillStyle = 'rgba(254, 249, 195, 0.72)';
          ctx.beginPath();
          ctx.moveTo(r * 0.4, -r * 1.35);
          ctx.lineTo(r * 0.65, 0);
          ctx.lineTo(r * 0.4, r * 1.35);
          ctx.lineTo(r * 0.15, 0);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawOrbitalBlades(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    const px = snap.player.x;
    const py = snap.player.y;
    ctx.save();
    if (!low) ctx.globalCompositeOperation = 'lighter';
    for (const b of snap.orbitalBlades) {
      // 1. 轨道流光拖尾弧
      if (!low) {
        const orbitDist = Math.hypot(b.x - px, b.y - py);
        if (orbitDist > 12) {
          ctx.strokeStyle = b.isEvolution ? 'rgba(250, 204, 21, 0.42)' : 'rgba(56, 189, 248, 0.36)';
          ctx.lineWidth = b.isEvolution ? 7 : 4.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(px, py, orbitDist, b.angleRad - 0.52, b.angleRad);
          ctx.stroke();
        }
      }

      // 2. 新月形相位等离子光刃（超武附加金色锯齿切割轮光环）
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angleRad + Math.PI / 2);
      const r = b.radiusPx;

      if (b.isEvolution) {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = b.isEvolution ? 'rgba(250, 204, 21, 0.42)' : 'rgba(56, 189, 248, 0.36)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.45);
      ctx.quadraticCurveTo(r * 0.95, 0, 0, r * 1.45);
      ctx.quadraticCurveTo(r * 0.15, 0, 0, -r * 1.45);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = b.isEvolution ? '#FEF08A' : '#E0F2FE';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.18);
      ctx.quadraticCurveTo(r * 0.62, 0, 0, r * 1.18);
      ctx.quadraticCurveTo(r * 0.12, 0, 0, -r * 1.18);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(r * 0.16, 0, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawEnemyBullets(snap: RenderSnapshot, minX: number, maxX: number, minY: number, maxY: number): void {
    const ctx = this.ctx;
    const pulse = 1 + 0.14 * Math.sin(snap.worldTimeSec * 16);
    for (const eb of snap.enemyBullets) {
      if (eb.x < minX || eb.x > maxX || eb.y < minY || eb.y > maxY) continue;
      const r = eb.radiusPx;
      // 敌方高危猩红炽橙能量弹（外晕 + 锐利猩红边 + 炽白核心，与我方青/金弹幕 100% 视觉分离）
      ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, r * 1.9 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F43F5E';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, r * 1.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FB923C';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, r * 0.82, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FEF9C3';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, r * 0.44, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayer(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const p = snap.player;
    const t = snap.worldTimeSec;
    const tier = Math.max(1, Math.min(5, p.formTier));
    const heading = Math.atan2(p.dirY, p.dirX);
    ctx.save();

    // 拾取范围柔和虚线圈
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.pickupRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const blinkVisible = p.invulnSec <= 0 || Math.floor(p.invulnSec * 24) % 2 === 0;
    if (p.isAlive && blinkVisible) {
      ctx.save();
      ctx.translate(p.x, p.y);

      // 电影级底部能量辉光晕（确保千军万马中 100% 一眼锁定主角）
      if (!this.settings.lowParticleMode) {
        const glowR = p.radiusPx * (2.2 + tier * 0.22);
        const aura = ctx.createRadialGradient(0, 0, p.radiusPx * 0.3, 0, 0, glowR);
        aura.addColorStop(0, tier >= 5 ? 'rgba(250, 204, 21, 0.32)' : 'rgba(56, 189, 248, 0.28)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      const formKey = `form_visual_${tier}` as SpriteAssetKey;
      const formSprite = this.sprites.get(formKey);
      if (formSprite) {
        // 高阶形态动态外环旋转能量反馈
        if (tier >= 4) {
          ctx.strokeStyle = tier >= 5 ? 'rgba(250, 204, 21, 0.55)' : 'rgba(192, 132, 252, 0.45)';
          ctx.lineWidth = 1.6;
          this.drawRegularPolygon(ctx, tier >= 5 ? 8 : 6, p.radiusPx * 2.15, -t * 1.4);
          ctx.stroke();
        }
        ctx.rotate(heading);
        const shipSize = p.radiusPx * (4.1 + (tier - 1) * 0.3);
        const half = shipSize / 2;
        const pSpeed = Math.hypot(this.playerVelX, this.playerVelY);
        const speedBoost = 0.85 + Math.min(0.65, pSpeed / 260);
        const tierAccent =
          tier >= 5
            ? '#FACC15'
            : tier === 4
              ? '#C084FC'
              : tier === 3
                ? '#34D399'
                : '#38BDF8';

        // 1. 主角机甲速度联动双喷口加力尾焰 + 激波菱形光核
        if (!this.settings.lowParticleMode) {
          const flick = (0.78 + 0.22 * Math.sin(t * 36)) * speedBoost;
          const jetCol = tier >= 5 ? 'rgba(250,204,21,0.9)' : tier === 4 ? 'rgba(192,132,252,0.88)' : tier === 3 ? 'rgba(52,211,153,0.88)' : 'rgba(56,189,248,0.9)';
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          this.drawThrusterFlame(ctx, -half * 0.54, -half * 0.14, half * 0.65 * flick, half * 0.105, jetCol, '#FFFFFF', true);
          this.drawThrusterFlame(ctx, -half * 0.54, half * 0.14, half * 0.65 * flick, half * 0.105, jetCol, '#FFFFFF', true);
          ctx.restore();
        }

        // 2. 机甲主体精灵
        ctx.drawImage(formSprite.normal, -half, -half, shipSize, shipSize);

        // 3. 主角机甲细节微特效：全息舰首护盾弧 + 翼尖航行频闪灯 + 开火炮口星芒 + 回血绿光环
        if (!this.settings.lowParticleMode) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';

          // 舰首半透明战术力场护盾弧（受击无敌、回血或低血量危机时高亮反馈）
          const lowHpDanger = p.hp / Math.max(1, p.maxHp) <= 0.3;
          const shieldAlpha =
            this.healAuraSec > 0
              ? 0.72
              : p.invulnSec > 0
                ? 0.78
                : lowHpDanger
                  ? 0.42 + 0.32 * Math.abs(Math.sin(t * 7.5))
                  : 0.24 + 0.12 * Math.sin(t * 4.5);
          ctx.strokeStyle =
            this.healAuraSec > 0
              ? '#34D399'
              : p.invulnSec > 0 || lowHpDanger
                ? '#F43F5E'
                : tierAccent;
          ctx.globalAlpha = shieldAlpha;
          ctx.lineWidth = p.invulnSec > 0 || this.healAuraSec > 0 || lowHpDanger ? 2.4 : 1.5;
          ctx.beginPath();
          ctx.arc(half * 0.1, 0, half * 0.96, -0.95, 0.95);
          ctx.stroke();

          // 双翼尖同步频闪导航微光灯
          const strobe = Math.sin(t * 10);
          if (strobe > 0.2) {
            ctx.globalAlpha = 0.75 * strobe;
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(-half * 0.18, -half * 0.56, 2.2, 0, Math.PI * 2);
            ctx.arc(-half * 0.18, half * 0.56, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }

          // 武器发射瞬间舰首十字炮口星芒闪爆
          if (this.muzzleFlashSec > 0) {
            const mf = this.muzzleFlashSec / 0.085;
            const mx = half * 0.76;
            ctx.globalAlpha = mf * 0.92;
            ctx.fillStyle = this.muzzleFlashGold ? '#FACC15' : '#7DD3FC';
            ctx.beginPath();
            ctx.arc(mx, 0, 5 + mf * 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(mx - 6 * mf, 0);
            ctx.lineTo(mx + 12 * mf, 0);
            ctx.moveTo(mx, -8 * mf);
            ctx.lineTo(mx, 8 * mf);
            ctx.stroke();
          }

          ctx.restore();
        }
      } else {
        // 加载期间程序化几何兜底
        ctx.fillStyle = p.primaryColorHex;
        ctx.beginPath();
        ctx.arc(0, 0, p.radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p.secondaryColorHex;
        ctx.lineWidth = 1.5;
        this.drawRegularPolygon(ctx, tier >= 2 ? 6 : 4, p.radiusPx + 3, heading);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 血条已统一升级至左上角战术 HUD，战机下方保持纯粹干净（低血危机通过舰首红光护盾弧提示）
    ctx.restore();
  }

  private stepAndDrawParticles(dt: number): void {
    const ctx = this.ctx;
    const low = this.settings.lowParticleMode;
    ctx.save();
    if (!low) ctx.globalCompositeOperation = 'lighter';

    // 1. 暴击与击杀动态扩散冲击环
    for (let i = 0; i < this.shockRings.length; i++) {
      const sr = this.shockRings[i];
      if (!sr || !sr.active) continue;
      sr.lifeSec -= dt;
      if (sr.lifeSec <= 0) {
        sr.active = false;
        continue;
      }
      const prog = 1 - sr.lifeSec / sr.maxLifeSec;
      sr.radiusPx = 4 + (sr.maxRadiusPx - 4) * (1 - (1 - prog) * (1 - prog));
      ctx.globalAlpha = Math.max(0, 1 - prog);
      ctx.strokeStyle = sr.colorHex;
      ctx.lineWidth = sr.lineWidth * (1 - prog * 0.55);
      ctx.beginPath();
      ctx.arc(sr.x, sr.y, sr.radiusPx, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 1.5 命中与击杀高能十字星芒闪爆（零 shadowBlur，打击感利器）
    if (!low) {
      for (let i = 0; i < this.impactFlashes.length; i++) {
        const fl = this.impactFlashes[i];
        if (!fl || !fl.active) continue;
        fl.lifeSec -= dt;
        if (fl.lifeSec <= 0) {
          fl.active = false;
          continue;
        }
        const ratio = Math.max(0, fl.lifeSec / fl.maxLifeSec);
        const curR = fl.radiusPx * (1.28 - ratio * 0.5);
        ctx.save();
        ctx.translate(fl.x, fl.y);
        ctx.rotate(fl.rotRad);
        ctx.globalAlpha = ratio * 0.92;
        // 外层染色核心光球
        ctx.fillStyle = fl.colorHex;
        ctx.beginPath();
        ctx.arc(0, 0, curR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        // 锐利十字高光星芒
        ctx.fillStyle = '#FFFFFF';
        for (let arm = 0; arm < 2; arm++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(-curR, 0);
          ctx.lineTo(0, curR * 0.16);
          ctx.lineTo(curR, 0);
          ctx.lineTo(0, -curR * 0.16);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 2. 高速方向性火花拖尾粒子
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      if (!pt || !pt.active) continue;
      const prevX = pt.x;
      const prevY = pt.y;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.9;
      pt.vy *= 0.9;
      pt.lifeSec -= dt;
      if (pt.lifeSec <= 0) {
        pt.active = false;
        continue;
      }
      ctx.globalAlpha = Math.max(0, pt.lifeSec / pt.maxLifeSec);
      if (low) {
        ctx.fillStyle = pt.colorHex;
        ctx.fillRect(pt.x - pt.sizePx / 2, pt.y - pt.sizePx / 2, pt.sizePx, pt.sizePx);
      } else {
        ctx.strokeStyle = pt.colorHex;
        ctx.lineWidth = Math.max(1.5, pt.sizePx * 0.72);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(pt.x + pt.vx * 0.025, pt.y + pt.vy * 0.025);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private stepAndDrawTexts(dt: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this.floatingTexts.length; i++) {
      const t = this.floatingTexts[i];
      if (!t || !t.active) continue;
      t.y += t.vy * dt;
      t.vy *= 0.92;
      t.lifeSec -= dt;
      if (t.lifeSec <= 0) {
        t.active = false;
        continue;
      }
      if (this.settings.disableDamageText) continue;
      const age = t.maxLifeSec - t.lifeSec;
      const pop = age < 0.08 ? 0.72 + (age / 0.08) * 0.56 : age < 0.16 ? 1.28 - ((age - 0.08) / 0.08) * 0.28 : 1;
      const fontSize = Math.round(13.5 * t.scale * pop);
      ctx.globalAlpha = Math.min(1, t.lifeSec * 2.5);
      ctx.font = `900 ${fontSize}px "Segoe UI", ui-monospace, monospace`;
      ctx.lineWidth = t.isCrit ? 3.5 : 2.6;
      ctx.strokeStyle = 'rgba(4, 8, 18, 0.92)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.colorHex;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawEdgeIndicators(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const margin = 48;
    const pulse = 0.86 + 0.14 * Math.sin(snap.worldTimeSec * 6);
    for (const ind of snap.edgeIndicators) {
      const color =
        ind.kind === 'altar'
          ? '#38BDF8'
          : ind.kind === 'elite'
            ? '#FF1E56'
            : ind.kind === 'chest'
              ? '#FACC15'
              : '#22D3EE';
      const label =
        ind.kind === 'altar'
          ? '祭坛'
          : ind.kind === 'elite'
            ? '精英'
            : ind.kind === 'chest'
              ? '宝箱'
              : '信标';

      const ax = Math.max(margin, Math.min(LOGICAL_WIDTH - margin, LOGICAL_WIDTH / 2 + Math.cos(ind.angleRad) * (LOGICAL_WIDTH / 2 - margin)));
      const ay = Math.max(84, Math.min(LOGICAL_HEIGHT - margin, LOGICAL_HEIGHT / 2 + Math.sin(ind.angleRad) * (LOGICAL_HEIGHT / 2 - margin)));

      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ind.angleRad);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = 'rgba(6, 11, 24, 0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, 6.5);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, -6.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const tagText = `${label} ${Math.round(ind.distancePx / 10)}m`;
      ctx.save();
      ctx.font = 'bold 11px "Segoe UI", monospace';
      const tw = ctx.measureText(tagText).width + 12;
      ctx.fillStyle = 'rgba(6, 11, 24, 0.84)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.fillRect(ax - tw / 2, ay + 15, tw, 17);
      ctx.strokeRect(ax - tw / 2, ay + 15, tw, 17);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(tagText, ax, ay + 27);
      ctx.restore();
    }
  }
}
