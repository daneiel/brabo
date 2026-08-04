import { describe, expect, it } from 'vitest';
import { agruparModelos, rotuloDoUpstream, upstreamDoModelo } from './models';
import type { Model, ModelsByCategory } from './api-types';

/**
 * O agrupamento por fabricante dentro de um hub.
 *
 * Um hub devolve o catálogo de dezenas de fabricantes numa lista só — o
 * OpenRouter trouxe 338 modelos no primeiro sync de verdade — e uma lista
 * plana desse tamanho não é navegável. O fabricante sai do PREFIXO do id, que
 * é como o hub namespaceia o catálogo.
 */

function modelo(over: Partial<Model> & { name: string }): Model {
  return {
    id: over.name,
    provider: 'openrouter',
    displayName: over.name,
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    contextWindow: null,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsVision: false,
    manualPricing: false,
    availability: 'available',
    lastSeenAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Model;
}

function catalogo(modelos: Model[]): ModelsByCategory {
  const porProvider: Record<string, Model[]> = {};
  for (const m of modelos) {
    porProvider[m.provider] = [...(porProvider[m.provider] ?? []), m];
  }
  return { local: {}, cloud: porProvider } as ModelsByCategory;
}

describe('upstreamDoModelo', () => {
  it('lê o fabricante do prefixo do id', () => {
    expect(upstreamDoModelo('anthropic/claude-sonnet-4')).toBe('anthropic');
    expect(upstreamDoModelo('meta-llama/llama-3.3-70b')).toBe('meta-llama');
  });

  /**
   * Alguns hubs expõem modelos próprios sem namespace. Sumir com eles seria
   * pior que agrupá-los à parte — um modelo que existe e não aparece na tela é
   * indistinguível de um que o sync não trouxe.
   */
  it('modelo sem namespace cai num grupo à parte, não some', () => {
    expect(upstreamDoModelo('kimi-k2-instruct')).toBe('outros');
  });

  it('rótulo conhecido é traduzido; desconhecido mantém o slug', () => {
    expect(rotuloDoUpstream('meta-llama')).toBe('Meta');
    // O hub inventa slugs quando quiser: travar o typecheck nisso pararia o
    // build por um dado que não é nosso.
    expect(rotuloDoUpstream('fabricante-novo-de-amanha')).toBe(
      'fabricante-novo-de-amanha',
    );
  });
});

describe('agruparModelos — subgrupos de hub', () => {
  const modelos = [
    modelo({ name: 'openai/gpt-4o' }),
    modelo({ name: 'openai/gpt-4o-mini' }),
    modelo({ name: 'anthropic/claude-sonnet-4' }),
    modelo({ name: 'meta-llama/llama-3.3-70b' }),
    modelo({ name: 'kimi-k2-instruct' }),
    modelo({ name: 'claude-opus-4-8', provider: 'anthropic' }),
  ];

  it('só o hub ganha subgrupos — numa API direta o dono já é o provider', () => {
    const grupos = agruparModelos(catalogo(modelos));
    const hub = grupos.find((g) => g.kind === 'hub')!;
    const direto = grupos.find((g) => g.kind === 'direct')!;

    expect(hub.subgrupos).toBeDefined();
    expect(direto.subgrupos).toBeUndefined();
  });

  it('reparte por fabricante e ordena do maior grupo para o menor', () => {
    const hub = agruparModelos(catalogo(modelos)).find((g) => g.kind === 'hub')!;

    expect(hub.subgrupos!.map((s) => s.upstream)).toEqual([
      'openai',
      'anthropic',
      'meta-llama',
      'outros',
    ]);
    expect(hub.subgrupos![0].modelos).toHaveLength(2);
  });

  /** Nenhum modelo pode se perder no caminho — o subgrupo é uma VISÃO. */
  it('a soma dos subgrupos é o grupo inteiro', () => {
    const hub = agruparModelos(catalogo(modelos)).find((g) => g.kind === 'hub')!;

    const soma = hub.subgrupos!.reduce((n, s) => n + s.modelos.length, 0);
    expect(soma).toBe(hub.modelos.length);
  });

  it('o filtro de aptos para agentes vale dentro dos subgrupos', () => {
    const comChatOnly = [
      ...modelos,
      modelo({ name: 'openai/o1-preview', supportsToolCalling: false }),
    ];
    const hub = agruparModelos(catalogo(comChatOnly), {
      somenteAptosParaAgentes: true,
    }).find((g) => g.kind === 'hub')!;

    const openai = hub.subgrupos!.find((s) => s.upstream === 'openai')!;
    expect(openai.modelos.map((m) => m.name)).not.toContain('openai/o1-preview');
  });
});
