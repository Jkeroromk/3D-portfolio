// Phone vs desktop tier. ?tier=mobile / ?tier=desktop forces one for testing.
export const MOBILE = (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has("tier")) return q.get("tier") === "mobile";
    const small = Math.min(window.screen.width, window.screen.height) <= 820;
    return /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && small);
  } catch {
    return false;
  }
})();
