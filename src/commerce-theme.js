import { useSyncExternalStore } from 'react';

// Modo noturno do GA: guarda a escolha neste navegador (localStorage "ga.theme") e liga a classe "ga-dark" na página.
const KEY = 'ga.theme';
let dark = false;
try { dark = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'dark'; } catch { dark = false; }
const subs = new Set();
export const isDark = () => dark;
export function applyTheme() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('ga-dark', dark);
}
export function setDark(v) {
  dark = Boolean(v);
  try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch { /* sem armazenamento: vale só nesta sessão */ }
  applyTheme();
  subs.forEach(f => f());
}
const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const useDark = () => useSyncExternalStore(subscribe, isDark, () => false);
