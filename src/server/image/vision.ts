import { getConfig } from '../config';
import { log } from '../log';

// 图片功能的状态（15 §4）：
//   off         LLM_VISION 未开启
//   on          已开启，sharp 可用（尚未探测时乐观视为可用，上传时再按需加载）
//   unavailable 已开启，但 sharp 加载失败：不显示附图入口，图片接口返回 VISION_DISABLED，文字提问照常

export type VisionStatus = 'on' | 'off' | 'unavailable';

const g = globalThis as typeof globalThis & { __chunfengSharpOk?: boolean };

/** 启动时调用：加载 sharp，失败记 fatal（只在开关开启时） */
export async function probeSharp(): Promise<boolean> {
  if (g.__chunfengSharpOk !== undefined) return g.__chunfengSharpOk;
  try {
    await import('sharp');
    g.__chunfengSharpOk = true;
  } catch (e) {
    g.__chunfengSharpOk = false;
    if (getConfig().llm.vision) {
      log().fatal(
        { evt: 'image.sharp_unavailable', err: e instanceof Error ? e.message : String(e) },
        'LLM_VISION=true 但 sharp 加载失败，图片功能不可用',
      );
    }
  }
  return g.__chunfengSharpOk;
}

export function visionStatus(): VisionStatus {
  if (!getConfig().llm.vision) return 'off';
  return g.__chunfengSharpOk === false ? 'unavailable' : 'on';
}

export function isVisionEnabled(): boolean {
  return visionStatus() === 'on';
}

/** 仅测试使用 */
export function setSharpAvailableForTests(ok: boolean | undefined): void {
  g.__chunfengSharpOk = ok;
}
