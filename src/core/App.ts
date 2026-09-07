import { TextureLoader } from 'three';
import { AudioEngine } from './AudioEngine';
import { IMG_PATH, type Visual, type VisualHost } from './types';
import { HorizonVisual } from '../visuals/HorizonVisual';
import { TunnelVisual } from '../visuals/TunnelVisual';
import { FlowFieldVisual } from '../visuals/FlowFieldVisual';
import { hasTouch, isSmartPhone } from '../lib/device';

const AUDIO_PATH = '/assets/audio/';

type VisualName = 'tunnel' | 'horizon' | 'flow';

interface Track {
  file: string;
  visual: VisualName;
}

const TRACKS: Track[] = [
  { file: 'track.mp3', visual: 'tunnel' },
  { file: 'the.mp3', visual: 'horizon' },
  // { file: 'stop.mp3', visual: 'flow' },
];

const UI_HIDE_FRAMES = 300;

export class App {
  private readonly dom = this.queryDom();
  private readonly audio: AudioEngine;

  visuals!: Record<VisualName, Visual>;
  private active!: Visual;

  private current = 0;
  private isLoading = true;
  private started = false;
  private showUI = false;
  private uiIdleFrames = 0;
  private backgroundPlay = false;
  private volumeOpen = false;
  private draggingVolume = false;

  private audioReady = false;
  private booted = false;

  private readonly host: VisualHost = {
    isPaused: () => this.audio.pausedForVisual,
    onFrame: () => this.tick(),
  };

  constructor() {
    this.audio = new AudioEngine({
      onReady: () => this.onAudioReady(),
      onLoaded: () => {
        this.isLoading = false;
      },
      onSpectrum: (data) => this.active?.spectrum(data),
      onProgress: (fraction) => {
        this.dom.progressFill.style.transform = `scaleX(${fraction})`;
      },
      onEnded: () => this.next(),
    });

    const stored = localStorage.getItem('isBackgroundPlayMode');
    this.backgroundPlay = stored !== 'false';
    if (this.backgroundPlay) this.dom.bgmBtn.classList.add('on');

    const storedVolume = localStorage.getItem('volume');
    const volume = storedVolume === null ? NaN : Number(storedVolume);
    this.setVolume(Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 1);

    this.audio.preload(AUDIO_PATH + TRACKS[0].file);
    void this.boot();
  }

  private async boot(): Promise<void> {
    const dot = await new TextureLoader().loadAsync(IMG_PATH + 'dot.png');

    this.visuals = {
      tunnel: new TunnelVisual(this.dom.canvas2, this.host, dot),
      horizon: new HorizonVisual(this.dom.canvas1, this.host),
      flow: new FlowFieldVisual(this.dom.canvas3, this.host),
    };
    this.active = this.visuals.tunnel;
    this.visuals.horizon.canvas.classList.add('hide');
    this.visuals.flow.canvas.classList.add('hide');

    this.wireEvents();

    this.booted = true;
    this.maybeShowStart();
  }

  private queryDom() {
    const pick = <T extends HTMLElement>(sel: string): T => {
      const el = document.querySelector<T>(sel);
      if (!el) throw new Error(`missing element: ${sel}`);
      return el;
    };
    return {
      startBtn: pick('#start_play_btn'),
      soundMessage: pick('#sound_message'),
      canvasContainer: pick('#canvasContainer'),
      canvas1: pick<HTMLCanvasElement>('#canvas'),
      canvas2: pick<HTMLCanvasElement>('#canvas2'),
      canvas3: pick<HTMLCanvasElement>('#canvas3'),
      audioUI: pick('#audio_ui'),
      progressBar: pick('#progress_bar'),
      progressFill: pick('#progress_bar .p_bar'),
      playBtn: pick('#audio_ui .ui_child .play'),
      volBtn: pick('#audio_ui .ui_child .vol'),
      volWrap: pick('#audio_ui .ui_child .vol_wrap'),
      volSlider: pick('#audio_ui .ui_child .vol_slider'),
      volFill: pick('#audio_ui .ui_child .v_fill'),
      backwardBtn: pick('#audio_ui .ui_child .backward'),
      forwardBtn: pick('#audio_ui .ui_child .forward'),
      bgmBtn: pick('#audio_ui .ui_child .bgm_setting'),
    };
  }

  private wireEvents(): void {
    window.addEventListener('mousemove', this.onPointerMove);
    window.addEventListener('touchmove', this.onPointerMove);

    this.dom.startBtn.addEventListener('click', () => this.start());
    this.dom.canvasContainer.addEventListener('click', () => {
      this.closeVolume();
    });

    this.dom.playBtn.addEventListener('click', () => {
      const paused = this.audio.togglePause();
      this.dom.playBtn.classList.toggle('playing', !paused);
    });
    this.dom.volBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleVolume();
    });
    this.dom.volSlider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.draggingVolume = true;
      this.dom.volSlider.setPointerCapture(e.pointerId);
      this.setVolumeFromPointer(e.clientX);
    });
    this.dom.volSlider.addEventListener('pointermove', (e) => {
      if (this.draggingVolume) this.setVolumeFromPointer(e.clientX);
    });
    const endVolumeDrag = () => {
      this.draggingVolume = false;
    };
    this.dom.volSlider.addEventListener('pointerup', endVolumeDrag);
    this.dom.volSlider.addEventListener('pointercancel', endVolumeDrag);
    this.dom.backwardBtn.addEventListener('click', () => this.prev());
    this.dom.forwardBtn.addEventListener('click', () => this.next());
    this.dom.bgmBtn.addEventListener('click', () => this.toggleBackgroundPlay());

    this.dom.progressBar.addEventListener('click', (e) => {
      const x = e.clientX - this.dom.progressBar.getBoundingClientRect().left;
      this.audio.seek(x / this.dom.progressBar.clientWidth);
    });

    window.addEventListener('focus', () => {
      if (!this.backgroundPlay) this.audio.setBlurPause(false);
    });
    window.addEventListener('blur', () => {
      if (!this.backgroundPlay) this.audio.setBlurPause(true);
    });
  }

  private onAudioReady(): void {
    this.audioReady = true;
    this.maybeShowStart();
  }

  private maybeShowStart(): void {
    if (!this.audioReady || !this.booted || this.started) return;
    this.dom.startBtn.classList.add('show');
    if (isSmartPhone) this.dom.soundMessage.classList.add('show');
    else this.dom.soundMessage.classList.add('hide');
  }

  private start(): void {
    if (this.started) return;
    this.dom.startBtn.classList.add('hide');
    this.dom.soundMessage.classList.add('hide');
    this.dom.progressBar.classList.add('show', 'visible');
    this.dom.audioUI.classList.add('show', 'visible');
    this.dom.playBtn.classList.add('playing');

    this.audio.startFirst();
    this.visuals.tunnel.start();

    this.showUI = true;
    this.started = true;
  }

  private next(): void {
    this.change((this.current + 1) % TRACKS.length);
  }

  private prev(): void {
    this.change((this.current - 1 + TRACKS.length) % TRACKS.length);
  }

  private change(id: number): void {
    if (this.isLoading) return;
    this.isLoading = true;
    this.current = id;
    this.audio.loadTrack(AUDIO_PATH + TRACKS[id].file);
    this.audio.resume();
    this.dom.playBtn.classList.add('playing');

    for (const name of Object.keys(this.visuals) as VisualName[]) {
      const visual = this.visuals[name];
      visual.canvas.classList.add('hide');
      visual.stop();
      visual.reset();
    }

    this.active = this.visuals[TRACKS[id].visual];
    this.active.canvas.classList.remove('hide');
    this.active.start();
  }

  private toggleVolume(): void {
    this.volumeOpen = !this.volumeOpen;
    this.dom.volWrap.classList.toggle('open', this.volumeOpen);
  }

  private closeVolume(): void {
    if (!this.volumeOpen) return;
    this.volumeOpen = false;
    this.draggingVolume = false;
    this.dom.volWrap.classList.remove('open');
  }

  private setVolumeFromPointer(clientX: number): void {
    const rect = this.dom.volSlider.getBoundingClientRect();
    this.setVolume((clientX - rect.left) / rect.width);
  }

  private setVolume(value: number): void {
    this.audio.setVolume(value);
    const level = this.audio.level;
    this.dom.volFill.style.transform = `scaleX(${level})`;
    this.dom.volBtn.classList.toggle('mute', level === 0);
    this.dom.volSlider.setAttribute('aria-valuenow', String(Math.round(level * 100)));
    localStorage.setItem('volume', String(level));
  }

  private toggleBackgroundPlay(): void {
    this.backgroundPlay = !this.backgroundPlay;
    this.dom.bgmBtn.classList.toggle('on', this.backgroundPlay);
    localStorage.setItem('isBackgroundPlayMode', String(this.backgroundPlay));
  }

  private readonly onPointerMove = (e: MouseEvent | TouchEvent): void => {
    if (this.started) {
      this.dom.progressBar.classList.add('show');
      this.dom.audioUI.classList.add('show');
      this.showUI = true;
      this.uiIdleFrames = 0;
    }
    if (!this.visuals) return;
    let x: number;
    let y: number;
    if ('touches' in e) {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    } else {
      x = e.clientX;
      y = e.clientY;
    }
    this.visuals.horizon.pointerMove(x, y);
    this.visuals.tunnel.pointerMove(x, y);
    this.visuals.flow.pointerMove(x, y);
  };

  private tick(): void {
    if (hasTouch || !this.showUI) return;
    this.uiIdleFrames++;
    if (this.uiIdleFrames > UI_HIDE_FRAMES) {
      this.showUI = false;
      this.dom.progressBar.classList.remove('show');
      this.dom.audioUI.classList.remove('show');
      this.closeVolume();
    }
  }
}
