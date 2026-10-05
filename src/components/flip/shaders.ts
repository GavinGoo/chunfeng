/**
 * 翻页着色器（09 §4.2、§4.4、§4.5）。
 *
 * 卷曲公式必须与 curl.ts 的 curlPoint 保持一致（单元测试验证的是 TS 版本）。
 * 颜色全程在 sRGB 空间直接计算：纹理不做色彩空间转换，输出也不转换，保证与 DOM 纸页逐像素一致。
 * 光照做了归一化：平放的纸页（法线 +z）亮度恰为 1，于是 WebGL 底页与 DOM 纸页交接时没有明暗跳变。
 */

export const PAGE_VERTEX = /* glsl */ `
uniform float uD;       // 卷曲线距离
uniform float uTheta;   // 卷曲线倾角
uniform float uR;       // 卷曲半径
varying vec2 vUv;
varying vec3 vNormal;
varying float vA;       // 卷曲角 0..π
varying float vWorldX;  // 单页模式越过书脊后的淡出
varying vec2 vLocal;    // 未卷曲时的局部坐标（接收投影用）
varying vec2 vPos;      // 卷曲后的局部坐标 (x, z)，用于书脊阴影

const float PI = 3.14159265;

void main() {
  vec2 p = position.xy;
  float R = max(uR, 0.25);
  vec2 n = vec2(cos(uTheta), -sin(uTheta));
  float s = dot(p, n) - uD;
  vec3 pos = vec3(p, 0.0);
  vec3 nor = vec3(0.0, 0.0, 1.0);
  float a = 0.0;
  if (s > 0.0) {
    float halfC = PI * R;
    if (s < halfC) {
      a = s / R;
      pos.xy = p - s * n + n * R * sin(a);
      pos.z = R * (1.0 - cos(a));
      nor = vec3(-sin(a) * n, cos(a));
    } else {
      a = PI;
      pos.xy = p - s * n - n * (s - halfC);
      pos.z = 2.0 * R;
      nor = vec3(0.0, 0.0, -1.0);
    }
  }
  vUv = uv;
  vNormal = nor;          // 模型无旋转，相机正对 −z：局部法线即视图空间法线
  vA = a;
  vLocal = p;
  vPos = vec2(pos.x, pos.z);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldX = world.x;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PAGE_FRAGMENT = /* glsl */ `
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform vec3 uLightDir;     // 指向光源，左上方月光
uniform float uSingle;      // 1 = 单页模式
uniform float uSpineX;      // 书脊的世界 x
uniform float uPageW;
uniform float uPageH;
uniform float uFlat;        // 1 = 底页（不做光照，恒等于纹理）
uniform vec4 uCasterA;      // (d, θ, R, 卷曲处影子强度)
uniform float uFoldA;       // 折返段边缘影子强度
uniform vec4 uCasterB;
uniform float uFoldB;
varying vec2 vUv;
varying vec3 vNormal;
varying float vA;
varying float vWorldX;
varying vec2 vLocal;
varying vec2 vPos;

const float PI = 3.14159265;

// 一张卷起的纸（caster）投在其下平面（局部坐标 q）上的影子
float casterShadow(vec2 q, vec4 c, float kFold) {
  if (c.w <= 0.0 && kFold <= 0.0) return 0.0;
  float R = max(c.z, 0.25);
  vec2 n = vec2(cos(c.y), -sin(c.y));
  float sh = 0.0;
  // 1. 卷起处：最深处在卷曲线附近，向外约 2R 衰减（卷曲线内侧被纸本身挡住）
  float u = dot(q, n) - c.x;
  if (c.w > 0.0 && u > 0.0) {
    sh = c.w * (1.0 - smoothstep(0.3 * R, 2.2 * R + 4.0, u));
  }
  // 2. 折返平铺段（高度 2R）边缘外侧的柔和接触影，沿光线方向（右下）偏移
  if (kFold > 0.0) {
    float h = 2.0 * R;
    vec2 qs = q + 0.5 * h * uLightDir.xy / max(uLightDir.z, 0.2);
    float us = dot(qs, n) - c.x;
    if (us <= 0.0) {
      vec2 p = qs - (2.0 * us - PI * R) * n;   // 关于 n·p = d + πR/2 的镜像，即折返前的位置
      float dist = max(p.x - uPageW, abs(p.y) - 0.5 * uPageH);
      if (dist > 0.0) {
        float w = 4.0 + 0.6 * h;
        sh = max(sh, kFold * (1.0 - smoothstep(0.0, w, dist)));
      }
    }
  }
  return sh;
}

void main() {
  bool front = gl_FrontFacing;
  vec3 N = normalize(front ? vNormal : -vNormal);
  vec2 uv = front ? vUv : vec2(1.0 - vUv.x, vUv.y);       // 背面镜像采样
  vec4 base = front ? texture2D(uFront, uv) : texture2D(uBack, uv);

  vec3 L = normalize(uLightDir);
  vec3 color;
  if (uFlat > 0.5) {
    color = base.rgb;
  } else {
    float diff = clamp(dot(N, L), 0.0, 1.0);
    float light = (0.74 + 0.26 * diff) / (0.74 + 0.26 * clamp(L.z, 0.0, 1.0));
    float ao = 1.0 - 0.16 * sin(vA);                          // 卷曲内侧略暗
    vec3 V = vec3(0.0, 0.0, 1.0);
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 24.0) * 0.05;
    float specFlat = pow(max(dot(reflect(-L, V), V), 0.0), 24.0) * 0.05;
    color = base.rgb * light * ao + (spec - specFlat);
  }

  // 只有平贴部分接收下方投影
  float flatW = front ? 1.0 - smoothstep(0.0, 0.04, vA) : 0.0;
  if (flatW > 0.0) {
    float sh = max(casterShadow(vLocal, uCasterA, uFoldA), casterShadow(vLocal, uCasterB, uFoldB));
    color *= 1.0 - sh * flatW;
  }

  // 书脊阴影：与 DOM 纸页的 linear-gradient(rgba(0,0,0,.22), transparent 10%) 完全一致（06 §4），
  // 只作用于贴近纸面的部分，保证画布淡出、页面落下时书脊处没有明暗跳变
  float gutter = 0.22 * (1.0 - clamp(abs(vPos.x) / (0.1 * uPageW), 0.0, 1.0));
  color *= 1.0 - gutter * (1.0 - smoothstep(0.5, 6.0, vPos.y));

  float alpha = uSingle > 0.5 ? smoothstep(uSpineX - 0.15 * uPageW, uSpineX, vWorldX) : 1.0;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(color, alpha);
}
`;
