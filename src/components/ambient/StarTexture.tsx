'use client';

// 星点纹理（10 §2.1、16 §3.13）：把平铺的星点 PNG 画进 <canvas>，代替 CSS 的平铺背景。
// canvas 是纹理层，不占合成器的瓦片显存，也不随整页失效重新栅格。Web 字体每加载完一个分片，Blink 都会让整页
// 重排、重绘；三层星点原先约占 140 MB 瓦片，开书后整页重新栅格时瓦片需求超出上限，书页整片缺块闪黑
// （复盘 2026-10-06-reveal-tile-oom-flash）。
//
// 接口：<StarTexture src="/textures/stars.png" tile={512} className={…} />
// - tile：平铺单元的边长（CSS px），即原先的 background-size；平铺从画布左上角起（background-position: 0 0）。
// 画布按自身 CSS 尺寸 × 设备像素比（上限 2）分配，尺寸或像素比变化时重画；图片未加载完时透明，与 CSS 背景一致。
// 不透明度、呼吸动画与混合模式仍写在 className 上，由合成器播放。

import { useEffect, useRef } from 'react';

const DPR_CAP = 2;

export interface StarTextureProps {
  src: string;
  tile: number;
  className?: string;
}

export function StarTexture({ src, tile, className }: StarTextureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = new Image();
    let loaded = false;

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      // 改 width / height 会清空画布；尺寸不变时手动清空，避免半透明的星点叠画两遍
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, pw, ph);
      }
      if (!loaded || pw === 0 || ph === 0) return;
      const pattern = ctx.createPattern(img, 'repeat');
      if (!pattern) return;
      const k = tile / img.naturalWidth;
      pattern.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 与 CSS 背景图（image-rendering: auto）相同的双线性放大
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    };

    img.onload = () => {
      loaded = true;
      draw();
    };
    img.src = src;

    const ro = new ResizeObserver(draw);
    ro.observe(canvas);

    // 窗口移到像素比不同的屏幕上：ResizeObserver 不报，单独监听
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      draw();
      watchDpr();
    };
    const watchDpr = () => {
      mq?.removeEventListener('change', onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    watchDpr();

    return () => {
      img.onload = null;
      ro.disconnect();
      mq?.removeEventListener('change', onDpr);
    };
  }, [src, tile]);

  return <canvas ref={canvasRef} className={className} data-star-texture="" />;
}
