export interface AudioCallbacks {
  onReady(): void;
  onLoaded(): void;
  onSpectrum(data: Uint8Array): void;
  onProgress(fraction: number): void;
  onEnded(): void;
}

const SPECTRUM_BINS = 1024;

export class AudioEngine {
  private readonly cb: AudioCallbacks;
  private readonly ctx: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly gain: GainNode;
  private readonly spectrumData = new Uint8Array(SPECTRUM_BINS);

  private req: XMLHttpRequest | null = null;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private duration = 0;
  private startTime = 0;
  private rafId = 0;

  private standby = true;
  private volume = 1;
  private userPaused = false;
  private visualPaused = false;

  constructor(cb: AudioCallbacks) {
    this.cb = cb;

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();

    if (navigator.audioSession) {
      try {
        navigator.audioSession.type = 'playback';
      } catch {}
    }

    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
  }

  get pausedForVisual(): boolean {
    return this.visualPaused;
  }

  preload(url: string): void {
    this.standby = true;
    this.fetchBuffer(url);
  }

  startFirst(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.loop();
    this.src?.start(0, 0);
    this.startTime = this.ctx.currentTime;
    this.standby = false;
  }

  loadTrack(url: string): void {
    if (this.src) {
      this.src.onended = null;
      this.src.stop();
      this.src = null;
      cancelAnimationFrame(this.rafId);
    }
    this.standby = false;
    this.fetchBuffer(url);
  }

  togglePause(): boolean {
    if (this.userPaused) {
      void this.ctx.resume();
      this.userPaused = false;
      this.visualPaused = false;
    } else {
      void this.ctx.suspend();
      this.userPaused = true;
      this.visualPaused = true;
    }
    return this.userPaused;
  }

  resume(): void {
    if (!this.userPaused && !this.visualPaused) return;
    void this.ctx.resume();
    this.userPaused = false;
    this.visualPaused = false;
  }

  setBlurPause(paused: boolean): void {
    if (this.userPaused) return;
    if (paused) {
      void this.ctx.suspend();
      this.visualPaused = true;
    } else {
      void this.ctx.resume();
      this.visualPaused = false;
    }
  }

  get level(): number {
    return this.volume;
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    this.gain.gain.value = this.volume;
  }

  seek(fraction: number): void {
    if (!this.buffer) return;
    const seekTime = this.duration * fraction;
    if (this.src) {
      this.src.onended = null;
      this.src.stop(0);
    }
    this.src = this.newSource();
    this.src.start(0, seekTime);
    this.src.onended = () => this.cb.onEnded();
    this.startTime = this.ctx.currentTime - seekTime;
  }

  private fetchBuffer(url: string): void {
    const req = (this.req = new XMLHttpRequest());
    req.responseType = 'arraybuffer';
    req.addEventListener('load', () => this.onLoad());
    req.addEventListener('error', () => this.cb.onLoaded());
    req.open('GET', url, true);
    req.send();
  }

  private onLoad(): void {
    if (!this.req) return;
    void this.ctx.decodeAudioData(
      this.req.response as ArrayBuffer,
      (buf) => {
        this.cb.onLoaded();
        this.buffer = buf;
        this.duration = buf.duration;
        this.setup();
        if (this.standby) return;
        this.loop();
        this.src?.start(0, 0);
        this.startTime = this.ctx.currentTime;
      },
      () => this.cb.onLoaded(),
    );
  }

  private setup(): void {
    if (this.src || !this.buffer) return;
    this.src = this.newSource();
    this.src.onended = () => this.cb.onEnded();
    this.cb.onReady();
  }

  private newSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.analyser);
    src.connect(this.gain);
    return src;
  }

  private loop = (): void => {
    this.analyser.getByteFrequencyData(this.spectrumData);
    this.cb.onSpectrum(this.spectrumData);
    if (this.duration > 0) {
      this.cb.onProgress((this.ctx.currentTime - this.startTime) / this.duration);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };
}
