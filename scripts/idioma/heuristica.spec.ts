import { describe, expect, it } from 'vitest';
import {
  AMPLIADA,
  AT080,
  avaliarSequencia,
  classificar,
  ehLinhaDeLog,
  limpar,
  PARAMETROS_AT080,
  pontuar,
} from './heuristica.ts';

const SEM_MINIMO = { ...PARAMETROS_AT080, minPalavras: 0 };

describe('limpeza (AT-080, itens 1–4)', () => {
  it('tira bloco cercado, crase simples, URL e e-mail', () => {
    const l = limpar('olha isso ```ts\nconst the = 1\n``` e `the thing` em https://x.dev/the ou a@b.com');
    expect(l.palavras).toEqual(['olha', 'isso', 'e', 'em', 'ou']);
  });

  it('tira linha de log, de stack trace e de citação', () => {
    const texto = [
      'o engine caiu',
      '2026-09-20 08:14:03.221 [error] the process terminated',
      '    at Foo (foo.ts:1:2)',
      '> ¿Por qué no puedo exportar?',
    ].join('\n');
    expect(limpar(texto).palavras).toEqual(['o', 'engine', 'caiu']);
  });

  it('tira identificador técnico sem apagar a palavra portuguesa ao lado (inspeção futura, item 3)', () => {
    const l = limpar('renomeia user_id para usuarioId no arquivo src/total.ts, não mexe na coluna');
    expect(l.palavras).toEqual(['renomeia', 'para', 'no', 'arquivo', 'não', 'mexe', 'na', 'coluna']);
  });

  it('citação curta entre aspas fica; longa sai', () => {
    expect(limpar('ele disse "ok então" e saiu').palavras).toContain('então');
    expect(limpar('ele disse "no puedo iniciar sesión desde ayer" e saiu').palavras).not.toContain('puedo');
  });

  it('reconhece as formas de log que a AT-080 nomeia', () => {
    expect(ehLinhaDeLog('ERROR connection refused')).toBe(true);
    expect(ehLinhaDeLog('exit code 1')).toBe(true);
    expect(ehLinhaDeLog('Traceback (most recent call last):')).toBe(true);
    expect(ehLinhaDeLog('o erro apareceu quando cliquei')).toBe(false);
  });
});

describe('pontuação contrastiva', () => {
  it('palavra compartilhada por pt e es (está, para, como, que) não pontua', () => {
    expect(pontuar(limpar('está para como que'), AT080)).toEqual({ pt: 0, es: 0, en: 0 });
    expect(pontuar(limpar('está para como que'), AMPLIADA)).toEqual({ pt: 0, es: 0, en: 0 });
  });

  it('um token pontua no máximo um ponto por língua ("não" está na lista E tem ã)', () => {
    expect(pontuar(limpar('não'), AT080).pt).toBe(1);
  });

  it('¿ e ¡ pontuam espanhol a cada ocorrência', () => {
    expect(pontuar(limpar('¿qué? ¡hola!'), AT080).es).toBe(4);
  });
});

describe('classificação', () => {
  it('abaixo da evidência mínima é indeterminado, nomeando o motivo', () => {
    const c = classificar('ok');
    expect(c.veredito).toBe('indeterminado');
    expect(c.motivo).toBe('evidencia-insuficiente');
  });

  it('decide pt, es e en em prosa longa', () => {
    expect(classificar('Não entendi por que o agente parou, então você pode ver isso também? Obrigado pela ajuda com a configuração.', AT080, SEM_MINIMO).veredito).toBe('pt');
    expect(classificar('¿Puedes revisar por qué falla la prueba? Gracias', AT080, SEM_MINIMO).veredito).toBe('es');
    expect(classificar('Can you check what is wrong with this test and the build?', AT080, SEM_MINIMO).veredito).toBe('en');
  });

  it('empate na liderança nunca decide', () => {
    const c = classificar('você the', AT080, { ...SEM_MINIMO, limiar: 0, margem: 0 });
    expect(c.veredito).toBe('indeterminado');
    expect(c.motivo).toBe('margem-insuficiente');
  });

  it('só código ou só log fica vazio e indeterminado', () => {
    expect(classificar('```\nthe and is you\n```', AT080, SEM_MINIMO).motivo).toBe('evidencia-insuficiente');
  });
});

describe('amostra e histerese', () => {
  const pt = 'Não sei se você viu, mas então isso também precisa de atenção na configuração da aplicação.';
  const es = '¿Puedes revisar la configuración? Gracias, ahora está muy bien, pero hola entonces.';

  it('uma mensagem em espanhol no meio de pt não troca o idioma confiável', () => {
    const passos = avaliarSequencia([pt, pt, es, pt], AT080, { ...PARAMETROS_AT080, minPalavras: 5 }, 'pt');
    expect(passos.every((p) => p.estado === 'pt')).toBe(true);
    expect(passos.some((p) => p.trocou)).toBe(false);
  });

  it('só troca depois de N avaliações seguidas concordando com o idioma novo', () => {
    const p = { ...PARAMETROS_AT080, minPalavras: 5, janelaMensagens: 1 };
    const passos = avaliarSequencia([pt, es, es, es], AT080, p, 'pt');
    expect(passos.map((x) => x.estado)).toEqual(['pt', 'pt', 'es', 'es']);
    expect(passos.filter((x) => x.trocou)).toHaveLength(1);
  });

  it('a amostra corta nas mensagens mais recentes pelo teto de caracteres', () => {
    const p = { ...PARAMETROS_AT080, minPalavras: 1, janelaCaracteres: 20, histerese: 1 };
    const passos = avaliarSequencia([pt, 'the and is you what this with'], AT080, p, null);
    expect(passos[1]!.classificacao.veredito).toBe('en');
  });
});
