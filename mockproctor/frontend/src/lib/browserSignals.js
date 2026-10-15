/** Emit browser focus signals; always call cleanup() on unmount. */
export function initBrowserSignals(onSignal) {
  if (typeof onSignal !== "function") throw new TypeError("A callback is required");
  let lastBlurAt = 0;
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      onSignal({ type: "tab_switch", timestamp: new Date().toISOString() });
    }
  };
  const onBlur = () => {
    const now = Date.now();
    if (now - lastBlurAt < 400) return;
    lastBlurAt = now;
    onSignal({ type: "window_blur", timestamp: new Date().toISOString() });
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onBlur);
  return {
    cleanup() {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
    },
  };
}
