import '@testing-library/jest-dom/vitest';

// O jsdom não tem `matchMedia`; o `use-mobile` do kit shadcn o chama (padrão: desktop).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((consulta: string) => ({
    matches: false,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}
