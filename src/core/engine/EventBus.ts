/**
 * 强类型每帧离散事件总线（消费后清空，杜绝跨帧事件堆积）
 */
import type { GameEvent } from '../contracts/gameContracts';

export class GameEventBus {
  private readonly events: GameEvent[] = [];

  public emit(event: GameEvent): void {
    this.events.push(event);
  }

  public getFrameEvents(): readonly GameEvent[] {
    return this.events;
  }

  public clearFrameEvents(): void {
    this.events.length = 0;
  }
}
