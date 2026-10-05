// 封面上的线描纹样：祥云角花（08 §1）与压纹风纹。

/** 祥云角花：绘制左上角，其余三角由 CSS 镜像 */
export function CloudCorner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 26C4.5 14.1 14.1 4.5 26 4.5" />
        <path d="M26 4.5c4.9 0 8.2 3.3 8.2 6.9 0 3.2-2.4 5.4-5.1 5.4-2.3 0-3.9-1.6-3.9-3.5 0-1.6 1.2-2.8 2.7-2.8" />
        <path d="M4.5 26c0 4.9 3.3 8.2 6.9 8.2 3.2 0 5.4-2.4 5.4-5.1 0-2.3-1.6-3.9-3.5-3.9-1.6 0-2.8 1.2-2.8 2.7" />
        <path d="M11.5 19.5c0-4.4 3.6-8 8-8" />
        <path d="M34.2 11.4h5.3M11.4 34.2v5.3" />
      </g>
      <circle cx="9" cy="9" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** 风纹：三道随风起伏的线，末端微卷（无色压印） */
export function WindMark({ className }: { className?: string }) {
  const paths = [
    'M4 20c16-10 32-11 48-4s31 10 45 1c7-4.6 6-12-.5-11.5-5 .4-5.2 6.4-.9 7.1',
    'M16 34c15-7 30-7.5 45-2s30 7.6 50-3',
    'M6 47c14-5.5 27-6 40-2.4S70 50 84 45',
  ];
  return (
    <svg className={className} viewBox="0 0 120 56" fill="none" aria-hidden="true" focusable="false">
      <g strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        {/* 下方亮边：光从上方来，压凹的槽下沿受光 */}
        <g stroke="rgba(245, 231, 193, 0.07)" transform="translate(0 1)">
          {paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g stroke="rgba(0, 0, 0, 0.42)">
          {paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}
