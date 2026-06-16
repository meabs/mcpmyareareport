export function shouldUseDemoFallback({ bootstrapped, demoModeEnabled }) {
  return !bootstrapped && Boolean(demoModeEnabled);
}

export function shouldShowSearchFallback({ bootstrapped, demoModeEnabled }) {
  return !bootstrapped && Boolean(demoModeEnabled);
}
