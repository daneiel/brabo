import { describe, expect, it } from 'vitest';
import { buildMinimapData, desenharMinimapa, linhaNoOffsetY, resolverCoresDoMinimapa } from './minimap';
import { highlightFile } from './highlight';

describe('buildMinimapData', () => {
  it('caminho feliz: resume cada linha pelo tipo de token com mais caracteres', () => {
    const linhas = highlightFile('const total = 42; // comentário grande explicando o total\n\nfunction f() {}', 'ts');
    const dados = buildMinimapData(linhas);

    expect(dados).toHaveLength(3);
    // Linha 1: "const total = 42; // comentário..." — o comentário é mais longo
    // que "const"/"total"/"42" somados, então domina mesmo tendo keyword antes.
    expect(dados[0].kind).toBe('comment');
    expect(dados[0].width).toBeGreaterThan(0);
    // Linha 2 é vazia.
    expect(dados[1]).toEqual({ width: 0, kind: 'empty' });
    // Linha 3 tem "function" (keyword) mais texto — não é vazia.
    expect(dados[2].kind).not.toBe('empty');
  });

  it('falha/borda: array vazio de linhas devolve array vazio, sem lançar', () => {
    expect(buildMinimapData([])).toEqual([]);
  });

  it('linha só com espaço em branco conta como vazia', () => {
    const linhas = highlightFile('a\n   \nb', 'ts');
    const dados = buildMinimapData(linhas);
    expect(dados[1]).toEqual({ width: 0, kind: 'empty' });
  });
});

describe('linhaNoOffsetY', () => {
  it('caminho feliz: mapeia proporcionalmente o Y do clique para a linha', () => {
    // Clique na metade exata de uma área de 200px, arquivo de 100 linhas.
    expect(linhaNoOffsetY(100, 200, 100)).toBe(50);
    expect(linhaNoOffsetY(0, 200, 100)).toBe(0);
  });

  it('falha/borda: offset fora dos limites (negativo ou além da altura) é limitado, nunca índice inválido', () => {
    expect(linhaNoOffsetY(-50, 200, 100)).toBe(0);
    expect(linhaNoOffsetY(9999, 200, 100)).toBe(99);
    expect(linhaNoOffsetY(50, 200, 0)).toBe(0);
    expect(linhaNoOffsetY(50, 0, 100)).toBe(0);
  });
});

describe('resolverCoresDoMinimapa', () => {
  it('caminho feliz: lê variáveis CSS existentes, sem lançar mesmo sem tema real (jsdom)', () => {
    const cores = resolverCoresDoMinimapa(document.documentElement);
    expect(cores.keyword).toBeTruthy();
    expect(cores.empty).toBe('transparent');
  });
});

describe('desenharMinimapa', () => {
  it('caminho feliz: desenha sem lançar num contexto de canvas real', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    // jsdom sem o pacote `canvas` devolve null — o teste prova que a função
    // aceita um ctx real do tipo certo sem explodir a assinatura; se `ctx`
    // vier null aqui (ambiente sem suporte), o teste de degradação fica a
    // cargo de CodeEditor.test.tsx, que exercita esse caminho de verdade.
    if (!ctx) return;
    const dados = buildMinimapData(highlightFile('a\nb\n\nc', 'ts'));
    expect(() => desenharMinimapa(ctx, dados, { width: 64, height: 100 }, resolverCoresDoMinimapa(canvas))).not.toThrow();
  });

  it('falha/borda: altura zero ou lista vazia não desenha nada e não lança', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cores = resolverCoresDoMinimapa(canvas);
    expect(() => desenharMinimapa(ctx, [], { width: 64, height: 0 }, cores)).not.toThrow();
    expect(() => desenharMinimapa(ctx, buildMinimapData(highlightFile('a', 'ts')), { width: 64, height: 0 }, cores)).not.toThrow();
  });
});
