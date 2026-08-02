# RAIMOSA Animated Splash Integration

`index.html` is a self-contained splash surface that loads only local project assets. It is suitable for an Electron `BrowserWindow`, a Tauri splash window, or a browser-based preview.

## Runtime contract

- Full reveal duration: 4.8 seconds.
- Completion signal: browser event `raimosa:splash-ready` on `window`.
- Review loop: add `?loop=1` to the splash URL.
- Reduced motion: honors `prefers-reduced-motion: reduce` and resolves immediately to the completed frame.
- Recommended window: 1280×720 minimum, frameless, non-resizable during startup.

## Transition hook

Attach the application transition before the reveal begins:

```js
window.addEventListener("raimosa:splash-ready", () => {
  // Tell the desktop shell that the brand reveal has completed.
});
```

The desktop shell should also gate the transition on actual application readiness. The event confirms that the motion sequence is complete; it does not claim that services, authentication, or network dependencies are ready.

## Static fallback

Use `assets/raimosa-splash-static-1920x1080.png` when HTML motion is unavailable or when a platform requires a static startup image.
