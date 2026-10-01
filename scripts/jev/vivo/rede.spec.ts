import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chamarChat, chamarJev, lerRespostaDoChat, paraOFio } from './rede.ts';
import { montarPedidoAoJev } from './roteador.ts';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const CHAVE = 'sk-teste-nunca-real';

function fetchFalso(status: number, corpo: unknown, captura?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (captura) Object.assign(captura, { url, init });
    return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });
  }) as unknown as typeof fetch;
}
const fetchQueLanca = (nome: string): typeof fetch =>
  (async () => {
    const e = new Error('x');
    e.name = nome;
    throw e;
  }) as unknown as typeof fetch;

describe('o fio (porta de toWireMessage/toWireTool)', () => {
  it('tool sem id vira tool_call_id vazio; assistant com chamadas leva arguments serializados', () => {
    expect(paraOFio({ role: 'tool', content: 'r', name: 'terminal' })).toEqual({ role: 'tool', content: 'r', tool_call_id: '', name: 'terminal' });
    expect(paraOFio({ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'terminal', arguments: { command: 'ls' } }] })).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'a', type: 'function', function: { name: 'terminal', arguments: '{"command":"ls"}' } }],
    });
  });

  it('a porta segue o arquivo da api (trechos-âncora)', () => {
    const fonte = readFileSync(join(RAIZ, 'apps/api/src/infrastructure/llm/openai-compatible-provider.ts'), 'utf8');
    expect(fonte).toContain("tool_call_id: message.toolCallId ?? '',");
    expect(fonte).toContain('arguments: JSON.stringify(chamada.arguments),');
    const adaptador = readFileSync(join(RAIZ, 'apps/api/src/infrastructure/llm/jev-tool-router.ts'), 'utf8');
    expect(adaptador).toContain('export const TETO_PADRAO_DO_JEV_MS = 2000;');
    expect(adaptador).toContain("nome === 'TimeoutError' || nome === 'AbortError'");
  });
});

describe('chamarChat', () => {
  it('manda tools e usage.include, lê chamadas, custo real e tokens em cache', async () => {
    const cap: { init?: RequestInit } = {};
    const r = await chamarChat(
      CHAVE,
      'm/x',
      [{ role: 'user', content: 'oi' }],
      [{ name: 'terminal', description: 'd', parameters: {} }],
      fetchFalso(200, {
        choices: [{ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'terminal', arguments: '{"command":"npm test"}' } }] } }],
        usage: { prompt_tokens: 900, completion_tokens: 20, cost: 0.00042, prompt_tokens_details: { cached_tokens: 512 } },
      }, cap),
    );
    const corpo = JSON.parse(String(cap.init?.body));
    expect(corpo).toMatchObject({ model: 'm/x', usage: { include: true }, tools: [{ type: 'function', function: { name: 'terminal' } }] });
    expect(r).toMatchObject({ toolCalls: [{ id: 't1', name: 'terminal', arguments: { command: 'npm test' } }], custoUsd: 0.00042, cachedTokens: 512, erro: null });
  });

  it('erro HTTP e erro de transporte viram `erro`, nunca exceção — e a chave não aparece', async () => {
    const http = await chamarChat(CHAVE, 'm', [], [], fetchFalso(400, { error: { message: 'tool_call_id inválido' } }));
    expect(http.erro).toBe('HTTP 400: tool_call_id inválido');
    const rede = await chamarChat(CHAVE, 'm', [], [], fetchQueLanca('TypeError'));
    expect(rede).toMatchObject({ erro: 'transporte: TypeError', transporte: true });
    expect(JSON.stringify([http, rede])).not.toContain(CHAVE);
  });

  it('argumentos que não são JSON de objeto viram {}', () => {
    expect(lerRespostaDoChat({ choices: [{ message: { tool_calls: [{ function: { name: 'x', arguments: 'nao json' } }] } }] }, 1).toolCalls[0]?.arguments).toEqual({});
  });
});

describe('chamarJev (porta de JevToolRouter)', () => {
  const pedido = montarPedidoAoJev({ agente: 'dev-x', pedido: 'p', contexto: 'c', passos_recentes: [] }, [
    { name: 'terminal', description: 'd', parameters: {} },
    { name: 'read_file', description: 'd', parameters: {} },
  ]);
  const opcoes = ['terminal', 'read_file'];

  it('decidido: escolha, confiança e custo real', async () => {
    const r = await chamarJev(
      CHAVE,
      pedido,
      opcoes,
      fetchFalso(200, {
        answers: { ferramenta_do_passo: { choice: 'terminal', confidence: 0.7, probabilities: { terminal: 0.7, read_file: 0.3 } } },
        usage: { input_tokens: 1800, output_tokens: 1, cost: 0.000075 },
      }),
    );
    expect(r).toMatchObject({ status: 'decidido', escolha: 'terminal', confianca: 0.7, custoUsd: 0.000075 });
  });

  it('quedas nomeadas: HTTP, timeout, rede, escolha fora das opções', async () => {
    expect(await chamarJev(CHAVE, pedido, opcoes, fetchFalso(404, 'gone'))).toMatchObject({ status: 'queda', motivo: 'erro_http' });
    expect(await chamarJev(CHAVE, pedido, opcoes, fetchQueLanca('TimeoutError'))).toMatchObject({ status: 'queda', motivo: 'timeout' });
    expect(await chamarJev(CHAVE, pedido, opcoes, fetchQueLanca('TypeError'))).toMatchObject({ status: 'queda', motivo: 'erro_de_rede' });
    expect(
      await chamarJev(CHAVE, pedido, opcoes, fetchFalso(200, { answers: { ferramenta_do_passo: { choice: 'rm_rf', confidence: 1 } }, usage: { cost: 0.00007 } })),
    ).toMatchObject({ status: 'queda', motivo: 'escolha_fora_das_opcoes', custoUsd: 0.00007 });
  });
});
