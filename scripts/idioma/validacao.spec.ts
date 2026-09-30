import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_DO_REPOSITORIO } from './corpus.ts';
import {
  CASOS,
  FONTES,
  deltasDaOrientacao,
  lerFerramentas,
  lerOrientacao,
  lerPersona,
  lerResumo,
  orientacao,
  resultadoDaFerramenta,
  veredicto,
  type Chamada,
  type Resposta,
} from './validacao.ts';

const ler = (p: string) => readFileSync(join(RAIZ_DO_REPOSITORIO, p), 'utf8');

describe('os textos vêm do produto, não de uma cópia', () => {
  const t = lerOrientacao(ler(FONTES.orientacao));

  it('lê a orientação de pt-BR e de en literalmente (RN-622)', () => {
    expect(orientacao(t, 'pt-BR', 'pt-BR', ['emit_artifact'])).toBe(
      'Responda em português brasileiro (pt-BR), salvo pedido explícito do usuário por outro idioma nesta mensagem.',
    );
    expect(orientacao(t, 'en', null, [])).toMatch(/^Respond in English \(en\), unless/);
  });

  it('usa a frase genérica para código sem texto próprio', () => {
    expect(orientacao(t, 'es-MX', null, [])).toBe(
      'Respond in the language with BCP-47 code es-MX, unless the user explicitly asks for another language in this message.',
    );
  });

  it('acrescenta a cláusula do artefato só com ferramenta de artefato e idiomas diferentes (RN-623)', () => {
    expect(orientacao(t, 'en', 'pt-BR', ['emit_artifact'])).toMatch(/ Write project artifacts in pt-BR\.$/);
    expect(orientacao(t, 'en', 'pt-BR', ['ask_structured_questions'])).not.toMatch(/artifacts/);
    expect(orientacao(t, 'pt-BR', 'en', ['emit_artifact'])).toMatch(/ Artefatos do projeto: em en\.$/);
    expect(orientacao(t, 'en', 'tlh-Piqd-419-x', ['emit_artifact'])).not.toMatch(/artifacts/);
  });

  it('lê a frase do resumo e monta o molde antigo sem ela (RN-621)', () => {
    const r = lerResumo(ler(FONTES.resumo));
    expect(r.prefixo).toMatch(/^Resuma concisamente .* Mantenha cada turno no idioma original; não traduza citações nem código\.\n\n$/);
    expect(r.prefixoAntigo).toBe('Resuma concisamente os turnos abaixo, preservando decisões e fatos.\n\n');
    expect(r.cabecalho).toBe('Resumo da conversa anterior (compactado):\n');
  });

  it('lê a persona do Criativo e as duas ferramentas dele', () => {
    expect(lerPersona(ler(FONTES.persona))).toMatch(/^Você é o Criativo/);
    const f = lerFerramentas(RAIZ_DO_REPOSITORIO);
    expect(f.map((x) => x.function.name)).toEqual(['emit_artifact', 'ask_structured_questions']);
    expect(f[0]?.function.description).toContain('- `business_rule` — payload EXIGE: `title`, `description`, `origin`');
    expect(f[0]?.function.description).not.toContain('#{');
  });

  it('lê a descrição do formulário SEM idioma fixo, a que a medição depois da AT-282 envia (RN-667)', () => {
    const perguntas = lerFerramentas(RAIZ_DO_REPOSITORIO)[1]?.function.description ?? '';
    expect(perguntas).toContain('o texto da pergunta, no idioma da sua resposta');
    expect(perguntas).not.toMatch(/pt-BR/);
    // A forma de antes — a que a AT-167 mediu — é a que esta régua recusa.
    expect('- `label` (string) — o texto da pergunta, em pt-BR').toMatch(/pt-BR/);
  });

  it('LANÇA quando o texto do produto muda de forma, sem cair numa reserva', () => {
    expect(() => lerOrientacao('defmodule X do end', 'x.ex')).toThrow(/não achei @textos em x\.ex/);
  });

  it('repete os resultados de ferramenta do produto', () => {
    expect(resultadoDaFerramenta('emit_artifact', { type: 'business_rule' })).toBe('artefato business_rule emitido');
    expect(resultadoDaFerramenta('ask_structured_questions', { questions: [{}, {}] })).toBe(
      '2 pergunta(s) estruturada(s) enviada(s) ao usuário',
    );
  });
});

describe('a matriz', () => {
  it('tem C01–C17, e o limiar é C01–C04 e C06–C15 (AT-169)', () => {
    expect(CASOS.map((c) => c.id)).toEqual(Array.from({ length: 17 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`));
    expect(CASOS.filter((c) => !c.noLimiar).map((c) => c.id)).toEqual(['C05', 'C16', 'C17']);
    for (const c of CASOS) expect(c.sessoes.flat().some((t) => t.esperado)).toBe(true);
  });
});

function resposta(p: Partial<Resposta>): Resposta {
  return {
    braco: 'tratamento', modelo: 'm', caso: 'C01', rodada: 0, sessao: 0, turno: 0, esperado: 'pt', veredito: 'pt',
    revisar: false, noLimiar: true, texto: '', usouFerramenta: [], upstream: [], ...p,
  };
}

describe('o limiar', () => {
  it('passa com zero espanhol e acerto ≥ 95%', () => {
    const rs = Array.from({ length: 20 }, () => resposta({}));
    expect(veredicto(rs, 'm').aprovado).toBe(true);
  });

  it('reprova com UM espanhol quando o esperado é pt, mesmo fora do limiar', () => {
    const rs = [...Array.from({ length: 40 }, () => resposta({})), resposta({ caso: 'C16', noLimiar: false, veredito: 'es' })];
    const v = veredicto(rs, 'm');
    expect(v.espanholQuandoPt).toBe(1);
    expect(v.aprovado).toBe(false);
  });

  it('conta indeterminado como NÃO acerto (taxa estrita) e ignora o baseline', () => {
    const rs = [
      ...Array.from({ length: 18 }, () => resposta({})),
      resposta({ veredito: 'indeterminado' }),
      resposta({ veredito: 'indeterminado' }),
      resposta({ braco: 'baseline', veredito: 'es' }),
    ];
    const v = veredicto(rs, 'm');
    expect(v.taxa).toBe(0.9);
    expect(v.espanholQuandoPt).toBe(0);
    expect(v.aprovado).toBe(false);
  });
});

describe('o custo incremental', () => {
  const chamada = (p: Partial<Chamada>): Chamada => ({
    data: '', sha: '', braco: 'baseline', modelo: 'm', sobTeste: 'm', modeloRespondido: 'm', upstream: 'u', caso: 'C01',
    rodada: 0, sessao: 0, turno: 0, iteracao: 0, papel: 'agente', compactouAntes: false, orientacao: null, promptTokens: 100,
    completionTokens: 10, cachedTokens: 0, reasoningTokens: 0, custoUsd: 0.001, latenciaMs: 1, erro: null, ...p,
  });

  it('é a diferença de prompt_tokens da PRIMEIRA chamada, pareada', () => {
    const d = deltasDaOrientacao([
      chamada({}),
      chamada({ braco: 'tratamento', orientacao: 'x', promptTokens: 127 }),
      chamada({ braco: 'tratamento', orientacao: 'x', promptTokens: 999, turno: 1 }),
      chamada({ braco: 'tratamento', orientacao: 'x', promptTokens: 130, rodada: 9 }),
    ]);
    expect(d.get('m|x')?.deltas).toEqual([27]);
  });
});
