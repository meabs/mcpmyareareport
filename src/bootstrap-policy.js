export function shouldUseDemoFallback({ bootstrapped, demoModeEnabled }) {
  return !bootstrapped && Boolean(demoModeEnabled);
}
