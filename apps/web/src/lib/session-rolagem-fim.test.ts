import { describe, it, expect } from 'vitest';
import { estaPertoDoFim } from './session-rolagem';
import { abaDaRota } from '../routes/project-tabs';

describe('estaPertoDoFim (RN-173, AT-442)', () => {
  it('caminho feliz: a menos de 120px do fim está perto', () => {
    expect(estaPertoDoFim({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 450 })).toBe(true);
  });

  it('quem subiu para reler não está perto do fim', () => {
    expect(estaPertoDoFim({ scrollHeight: 2000, scrollTop: 0, clientHeight: 450 })).toBe(false);
  });
});

describe('abaDaRota (AT-442)', () => {
  it('caminho feliz: a tela de Sessão marca o Chat', () => {
    expect(abaDaRota('/projects/p1/sessions/s1', 'p1')).toBe('chat');
  });

  it('AT-463: sessão criativa marca "Criativo", onde a ideação está listada', () => {
    expect(abaDaRota('/projects/p1/sessions/s1', 'p1', { projectId: 'p1', tab: 'criativo' })).toBe(
      'criativo',
    );
  });

  it('CASO DE FALHA evitado (AT-463): aba publicada de OUTRO projeto ou inválida não vale', () => {
    expect(abaDaRota('/projects/p1/sessions/s1', 'p1', { projectId: 'p2', tab: 'criativo' })).toBe('chat');
    expect(abaDaRota('/projects/p1/sessions/s1', 'p1', { projectId: 'p1', tab: 'xyz' })).toBe('chat');
  });

  it('fora da Sessão (ou de outro projeto), nenhuma aba implícita', () => {
    expect(abaDaRota('/projects/p1', 'p1')).toBeUndefined();
    expect(abaDaRota('/projects/p2/sessions/s1', 'p1')).toBeUndefined();
  });
});
