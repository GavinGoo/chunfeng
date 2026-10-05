import type { ReactElement } from 'react';
import { photoTilt } from '@/components/answer/photoStyle';
import { zh } from '@/copy/zh';
import { formatCompact, formatLunarWithShichen } from '@/lib/shared/datetime';
import { formatPct } from '@/lib/shared/percent';
import type { OptionLetter, Reading } from '@/lib/shared/types';
import { CJK_FAMILY, LATIN_FAMILY } from './fonts';
import { Seal } from './seal';
import { sanitizeForShare } from './text';

// 分享图模板（12 §2）：1080 × 1620 的单页书页。satori 只支持 flex 布局：凡有多个子元素的节点都写明 display:flex。
// 颜色与答案页一致（06 §2，与 tokens.css 同值）；百分比直接读取已保存的 pct（与答案页完全相同）。

export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1620;

const C = {
  paper50: '#f4ecdc',
  ink900: '#2a221b',
  ink700: '#4b3f33',
  ink500: '#6b5a48',
  inkLine: 'rgba(42,34,27,.28)',
  inkLineSoft: 'rgba(42,34,27,.16)',
  inkWash: 'rgba(42,34,27,.10)',
  cinnabar: '#a33b2a',
  cinnabarLine: 'rgba(163,59,42,.5)',
  cinnabarWash: 'rgba(163,59,42,.16)',
  // 相角（与 tokens.css 的 --photo-corner-* 同值）
  cornerLight: '#4a3a2b',
  cornerDark: '#2f241a',
  cornerLine: 'rgba(227,200,138,.55)',
} as const;

const SERIF = `'${CJK_FAMILY}', '${LATIN_FAMILY}'`;
const NUMERIC = `'${LATIN_FAMILY}', '${CJK_FAMILY}'`;

/** 书页内容区：距图片边缘 40 px 的内框 + 64 px 版心留白 */
const FRAME = 40;
const PAD_X = 64;
const PAD_Y = 56;

export interface ShareOptionModel {
  letter: OptionLetter;
  title: string;
  pctText: string;
  /** 0–100，填充宽度 */
  pct: number;
}

/** 带图答案的相片（15 §12）：已缩放到相片框像素尺寸的 JPEG data URI */
export interface SharePhoto {
  dataUri: string;
  width: number;
  height: number;
  layout: PhotoLayout;
}

export interface ShareModel {
  time: string;
  lunar: string | null;
  question: string;
  options: ShareOptionModel[];
  photo?: SharePhoto;
  /** 相片的倾斜角（deg），与答案页横屏相同（由 reading id 算出，15 §11.2） */
  photoTilt?: number;
  /** 带图但读图失败：按无图版式渲染，「所问」行右侧标注「附图一张 · 扫码查看」 */
  photoFallback?: boolean;
}

const PHOTO_BORDER = 8;

/** 从 reading 生成模板数据：格式化时间、清洗文字（去 emoji 与缺字） */
export function toShareModel(
  reading: Reading,
  photo?: { photo?: SharePhoto; fallback?: boolean },
): ShareModel {
  const created = new Date(reading.createdAt);
  const q = sanitizeForShare(reading.question);
  return {
    ...(photo?.photo ? { photo: photo.photo, photoTilt: photoTilt(reading.id, 'spread') } : {}),
    ...(photo?.fallback ? { photoFallback: true } : {}),
    time: formatCompact(created, reading.tz),
    lunar: formatLunarWithShichen(created, reading.tz),
    question: `「${q || zh.share.image.emptyQuestion}」`,
    options: reading.options.map((o) => ({
      letter: o.letter,
      title: sanitizeForShare(o.title) || zh.share.image.emptyQuestion,
      pctText: formatPct(o.pct, o.prob),
      pct: Math.max(0, Math.min(100, o.pct)),
    })),
  };
}

/** 按字重汇总模板中要显示的全部文字（用于字体子集化；印章用书名子集字体，不在此列） */
export function shareTexts(m: ShareModel): { 400: string; 600: string } {
  return {
    400: [
      m.time,
      m.lunar ?? '',
      zh.share.image.asked,
      m.photoFallback ? zh.share.image.photoFallback : '',
      m.question,
      zh.answer.heading,
      ...m.options.map((o) => o.title),
      zh.share.scanHint,
      zh.answer.aiLabel,
    ].join(''),
    600: [zh.share.slogan, ...m.options.flatMap((o) => [o.letter, o.pctText])].join(''),
  };
}

function Label({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', fontSize: 22, letterSpacing: '0.3em', color: C.ink500, lineHeight: 1 }}>
      {text}
    </div>
  );
}

function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <div style={{ display: 'flex', flex: 1, height: 1.5, backgroundColor: C.inkLine }} />
      <div
        style={{
          display: 'flex',
          width: 11,
          height: 11,
          margin: '0 22px',
          border: `1.5px solid ${C.inkLine.replace('.28', '.5')}`,
          transform: 'rotate(45deg)',
        }}
      />
      <div style={{ display: 'flex', flex: 1, height: 1.5, backgroundColor: C.inkLine }} />
    </div>
  );
}

function OptionRow({ o, first }: { o: ShareOptionModel; first: boolean }) {
  const wash = first ? C.cinnabarWash : C.inkWash;
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        alignItems: 'center',
        height: 92,
        marginTop: first ? 0 : 20,
        padding: '0 30px 0 24px',
        border: `1.5px solid ${first ? C.cinnabarLine : C.inkLine}`,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {o.pct > 0 ? (
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${o.pct}%`,
            backgroundImage: `linear-gradient(90deg, ${wash} 0%, ${wash} 94%, rgba(0,0,0,0) 100%)`,
          }}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 46,
          borderRadius: 23,
          flexShrink: 0,
          backgroundColor: first ? C.cinnabar : 'transparent',
          border: first ? 'none' : `1.5px solid ${C.ink700}`,
          color: first ? C.paper50 : C.ink700,
          fontFamily: NUMERIC,
          fontWeight: 600,
          fontSize: 25,
          lineHeight: 1,
          paddingBottom: 2,
        }}
      >
        {o.letter}
      </div>
      <div
        style={{
          display: 'block',
          flex: 1,
          minWidth: 0,
          marginLeft: 24,
          fontSize: 34,
          lineHeight: 1.3,
          color: C.ink900,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {o.title}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          width: 116,
          flexShrink: 0,
          marginLeft: 16,
          fontFamily: NUMERIC,
          fontWeight: 600,
          fontSize: 34,
          color: first ? C.cinnabar : C.ink900,
        }}
      >
        {o.pctText}
      </div>
    </div>
  );
}

const EDGE_DIR = { top: '180deg', bottom: '0deg', left: '90deg', right: '270deg' } as const;

function Edge({ side, size, alpha }: { side: keyof typeof EDGE_DIR; size: number; alpha: number }) {
  const horizontal = side === 'left' || side === 'right';
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        [side]: 0,
        ...(horizontal
          ? { top: 0, width: size, height: SHARE_HEIGHT }
          : { left: 0, width: SHARE_WIDTH, height: size }),
        backgroundImage: `linear-gradient(${EDGE_DIR[side]}, rgba(74,50,22,${alpha}) 0%, rgba(74,50,22,${alpha * 0.35}) 35%, rgba(74,50,22,0) 100%)`,
      }}
    />
  );
}

/** 老相册相角（15 §11.2）：深墨褐的三角小插袋，斜边内侧一道淡金细线；satori 不支持 clip-path，用 SVG 图片绘制 */
const CORNER = 46;
function cornerSvg(): string {
  const S = CORNER;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.cornerLight}"/><stop offset="1" stop-color="${C.cornerDark}"/></linearGradient></defs>
<path d="M1.5 1.5 H${S - 2} L1.5 ${S - 2} Z" fill="rgba(20,12,4,.22)" transform="translate(1.2 1.6)"/>
<path d="M0 0 H${S} L0 ${S} Z" fill="url(#g)"/>
<path d="M${S - 5} 3 L3 ${S - 5}" stroke="${C.cornerLine}" stroke-width="1.2" fill="none"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
const CORNER_SRC = cornerSvg();
const CORNER_ROTATE = { tl: 0, tr: 90, br: 180, bl: 270 } as const;

function PhotoCorner({ at }: { at: keyof typeof CORNER_ROTATE }) {
  const off = -3;
  return (
    // biome-ignore lint/performance/noImgElement: satori 模板，不是网页
    <img
      src={CORNER_SRC}
      width={CORNER}
      height={CORNER}
      alt=""
      style={{
        position: 'absolute',
        ...(at[0] === 't' ? { top: off } : { bottom: off }),
        ...(at[1] === 'l' ? { left: off } : { right: off }),
        transform: `rotate(${CORNER_ROTATE[at]}deg)`,
      }}
    />
  );
}

/** 相片：白边 + 细框 + 对角两枚老相册相角，整张按 reading id 倾斜（15 §11.2） */
function PhotoPrint({ photo, tilt }: { photo: SharePhoto; tilt: number }) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        padding: PHOTO_BORDER,
        backgroundColor: C.paper50,
        border: `1px solid rgba(42,34,27,.52)`,
        boxShadow: '0 3px 6px rgba(42,34,27,.18), 0 12px 26px -10px rgba(42,34,27,.26)',
        transform: `rotate(${tilt}deg)`,
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: satori 模板，不是网页 */}
      <img src={photo.dataUri} width={photo.width} height={photo.height} alt="" />
      <PhotoCorner at="tl" />
      <PhotoCorner at="br" />
    </div>
  );
}

/**
 * 带图时提问区的版式（15 §12）：side = 左文右图（提问最多 3 行，相片在右侧顶端对齐）；
 * 宽高比超过 2:1 的图放在右栏会压成一条细带，改用 below = 相片在提问下方、左对齐（提问最多 2 行）。
 */
export type PhotoLayout = 'side' | 'below';

/** 宽高比超过它的图用 below 版式 */
export const PHOTO_SIDE_MAX_RATIO = 2;

/** 各版式中相片（含白边与细框）的最大尺寸 */
export const PHOTO_BOXES: Record<PhotoLayout, { width: number; height: number }> = {
  side: { width: 340, height: 340 },
  below: { width: 880, height: 260 },
};

/** 相片框中图片的最大像素尺寸（扣除白边与细框） */
export function photoMax(layout: PhotoLayout): { width: number; height: number } {
  const b = PHOTO_BOXES[layout];
  return { width: b.width - 2 * (PHOTO_BORDER + 1), height: b.height - 2 * (PHOTO_BORDER + 1) };
}

export function photoLayoutFor(width: number, height: number): PhotoLayout {
  return height > 0 && width / height > PHOTO_SIDE_MAX_RATIO ? 'below' : 'side';
}

function QuestionText({ text, clamp }: { text: string; clamp: number }) {
  return (
    <div style={{ display: 'block', fontSize: 46, lineHeight: 1.5, color: C.ink900, lineClamp: clamp }}>
      {text}
    </div>
  );
}

function AskedWithPhoto({ question, photo, tilt }: { question: string; photo: SharePhoto; tilt: number }) {
  if (photo.layout === 'below') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26 }}>
        <QuestionText text={question} clamp={2} />
        <div style={{ display: 'flex', marginTop: 28, paddingLeft: 6 }}>
          <PhotoPrint photo={photo} tilt={tilt} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 26 }}>
      <div style={{ display: 'flex', flex: 1, minWidth: 0, marginRight: 44 }}>
        <QuestionText text={question} clamp={3} />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: PHOTO_BOXES.side.width,
          flexShrink: 0,
          marginTop: 8,
        }}
      >
        <PhotoPrint photo={photo} tilt={tilt} />
      </div>
    </div>
  );
}

export interface ShareAssets {
  paperDataUri: string;
  qrDataUri: string;
}

export function ShareTemplate({ model, assets }: { model: ShareModel; assets: ShareAssets }): ReactElement {
  const inset = FRAME;
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: SHARE_WIDTH,
        height: SHARE_HEIGHT,
        backgroundColor: '#efe5d0',
        fontFamily: SERIF,
        color: C.ink900,
      }}
    >
      {/* 纸纹 */}
      {/* biome-ignore lint/performance/noImgElement: satori 模板，不是网页 */}
      <img
        src={assets.paperDataUri}
        width={SHARE_WIDTH}
        height={SHARE_HEIGHT}
        alt=""
        style={{ position: 'absolute', left: 0, top: 0 }}
      />
      {/* 四周暗角：四条边各一段渐隐（satori 的 radial-gradient 支持有限，用线性渐变拼出） */}
      <Edge side="top" size={220} alpha={0.12} />
      <Edge side="bottom" size={260} alpha={0.14} />
      <Edge side="right" size={200} alpha={0.12} />
      <Edge side="left" size={200} alpha={0.06} />
      {/* 左缘书脊阴影 */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: 0,
          top: 0,
          width: 140,
          height: SHARE_HEIGHT,
          backgroundImage:
            'linear-gradient(90deg, rgba(20,12,4,.24) 0%, rgba(20,12,4,.10) 28%, rgba(20,12,4,0) 100%)',
        }}
      />
      {/* 双细线内框 */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: inset,
          top: inset,
          right: inset,
          bottom: inset,
          border: `1.5px solid ${C.inkLine}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 7,
            top: 7,
            right: 7,
            bottom: 7,
            border: `1px solid ${C.inkLineSoft}`,
          }}
        />
      </div>

      {/* 版心 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: FRAME + PAD_X,
          right: FRAME + PAD_X,
          top: FRAME + PAD_Y,
          bottom: FRAME + PAD_Y,
        }}
      >
        {/* 页眉：印章 + 时间 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Seal text={zh.share.image.seal} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingTop: 2 }}>
            <div
              style={{ display: 'flex', fontFamily: NUMERIC, fontSize: 26, color: C.ink700, lineHeight: 1.2 }}
            >
              {model.time}
            </div>
            {model.lunar ? (
              <div style={{ display: 'flex', fontSize: 22, color: C.ink500, marginTop: 8, lineHeight: 1.2 }}>
                {model.lunar}
              </div>
            ) : null}
          </div>
        </div>

        {/* 正文：提问 / 分割线 / 风吟 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            paddingBottom: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label text={zh.share.image.asked} />
            {model.photoFallback ? (
              <div style={{ display: 'flex', fontSize: 22, color: C.ink500, lineHeight: 1 }}>
                {zh.share.image.photoFallback}
              </div>
            ) : null}
          </div>
          {model.photo ? (
            <AskedWithPhoto question={model.question} photo={model.photo} tilt={model.photoTilt ?? 0} />
          ) : (
            <div
              style={{
                display: 'block',
                marginTop: 26,
                fontSize: 46,
                lineHeight: 1.5,
                color: C.ink900,
                lineClamp: 4,
              }}
            >
              {model.question}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              marginTop: model.photo ? 40 : 52,
              marginBottom: model.photo ? 40 : 52,
            }}
          >
            <Divider />
          </div>
          <Label text={zh.answer.heading} />
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
            {model.options.map((o, i) => (
              <OptionRow key={o.letter} o={o} first={i === 0} />
            ))}
          </div>
        </div>

        {/* 页脚：标语 + 二维码 */}
        <div style={{ display: 'flex', height: 1.5, backgroundColor: C.inkLine }} />
        <div style={{ display: 'flex', marginTop: 36, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingTop: 18 }}>
            <div
              style={{
                display: 'flex',
                fontSize: 40,
                fontWeight: 600,
                color: C.ink900,
                letterSpacing: '0.06em',
                lineHeight: 1.2,
              }}
            >
              {zh.share.slogan}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 24,
                color: C.ink500,
                marginTop: 18,
                letterSpacing: '0.04em',
              }}
            >
              {zh.share.scanHint}
            </div>
            <div style={{ display: 'flex', flex: 1 }} />
            <div style={{ display: 'flex', fontSize: 18, color: C.ink500, letterSpacing: '0.04em' }}>
              {zh.answer.aiLabel}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              padding: 5,
              border: `1px solid ${C.inkLineSoft}`,
              backgroundColor: C.paper50,
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: satori 模板，不是网页 */}
            <img src={assets.qrDataUri} width={220} height={220} alt="" />
          </div>
        </div>
      </div>
    </div>
  );
}
