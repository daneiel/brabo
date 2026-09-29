import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_DO_REPOSITORIO } from './corpus.ts';
import { gastoDasChamadas, relatorioDoDiagnostico, resumoPorPosicao } from './diagnostico-haiku.ts';
import { FONTES, POSICOES, lerOrientacao, orientacao, posicionar, type Chamada, type Resposta } from './validacao.ts';

const HISTORICO = [
  { role: 'system', content: 'PERSONA' },
  { role: 'user', content: 'primeira' },
  { role: 'assistant', content: 'resposta' },
  { role: 'user', content: 'ultima do usuario' },
];
const O = 'ORIENTACAO';

describe('posicionar', () => {
  it('ultima-system é o que o produto faz: a orientação vira a última mensagem, role system', () => {
    const m = posicionar('ultima-system', HISTORICO, O);
    expect(m).toHaveLength(5);
    expect(m.at(-1)).toEqual({ role: 'system', content: O });
    expect(m.slice(0, 4)).toEqual(HISTORICO);
  });

  it('system-fundido põe a orientação no primeiro system e não cria mensagem', () => {
    const m = posicionar('system-fundido', HISTORICO, O);
    expect(m).toHaveLength(4);
    expect(m[0]?.content).toBe('PERSONA\n\nORIENTACAO');
    expect(m[3]?.content).toBe('ultima do usuario');
  });

  it('sufixo-user acrescenta o texto na ÚLTIMA mensagem do usuário e nada mais', () => {
    const m = posicionar('sufixo-user', HISTORICO, O);
    expect(m).toHaveLength(4);
    expect(m[3]?.content).toBe('ultima do usuario\n\nORIENTACAO');
    expect(m[1]?.content).toBe('primeira');
  });

  it('a quarta é a primeira MAIS o sufixo, com a mesma frase nas duas pontas', () => {
    const m = posicionar('ultima-system-e-sufixo-user', HISTORICO, O);
    expect(m).toHaveLength(5);
    expect(m.at(-1)).toEqual({ role: 'system', content: O });
    expect(m[3]?.content).toBe('ultima do usuario\n\nORIENTACAO');
  });

  it('nunca altera o histórico (a orientação é efêmera, RN-622)', () => {
    const antes = JSON.stringify(HISTORICO);
    for (const p of POSICOES) posicionar(p, HISTORICO, O);
    expect(JSON.stringify(HISTORICO)).toBe(antes);
  });

  it('LANÇA sem system inicial ou sem mensagem de usuário, em vez de posicionar errado', () => {
    expect(() => posicionar('system-fundido', [{ role: 'user', content: 'x' }], O)).toThrow(/system da persona/);
    expect(() => posicionar('sufixo-user', [{ role: 'system', content: 'p' }], O)).toThrow(/usuário/);
  });

  it('com a orientação lida do produto, o texto é o mesmo nas quatro posições', () => {
    const t = lerOrientacao(readFileSync(join(RAIZ_DO_REPOSITORIO, FONTES.orientacao), 'utf8'));
    const texto = orientacao(t, 'en', 'pt-BR', ['emit_artifact']);
    for (const p of POSICOES) {
      const m = posicionar(p, HISTORICO, texto);
      expect(m.some((x) => x.content.includes(texto))).toBe(true);
    }
  });
});

describe('resumo do diagnóstico', () => {
  const r = (posicao: Resposta['posicao'], veredito: Resposta['veredito']): Resposta => ({
    braco: 'tratamento', modelo: 'm', caso: 'C12', rodada: 0, sessao: 0, turno: 0, esperado: 'en', veredito,
    revisar: false, noLimiar: true, texto: '', usouFerramenta: [], upstream: [], ...(posicao ? { posicao } : {}),
  });

  it('conta o acerto por posição e ignora respostas sem posição (a validação da AT-167)', () => {
    const s = resumoPorPosicao([r('ultima-system', 'pt'), r('ultima-system', 'en'), r('sufixo-user', 'en'), r(undefined, 'pt')]);
    expect(s).toEqual([
      { posicao: 'ultima-system', n: 2, acerto: 1, porVeredito: { pt: 1, en: 1 } },
      { posicao: 'sufixo-user', n: 1, acerto: 1, porVeredito: { en: 1 } },
    ]);
  });

  it('soma o custo de cada chamada, tratando ausência como zero', () => {
    const c = (custoUsd: number | null, erro: string | null = null) => ({ custoUsd, erro }) as Chamada;
    expect(gastoDasChamadas([c(0.01), c(0.005), c(null, 'falhou')])).toBeCloseTo(0.015, 6);
    expect(relatorioDoDiagnostico([c(0.01), c(null, 'x')], [r('sufixo-user', 'en')])).toMatch(/US\$ 0\.0100 em 2 chamadas, 1 com erro/);
  });
});
