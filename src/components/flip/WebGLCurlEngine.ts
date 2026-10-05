/**
 * WebGL 圆柱卷曲翻页引擎（09 §3–§7）。
 *
 * 本模块只经由 select.ts 的动态 import() 加载，three.js 因此只出现在这个懒加载 chunk 中。
 *
 * 场景：一个全视口透明画布，世界坐标以 CSS px 为单位、y 轴朝上（worldY = vh − domY）；
 * 相机 fov 与舞台根节点的 CSS perspective 对齐，z = 0 平面与 DOM 像素级重合。
 * 所有纸页共用一个局部坐标系：原点在书脊中点，右页 x ∈ [0, W]，左页 x ∈ [−W, 0]。
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DoubleSide,
  FrontSide,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoColorSpace,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import type { BookGeometry } from '@/components/book/geometry';
import { createRoot, fadeTo, registerDevHook, unregisterDevHook, waitFrame } from './common';
import { type CurlParams, clamp, curlAt, easeFinal, easeInOutCubic, smoothstep } from './curl';
import { browserClock, type Flight, FlipScheduler, FrameDriver } from './scheduler';
import { PAGE_FRAGMENT, PAGE_VERTEX } from './shaders';
import { getPageTextures, PAPER_COLOR, type PageTextureSet } from './textures';
import { fpsMeter, lightDir, onTuningChange, rhythmFromTuning, tuning } from './tuning';
import type { FlipDevHook, FlipEngine } from './types';
import { flipCanvasRect } from './viewport';

const SEG_X = 40;
const SEG_Y = 60;
/** 空中页 3 + 收尾页 1 */
const POOL = 4;
/** 让卷曲线远离页面，即「不卷曲」 */
const NO_CURL: CurlParams = { d: 1e6, theta: 0, R: 1 };
const NO_CASTER = new Vector4(1e6, 0, 1, 0);

type Tex = 'blank' | 0 | 1 | 2;

type Uniforms = {
  uD: IUniform<number>;
  uTheta: IUniform<number>;
  uR: IUniform<number>;
  uFront: IUniform<Texture | null>;
  uBack: IUniform<Texture | null>;
  uLightDir: IUniform<Vector3>;
  uSingle: IUniform<number>;
  uSpineX: IUniform<number>;
  uPageW: IUniform<number>;
  uPageH: IUniform<number>;
  uFlat: IUniform<number>;
  uCasterA: IUniform<Vector4>;
  uFoldA: IUniform<number>;
  uCasterB: IUniform<Vector4>;
  uFoldB: IUniform<number>;
};

interface PageSlot {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  u: Uniforms;
  flight: Flight | null;
  front: Tex;
  back: Tex;
  /** 本帧的卷曲参数（供其下的页计算投影） */
  curl: CurlParams;
}

function makeUniforms(): Uniforms {
  return {
    uD: { value: NO_CURL.d },
    uTheta: { value: 0 },
    uR: { value: 1 },
    uFront: { value: null },
    uBack: { value: null },
    uLightDir: { value: new Vector3(...lightDir()) },
    uSingle: { value: 0 },
    uSpineX: { value: 0 },
    uPageW: { value: 1 },
    uPageH: { value: 1 },
    uFlat: { value: 0 },
    uCasterA: { value: NO_CASTER.clone() },
    uFoldA: { value: 0 },
    uCasterB: { value: NO_CASTER.clone() },
    uFoldB: { value: 0 },
  };
}

function makeMaterial(u: Uniforms, side: typeof DoubleSide | typeof FrontSide): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: u,
    vertexShader: PAGE_VERTEX,
    fragmentShader: PAGE_FRAGMENT,
    side,
    depthTest: true,
    depthWrite: true,
  });
}

export class WebGLCurlEngine implements FlipEngine {
  readonly kind = 'webgl' as const;
  onFallback?: (reason: string) => void;

  private layer: HTMLElement | null = null;
  private root: HTMLDivElement | null = null;
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 1, 10000);
  private book = new Object3D();
  private leftUnder: Mesh<PlaneGeometry, ShaderMaterial> | null = null;
  private rightUnder: Mesh<PlaneGeometry, ShaderMaterial> | null = null;
  private leftU = makeUniforms();
  private rightU = makeUniforms();
  private slots: PageSlot[] = [];
  private geometry: BookGeometry | null = null;
  private textures: Record<string, CanvasTexture> = {};
  private textureSet: PageTextureSet | null = null;
  private fallbackTex: CanvasTexture | null = null;
  private driver: FrameDriver | null = null;
  private scheduler: FlipScheduler;
  private texCursor = 0;
  private rightTex: Tex = 0;
  private leftTex: Tex | null = null;
  private seekT: number | null = null;
  private visible = false;
  private lost = false;
  private offTuning: (() => void) | null = null;
  private readonly hook: FlipDevHook = { kind: 'webgl', seek: (t) => this.seek(t) };
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    if (this.lost) return;
    this.lost = true;
    this.driver?.stop();
    this.onFallback?.('webglcontextlost');
  };

  constructor() {
    this.scheduler = new FlipScheduler(
      {
        onStart: (f) => this.onStart(f),
        onLand: (f) => this.onLand(f),
      },
      { rhythm: rhythmFromTuning() },
    );
  }

  async mount(layer: HTMLElement, geometry: BookGeometry): Promise<void> {
    this.layer = layer;
    const root = createRoot(layer, this.kind);
    this.root = root;

    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      // 几千个三角形、4 张纹理，集成显卡足够；不在双显卡机器上唤起独立显卡（16 §3.2）
      powerPreference: 'default',
    });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.sortObjects = true;
    const canvas = renderer.domElement;
    // 位置与尺寸由 resize 按翻动范围写入（16 §3.3）
    Object.assign(canvas.style, {
      position: 'absolute',
      display: 'block',
    } satisfies Partial<CSSStyleDeclaration>);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    root.appendChild(canvas);

    // 纹理未就绪前的纯纸色占位
    const ph = document.createElement('canvas');
    ph.width = 4;
    ph.height = 4;
    const pctx = ph.getContext('2d');
    if (pctx) {
      pctx.fillStyle = PAPER_COLOR;
      pctx.fillRect(0, 0, 4, 4);
    }
    this.fallbackTex = new CanvasTexture(ph);
    this.fallbackTex.colorSpace = NoColorSpace;

    this.scene.add(this.book);
    this.rightU.uFlat.value = 1;
    this.leftU.uFlat.value = 1;
    this.rightUnder = new Mesh(new PlaneGeometry(1, 1), makeMaterial(this.rightU, FrontSide));
    this.leftUnder = new Mesh(new PlaneGeometry(1, 1), makeMaterial(this.leftU, FrontSide));
    this.rightUnder.renderOrder = 0;
    this.leftUnder.renderOrder = 0;
    this.book.add(this.rightUnder, this.leftUnder);

    for (let i = 0; i < POOL; i++) {
      const u = makeUniforms();
      const mesh = new Mesh(new PlaneGeometry(1, 1, SEG_X, SEG_Y), makeMaterial(u, DoubleSide));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.book.add(mesh);
      this.slots.push({ mesh, u, flight: null, front: 0, back: 'blank', curl: NO_CURL });
    }

    this.driver = new FrameDriver(browserClock, (now) => this.frame(now), this.scheduler);
    this.offTuning = onTuningChange(() => {
      this.scheduler.rhythm = rhythmFromTuning(this.scheduler.rhythm);
      // 倾角与卷曲半径的范围可能变了：重算画布范围
      if (this.geometry) this.resize(this.geometry);
      const L = lightDir();
      for (const u of this.allUniforms()) u.uLightDir.value.set(...L);
    });

    this.resize(geometry);
    await this.loadTextures(geometry);
    // 预热：编译着色器、上传纹理
    for (const s of this.slots) s.mesh.visible = true;
    renderer.compile(this.scene, this.camera);
    for (const t of Object.values(this.textures)) renderer.initTexture(t);
    for (const s of this.slots) s.mesh.visible = false;
    registerDevHook(this.hook);
  }

  startLoop(): void {
    if (!this.driver || this.lost) return;
    this.resetBook();
    this.scheduler.start(browserClock.now());
    this.show();
    this.driver.start();
  }

  async stop(opts?: { minLoopMs?: number; minPages?: number }): Promise<void> {
    await this.scheduler.stop(browserClock.now(), opts);
    this.render();
    await waitFrame();
  }

  async flipOnce(): Promise<void> {
    if (!this.driver || this.lost) return;
    this.resetBook();
    const p = this.scheduler.flipOnce(browserClock.now());
    this.show();
    this.driver.start();
    await p;
    this.render();
    await waitFrame();
  }

  resize(geometry: BookGeometry): void {
    const prev = this.geometry;
    this.geometry = geometry;
    const renderer = this.renderer;
    if (!renderer || !this.layer) return;
    const vw = this.layer.clientWidth || window.innerWidth;
    const vh = this.layer.clientHeight || window.innerHeight;
    // 画布只覆盖纸页翻动时可能投影到的范围（16 §3.3）：相机仍按全视口投影，setViewOffset 只渲染其中这一块
    const r = flipCanvasRect(vw, vh, geometry, this.scheduler.rhythm);
    renderer.setSize(r.w, r.h, false);
    Object.assign(renderer.domElement.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.w}px`,
      height: `${r.h}px`,
    });

    // 相机与 CSS perspective 对齐：距离 D = geometry.perspective，fov 由 vh 与 D 反推（即 30°）
    const D = geometry.perspective;
    this.camera.fov = (2 * Math.atan(vh / 2 / D) * 180) / Math.PI;
    this.camera.aspect = vw / vh;
    this.camera.near = Math.max(1, D * 0.25);
    this.camera.far = D * 2 + 2000;
    this.camera.position.set(vw / 2, vh / 2, D);
    this.camera.lookAt(vw / 2, vh / 2, 0);
    this.camera.setViewOffset(vw, vh, r.x, r.y, r.w, r.h);

    const W = geometry.page.w;
    const H = geometry.page.h;
    this.book.position.set(geometry.spineX, vh - (geometry.open.y + H / 2), 0);

    const sizeChanged = !prev || prev.page.w !== W || prev.page.h !== H;
    if (sizeChanged) {
      if (this.rightUnder) {
        this.rightUnder.geometry.dispose();
        this.rightUnder.geometry = new PlaneGeometry(W, H).translate(W / 2, 0, 0);
      }
      if (this.leftUnder) {
        this.leftUnder.geometry.dispose();
        this.leftUnder.geometry = new PlaneGeometry(W, H).translate(-W / 2, 0, 0);
      }
      for (const s of this.slots) {
        s.mesh.geometry.dispose();
        s.mesh.geometry = new PlaneGeometry(W, H, SEG_X, SEG_Y).translate(W / 2, 0, 0);
      }
      if (prev) void this.loadTextures(geometry);
    }
    for (const u of this.allUniforms()) {
      u.uPageW.value = W;
      u.uPageH.value = H;
      u.uSpineX.value = geometry.spineX;
    }
    const single = geometry.mode === 'single';
    for (const s of this.slots) {
      s.u.uSingle.value = single ? 1 : 0;
      s.mesh.material.transparent = single;
      s.mesh.material.needsUpdate = true;
    }
    this.render();
  }

  async fadeOut(ms = 150): Promise<void> {
    if (!this.root) return;
    this.visible = false;
    await fadeTo(this.root, 0, ms);
    if (!this.visible) this.driver?.stop();
  }

  destroy(): void {
    this.driver?.destroy();
    this.driver = null;
    this.offTuning?.();
    this.offTuning = null;
    for (const s of this.slots) {
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    this.slots = [];
    for (const m of [this.leftUnder, this.rightUnder]) {
      m?.geometry.dispose();
      m?.material.dispose();
    }
    this.leftUnder = null;
    this.rightUnder = null;
    for (const t of Object.values(this.textures)) t.dispose();
    this.textures = {};
    this.fallbackTex?.dispose();
    this.fallbackTex = null;
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.scene.clear();
    this.root?.remove();
    this.root = null;
    this.layer = null;
    unregisterDevHook(this.kind, this.hook);
  }

  // -------------------------------------------------------------------------

  private allUniforms(): Uniforms[] {
    return [this.leftU, this.rightU, ...this.slots.map((s) => s.u)];
  }

  private async loadTextures(g: BookGeometry): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    try {
      const set = await getPageTextures(
        g.page.w,
        g.page.h,
        window.devicePixelRatio || 1,
        renderer.capabilities.maxTextureSize,
      );
      if (set === this.textureSet || !this.renderer) return;
      const make = (c: HTMLCanvasElement) => {
        const t = new CanvasTexture(c);
        t.colorSpace = NoColorSpace;
        t.wrapS = ClampToEdgeWrapping;
        t.wrapT = ClampToEdgeWrapping;
        t.minFilter = LinearMipmapLinearFilter;
        t.magFilter = LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return t;
      };
      const old = this.textures;
      this.textures = {
        blank: make(set.blank),
        0: make(set.written[0]),
        1: make(set.written[1]),
        2: make(set.written[2]),
      };
      this.textureSet = set;
      for (const t of Object.values(old)) t.dispose();
    } catch {
      // 纹理失败时保持纯纸色占位，流程不受影响
    }
    this.applyTextures();
  }

  private tex(t: Tex): Texture | null {
    return this.textures[String(t)] ?? this.fallbackTex;
  }

  private applyTextures(): void {
    this.rightU.uFront.value = this.tex(this.rightTex);
    this.leftU.uFront.value = this.tex(this.leftTex ?? 'blank');
    for (const s of this.slots) {
      s.u.uFront.value = this.tex(s.front);
      s.u.uBack.value = this.tex(s.back);
    }
  }

  private show(): void {
    if (!this.root) return;
    this.visible = true;
    void fadeTo(this.root, 1, 200);
  }

  private resetBook(): void {
    this.seekT = null;
    this.texCursor = 0;
    this.rightTex = 0;
    this.leftTex = null;
    for (const s of this.slots) {
      s.flight = null;
      s.mesh.visible = false;
    }
    this.applyTextures();
  }

  /** 纹理轮换：起翻时右侧底页换成下一页 */
  private onStart(f: Flight): void {
    const slot = this.slots.find((s) => s.flight === null);
    let front: Tex;
    let back: Tex;
    if (f.final) {
      front = this.rightTex;
      back = 'blank';
      this.rightTex = 'blank';
    } else {
      const c = this.texCursor;
      front = (c % 3) as Tex;
      back = ((c + 2) % 3) as Tex;
      this.texCursor = c + 1;
      this.rightTex = ((c + 1) % 3) as Tex;
    }
    if (slot) {
      slot.flight = f;
      slot.front = front;
      slot.back = back;
      slot.mesh.visible = true;
    }
    this.applyTextures();
  }

  /** 纹理轮换：落下时左侧底页换成它的背面 */
  private onLand(f: Flight): void {
    const slot = this.slots.find((s) => s.flight === f);
    this.leftTex = slot ? slot.back : 'blank';
    if (slot) {
      slot.flight = null;
      slot.mesh.visible = false;
    }
    this.applyTextures();
  }

  private frame(now: number): void {
    if (this.lost) return;
    fpsMeter.mark(now);
    if (this.seekT === null) this.scheduler.tick(now);
    this.render();
    if (this.scheduler.phase === 'settled' && !this.visible) this.driver?.stop();
  }

  private render(): void {
    const renderer = this.renderer;
    const g = this.geometry;
    if (!renderer || !g || this.lost) return;
    const W = g.page.w;
    const H = g.page.h;

    // 按起翻顺序排列：先翻的页在上（右侧），它的卷曲投影落在后翻的页上
    const active = this.slots.filter((s) => s.flight !== null).sort((a, b) => a.flight!.seq - b.flight!.seq);
    const kCurl: number[] = [];
    const kFold: number[] = [];
    for (const s of active) {
      const f = s.flight!;
      const shape = { W, H, theta0: f.theta0, rMax: f.rMaxRatio * W };
      const c = curlAt(f.t, shape, f.final ? easeFinal : easeInOutCubic);
      s.curl = c;
      s.u.uD.value = c.d;
      s.u.uTheta.value = c.theta;
      s.u.uR.value = c.R;
      // 右侧：先翻的页在上；z 偏移随进度增大，保证平贴部分不与底页、后翻的页互相穿插
      s.mesh.position.z = 0.15 + 0.5 * f.t;
      kCurl.push(tuning.curlShadow * Math.sin(Math.PI * f.t));
      // 折返段的接触影（环境光遮蔽）：离纸面越低越明显，悬得高时几乎没有；贴合前迅速消失
      const h = 2 * c.R;
      kFold.push(
        tuning.foldShadow *
          smoothstep(1, 12, h) *
          (1 - smoothstep(0.04 * W, 0.3 * W, h)) *
          (1 - smoothstep(0.94, 1, f.t)),
      );
    }
    for (let i = 0; i < active.length; i++) {
      const s = active[i]!;
      const above = i > 0 ? active[i - 1] : undefined;
      // A：自身折返段投在自己平贴部分上的接触影
      s.u.uCasterA.value.set(s.curl.d, s.curl.theta, s.curl.R, 0);
      s.u.uFoldA.value = kFold[i] ?? 0;
      // B：正上方那一页的卷曲投影与接触影
      if (above) {
        s.u.uCasterB.value.set(above.curl.d, above.curl.theta, above.curl.R, kCurl[i - 1] ?? 0);
        s.u.uFoldB.value = kFold[i - 1] ?? 0;
      } else {
        s.u.uCasterB.value.copy(NO_CASTER);
        s.u.uFoldB.value = 0;
      }
    }
    // 右侧底页：最后起翻的那页在最下面，它的影子落在底页上
    const last = active[active.length - 1];
    if (last) {
      const i = active.length - 1;
      this.rightU.uCasterA.value.set(last.curl.d, last.curl.theta, last.curl.R, kCurl[i] ?? 0);
      this.rightU.uFoldA.value = kFold[i] ?? 0;
    } else {
      this.rightU.uCasterA.value.copy(NO_CASTER);
      this.rightU.uFoldA.value = 0;
    }
    // 左侧底页（双页）：最先起翻的页最先落下，它的接触影就是「落向左页的影子」
    const first = active[0];
    if (first) {
      this.leftU.uCasterA.value.set(first.curl.d, first.curl.theta, first.curl.R, 0);
      this.leftU.uFoldA.value = kFold[0] ?? 0;
    } else {
      this.leftU.uCasterA.value.copy(NO_CASTER);
      this.leftU.uFoldA.value = 0;
    }
    const second = active[1];
    if (second) {
      this.leftU.uCasterB.value.set(second.curl.d, second.curl.theta, second.curl.R, 0);
      this.leftU.uFoldB.value = kFold[1] ?? 0;
    } else {
      this.leftU.uCasterB.value.copy(NO_CASTER);
      this.leftU.uFoldB.value = 0;
    }

    if (this.rightUnder) this.rightUnder.visible = true;
    if (this.leftUnder) this.leftUnder.visible = g.mode === 'spread' && this.leftTex !== null;
    renderer.render(this.scene, this.camera);
  }

  private seek(t: number | null): void {
    if (!this.driver || !this.renderer) return;
    if (t === null) {
      this.seekT = null;
      if (this.visible) this.driver.start();
      return;
    }
    this.driver.stop();
    this.seekT = clamp(t, 0, 1);
    this.rightTex = 1;
    this.leftTex = 2;
    for (const s of this.slots) {
      s.flight = null;
      s.mesh.visible = false;
    }
    const slot = this.slots[0];
    if (slot) {
      slot.flight = {
        seq: 0,
        start: 0,
        duration: 1,
        theta0: 0.19,
        rMaxRatio: 0.23,
        final: false,
        t: this.seekT,
      };
      slot.front = 0;
      slot.back = 2;
      slot.mesh.visible = true;
    }
    this.applyTextures();
    if (this.root) this.root.style.opacity = '1';
    this.visible = true;
    this.render();
  }
}
