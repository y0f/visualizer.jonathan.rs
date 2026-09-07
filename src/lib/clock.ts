const FRAME_MS = 1000 / 60;

// Motion in the visuals is advanced per animation frame, so anything that stalls the
// main thread (the menu reveal transitions hundreds of character spans at once) used to
// slow the visuals down for the duration of the stall. Scale every per-frame increment by
// this multiplier instead: 1 means "one 60fps frame elapsed", so the visuals keep their
// speed in wall-clock time no matter how the frame rate wobbles.
export class FrameClock {
  private last = 0;

  step(): number {
    const now = performance.now();
    if (this.last === 0) {
      this.last = now;
      return 1;
    }
    const delta = (now - this.last) / FRAME_MS;
    this.last = now;
    // Cap the catch-up at ~100ms. Longer gaps mean a real stall or a backgrounded tab,
    // where teleporting the motion forward looks worse than losing the time.
    return Math.min(6, Math.max(0.2, delta));
  }

  reset(): void {
    this.last = 0;
  }
}
