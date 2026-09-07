import { createProgram, loadTexture } from '../gl/glHelpers';
import { BREAKPOINT, IMG_PATH, type Visual, type VisualHost } from '../core/types';
import { fitCanvas, pixelRatio } from '../lib/device';
import { FrameClock } from '../lib/clock';
import vertexSrc from '../shaders/horizon.vert.glsl?raw';
import fragmentSrc from '../shaders/horizon.frag.glsl?raw';

const NUM_Y = 90;
const MARGIN = 40;
const SPEED_ADJUSTER_BASE = 1_600_000;

// On phones the grid is narrower (fewer columns), so the per-column audio sum that drives
// the scroll speed reads far less energy than on desktop and the visual crawls. Boost the
// audio->speed gain on mobile so the same track pushes the horizon as hard as on desktop.
// Tuning knob — raise for a faster scroll, lower for slower.
const MOBILE_SPEED_GAIN = 3;

export class HorizonVisual implements Visual {
  readonly canvas: HTMLCanvasElement;

  private readonly host: VisualHost;
  private readonly gl: WebGLRenderingContext;

  private ready = false;
  private program!: WebGLProgram;
  private textures: WebGLTexture[] = [];

  private attrib = { position: 0, color: 0, size: 0, patern: 0 };
  private uniform!: {
    texture1: WebGLUniformLocation | null;
    texture2: WebGLUniformLocation | null;
    mouse: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    cursorRadius: WebGLUniformLocation | null;
    pixelRatio: WebGLUniformLocation | null;
  };

  private posBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private sizeBuffer: WebGLBuffer | null = null;
  private paternBuffer: WebGLBuffer | null = null;

  private numX = 128;
  private position = new Float32Array(0);
  private color = new Float32Array(0);
  private size = new Float32Array(0);
  private patern = new Float32Array(0);
  private baseSpeed = new Float32Array(NUM_Y);
  private baseRatio = new Float32Array(NUM_Y);

  private sw = window.innerWidth;
  private sh = window.innerHeight;
  private dpr = pixelRatio();
  private swh = this.sw >> 1;
  private shh = this.sh >> 1;
  private speedRatio = 1680 / this.sw;
  private speedAdjuster = SPEED_ADJUSTER_BASE;
  private totalSoundAmount = 0;
  private currentSpeed = 0;
  private readonly clock = new FrameClock();
  private mouseMoveDistance = 0;

  private readonly mouse = {
    ratioX: 0,
    ratioY: 0,
    targetX: this.swh,
    targetY: this.shh,
    pastX: this.swh,
    pastY: this.shh,
    vx: 0,
    vy: 0,
  };

  private rafId = 0;
  private readonly onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, host: VisualHost) {
    this.canvas = canvas;
    this.host = host;
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('HorizonVisual: WebGL unavailable');
    this.gl = gl as WebGLRenderingContext;
    void this.init();
  }

  private async init(): Promise<void> {
    this.textures = await Promise.all([
      loadTexture(this.gl, IMG_PATH + 'zero.png'),
      loadTexture(this.gl, IMG_PATH + 'one.png'),
    ]);
    this.initGL();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.ready = true;
  }

  private initGL(): void {
    const gl = this.gl;
    this.program = createProgram(gl, vertexSrc, fragmentSrc);

    this.attrib = {
      position: gl.getAttribLocation(this.program, 'position'),
      color: gl.getAttribLocation(this.program, 'color'),
      size: gl.getAttribLocation(this.program, 'size'),
      patern: gl.getAttribLocation(this.program, 'patern'),
    };
    this.uniform = {
      texture1: gl.getUniformLocation(this.program, 'texture1'),
      texture2: gl.getUniformLocation(this.program, 'texture2'),
      mouse: gl.getUniformLocation(this.program, 'mouse'),
      resolution: gl.getUniformLocation(this.program, 'resolution'),
      cursorRadius: gl.getUniformLocation(this.program, 'cursor_radius'),
      pixelRatio: gl.getUniformLocation(this.program, 'pixel_ratio'),
    };

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
  }

  private pickNumX(): number {
    if (this.sw >= BREAKPOINT) return 128;
    if (this.sw >= 500) return 72;
    return 40;
  }

  private buildGrid(): void {
    const { numX } = this;
    const count = numX * NUM_Y;
    this.position = new Float32Array(count * 3);
    this.color = new Float32Array(count * 4);
    this.size = new Float32Array(count);
    this.patern = new Float32Array(count);

    const sizeX = (numX * MARGIN) / 2;
    const sizeY = (NUM_Y * MARGIN) / 2;
    let cnt = 0;
    for (let i = 0; i < numX; i++) {
      for (let j = 0; j < NUM_Y; j++) {
        const x = (MARGIN * i) / sizeX - 1;
        const y = -((MARGIN * j) / sizeY - 1);
        this.position[cnt * 3] = x;
        this.position[cnt * 3 + 1] = y;
        this.position[cnt * 3 + 2] = 0;
        this.color[cnt * 4] = 1;
        this.color[cnt * 4 + 1] = 1;
        this.color[cnt * 4 + 2] = 1;
        this.color[cnt * 4 + 3] = 1;
        this.size[cnt] = 1;
        this.patern[cnt] = Math.floor(Math.random() * 5);
        cnt++;
      }
    }
    for (let j = 0; j < NUM_Y; j++) {
      this.baseSpeed[j] = Math.random() * 0.0002;
      this.baseRatio[j] = 0.25 + Math.random() * 0.75;
    }
  }

  private setupBuffers(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.colorBuffer);
    gl.deleteBuffer(this.sizeBuffer);
    gl.deleteBuffer(this.paternBuffer);

    this.posBuffer = this.bindAttrib(this.position, this.attrib.position, 3, gl.DYNAMIC_DRAW);
    this.colorBuffer = this.bindAttrib(this.color, this.attrib.color, 4, gl.STATIC_DRAW);
    this.sizeBuffer = this.bindAttrib(this.size, this.attrib.size, 1, gl.DYNAMIC_DRAW);
    this.paternBuffer = this.bindAttrib(this.patern, this.attrib.patern, 1, gl.DYNAMIC_DRAW);
  }

  private bindAttrib(data: Float32Array, location: number, stride: number, usage: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('createBuffer failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, stride, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  private uploadDynamic(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.position, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.size, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.paternBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.patern, gl.DYNAMIC_DRAW);
  }

  spectrum(audio: Uint8Array): void {
    if (!this.ready || this.host.isPaused()) return;
    const { numX } = this;
    const reverseNum = NUM_Y * 2;
    const isSP = this.sw < BREAKPOINT;
    const dt = this.clock.step();
    this.totalSoundAmount = 0;
    let cnt = 0;
    let cnt2 = 0;

    for (let i = 0; i < numX; i++) {
      this.totalSoundAmount += audio[cnt2++];
      this.totalSoundAmount += audio[cnt2++];

      for (let j = 0; j < NUM_Y; j++) {
        let id = j * 2;
        if (isSP) id = reverseNum - id;
        let size = audio[id] / 64;
        if (size > 3.2) this.patern[cnt] = Math.floor(Math.random() * 5);
        if (this.patern[cnt] === 0 || this.patern[cnt] === 1) size *= 4.0;
        if (size <= 1) size = 1;
        this.size[cnt] = size;

        const positionID = cnt * 3;
        let speed = this.baseSpeed[j] * this.speedRatio;
        speed = (speed + this.currentSpeed * this.speedRatio) * this.baseRatio[j] * dt;
        let x = this.position[positionID] - speed;
        if (x < -1) x += 2;
        this.position[positionID] = x;
        cnt++;
      }
    }

    if (isSP) this.totalSoundAmount *= MOBILE_SPEED_GAIN;
  }

  start(): void {
    this.stop();
    this.clock.reset();
    this.update();
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private update = (): void => {
    this.render();
    this.rafId = requestAnimationFrame(this.update);
    this.host.onFrame();

    const m = this.mouse;
    m.vx += (m.targetX - m.pastX) * 0.18;
    m.vy += (m.targetY - m.pastY) * 0.18;
    m.vx *= 0.845;
    m.vy *= 0.845;
    m.pastX += m.vx;
    m.pastY += m.vy;
    const difX = Math.abs(m.targetX - m.pastX);
    const difY = Math.abs(m.targetY - m.pastY);
    this.mouseMoveDistance = Math.min(120, Math.sqrt(difX * difX + difY * difY) * 0.7);
  };

  private render(): void {
    if (!this.ready) return;
    const gl = this.gl;
    this.currentSpeed = this.totalSoundAmount / this.speedAdjuster;

    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
    gl.uniform1i(this.uniform.texture1, 0);
    gl.uniform1i(this.uniform.texture2, 1);
    gl.uniform2fv(this.uniform.mouse, [this.mouse.ratioX, this.mouse.ratioY]);
    gl.uniform2fv(this.uniform.resolution, [this.sw, this.sh]);
    gl.uniform1f(this.uniform.cursorRadius, this.mouseMoveDistance);
    gl.uniform1f(this.uniform.pixelRatio, this.dpr);

    this.uploadDynamic();
    gl.drawArrays(gl.POINTS, 0, this.position.length / 3);
    gl.flush();
  }

  reset(): void {
    this.stop();
    this.clock.reset();
    if (!this.ready) return;
    this.size.fill(0);
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.uploadDynamic();
    gl.drawArrays(gl.POINTS, 0, this.position.length / 3);
  }

  pointerMove(x: number, y: number): void {
    this.mouse.targetX = x;
    this.mouse.targetY = y;
    this.mouse.ratioX = (x - this.swh) / this.swh;
    this.mouse.ratioY = (y - this.shh) / -this.shh;
  }

  private resize(): void {
    this.sw = window.innerWidth;
    this.sh = window.innerHeight;
    this.dpr = pixelRatio();
    this.swh = this.sw >> 1;
    this.shh = this.sh >> 1;
    fitCanvas(this.canvas, this.sw, this.sh, this.dpr);
    this.speedRatio = 1680 / this.sw;
    this.numX = this.pickNumX();
    this.buildGrid();
    if (this.numX === 128) this.speedAdjuster = SPEED_ADJUSTER_BASE;
    else if (this.numX === 72) this.speedAdjuster = SPEED_ADJUSTER_BASE * 1.3;
    else this.speedAdjuster = SPEED_ADJUSTER_BASE * 1.1;
    this.setupBuffers();
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}
