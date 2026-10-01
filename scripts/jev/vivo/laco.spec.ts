import { describe, expect, it } from 'vitest';
import { executarLaco, rotear, type Definicao, type Dependencias, type RespostaDoChat, type ResultadoDoJev } from './laco.ts';

const def = (name: string): Definicao => ({ name, description: `descrição de ${name}`, parameters: { type: 'object', properties: {} } });
const CATALOGO = ['read_file', 'write_file', 'terminal', 'report_done'].map(def);

const resp = (r: Partial<RespostaDoChat>): RespostaDoChat => ({
  content: '',
  toolCalls: [],
  custoUsd: 0.001,
  promptTokens: 100,
  completionTokens: 10,
  cachedTokens: 0,
  latenciaMs: 50,
  erro: null,
  ...r,
});
const chamada = (name: string, id = `c-${name}`) => ({ id, name, arguments: {} });

function deps(
  respostas: RespostaDoChat[],
  jev: (opcoes: readonly string[]) => ResultadoDoJev = () => ({ status: 'decidido', escolha: 'terminal', confianca: 0.9, probabilidades: {}, custoUsd: 0.0001, latenciaMs: 300 }),
  extra: Partial<Dependencias> = {},
) {
  const menus: string[][] = [];
  let jevs = 0;
  let t = 0;
  const d: Dependencias = {
    chat: async (_m, tools) => {
      menus.push(tools.map((x) => x.name));
      const r = respostas.shift();
      if (!r) throw new Error('chat chamado além do roteiro');
      return r;
    },
    jev: async (_p, opcoes) => {
      jevs++;
      return jev(opcoes);
    },
    executar: (nome) => (nome === 'report_done' ? { conteudo: 'conclusão registrada', ok: true } : { conteudo: 'exit 0\nok', ok: true }),
    podeGastar: () => true,
    agora: () => (t += 10),
    ...extra,
  };
  return { d, menus, jevs: () => jevs };
}

const params = (braco: 'ligado' | 'desligado') => ({ agente: 'dev-x', sistema: 'Você é o agente dev-x.', pedido: 'Implemente a task.', catalogo: CATALOGO, braco, maxIteracoes: 10 });

describe('executarLaco', () => {
  it('desligado: nenhum Jev, catálogo inteiro em todo passo, para no report_done', async () => {
    const { d, menus, jevs } = deps([resp({ toolCalls: [chamada('terminal')] }), resp({ toolCalls: [chamada('report_done')] })]);
    const e = await executarLaco(params('desligado'), d);
    expect(e.fim).toBe('report_done');
    expect(e.passos).toHaveLength(2);
    expect(jevs()).toBe(0);
    expect(menus.every((m) => m.length === 4)).toBe(true);
    expect(e.passos.every((p) => p.roteamento === null)).toBe(true);
  });

  it('ligado: no 1º passo não há ferramenta anterior (catálogo inteiro, sem queda); no 2º o menu P3 é {escolha, anterior}', async () => {
    const { d, menus } = deps(
      [resp({ toolCalls: [chamada('read_file')] }), resp({ toolCalls: [chamada('report_done')] })],
      () => ({ status: 'decidido', escolha: 'report_done', confianca: 0.8, probabilidades: { report_done: 0.8 }, custoUsd: 0.0001, latenciaMs: 300 }),
    );
    const e = await executarLaco(params('ligado'), d);
    expect(menus[0]).toHaveLength(4);
    expect(e.passos[0]?.roteamento).toMatchObject({ aplicado: false, motivoDaQueda: null, anterior: null });
    expect(menus[1]).toEqual(['read_file', 'report_done']);
    expect(e.passos[1]?.roteamento).toMatchObject({ aplicado: true, escolha: 'report_done', anterior: 'read_file', foraDoCardapio: [] });
    expect(e.passos[1]?.roteamento?.custoUsd).toBe(0.0001);
  });

  it('menu restrito e resposta sem ferramenta: o passo volta UMA vez com o catálogo inteiro, e o custo é das duas chamadas', async () => {
    const { d, menus } = deps([
      resp({ toolCalls: [chamada('read_file')] }),
      resp({ content: 'Pronto, terminei.', custoUsd: 0.002 }),
      resp({ toolCalls: [chamada('write_file')], custoUsd: 0.003 }),
      resp({ toolCalls: [chamada('report_done')] }),
    ]);
    const e = await executarLaco(params('ligado'), d);
    expect(menus[1]).toEqual(['read_file', 'terminal']);
    expect(menus[2]).toHaveLength(4);
    const p = e.passos[1]!;
    expect(p.chamadasDeChat).toBe(2);
    expect(p.custoDoChatUsd).toBeCloseTo(0.005);
    expect(p.roteamento?.repetidoComCatalogoInteiro).toBe(true);
    // write_file não estava no cardápio RESTRITO da primeira volta.
    expect(p.roteamento?.foraDoCardapio).toEqual(['write_file']);
    expect(e.fim).toBe('report_done');
  });

  it('chamada em TEXTO é recuperada (conta como passo recuperado) e NÃO dispara a volta com o catálogo inteiro', async () => {
    const { d, menus } = deps([
      resp({ toolCalls: [chamada('read_file')] }),
      resp({ content: '```json\n{"name": "write_file", "arguments": {"path": "a", "content": "b"}}\n```' }),
      resp({ toolCalls: [chamada('report_done')] }),
    ]);
    const e = await executarLaco(params('ligado'), d);
    expect(menus).toHaveLength(3);
    expect(e.passos[1]).toMatchObject({ recuperado: true, ferramentas: ['write_file'], chamadasDeChat: 1 });
  });

  it('queda do Jev (timeout): catálogo inteiro, motivo e origem `infra`, o turno segue', async () => {
    const { d, menus } = deps(
      [resp({ toolCalls: [chamada('read_file')] }), resp({ toolCalls: [chamada('report_done')] })],
      () => ({ status: 'queda', motivo: 'timeout', detalhe: 'TimeoutError', custoUsd: null, latenciaMs: 2000 }),
    );
    const e = await executarLaco(params('ligado'), d);
    expect(menus[1]).toHaveLength(4);
    expect(e.passos[1]?.roteamento).toMatchObject({ aplicado: false, motivoDaQueda: 'timeout', origemDaQueda: 'infra', custoUsd: 0 });
    expect(e.fim).toBe('report_done');
  });

  it('report_done recusado (sem suite verde) NÃO encerra', async () => {
    let n = 0;
    const { d } = deps(
      [resp({ toolCalls: [chamada('report_done', 'a')] }), resp({ toolCalls: [chamada('report_done', 'b')] })],
      undefined,
      { executar: () => (n++ === 0 ? { conteudo: 'não é possível concluir', ok: false } : { conteudo: 'conclusão registrada', ok: true }) },
    );
    const e = await executarLaco(params('desligado'), d);
    expect(e.passos).toHaveLength(2);
    expect(e.fim).toBe('report_done');
  });

  it('falhas: teto de gasto antes da chamada, limite de iterações, erro do provider sem chamada, resposta sem chamada', async () => {
    expect((await executarLaco(params('ligado'), deps([], undefined, { podeGastar: () => false }).d)).fim).toBe('teto_de_gasto');
    const muitas = Array.from({ length: 10 }, () => resp({ toolCalls: [chamada('terminal')] }));
    expect((await executarLaco(params('desligado'), deps(muitas).d)).fim).toBe('limite');
    expect((await executarLaco(params('desligado'), deps([resp({ erro: 'HTTP 400: x' })]).d)).fim).toBe('erro');
    expect((await executarLaco(params('desligado'), deps([resp({ content: 'acabei' })]).d)).fim).toBe('sem_chamada');
  });
});

describe('rotear (as condições do caso de uso da api)', () => {
  const jev = async (): Promise<ResultadoDoJev> => ({ status: 'decidido', escolha: 'terminal', confianca: 1, probabilidades: {}, custoUsd: 0, latenciaMs: 1 });

  it('não consulta com menos de duas ferramentas, nem para agente fora do roteamento', async () => {
    expect(await rotear('dev-x', [], [def('terminal')], jev)).toBeNull();
    expect(await rotear('anamnese', [], CATALOGO, jev)).toBeNull();
  });

  it('colisão com o nome reservado e estado grande caem com origem `codigo`, sem chamar o Jev', async () => {
    let chamou = false;
    const espiao = async (): Promise<ResultadoDoJev> => {
      chamou = true;
      return jev();
    };
    const colisao = await rotear('dev-x', [], [...CATALOGO, def('responder_sem_ferramenta')], espiao);
    expect(colisao?.roteamento).toMatchObject({ motivoDaQueda: 'colisao_de_nome', origemDaQueda: 'codigo' });
    const grande = await rotear('dev-x', [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }], [...CATALOGO.slice(0, 3), { ...def('report_done'), description: 'z'.repeat(70_000) }], espiao);
    expect(grande?.roteamento).toMatchObject({ motivoDaQueda: 'estado_grande', origemDaQueda: 'codigo' });
    expect(chamou).toBe(false);
  });
});
