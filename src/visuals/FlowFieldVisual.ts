import { createProgram, createBuffer } from '../gl/glHelpers';
import { type Visual, type VisualHost } from '../core/types';
import { fitCanvas, isSmartPhone, pixelRatio } from '../lib/device';
import { FrameClock } from '../lib/clock';
import vertexSrc from '../shaders/flow.vert.glsl?raw';
import fragmentSrc from '../shaders/flow.frag.glsl?raw';

function hash(i: number, j: number, k: number): number {
  let n = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const GX = 96;
const GY = 54;
const NOISE_SCALE = 2.2;
const ENERGY_EMA = 0.12;
const DRIVE_ATTACK = 0.6;
const DRIVE_RELEASE = 0.12;
const IDLE_FLOW = 0.00015;
const IDLE_STEP = 0.012;
const SURGE_EMA = 0.22;
const FIELD_STEP = 0.008;
const ENERGY_ADJUSTER = 30000;

// Lift the audio-driven flow speed on phones so it keeps pace with desktop. Scales only the
// motion (field evolution + grain advection), not brightness/turbulence. Resolved once at
// load; the 2 is the mobile tuning knob — raise for faster flow, lower for slower.
const SPEED_GAIN = isSmartPhone ? 2 : 1;

export class FlowFieldVisual implements Visual {
  readonly canvas: HTMLCanvasElement;

  private readonly host: VisualHost;
  private readonly gl: WebGLRenderingContext | null;

  private ready = false;
  private program!: WebGLProgram;
  private attrib = { position: 0, bright: 0 };
  private uPixelRatio: WebGLUniformLocation | null = null;
  private posVbo: WebGLBuffer | null = null;
  private brightVbo: WebGLBuffer | null = null;

  private readonly n: number;
  private px: Float32Array;
  private py: Float32Array;
  private gs: Float32Array;
  private gb: Float32Array;
  private readonly positions: Float32Array;
  private readonly brights: Float32Array;

  private readonly psi = new Float32Array(GX * GY);
  private readonly vx = new Float32Array(GX * GY);
  private readonly vy = new Float32Array(GX * GY);
  private noiseTime = 0;

  private energy = 0;
  private drive = 0;
  private surge = 0;
  private fieldAccum = 0;

  private sw = window.innerWidth;
  private sh = window.innerHeight;
  private dpr = pixelRatio();
  private rafId = 0;
  private readonly clock = new FrameClock();
  private dt = 1;
  private readonly onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, host: VisualHost) {
    this.canvas = canvas;
    this.host = host;

    this.n = isSmartPhone ? 11000 : 22000;
    this.px = new Float32Array(this.n);
    this.py = new Float32Array(this.n);
    this.gs = new Float32Array(this.n);
    this.gb = new Float32Array(this.n);
    this.positions = new Float32Array(this.n * 2);
    this.brights = new Float32Array(this.n);
    this.seedGrains();

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    this.gl = gl as WebGLRenderingContext | null;
    if (!this.gl) {
      console.warn('FlowFieldVisual: WebGL unavailable; flow field disabled.');
      return;
    }

    this.initGL();
    this.buildField();
    this.buildPoints();
    this.ready = true;
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  private seedGrains(): void {
    let seed = 991;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < this.n; i++) {
      this.px[i] = rnd();
      this.py[i] = rnd();
      this.gs[i] = 0.5 + rnd() * 0.9;
      this.gb[i] = 0.5 + rnd() * 0.5;
    }
  }

  private noise3(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const x00 = lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), u);
    const x10 = lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u);
    const x01 = lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u);
    const x11 = lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }

  private initGL(): void {
    const gl = this.gl!;
    this.program = createProgram(gl, vertexSrc, fragmentSrc);
    this.attrib = {
      position: gl.getAttribLocation(this.program, 'position'),
      bright: gl.getAttribLocation(this.program, 'bright'),
    };
    this.uPixelRatio = gl.getUniformLocation(this.program, 'pixel_ratio');
    this.posVbo = createBuffer(gl, this.positions, gl.DYNAMIC_DRAW);
    this.brightVbo = createBuffer(gl, this.brights, gl.DYNAMIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  }

  start(): void {
    this.stop();
    this.update();
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  reset(): void {
    this.stop();
    this.seedGrains();
    this.energy = 0;
    this.drive = 0;
    this.surge = 0;
    this.fieldAccum = 0;
    this.noiseTime = 0;
    if (!this.gl || !this.ready) return;
    this.buildField();
    this.buildPoints();
  }

  private update = (): void => {
    this.dt = this.clock.step();
    if (!this.host.isPaused()) {
      const d = this.drive;
      this.surge += (d * d - this.surge) * SURGE_EMA;
      const rate = (IDLE_FLOW + this.surge * 0.022) * SPEED_GAIN * this.dt;
      this.noiseTime += rate;
      this.fieldAccum += rate;
      if (this.fieldAccum >= FIELD_STEP) {
        this.buildField();
        this.fieldAccum = 0;
      }
      this.advect();
    }
    this.buildPoints();
    this.draw();
    this.rafId = requestAnimationFrame(this.update);
    this.host.onFrame();
  };

  private buildField(): void {
    const { psi, vx, vy } = this;
    const s = NOISE_SCALE;
    const t = this.noiseTime;
    const turb = 0.4 + this.energy * 0.7;
    for (let j = 0; j < GY; j++) {
      const ny = (j / GY) * s;
      for (let i = 0; i < GX; i++) {
        const nx = (i / GX) * s;
        psi[j * GX + i] =
          this.noise3(nx, ny, t) +
          turb * this.noise3(nx * 2.1 + 11.3, ny * 2.1 + 4.7, t * 1.4 + 2.0);
      }
    }
    for (let j = 0; j < GY; j++) {
      const jm = j > 0 ? j - 1 : j;
      const jp = j < GY - 1 ? j + 1 : j;
      for (let i = 0; i < GX; i++) {
        const im = i > 0 ? i - 1 : i;
        const ip = i < GX - 1 ? i + 1 : i;
        vx[j * GX + i] = psi[jp * GX + i] - psi[jm * GX + i];
        vy[j * GX + i] = -(psi[j * GX + ip] - psi[j * GX + im]);
      }
    }
  }

  private sampleVel(x: number, y: number, out: [number, number]): void {
    let fx = x * (GX - 1);
    let fy = y * (GY - 1);
    if (fx < 0) fx = 0;
    else if (fx > GX - 1.001) fx = GX - 1.001;
    if (fy < 0) fy = 0;
    else if (fy > GY - 1.001) fy = GY - 1.001;
    const ix = fx | 0;
    const iy = fy | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const i00 = iy * GX + ix;
    const i10 = i00 + 1;
    const i01 = i00 + GX;
    const i11 = i01 + 1;
    const { vx, vy } = this;
    out[0] = (vx[i00] * (1 - tx) + vx[i10] * tx) * (1 - ty) + (vx[i01] * (1 - tx) + vx[i11] * tx) * ty;
    out[1] = (vy[i00] * (1 - tx) + vy[i10] * tx) * (1 - ty) + (vy[i01] * (1 - tx) + vy[i11] * tx) * ty;
  }

  private advect(): void {
    const { n, px, py, gs } = this;
    const E = this.energy;
    const step = (IDLE_STEP + this.surge * 0.96) * SPEED_GAIN * this.dt;
    const out: [number, number] = [0, 0];
    let r = 2246 + ((this.noiseTime * 104729) | 0);
    const rand = () => {
      r = (r * 9301 + 49297) % 233280;
      return r / 233280;
    };
    for (let i = 0; i < n; i++) {
      this.sampleVel(px[i], py[i], out);
      let x = px[i] + out[0] * step * gs[i];
      let y = py[i] + out[1] * step * gs[i];
      if (x < 0 || x > 1 || y < 0 || y > 1 || rand() < 0.0006 * E) {
        x = rand();
        y = rand();
      }
      px[i] = x;
      py[i] = y;
    }
  }

  private buildPoints(): void {
    const { n, px, py, gb, positions, brights } = this;
    const glow = 0.6 + this.energy * 0.9 + this.surge * 0.5;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const hx = px[i] * 2 - 1;
      const hy = -(py[i] * 2 - 1);
      // Rectangular edge falloff (not radial): the field fills the whole screen in both
      // orientations, with only a gentle taper in the last sliver so grains don't pop in
      // at the boundary as they reseed. Was a centered radial blob that left the corners
      // and edges dark, making the field look small and sparse.
      const e = Math.max(Math.abs(hx), Math.abs(hy));
      let env = (e - 0.92) / (1.15 - 0.92);
      env = env < 0 ? 0 : env > 1 ? 1 : env;
      env = 1 - env * env * (3 - 2 * env);
      positions[v++] = hx;
      positions[v++] = hy;
      brights[i] = gb[i] * glow * env;
    }
  }

  private draw(): void {
    if (!this.gl || !this.ready) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(this.uPixelRatio, this.dpr);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attrib.position);
    gl.vertexAttribPointer(this.attrib.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.brightVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.brights, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attrib.bright);
    gl.vertexAttribPointer(this.attrib.bright, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.flush();
  }

  spectrum(audio: Uint8Array): void {
    if (!this.gl || this.host.isPaused()) return;
    let total = 0;
    for (let i = 2; i < 300; i++) total += audio[i];
    const target = Math.min(total / ENERGY_ADJUSTER, 1);
    this.energy += (target - this.energy) * ENERGY_EMA;
    const k = target > this.drive ? DRIVE_ATTACK : DRIVE_RELEASE;
    this.drive += (target - this.drive) * k;
  }

  pointerMove(): void {}

  private resize(): void {
    this.sw = window.innerWidth;
    this.sh = window.innerHeight;
    this.dpr = pixelRatio();
    fitCanvas(this.canvas, this.sw, this.sh, this.dpr);
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}
