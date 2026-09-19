import { describe, it, expect } from 'vitest';
import { sessaoMaisRecente } from './hooks';

const s = (id: string, createdAt: string, name: string | null = null) => ({
  id,
  createdAt,
  name,
});

// AT-131 — a sessão técnica do provisionamento não desloca a de trabalho.
describe('sessaoMaisRecente', () => {
  it('a sessão do bootstrap não é a mais recente quando há sessão de trabalho', () => {
    const r = sessaoMaisRecente([
      s('trabalho', '2026-09-01T10:00:00Z'),
      s('boot', '2026-09-01T11:00:00Z', 'git-bootstrap'),
    ]);
    expect(r?.id).toBe('trabalho');
  });

  it('é a mais recente quando é a única', () => {
    expect(
      sessaoMaisRecente([s('boot', '2026-09-01T11:00:00Z', 'git-bootstrap')])?.id,
    ).toBe('boot');
  });

  it('lista vazia: undefined', () => {
    expect(sessaoMaisRecente([])).toBeUndefined();
  });
});
