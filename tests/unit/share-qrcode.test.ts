import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { QR_INK, QR_PAPER, QR_QUIET_ZONE, qrDataUri, qrSvg } from '@/server/share/qrcode';

describe('分享图二维码（12 §2）', () => {
  const url = 'https://chunfeng.example.com/a/AbCdEfGhIjKl';

  it('纠错等级 M，viewBox 含 4 个模块宽的静区', () => {
    const { svg, modules, version } = qrSvg(url);
    const ref = QRCode.create(url, { errorCorrectionLevel: 'M' });
    expect(modules).toBe(ref.modules.size);
    expect(version).toBe(ref.version);
    expect(modules).toBe(17 + 4 * version);
    const total = modules + QR_QUIET_ZONE * 2;
    expect(svg).toContain(`viewBox="0 0 ${total} ${total}"`);
    expect(svg).toContain(`fill="${QR_PAPER}"`);
    expect(svg).toContain(`fill="${QR_INK}"`);
  });

  it('深色模块与 qrcode 矩阵完全一致，且都在静区之内', () => {
    const { svg, modules } = qrSvg(url);
    const ref = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const grid = Array.from({ length: modules }, () => new Array<boolean>(modules).fill(false));
    const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const x = Number(m[1]) - QR_QUIET_ZONE;
      const y = Number(m[2]) - QR_QUIET_ZONE;
      const w = Number(m[3]);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(modules);
      for (let i = 0; i < w; i++) grid[y]![x + i] = true;
    }
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) expect(grid[r]![c]).toBe(Boolean(ref.modules.get(r, c)));
    }
  });

  it('data URI 为 base64 SVG', () => {
    const uri = qrDataUri(url);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1]!, 'base64').toString()).toContain('<svg');
  });
});
