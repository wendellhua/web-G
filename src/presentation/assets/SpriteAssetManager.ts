/**
 * SpriteAssetManager —— 离屏位图缓存与纯白受击剪影缓存管理器（L3 表现层专用）
 * - 启动时异步并行加载 public/assets/sprites/*（全部 23 枚硬表面厚涂透明 PNG）；
 * - 光栅化预渲染至离屏 Canvas（60FPS 零重复解析开销），并自动生成纯白受击闪光剪影缓存；
 * - 任意资源尚未就绪或加载失败时返回 null，由 CanvasRenderer 无缝降级程序化绘制，绝不白屏阻塞。
 */
import { SPRITE_MANIFEST, STAGE_BACKGROUND_URL_BY_TIER, type SpriteAssetKey } from '../../assets/manifest';

export interface CachedSpriteEntry {
  readonly normal: HTMLCanvasElement;
  readonly whiteFlash: HTMLCanvasElement | null;
}

export class SpriteAssetManager {
  private readonly cache = new Map<SpriteAssetKey, CachedSpriteEntry>();
  private readonly bgCache = new Map<number, HTMLCanvasElement>();
  private started = false;

  public preloadAll(): void {
    if (this.started || typeof Image === 'undefined' || typeof document === 'undefined') {
      return;
    }
    this.started = true;

    // 1. 预加载全部 5 套五阶段星空背景贴图（离线预合成为 2x2 镜像无缝循环瓦片，确保全方向无限单调卷轴绝不反转眩晕）
    for (let tier = 1; tier <= 5; tier++) {
      const bgUrl = STAGE_BACKGROUND_URL_BY_TIER[tier];
      if (!bgUrl) continue;
      const bgImg = new Image();
      bgImg.decoding = 'async';
      bgImg.onload = () => {
        try {
          const tileW = 1280;
          const tileH = 720;
          const c = document.createElement('canvas');
          c.width = tileW * 2;
          c.height = tileH * 2;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.imageSmoothingEnabled = true;
          // 左上正常
          ctx.drawImage(bgImg, 0, 0, tileW, tileH);
          // 右上水平镜像
          ctx.save();
          ctx.translate(tileW * 2, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(bgImg, 0, 0, tileW, tileH);
          ctx.restore();
          // 左下垂直镜像
          ctx.save();
          ctx.translate(0, tileH * 2);
          ctx.scale(1, -1);
          ctx.drawImage(bgImg, 0, 0, tileW, tileH);
          ctx.restore();
          // 右下双向镜像
          ctx.save();
          ctx.translate(tileW * 2, tileH * 2);
          ctx.scale(-1, -1);
          ctx.drawImage(bgImg, 0, 0, tileW, tileH);
          ctx.restore();

          this.bgCache.set(tier, c);
        } catch {
          // 静默回退
        }
      };
      bgImg.src = bgUrl;
    }

    // 2. 预加载全部 23 枚精灵贴图与纯白受击剪影

    const keys = Object.keys(SPRITE_MANIFEST) as SpriteAssetKey[];
    for (const key of keys) {
      const spec = SPRITE_MANIFEST[key];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const size = spec.cacheSizePx;
          const normal = document.createElement('canvas');
          normal.width = size;
          normal.height = size;
          const nCtx = normal.getContext('2d');
          if (!nCtx) return;
          nCtx.imageSmoothingEnabled = true;

          // 离屏一次性烘焙装甲提亮与阵营轮廓微光（零逐帧 shadowBlur 开销，确保暗金属战舰与主角机甲在深空背景中细节锐利）
          const pad = spec.rimGlowRgba ? Math.round(size * 0.05) : 0;
          if (spec.rimGlowRgba) {
            const isEnemy = spec.needsWhiteFlash;
            const filterPrefix = isEnemy ? 'brightness(1.24) contrast(1.08)' : 'brightness(1.08) contrast(1.05)';
            nCtx.save();
            nCtx.filter = `${filterPrefix} drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.032))}px ${spec.rimGlowRgba})`;
            nCtx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
            nCtx.restore();
          } else {
            nCtx.drawImage(img, 0, 0, size, size);
          }

          let whiteFlash: HTMLCanvasElement | null = null;
          if (spec.needsWhiteFlash) {
            whiteFlash = document.createElement('canvas');
            whiteFlash.width = size;
            whiteFlash.height = size;
            const wCtx = whiteFlash.getContext('2d');
            if (wCtx) {
              wCtx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
              wCtx.globalCompositeOperation = 'source-in';
              wCtx.fillStyle = '#FFFFFF';
              wCtx.fillRect(0, 0, size, size);
            }
          }

          this.cache.set(key, { normal, whiteFlash });
        } catch {
          // 静默回退至程序化兜底绘制
        }
      };
      img.onerror = () => {
        // 容错降级：保持未缓存状态，CanvasRenderer 自动采用程序化兜底
      };
      img.src = spec.url;
    }
  }

  public get(key: SpriteAssetKey): CachedSpriteEntry | null {
    return this.cache.get(key) ?? null;
  }

  public getStageBackground(tier: number): HTMLCanvasElement | null {
    const safeTier = Math.max(1, Math.min(5, Math.floor(tier)));
    return this.bgCache.get(safeTier) ?? null;
  }
}
