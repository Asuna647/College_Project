/**
 * Browser-level signal detection using native APIs.
 * Monitors tab switches and window focus changes.
 *
 * Phase 3 implementation:
 * - Page Visibility API detects tab switches (100% accuracy)
 * - Window blur/focus detects alt-tab and window focus loss (100% accuracy)
 */

export function initBrowserSignals(onEvent) {
  const signals = {
    lastTabSwitchTime: null,
    lastWindowBlurTime: null,
    isWindowFocused: true,
  };

  // Page Visibility API - detects tab switches
  const handleVisibilityChange = () => {
    if (document.hidden) {
      // Tab was hidden (switched away)
      signals.lastTabSwitchTime = Date.now();
      onEvent?.({
        type: "tab_switch",
        timestamp: new Date().toISOString(),
        meta: { visibilityState: document.visibilityState },
      });
      console.log("[BROWSER SIGNAL] TAB SWITCH detected");
    } else {
      // Tab became visible again
      console.log("[BROWSER SIGNAL] TAB RETURNED - tab became visible");
    }
  };

  // Window blur/focus - detects alt-tab and window focus loss
  const handleWindowBlur = () => {
    signals.isWindowFocused = false;
    signals.lastWindowBlurTime = Date.now();
    onEvent?.({
      type: "window_blur",
      timestamp: new Date().toISOString(),
      meta: { reason: "window_blur" },
    });
    console.log("[BROWSER SIGNAL] WINDOW BLUR detected");
  };

  const handleWindowFocus = () => {
    signals.isWindowFocused = true;
    console.log("[BROWSER SIGNAL] WINDOW RETURNED - window regained focus");
  };

  // Page beforeunload - warn if leaving exam page
  const handleBeforeUnload = (e) => {
    if (signals.isWindowFocused) {
      // User is trying to leave the page
      e.preventDefault();
      e.returnValue = "";
      console.log("[BROWSER SIGNAL] NAVIGATION ATTEMPT - user trying to leave page");
    }
  };

  // Add event listeners
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);
  window.addEventListener("beforeunload", handleBeforeUnload);

  // Return cleanup function and signals
  return {
    signals,
    cleanup: () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  };
}
