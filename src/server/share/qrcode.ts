import QRCode from 'qrcode';

// 分享图二维码（12 §2）：纠错等级 M，4 个模块宽的静区，模块为 --ink-900，底色为 --paper-50。
// 直接由模块矩阵拼出 SVG（每个模块一个整格方块，crispEdges），不依赖 qrcode 的渲染器。

export const QR_QUIET_ZONE = 4;
export const QR_INK = '#2a221b'; // --ink-900
export const QR_PAPER = '#f4ecdc'; // --paper-50

export interface QrSvg {
  svg: string;
  /** 不含静区的模块数（边长） */
  modules: number;
  version: number;
}

export function qrSvg(text: string): QrSvg {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const total = size + QR_QUIET_ZONE * 2;
  let d = '';
  for (let r = 0; r < size; r++) {
    // 同一行里连续的深色模块合并为一段
    let c = 0;
    while (c < size) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < size && qr.modules.get(r, c)) c++;
      d += `M${start + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h${c - start}v1h${start - c}z`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${QR_PAPER}"/>` +
    `<path d="${d}" fill="${QR_INK}"/></svg>`;
  return { svg, modules: size, version: qr.version };
}

export function qrDataUri(text: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(qrSvg(text).svg).toString('base64')}`;
}
