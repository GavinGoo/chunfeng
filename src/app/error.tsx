'use client';

// 统一的错误边界（05 §7）：如 /a/[id] 读库失败。「书页一时翻不开」+ 刷新。

import { useEffect } from 'react';
import { AmbientBackground } from '@/components/ambient/AmbientBackground';
import { Button } from '@/components/ui/Button';
import { zh } from '@/copy/zh';
import styles from './error.module.css';

export default function ErrorPage({ error }: { error: Error & { digest?: string }; retry?: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className={styles.main}>
      <title>{zh.meta.title}</title>
      <AmbientBackground intensity="calm" />
      <section className={styles.page} aria-labelledby="error-title">
        <h1 id="error-title" className={styles.title}>
          {zh.error.server.title}
        </h1>
        <p className={styles.body}>{zh.error.server.body}</p>
      </section>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {zh.actions.refresh}
        </Button>
      </div>
    </main>
  );
}
