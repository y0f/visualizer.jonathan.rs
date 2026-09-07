import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Fog,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { BREAKPOINT, type Visual, type VisualHost } from '../core/types';
import { isSmartPhone, pixelRatio } from '../lib/device';
import { FrameClock } from '../lib/clock';
import vertexSrc from '../shaders/tunnel.vert.glsl?raw';
import fragmentSrc from '../shaders/tunnel.frag.glsl?raw';

const MIN_SIZE = 0.0025;
const BASE_SPEED = 0.01;

class Particle {
  private percent = Math.random();
  private readonly speed = Math.random() * 0.001 + 0.001;
  private readonly offset: Vector3;
  private readonly pos = new Vector3();

  constructor(id: number) {
    this.offset = new Vector3(Math.cos(id) / 45, Math.sin(id) / 45, 0);
  }

  update(tunnel: TunnelVisual, id: number): void {
    this.percent += this.speed * tunnel.speed * tunnel.dt;
    const p = tunnel.curve.getPoint(1 - (this.percent % 1));
    this.pos.copy(p).add(this.offset);
    tunnel.positionAttribute.setXYZ(id, this.pos.x, this.pos.y, this.pos.z);
  }
}

export class TunnelVisual implements Visual {
  readonly canvas: HTMLCanvasElement;
  speed = BASE_SPEED;
  dt = 1;
  curve!: CatmullRomCurve3;
  positionAttribute!: BufferAttribute;

  private readonly host: VisualHost;
  private readonly renderer: WebGLRenderer;
  private readonly camera: PerspectiveCamera;
  private readonly scene = new Scene();

  private particles: Particle[] = [];
  private particleCount = 0;
  private sizes!: Float32Array;
  private sizeAttribute!: BufferAttribute;
  private material!: ShaderMaterial;
  private dpr = pixelRatio();
  private totalSoundAmount = 0;

  private sw = window.innerWidth;
  private sh = window.innerHeight;
  private swh = this.sw / 2;
  private shh = this.sh / 2;
  private reactionNumber = this.sw >= BREAKPOINT ? 7 : 12;
  private cntX = 0;
  private cntY = 0;

  private readonly mouse = {
    posX: this.sw * 0.5,
    posY: this.sh * 0.5,
    ratioX: 0,
    ratioY: 0,
    targetX: this.sw * 0.5,
    targetY: this.sh * 0.5,
  };

  private rafId = 0;
  private readonly clock = new FrameClock();
  private readonly onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, host: VisualHost, dot: Texture) {
    this.canvas = canvas;
    this.host = host;

    this.renderer = new WebGLRenderer({ antialias: false, alpha: true, canvas });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.sw, this.sh);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new PerspectiveCamera(8, this.sw / this.sh, 0.01, 1000);
    this.camera.rotation.y = Math.PI;
    this.camera.position.z = 0.35;

    this.scene.fog = new Fog(0x000000, 0.05, 1.6);

    this.buildCurve();
    this.buildParticles(dot);
    window.addEventListener('resize', this.onResize);
  }

  private buildCurve(): void {
    const points: Vector3[] = [];
    for (let i = 0; i < 5; i++) points.push(new Vector3(0, 0, 2.5 * (i / 6)));
    points[4].y = -0.06;
    this.curve = new CatmullRomCurve3(points);
    this.curve.curveType = 'catmullrom';
  }

  private buildParticles(dot: Texture): void {
    this.particleCount = isSmartPhone ? 3500 : 15000;
    this.particles = [];
    for (let i = 0; i < this.particleCount; i++) this.particles.push(new Particle(i));

    const radius = 20;
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    this.sizes = new Float32Array(this.particleCount);
    const color = new Color(0xffffff);
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * radius;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * radius;
      positions[i * 3 + 2] = 1000;
      color.toArray(colors, i * 3);
      this.sizes[i] = MIN_SIZE;
    }

    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(positions, 3);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('customColor', new BufferAttribute(colors, 3));
    this.sizeAttribute = new BufferAttribute(this.sizes, 1);
    geometry.setAttribute('size', this.sizeAttribute);

    const emissiveColor = this.sw >= BREAKPOINT ? 0x777777 : 0xffffff;
    const material = new ShaderMaterial({
      vertexShader: vertexSrc,
      fragmentShader: fragmentSrc,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          diffuse: { value: new Color(0xffffff) },
          emissive: { value: new Color(emissiveColor) },
          pointTexture: { value: dot },
          uPixelRatio: { value: this.dpr },
        },
      ]),
      fog: true,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });
    this.material = material;

    this.scene.add(new Points(geometry, material));
  }

  spectrum(audio: Uint8Array): void {
    const len = audio.length;
    this.sizes.fill(0);
    this.totalSoundAmount = 0;
    for (let i = 0; i < this.particleCount; i++) {
      const num = audio[i % len];
      this.totalSoundAmount += num;
      if (i % 2 === 0) continue;
      let r = num * 0.0001;
      if (r < MIN_SIZE) r = MIN_SIZE;
      this.sizes[i] = r;
    }
    if (isSmartPhone) this.totalSoundAmount *= 5;
    this.sizeAttribute.needsUpdate = true;
  }

  reset(): void {
    this.clock.reset();
    this.dt = 1;
    this.totalSoundAmount = 10000;
    for (let i = 1; i < this.particleCount; i += 2) this.sizes[i] = MIN_SIZE;
    this.sizeAttribute.needsUpdate = true;
    this.render();
  }

  start(): void {
    this.stop();
    this.clock.reset();
    this.dt = 1;
    this.update();
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private update = (): void => {
    this.dt = this.clock.step();
    this.render();
    this.rafId = requestAnimationFrame(this.update);
    this.host.onFrame();
  };

  private render(): void {
    this.updateCamera();
    this.updateCurve();

    this.speed = BASE_SPEED + this.totalSoundAmount / 120000;
    if (this.speed >= 7) this.speed = 7;
    if (this.host.isPaused()) this.speed = 0;

    for (let i = 0; i < this.particles.length; i++) this.particles[i].update(this, i);
    this.positionAttribute.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(): void {
    const targetX = ((this.mouse.targetX - this.swh) / this.swh) * 200;
    const targetY = ((this.mouse.targetY - this.shh) / this.shh) * 200;
    const mx = this.swh + targetX / this.reactionNumber + Math.cos(this.cntX) * 12;
    const my = this.shh + targetY / this.reactionNumber + Math.sin(this.cntY) * 12;
    const ease = Math.min(1, this.dt / 30);
    this.mouse.posX += (mx - this.mouse.posX) * ease;
    this.mouse.posY += (my - this.mouse.posY) * ease;
    this.mouse.ratioX = this.mouse.posX / this.sw;
    this.mouse.ratioY = this.mouse.posY / this.sh;
    this.cntX += 0.02 * this.dt;
    this.cntY += 0.01 * this.dt;
  }

  private updateCurve(): void {
    const baseNum = this.sw >= BREAKPOINT ? 0.3 : 0.2;
    const adjustNum = this.sw >= BREAKPOINT ? 0.15 : 0.1;
    const x = baseNum * (1 - this.mouse.ratioX) - adjustNum;
    const y = baseNum * (1 - this.mouse.ratioY) - adjustNum;
    const p = this.curve.points;
    p[2].x = x;
    p[3].x = 0;
    p[4].x = x;
    p[2].y = y;
    p[3].y = 0;
    p[4].y = y;
  }

  pointerMove(x: number, y: number): void {
    this.mouse.targetX = x;
    this.mouse.targetY = y;
  }

  private resize(): void {
    this.sw = window.innerWidth;
    this.sh = window.innerHeight;
    this.swh = this.sw / 2;
    this.shh = this.sh / 2;
    this.camera.aspect = this.sw / this.sh;
    this.camera.updateProjectionMatrix();
    this.dpr = pixelRatio();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.sw, this.sh);
    this.material.uniforms.uPixelRatio.value = this.dpr;
    this.reactionNumber = this.sw >= BREAKPOINT ? 7 : 12;
  }
}
