'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { LiveRegion, type LiveRegionHandle } from '@/components/ui/LiveRegion';
import { zh } from '@/copy/zh';

const MESSAGES = [zh.live.flipping, zh.live.revealed, zh.live.closed] as const;

export function LiveRegionDemo() {
  const ref = useRef<LiveRegionHandle>(null);
  const [i, setI] = useState(0);
  return (
    <div>
      <Button
        variant="secondary"
        onClick={() => {
          const text = MESSAGES[i % MESSAGES.length] ?? '';
          ref.current?.announce(text);
          setI(i + 1);
        }}
      >
        {MESSAGES[i % MESSAGES.length]}
      </Button>
      <LiveRegion ref={ref} />
    </div>
  );
}
