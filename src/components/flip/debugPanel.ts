/**
 * `?debug=flip` 调参面板（09 §9，仅开发环境，经动态 import 加载）。
 * 直接修改 tuning 对象；显示实时 FPS。
 */

import { type FlipTuning, fpsMeter, setTuning, tuning } from './tuning';

interface Field {
  key: keyof FlipTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

const FIELDS: Field[] = [
  { key: 'theta0Min', label: 'θ0 min', min: 0, max: 0.5, step: 0.01 },
  { key: 'theta0Max', label: 'θ0 max', min: 0, max: 0.5, step: 0.01 },
  { key: 'rMaxMin', label: 'Rmax min ×W', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'rMaxMax', label: 'Rmax max ×W', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'duration', label: '时长 ms', min: 300, max: 2000, step: 10 },
  { key: 'interval', label: '间隔 ms', min: 150, max: 1500, step: 10 },
  { key: 'lightX', label: '光 x', min: -1, max: 1, step: 0.01 },
  { key: 'lightY', label: '光 y', min: -1, max: 1, step: 0.01 },
  { key: 'lightZ', label: '光 z', min: 0.1, max: 1, step: 0.01 },
  { key: 'curlShadow', label: '卷曲影', min: 0, max: 0.6, step: 0.01 },
  { key: 'foldShadow', label: '接触影', min: 0, max: 0.6, step: 0.01 },
];

let panel: HTMLDivElement | null = null;

export function openDebugPanel(): void {
  if (panel || typeof document === 'undefined') return;
  fpsMeter.enabled = true;
  const el = document.createElement('div');
  panel = el;
  Object.assign(el.style, {
    position: 'fixed',
    right: '8px',
    top: '8px',
    zIndex: '2147483647',
    background: 'rgba(7,6,15,0.88)',
    color: '#ece6d8',
    font: '12px/1.4 ui-monospace, monospace',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(227,200,138,0.35)',
    width: '240px',
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);

  const fps = document.createElement('div');
  fps.style.marginBottom = '6px';
  el.appendChild(fps);

  for (const f of FIELDS) {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '84px 1fr 44px',
      gap: '6px',
      alignItems: 'center',
    } satisfies Partial<CSSStyleDeclaration>);
    const name = document.createElement('span');
    name.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step);
    input.value = String(tuning[f.key]);
    const val = document.createElement('span');
    val.textContent = String(tuning[f.key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = String(v);
      setTuning({ [f.key]: v });
    });
    row.append(name, input, val);
    el.appendChild(row);
  }

  const dump = document.createElement('button');
  dump.type = 'button';
  dump.textContent = '输出参数到控制台';
  Object.assign(dump.style, { marginTop: '6px', width: '100%' } satisfies Partial<CSSStyleDeclaration>);
  dump.addEventListener('click', () => {
    console.info('[flip] tuning', JSON.stringify(tuning));
  });
  el.appendChild(dump);
  document.body.appendChild(el);

  let min = Number.POSITIVE_INFINITY;
  const tick = () => {
    if (!panel) return;
    const v = fpsMeter.fps();
    if (v > 5) min = Math.min(min, v);
    fps.textContent = `FPS ${v}  ·  最低 ${Number.isFinite(min) ? min : '—'}`;
    setTimeout(tick, 500);
  };
  tick();
}

export function closeDebugPanel(): void {
  panel?.remove();
  panel = null;
  fpsMeter.enabled = false;
}
