/// <reference types="vite/client" />

interface AudioSession {
  type: 'auto' | 'playback' | 'ambient' | 'transient' | 'transient-solo' | 'play-and-record';
}
interface Navigator {
  readonly audioSession?: AudioSession;
}
