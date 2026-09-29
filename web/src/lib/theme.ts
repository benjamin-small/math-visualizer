// Theme preference: 'system' follows the OS (no data-theme attribute);
// 'light'/'dark' force it. Storage access is wrapped: private windows and
// blocked storage must not break the page.
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

export function readTheme(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable — the attribute still applied */
  }
}

export function nextTheme(t: Theme): Theme {
  return t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system';
}
