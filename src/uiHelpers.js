export function isClearVisible(answer, result, error, loading) {
  return Boolean((answer && String(answer).trim()) || result || error || loading);
}

export function getInitialTheme(storage) {
  try {
    const value = storage && typeof storage.getItem === "function" ? storage.getItem("theme") : null;
    if (value === "dark" || value === "light") return value;
  } catch {
    // ignore storage errors
  }
  return "light";
}

export function nextTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}