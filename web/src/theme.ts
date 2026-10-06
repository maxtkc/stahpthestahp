/** Light/dark toggle: `data-theme` on <html>, saved under the `theme` key. */

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // Checked means light
  document
    .querySelectorAll<HTMLInputElement>('.theme-controller')
    .forEach((c) => {
      c.checked = c.value === theme;
    });
}

export function initTheme(): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  apply(saved() ?? (prefersDark ? 'dark' : 'light'));
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.classList?.contains('theme-controller')) {
      return;
    }
    const theme: Theme = t.checked ? 'light' : 'dark';
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage blocked: the choice lasts for this page only
    }
  });
}
