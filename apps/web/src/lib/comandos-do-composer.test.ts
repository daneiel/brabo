import { describe, expect, it } from 'vitest';
import { destinoDoAprovar, ehTeto, filtrar, gatilhoNoCursor, type ItemDoMenu } from './comandos-do-composer';

const acao = (actionType: string, payload = {}) => ({ actionType, payload }) as never;
const item = (id: string, rotulo: string): ItemDoMenu => ({ id, tipo: 'acao', rotulo, executar: () => {} });

describe('comandos do composer (AT-717)', () => {
  it('o gatilho só vale no início de uma palavra', () => {
    expect(gatilhoNoCursor('oi @po', 6)).toEqual({ tipo: '@', inicio: 3, consulta: 'po' });
    expect(gatilhoNoCursor('/res', 4)?.tipo).toBe('/');
    expect(gatilhoNoCursor('a@b', 3)).toBeNull();
    expect(gatilhoNoCursor('e/ou', 4)).toBeNull();
  });
  it('o filtro casa o nome localizado e o id interno, sem acento', () => {
    const itens = [item('resumo', 'sumário'), item('plano', 'plano')];
    expect(filtrar(itens, 'sumar')).toHaveLength(1);
    expect(filtrar(itens, 'RESUMO')).toHaveLength(1);
  });
  it('os tetos nunca são aprovados por comando', () => {
    expect(ehTeto(acao('git_merge'))).toBe(true);
    expect(ehTeto(acao('terminal', { command: 'sudo rm x' }))).toBe(true);
    expect(destinoDoAprovar([acao('terminal', { command: 'ls' })])).toBe('confirmar');
    expect(destinoDoAprovar([acao('terminal'), acao('terminal')])).toBe('card');
    expect(destinoDoAprovar([acao('instruction_patch')])).toBe('card');
  });
});
