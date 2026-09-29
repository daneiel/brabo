import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { perguntar } from './cliente.ts';
import { DEGRAUS_DA_CASCATA, dentroDoRepositorio, gastoAcumulado, lerChave, lerOpcoes } from './analise.ts';
import { INSTRUCAO, INSTRUCAO_COM_FLUXO, montarPedido } from './jev.ts';
import type { Catalogo } from './passos.ts';
import { VARIANTES } from './variantes.ts';

describe('lerOpcoes', () => {
  it('recusa saída, cache e dump dentro do repositório (têm texto de sessão)', () => {
    expect(() => lerOpcoes(['--container', 'c', '--saida-dir', join(process.cwd(), 'x')], {})).toThrow(/dentro do repositório/);
    expect(() => lerOpcoes(['--container', 'c', '--dados-cache', join(process.cwd(), 'd.json')], {})).toThrow(/dentro do repositório/);
    expect(dentroDoRepositorio(join(tmpdir(), 'fora'))).toBe(false);
  });

  it('recusa variante desconhecida e pede de onde ler', () => {
    expect(() => lerOpcoes(['--container', 'c', '--variante', 'inexistente'], {})).toThrow(/variante desconhecida/);
    expect(() => lerOpcoes(['--variante', 'escopo'], {})).toThrow(/de onde ler/);
  });

  it('por padrão pergunta só a metade de tuning — a validação não se olha antes da hora', () => {
    expect(lerOpcoes(['--container', 'c', '--variante', 'escopo'], {}).metade).toBe('tuning');
    expect(lerOpcoes(['--container', 'c', '--metade', 'validacao'], {}).metade).toBe('validacao');
    expect(() => lerOpcoes(['--container', 'c', '--metade', 'todas'], {})).toThrow(/tuning, validacao ou ambas/);
  });

  it('o teto padrão do gasto acumulado é US$ 1,00', () => {
    expect(lerOpcoes(['--container', 'c'], {}).tetoUsd).toBe(1);
  });
});

describe('gasto acumulado', () => {
  it('soma o usage.cost de todas as saídas do diretório, inclusive as descartadas — gasto é gasto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-gasto-'));
    writeFileSync(join(dir, 'a.jsonl'), `${JSON.stringify({ custoUsd: 0.01 })}\n${JSON.stringify({ custoUsd: null })}\n`);
    writeFileSync(join(dir, 'b.descartado'), `${JSON.stringify({ custoUsd: 0.02 })}\n`);
    writeFileSync(join(dir, 'c.txt'), `${JSON.stringify({ custoUsd: 5 })}\n`);
    expect(gastoAcumulado(dir)).toBeCloseTo(0.03, 10);
    expect(gastoAcumulado(join(dir, 'nao-existe'))).toBe(0);
  });
});

describe('lerChave', () => {
  it('lê a chave de um arquivo KEY=valor, sem aspas, e recusa arquivo sem ela', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-chave-'));
    writeFileSync(join(dir, 'ok.env'), "# c\nexport OPENROUTER_TEST_KEY='sk-teste'\n");
    writeFileSync(join(dir, 'vazio.env'), 'OUTRA=1\n');
    expect(lerChave(join(dir, 'ok.env'), {})).toBe('sk-teste');
    expect(() => lerChave(join(dir, 'vazio.env'), {})).toThrow(/não define/);
    expect(() => lerChave(undefined, {})).toThrow(/ausente/);
  });
});

describe('a cascata foi escrita antes de rodar', () => {
  it('cada degrau usa uma variante que existe; a régua só sobe (estrita → E1 → E1+E2 → todas)', () => {
    for (const d of DEGRAUS_DA_CASCATA) expect(VARIANTES[d.variante], d.variante).toBeDefined();
    expect(DEGRAUS_DA_CASCATA.slice(0, 4).map((d) => d.camadas.length)).toEqual([0, 1, 2, 3]);
  });
});

describe('perguntar (o cliente)', () => {
  const catalogo: Catalogo = { agentes: {}, ferramentas: { a: 'A', b: 'B' }, identidades: {} };
  const corpo = montarPedido({ agente: 'x' }, ['a', 'b'], catalogo);
  const base = { id: 'i', ator: 'x', rotulos: ['a'], chamadas: ['a'], suspeitas: [], anterior: null, opcoes: 3 };
  const resposta = (o: unknown, status = 200) => (async () => new Response(JSON.stringify(o), { status })) as unknown as typeof fetch;

  it('guarda as probabilidades da resposta (a 1ª rodada só guardava a escolha)', async () => {
    const r = await perguntar(
      corpo,
      ['a', 'b'],
      base,
      'segredo',
      1000,
      resposta({
        model: 'm',
        id: 'gen-1',
        answers: { ferramenta_do_passo: { type: 'choice', choice: 'a', confidence: 0.7, probabilities: { a: 0.8, b: 0.1, responder_sem_ferramenta: 0.1 } } },
        usage: { cost: 0.0001, input_tokens: 10 },
      }),
    );
    expect(r).toMatchObject({ status: 'ok', escolha: 'a', probabilidades: { a: 0.8, b: 0.1 }, custoUsd: 0.0001, geracao: 'gen-1' });
  });

  it('erro http, escolha fora das opções e queda de rede viram status nomeado, nunca exceção; a chave não vaza', async () => {
    const http = await perguntar(corpo, ['a', 'b'], base, 'segredo', 1000, resposta({ error: 'x' }, 500));
    expect(http.status).toBe('erro_http');
    const fora = await perguntar(corpo, ['a', 'b'], base, 'segredo', 1000, resposta({ answers: { ferramenta_do_passo: { choice: 'zzz', confidence: 1 } } }));
    expect(fora.status).toBe('escolha_fora_das_opcoes');
    const rede = await perguntar(corpo, ['a', 'b'], base, 'segredo', 1000, (async () => { throw new TypeError('rede'); }) as unknown as typeof fetch);
    expect(rede.status).toBe('erro_de_rede');
    for (const x of [http, fora, rede]) expect(JSON.stringify(x)).not.toContain('segredo');
  });

  it('manda a chave só no cabeçalho de autorização', async () => {
    let visto: RequestInit | undefined;
    await perguntar(corpo, ['a', 'b'], base, 'segredo', 1000, (async (_u: unknown, init: RequestInit) => {
      visto = init;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    expect((visto!.headers as Record<string, string>).Authorization).toBe('Bearer segredo');
    expect(String(visto!.body)).not.toContain('segredo');
  });
});

describe('a pergunta da variante `fluxo`', () => {
  const catalogo: Catalogo = { agentes: {}, ferramentas: { a: 'A' }, identidades: {} };
  it('só troca o texto da instrução; as opções são as mesmas', () => {
    const base = montarPedido({}, ['a'], catalogo);
    const fluxo = montarPedido({}, ['a'], catalogo, INSTRUCAO_COM_FLUXO);
    expect(base.questions.ferramenta_do_passo!.instructions).toBe(INSTRUCAO);
    expect(fluxo.questions.ferramenta_do_passo!.instructions).toBe(INSTRUCAO_COM_FLUXO);
    expect(fluxo.questions.ferramenta_do_passo!.criteria).toEqual(base.questions.ferramenta_do_passo!.criteria);
  });
});
