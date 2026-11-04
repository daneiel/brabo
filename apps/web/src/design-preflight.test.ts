import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('preflight do Tailwind (AT-659)', () => {
  it('as listas do chat declaram list-style', () => {
    const css = ler('./components/ui/MarkdownMessage.module.css');
    expect(css).toMatch(/ul\.lista\s*{[^}]*list-style:\s*disc/);
    expect(css).toMatch(/ol\.lista\s*{[^}]*list-style:\s*decimal/);
  });
  it('a reposição de h1-h6 só vale sem classe', () => {
    const css = ler('./index.css');
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(css).toMatch(new RegExp(`(^|\\n)${h}:not\\(\\[class\\]\\)`));
      expect(css).not.toMatch(new RegExp(`(^|\\n)${h}\\s*{\\s*font-size`));
    }
  });
});
