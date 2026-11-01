import { describe, expect, it } from 'vitest';
import { deveAbrirPaleta, itensDaPaleta } from './paleta-de-comandos';
import type { Project, ProjectCardSummary, Session } from './api-types';

const proj = (id: string, name: string) => ({ id, name }) as Project;
const base = {
  projetos: [proj('p1', 'Alfa'), proj('p2', 'Beta')],
  resumo: [{ projectId: 'p2', latestSessionId: 's9' }] as ProjectCardSummary[],
  sessoesEmCache: [{ id: 's1', projectId: 'p1', name: 'Ideia' }] as Session[],
  projetoAbertoId: 'p1',
  abas: [{ key: 'spend', label: 'Gastos' }],
  acoes: [{ destino: { tipo: 'tema' } as const, rotulo: 'Tema' }],
  rotuloSessao: (n: string | null, id: string) => n ?? `#${id}`,
};
const tecla = (init: KeyboardEventInit, alvo?: Element) => {
  const e = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...init });
  if (alvo) Object.defineProperty(e, 'target', { value: alvo });
  return e;
};

describe('itensDaPaleta', () => {
  it('lista os quatro grupos a partir de dado já em memória', () => {
    const itens = itensDaPaleta(base);
    expect(itens.map((i) => i.rotulo)).toEqual([
      'Alfa',
      'Beta',
      'Gastos',
      'Alfa · Ideia',
      'Beta · #s9',
      'Tema',
    ]);
  });
  it('sem projeto aberto não há abas, e sem cache não há sessões do projeto', () => {
    const itens = itensDaPaleta({ ...base, projetoAbertoId: undefined, sessoesEmCache: undefined });
    expect(itens.some((i) => i.grupo === 'abas')).toBe(false);
    expect(itens.filter((i) => i.grupo === 'sessoes')).toHaveLength(1);
  });
});

describe('deveAbrirPaleta', () => {
  it('aceita Ctrl+K e Meta+K', () => {
    expect(deveAbrirPaleta(tecla({ ctrlKey: true }))).toBe(true);
    expect(deveAbrirPaleta(tecla({ metaKey: true }))).toBe(true);
  });
  it('recusa K puro, IME, evento já tratado e foco no xterm', () => {
    expect(deveAbrirPaleta(tecla({}))).toBe(false);
    expect(deveAbrirPaleta(tecla({ ctrlKey: true, isComposing: true }))).toBe(false);
    const ja = tecla({ ctrlKey: true });
    ja.preventDefault();
    expect(deveAbrirPaleta(ja)).toBe(false);
    const x = document.createElement('div');
    x.className = 'xterm';
    const filho = document.createElement('textarea');
    x.appendChild(filho);
    expect(deveAbrirPaleta(tecla({ ctrlKey: true }, filho))).toBe(false);
  });
});
