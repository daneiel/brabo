import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_DO_REPOSITORIO } from './corpus.ts';
import { CONSULTA, comandoPsql, lerOpcoes, mesclar, montarItens, type Evento } from './extrair.ts';
import { interpretar } from './rotular.ts';

const ev = (seq: number, tipo: string, payload: Evento['payload'], ator = 'u1', sessao = 's1'): Evento => ({
  sessao,
  seq,
  tipo,
  ator,
  em: `2026-09-01T00:00:0${seq}Z`,
  payload,
});

describe('o que entra na evidência (AT-080, itens 5 e 6)', () => {
  it('a consulta só lê eventos de ATOR usuário — resposta de agente nunca realimenta a detecção', () => {
    expect(CONSULTA).toMatch(/actor_kind = 'user'/);
    expect(CONSULTA).toMatch(/^SELECT/);
    expect(CONSULTA).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
  });

  it('do formulário estruturado entram só as respostas, e o eco com os rótulos do agente é pulado', () => {
    const itens = montarItens([
      ev(1, 'chat.message', { text: 'quero um app de reservas' }),
      ev(2, 'chat.structured_question_answered', { questionSetId: 'q', answers: { a: 'só no celular', b: 'uns cinquenta' } } as Evento['payload']),
      ev(3, 'chat.message', { text: '1. Em quais dispositivos?: só no celular\n2. Quantos usuários?: uns cinquenta' }),
      ev(4, 'chat.message', { text: '1. primeiro isso: depois aquilo' }),
    ]);
    expect(itens.map((i) => i.texto)).toEqual([
      'quero um app de reservas',
      'só no celular\nuns cinquenta',
      '1. primeiro isso: depois aquilo',
    ]);
    expect(itens.every((i) => i.idioma === null && i.origem === 'real')).toBe(true);
    expect(itens[0]).toMatchObject({ id: 's1:1', grupo: 'u1' });
  });

  it('o eco é pulado só na mesma sessão e do mesmo autor', () => {
    const itens = montarItens([
      ev(1, 'chat.structured_question_answered', { answers: { a: 'sim' } }, 'u1', 's1'),
      ev(2, 'chat.message', { text: '1. Pergunta?: resposta' }, 'u2', 's1'),
    ]);
    expect(itens.map((i) => i.texto)).toEqual(['sim', '1. Pergunta?: resposta']);
  });

  it('rodar de novo mantém o rótulo do que já estava e acrescenta só o novo', () => {
    const velho = [{ id: 's1:1', idioma: 'pt-BR', texto: 'x', origem: 'real' as const }];
    const novo = montarItens([ev(1, 'chat.message', { text: 'x' }), ev(2, 'chat.message', { text: 'y' })]);
    expect(mesclar(velho, novo).map((i) => [i.id, i.idioma])).toEqual([
      ['s1:1', 'pt-BR'],
      ['s1:2', null],
    ]);
  });
});

describe('opções da extração', () => {
  it('exige exatamente uma fonte', () => {
    expect(() => lerOpcoes([])).toThrow(/um dos dois/);
    expect(() => lerOpcoes(['--container', 'a', '--database-url', 'postgres://x'])).toThrow(/um dos dois/);
  });

  it('recusa --saida dentro do repositório', () => {
    expect(() => lerOpcoes(['--container', 'pg', '--saida', join(RAIZ_DO_REPOSITORIO, 'corpus.jsonl')])).toThrow(/fora do git/);
  });

  it('pelo container, roda psql dentro dele com a consulta de leitura', () => {
    const o = lerOpcoes(['--container', 'meu-pg', '--usuario', 'u', '--banco', 'b'], { XDG_CACHE_HOME: '/tmp/cache' });
    expect(o.saida).toBe('/tmp/cache/brabo/corpus-idioma/mensagens.jsonl');
    const [bin, args] = comandoPsql(o);
    expect(bin).toBe('docker');
    expect(args.slice(0, 7)).toEqual(['exec', '-i', 'meu-pg', 'psql', '-U', 'u', '-d']);
    expect(args.at(-1)).toBe(CONSULTA);
  });
});

describe('rotulagem assistida', () => {
  it('ENTER aceita o padrão declarado; sem padrão, ENTER não rotula', () => {
    expect(interpretar('', 'pt-BR')).toEqual({ tipo: 'rotulo', valor: 'pt-BR' });
    expect(interpretar('')).toEqual({ tipo: 'invalida' });
  });

  it('aceita código BCP-47, und e mul; recusa o resto', () => {
    expect(interpretar('es')).toEqual({ tipo: 'rotulo', valor: 'es' });
    expect(interpretar('zh-Hant')).toEqual({ tipo: 'rotulo', valor: 'zh-Hant' });
    expect(interpretar('mul')).toEqual({ tipo: 'rotulo', valor: 'mul' });
    expect(interpretar('português')).toEqual({ tipo: 'invalida' });
    expect(interpretar('q')).toEqual({ tipo: 'sair' });
    expect(interpretar('p')).toEqual({ tipo: 'pular' });
  });
});
