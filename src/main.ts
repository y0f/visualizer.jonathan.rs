import { App } from './core/App';

window.addEventListener('load', () => {
  const app = new App();
  // Dev-only handle so the Playwright checks can drive the visuals without audio decode.
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
});
