// 设计系统评审页（06 §9.5）：仅开发环境可见。
// 色板、字体与字号、按钮、图标、烫金、材质纹理。答案页的选项行留待 M4。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FoilText } from '@/components/book/CoverFoil';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatPageNo, formatPct, zh } from '@/copy/zh';
import { LiveRegionDemo } from './LiveRegionDemo';
import styles from './styleguide.module.css';

export const metadata: Metadata = { title: '春风 · 设计系统', robots: { index: false } };

const COLOR_GROUPS: { name: string; tokens: string[] }[] = [
  { name: '夜色', tokens: ['night-950', 'night-900', 'night-800'] },
  { name: '月光', tokens: ['moon-100', 'moon-300', 'moon-500'] },
  { name: '午夜蓝封面', tokens: ['cover-950', 'cover-900', 'cover-800', 'cover-700'] },
  { name: '烫金', tokens: ['gold-100', 'gold-300', 'gold-500', 'gold-700'] },
  { name: '纸页', tokens: ['paper-50', 'paper-100', 'paper-200', 'paper-300'] },
  { name: '墨色', tokens: ['ink-900', 'ink-700', 'ink-500', 'ink-line', 'ink-wash'] },
  { name: '朱砂 · 春绿', tokens: ['cinnabar-600', 'cinnabar-wash', 'jade-300'] },
];

const TYPE_SCALE = [
  { token: 'fs-xs', sample: zh.answer.aiLabel },
  { token: 'fs-sm', sample: zh.answer.firstHint },
  { token: 'fs-base', sample: zh.notice.sensitive.fallback },
  { token: 'fs-md', sample: '拿着邀约谈一次加薪' },
  { token: 'fs-lg', sample: zh.cover.subtitle },
  { token: 'fs-xl', sample: '「工作三年了，要不要跳槽去创业公司？」' },
];

const ICONS: IconName[] = ['share', 'reflip', 'chevron', 'close'];

export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className={styles.page}>
      <h1 className={styles.h1}>春风 · 设计系统</h1>

      <section className={styles.section}>
        <h2 className={styles.h2}>色彩</h2>
        {COLOR_GROUPS.map((g) => (
          <div key={g.name} className={styles.group}>
            <h3 className={styles.h3}>{g.name}</h3>
            <div className={styles.swatches}>
              {g.tokens.map((t) => (
                <figure key={t} className={styles.swatch}>
                  <span className={styles.chip} style={{ background: `var(--${t})` }} />
                  <figcaption>--{t}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>字号（夜色）</h2>
        {TYPE_SCALE.map(({ token, sample }) => (
          <p key={token} className={styles.typeRow}>
            <code className={styles.code}>--{token}</code>
            <span style={{ fontSize: `var(--${token})` }}>{sample}</span>
          </p>
        ))}
      </section>

      <section className={`${styles.section} ${styles.paper}`} data-surface="paper">
        <h2 className={styles.h2}>纸页与墨色</h2>
        <p className={styles.meta}>2026年9月27日 21:40 · 丙午年八月十七 · 亥时</p>
        <p className={styles.question}>「工作三年了，要不要跳槽去创业公司？」</p>
        <p className={styles.body}>{zh.notice.sensitive.fallback}</p>
        <p className={styles.numbers}>
          <span className="tnum">{formatPct(44)}</span>
          <span className="tnum">{formatPct(25)}</span>
          <span className="tnum">{formatPct(20)}</span>
          <span className="tnum">{formatPct(11)}</span>
          <span className="tnum">{formatPct(0)}</span>
        </p>
        <p className={styles.footer}>
          <span>{zh.answer.aiLabel}</span>
          <span>{formatPageNo(237)}</span>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>烫金</h2>
        <p className={styles.foilSample}>
          <FoilText sheen="loop">{zh.cover.title}</FoilText>
        </p>
        <p className={styles.foilSub}>
          <FoilText>{zh.cover.subtitle}</FoilText>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>按钮</h2>
        <div className={styles.row}>
          <Button variant="link">{zh.actions.changeQuestion}</Button>
          <Button variant="primary">{zh.actions.regenerate}</Button>
          <Button variant="secondary" icon="share">
            {zh.actions.share}
          </Button>
        </div>
        <div className={styles.row}>
          <Button variant="primary">{zh.actions.askToo}</Button>
          <Button variant="primary" inactive>
            {zh.actions.retry}
          </Button>
          <Button variant="primary" highlight>
            {zh.actions.retry}
          </Button>
          <Button variant="link">{zh.actions.close}</Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>图标（1.25 px 线宽）</h2>
        <div className={styles.row}>
          {ICONS.map((name) => (
            <figure key={name} className={styles.icon}>
              <Icon name={name} size={28} />
              <figcaption>{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>材质</h2>
        <div className={styles.textures}>
          <figure>
            <span className={`${styles.texture} ${styles.leather}`} />
            <figcaption>leather.webp · multiply · --cover-800</figcaption>
          </figure>
          <figure>
            <span className={`${styles.texture} ${styles.paperTexture}`} />
            <figcaption>paper.webp</figcaption>
          </figure>
          <figure>
            <span className={`${styles.texture} ${styles.grain}`} />
            <figcaption>grain.png（放大显示）</figcaption>
          </figure>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>播报（LiveRegion）</h2>
        <LiveRegionDemo />
      </section>
    </main>
  );
}
