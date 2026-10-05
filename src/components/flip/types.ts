import type { BookGeometry } from '@/components/book/geometry';

export type FlipEngineKind = 'webgl' | 'css' | 'reduced';

/**
 * 翻页引擎接口（09 §5）。三种引擎实现同一接口，状态机不感知差异。
 *
 * 用法：
 *   const engine = await selectEngine();
 *   await engine.mount(layer, geometry);   // 预热：编译着色器、生成纹理（此时层不可见）
 *   engine.startLoop();                    // 层淡入并开始循环翻页
 *   await engine.stop();                   // resolve 时：空白底页完全可见
 *   await engine.fadeOut(150);             // 层淡出后暂停渲染
 *   engine.destroy();                      // 书进入 open / closed 时释放全部资源（16 §3.2）
 */
export interface FlipEngine {
  readonly kind: FlipEngineKind;
  /** 预热：编译着色器、生成纹理 */
  mount(layer: HTMLElement, geometry: BookGeometry): Promise<void>;
  startLoop(): void;
  /** resolve 时：空白底页完全可见 */
  stop(opts?: { minLoopMs?: number; minPages?: number }): Promise<void>;
  /** 单独翻一页（浏览器前进/后退恢复答案时使用） */
  flipOnce(): Promise<void>;
  resize(geometry: BookGeometry): void;
  fadeOut(ms?: number): Promise<void>;
  destroy(): void;
  onFallback?: (reason: string) => void;
}

/** 开发与测试钩子（09 §9）：window.__flip */
export interface FlipDevHook {
  readonly kind: FlipEngineKind;
  /** 暂停并渲染某个进度（t ∈ [0, 1]）；传 null 恢复正常渲染 */
  seek(t: number | null): void;
}

declare global {
  interface Window {
    __flip?: FlipDevHook;
  }
}
