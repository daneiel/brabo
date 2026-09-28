import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decisaoDaPoliticaDaAcao,
  fraseDaDecisaoDaPolitica,
  fraseDaDecisaoForaDoRecorte,
  lerDecisaoDaPolitica,
  linhaDoEventoDePolitica,
} from './decisao-da-politica';
import { classifyEvent } from './activity';
import type { SessionEvent } from './api-types';
// Singleton REAL (mesmo padrão de `session-falha.test.ts`): as frases resolvem
// por `i18n.t()` dentro da função, então o idioma é fixado por teste.
import i18n from './i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const MOTIVO = 'escopo: cd dentro da pasta do projeto';

function evento(payload: Record<string, unknown>, seq = 1): SessionEvent {
  return {
    id: `ev-${seq}`,
    sessionId: 'sess-1',
    seq,
    type: 'proposed_action.created',
    actor: { kind: 'agent', id: 'dev-api' },
    payload,
    createdAt: new Date().toISOString(),
  };
}

describe('fraseDaDecisaoDaPolitica — o motivo e a raiz, numa frase só (RN-614)', () => {
  it('motivo SEM raiz (tipo que não é terminal): só o motivo, sem falar de raiz', () => {
    const d = lerDecisaoDaPolitica({ actionType: 'git_commit', reason: MOTIVO });
    expect(fraseDaDecisaoDaPolitica(d)).toBe(`A política decidiu por: ${MOTIVO}`);
  });

  it('raiz_gerenciada: o segmento como pasta gerenciada', () => {
    const d = lerDecisaoDaPolitica({
      actionType: 'terminal',
      reason: MOTIVO,
      scopeRoot: { executionMode: 'container', ancora: 'raiz_gerenciada', segmento: 'loja-a1b2' },
    });
    expect(fraseDaDecisaoDaPolitica(d)).toBe(
      `A política decidiu por: ${MOTIVO} · raiz do escopo: pasta gerenciada “loja-a1b2”`,
    );
  });

  it('base_de_projetos: o segmento relativo à base', () => {
    const d = lerDecisaoDaPolitica({
      actionType: 'terminal',
      reason: MOTIVO,
      scopeRoot: { executionMode: 'mounted', ancora: 'base_de_projetos', segmento: 'clientes/loja' },
    });
    expect(fraseDaDecisaoDaPolitica(d)).toContain(
      'raiz do escopo: “clientes/loja” dentro da base de projetos',
    );
  });

  it('nome_da_pasta: um NOME na máquina do runner, não um caminho', () => {
    const d = lerDecisaoDaPolitica({
      actionType: 'terminal',
      reason: MOTIVO,
      scopeRoot: { executionMode: 'runner', ancora: 'nome_da_pasta', segmento: 'loja-a1b2' },
    });
    expect(fraseDaDecisaoDaPolitica(d)).toContain(
      'raiz do escopo: pasta “loja-a1b2” na máquina do runner',
    );
  });

  it('indisponivel tem texto PRÓPRIO, e nunca um caminho', () => {
    const d = lerDecisaoDaPolitica({
      actionType: 'terminal',
      reason: MOTIVO,
      scopeRoot: { executionMode: 'mounted', ancora: 'indisponivel', segmento: null },
    });
    const frase = fraseDaDecisaoDaPolitica(d);
    expect(frase).toContain('raiz do escopo: sem forma relativa');
    expect(frase).not.toContain('/');
  });

  it('evento ANTIGO sem `reason` nem `scopeRoot`: diz "não registrado", nunca cala', () => {
    const d = lerDecisaoDaPolitica({ actionId: 'a1', actionType: 'terminal', status: 'pending' });
    expect(fraseDaDecisaoDaPolitica(d)).toBe(
      'Motivo da política não registrado (proposta antes de o motivo ir para o log) · ' +
        'raiz do escopo não registrada (proposta antes de a raiz ir para o log)',
    );
  });

  it('evento com motivo mas sem raiz (entre a RN-567 e a RN-609): o motivo e a raiz não registrada', () => {
    const d = lerDecisaoDaPolitica({ actionType: 'terminal', reason: MOTIVO });
    expect(fraseDaDecisaoDaPolitica(d)).toBe(
      `A política decidiu por: ${MOTIVO} · raiz do escopo não registrada (proposta antes de a raiz ir para o log)`,
    );
  });

  it('payload malformado e âncora desconhecida não quebram', () => {
    expect(() => fraseDaDecisaoDaPolitica(lerDecisaoDaPolitica(null))).not.toThrow();
    const d = lerDecisaoDaPolitica({
      actionType: 'terminal',
      reason: MOTIVO,
      scopeRoot: { ancora: 'caminho_absoluto', segmento: '/home/fulano/projeto' },
    });
    const frase = fraseDaDecisaoDaPolitica(d);
    expect(frase).toContain('gravada numa forma que esta tela não conhece');
    expect(frase).not.toContain('/home/fulano');
  });

  it('as frases existem nos DOIS idiomas', async () => {
    const d = lerDecisaoDaPolitica({
      actionType: 'terminal',
      reason: MOTIVO,
      scopeRoot: { executionMode: 'container', ancora: 'raiz_gerenciada', segmento: 'loja' },
    });
    await i18n.changeLanguage('en');
    try {
      expect(fraseDaDecisaoDaPolitica(d)).toBe(
        `Policy decided by: ${MOTIVO} · scope root: managed folder “loja”`,
      );
      expect(fraseDaDecisaoForaDoRecorte()).toBe('Policy reason not in the events loaded on this screen');
    } finally {
      await i18n.changeLanguage('pt-BR');
    }
  });
});

describe('decisaoDaPoliticaDaAcao — o evento da ação, entre os carregados', () => {
  it('acha o `proposed_action.created` pelo actionId', () => {
    const eventos = [evento({ actionId: 'outra', reason: 'x' }, 1), evento({ actionId: 'a1', reason: MOTIVO }, 2)];
    expect(decisaoDaPoliticaDaAcao('a1', eventos)?.motivo).toBe(MOTIVO);
  });

  it('fora dos eventos carregados devolve null — "não carregado", distinto de "não registrado"', () => {
    expect(decisaoDaPoliticaDaAcao('a1', [])).toBeNull();
  });
});

describe('a linha do log e o card usam a MESMA frase', () => {
  it('classifyEvent do `proposed_action.created` termina com fraseDaDecisaoDaPolitica', () => {
    const payload = {
      actionId: 'a1',
      actionType: 'terminal',
      status: 'auto_approved',
      reason: MOTIVO,
      scopeRoot: { executionMode: 'container', ancora: 'raiz_gerenciada', segmento: 'loja' },
    };
    const display = classifyEvent(evento(payload));
    const frase = fraseDaDecisaoDaPolitica(lerDecisaoDaPolitica(payload));
    expect(display.text).toBe(`dev-api: ação aprovada automaticamente pela política — ${frase}`);
    expect(display.text).toBe(linhaDoEventoDePolitica('dev-api', payload));
    expect(display.kind).toBe('permission');
    expect(display.bad).toBe(false);
  });

  it('negada pela política é `bad`', () => {
    const display = classifyEvent(evento({ status: 'denied', reason: 'deny: sudo' }));
    expect(display.bad).toBe(true);
    expect(display.text).toContain('ação negada pela política');
  });
});
