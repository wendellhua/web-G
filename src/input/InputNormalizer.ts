/**
 * 键盘输入归一化模块（纯自动走位流：WASD / 方向键 + 1/2/3/R/Esc/P/Space/Enter 边沿热键）
 * 失焦或切后台时强制清空 pressedKeys 彻底杜绝粘键。
 */
import type { InputCommandFrame } from '../core/contracts/gameContracts';

export type HotkeyAction =
  | 'SELECT_0'
  | 'SELECT_1'
  | 'SELECT_2'
  | 'REROLL'
  | 'TOGGLE_PAUSE'
  | 'CONFIRM';

const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export class InputNormalizer {
  private readonly pressedKeys = new Set<string>();
  private readonly onHotkey: (action: HotkeyAction) => void;
  private readonly onAnyGesture: () => void;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    this.onAnyGesture();
    if (MOVEMENT_CODES.has(e.code)) {
      e.preventDefault();
      this.pressedKeys.add(e.code);
      return;
    }

    if (e.repeat) return;

    switch (e.code) {
      case 'Digit1':
        this.onHotkey('SELECT_0');
        break;
      case 'Digit2':
        this.onHotkey('SELECT_1');
        break;
      case 'Digit3':
        this.onHotkey('SELECT_2');
        break;
      case 'KeyR':
        this.onHotkey('REROLL');
        break;
      case 'Escape':
      case 'KeyP':
        e.preventDefault();
        this.onHotkey('TOGGLE_PAUSE');
        break;
      case 'Space':
      case 'Enter':
        this.onHotkey('CONFIRM');
        break;
      default:
        break;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.pressedKeys.delete(e.code);
  };

  private readonly handlePointerDown = (): void => {
    this.onAnyGesture();
  };

  constructor(onHotkey: (action: HotkeyAction) => void, onAnyGesture: () => void) {
    this.onHotkey = onHotkey;
    this.onAnyGesture = onAnyGesture;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('pointerdown', this.handlePointerDown);
  }

  public clearMovementKeys(): void {
    this.pressedKeys.clear();
  }

  public pollMovement(): InputCommandFrame {
    let moveX = 0;
    let moveY = 0;
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) moveX -= 1;
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) moveX += 1;
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) moveY -= 1;
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) moveY += 1;

    if (moveX !== 0 && moveY !== 0) {
      const inv = 1 / Math.SQRT2;
      moveX *= inv;
      moveY *= inv;
    }
    return { moveX, moveY };
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('pointerdown', this.handlePointerDown);
  }
}
