import { describe, it, expect } from 'vitest';
import { sessaoMaisRecente } from './hooks';

const s = (
  id: string,
  createdAt: string,
  technical = false,
  name: string | null = null,
) => ({ id, createdAt, technical, name });

// AT-131 — a sessão técnica do provisionamento não desloca a de trabalho.
// AT-183 / RN-592 — "técnica" é o marcador da api, nunca o nome.
describe('sessaoMaisRecente', () => {
  it('a sessão técnica não é a mais recente quando há sessão de trabalho', () => {
    const r = sessaoMaisRecente([
      s('trabalho', '2026-09-01T10:00:00Z'),
      s('boot', '2026-09-01T11:00:00Z', true),
    ]);
    expect(r?.id).toBe('trabalho');
  });

  it('é a mais recente quando é a única', () => {
    expect(sessaoMaisRecente([s('boot', '2026-09-01T11:00:00Z', true)])?.id).toBe(
      'boot',
    );
  });

  it('renomeada, a técnica continua fora (o marcador, não o nome, decide)', () => {
    const r = sessaoMaisRecente([
      s('trabalho', '2026-09-01T10:00:00Z'),
      s('boot', '2026-09-01T11:00:00Z', true, 'Provisionamento'),
    ]);
    expect(r?.id).toBe('trabalho');
  });

  it('sessão de trabalho chamada `git-bootstrap` NÃO é tratada como técnica', () => {
    const r = sessaoMaisRecente([
      s('antiga', '2026-09-01T10:00:00Z'),
      s('nome-antigo', '2026-09-01T11:00:00Z', false, 'git-bootstrap'),
    ]);
    expect(r?.id).toBe('nome-antigo');
  });

  it('lista vazia: undefined', () => {
    expect(sessaoMaisRecente([])).toBeUndefined();
  });
});
