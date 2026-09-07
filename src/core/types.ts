export const BREAKPOINT = 1024;
export const IMG_PATH = '/assets/img/';

export interface VisualHost {
  isPaused(): boolean;
  onFrame(): void;
}

export interface Visual {
  readonly canvas: HTMLCanvasElement;
  spectrum(data: Uint8Array): void;
  start(): void;
  stop(): void;
  reset(): void;
  pointerMove(x: number, y: number): void;
}
