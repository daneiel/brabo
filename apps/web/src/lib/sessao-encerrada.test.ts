import { describe, expect, it } from 'vitest';
import { ehRecusaDeSessaoEncerrada, sessaoEhTerminal } from './sessao-encerrada';

describe('ehRecusaDeSessaoEncerrada', () => {
  it('reconhece o 409 pelo código nomeado', () => {
    expect(
      ehRecusaDeSessaoEncerrada({ status: 409, body: { reason: 'sessao_encerrada', status: 'closed' } }),
    ).toBe(true);
  });

  it('não confunde com outro 409 (turno em andamento) nem com o texto', () => {
    expect(ehRecusaDeSessaoEncerrada({ status: 409, body: { message: 'sessão encerrada' } })).toBe(false);
    expect(ehRecusaDeSessaoEncerrada({ status: 500, body: { reason: 'sessao_encerrada' } })).toBe(false);
    expect(ehRecusaDeSessaoEncerrada(new Error('x'))).toBe(false);
    expect(ehRecusaDeSessaoEncerrada(null)).toBe(false);
  });
});

describe('sessaoEhTerminal', () => {
  it('vale para os DOIS estados terminais', () => {
    expect(sessaoEhTerminal('closed')).toBe(true);
    expect(sessaoEhTerminal('closed_abnormally')).toBe(true);
  });

  it('não vale para os demais', () => {
    for (const s of ['created', 'active', 'closing', undefined]) {
      expect(sessaoEhTerminal(s)).toBe(false);
    }
  });
});
