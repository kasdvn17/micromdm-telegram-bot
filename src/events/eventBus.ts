import { EventEmitter } from "events";
import { AppEvent } from "../types/event.types";

const CHANNEL = "app-event";

/**
 * Event bus nội bộ, typed qua discriminated union `AppEvent`.
 * Mọi service publish qua đây, không quan tâm ai đang subscribe -
 * historyLogger và notifyBridge tự đăng ký lắng nghe tại main.ts.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // nhiều subscriber (history + notify + tương lai) trên cùng 1 event
    this.emitter.setMaxListeners(50);
  }

  publish(event: AppEvent): void {
    this.emitter.emit(CHANNEL, event);
  }

  subscribe(handler: (event: AppEvent) => void | Promise<void>): () => void {
    const wrapped = (event: AppEvent): void => {
      void handler(event);
    };
    this.emitter.on(CHANNEL, wrapped);
    return () => this.emitter.off(CHANNEL, wrapped);
  }
}
