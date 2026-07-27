import { describe, expect, it } from 'vitest';
import {
  CicloVazioError,
  classificar,
  explicarParInvalido,
  lerPar,
  lerTagDeEstagio,
  lerVersaoFinal,
  maiorImpacto,
  montarTag,
  parEhAdjacente,
  proximaVersao,
  proximoN,
  verificarAncora,
  type PrDoCiclo,
} from './version.ts';

function pr(numero: number, branch: string, titulo = 'algo'): PrDoCiclo {
  return { numero, branch, titulo };
}

// ------------------------------------------------------------- 1. leitura

describe('leitura de tag', () => {
  it('lê versão final e recusa pré-lançamento', () => {
    expect(lerVersaoFinal('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(lerVersaoFinal('v1.2.3-qa.4')).toBeNull();
    expect(lerVersaoFinal('release-1.2.3')).toBeNull();
  });

  it('lê tag de estágio e recusa final', () => {
    expect(lerTagDeEstagio('v0.2.0-qa.7')).toEqual({ versao: 'v0.2.0', estagio: 'qa', n: 7 });
    expect(lerTagDeEstagio('v0.2.0-dev.1')).toEqual({ versao: 'v0.2.0', estagio: 'dev', n: 1 });
    expect(lerTagDeEstagio('v0.2.0')).toBeNull();
    // `rc` saiu da escada: uma tag antiga não deve ser interpretada.
    expect(lerTagDeEstagio('v0.2.0-rc.1')).toBeNull();
  });
});

// ------------------------------------------------------- 2. impacto do ciclo

describe('impacto do ciclo', () => {
  it('a função da branch decide o impacto', () => {
    const c = classificar([pr(1, 'breaking/x'), pr(2, 'feature/y'), pr(3, 'docs/z')]);
    expect(c.map((x) => x.impacto)).toEqual(['major', 'minor', 'patch']);
  });

  it('função desconhecida é patch, nunca explode', () => {
    expect(classificar([pr(1, 'sei-la/x')])[0]!.impacto).toBe('patch');
    expect(classificar([pr(1, 'sem-barra')])[0]!.impacto).toBe('patch');
  });

  it('o MAIOR impacto manda', () => {
    const dez = [...Array(10)].map((_, i) => pr(i, 'docs/x'));
    expect(maiorImpacto(classificar(dez))).toBe('patch');
    expect(maiorImpacto(classificar([...dez, pr(99, 'breaking/x')]))).toBe('major');
    expect(maiorImpacto(classificar([...dez, pr(98, 'feature/x')]))).toBe('minor');
  });
});

// ---------------------------------------------------- 3. cenários do item 5

describe('ciclos', () => {
  it('ciclo só de bugfix sobe PATCH', () => {
    const v = proximaVersao('v0.1.0', [pr(1, 'bugfix/a'), pr(2, 'bugfix/b'), pr(3, 'chore/c')]);
    expect(v).toBe('v0.1.1');
  });

  it('ciclo com breaking sobe MAJOR e zera minor e patch', () => {
    expect(proximaVersao('v0.1.5', [pr(1, 'bugfix/a'), pr(2, 'breaking/b')])).toBe('v1.0.0');
    expect(proximaVersao('v2.7.3', [pr(1, 'breaking/b')])).toBe('v3.0.0');
  });

  it('ciclo com feature sobe MINOR e zera patch', () => {
    expect(proximaVersao('v0.1.5', [pr(1, 'feature/a'), pr(2, 'docs/b')])).toBe('v0.2.0');
  });

  it('CICLO VAZIO falha com mensagem, nunca gera tag', () => {
    expect(() => proximaVersao('v0.1.0', [])).toThrow(CicloVazioError);
    try {
      proximaVersao('v0.1.0', []);
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain('v0.1.0');
      // A mensagem tem que dizer POR QUE, não só recusar.
      expect(m).toContain('mesmo');
      expect(m).toContain('Mergeie ao menos um PR');
    }
  });

  it('primeiro ciclo do repositório, sem tag final anterior', () => {
    expect(proximaVersao(null, [pr(1, 'feature/a')])).toBe('v0.1.0');
    expect(proximaVersao(null, [pr(1, 'bugfix/a')])).toBe('v0.0.1');
  });

  it('DOIS CICLOS SEGUIDOS partem da final, não da anterior', () => {
    const primeira = proximaVersao('v0.1.0', [pr(1, 'feature/a')]);
    expect(primeira).toBe('v0.2.0');
    // Depois que v0.2.0 vira final, o ciclo seguinte parte dela.
    expect(proximaVersao(primeira, [pr(2, 'bugfix/b')])).toBe('v0.2.1');
    expect(proximaVersao(primeira, [pr(2, 'feature/b')])).toBe('v0.3.0');
  });
});

// ----------------------------------------------------------------- 4. o N

describe('o N do estágio', () => {
  it('primeira promoção da versão é N=1', () => {
    expect(proximoN(['v0.1.0'], 'v0.2.0', 'qa')).toBe(1);
    expect(proximoN([], 'v0.2.0', 'qa')).toBe(1);
  });

  it('REPROVAÇÃO + nova promoção gera -qa.2', () => {
    // A tag -qa.1 já existe: o ciclo foi promovido, reprovado e corrigido.
    // Ninguém anotou a reprovação em lugar nenhum — as tags são o contador.
    const tags = ['v0.1.0', 'v0.2.0-dev.1', 'v0.2.0-qa.1'];
    expect(proximoN(tags, 'v0.2.0', 'qa')).toBe(2);
    expect(montarTag('v0.2.0', 'qa', 2)).toBe('v0.2.0-qa.2');
  });

  it('conta pelo MAIOR N, não pela quantidade — tag apagada não reusa número', () => {
    expect(proximoN(['v0.2.0-qa.1', 'v0.2.0-qa.3'], 'v0.2.0', 'qa')).toBe(4);
  });

  it('N é por versão E por estágio, sem vazamento entre eles', () => {
    const tags = ['v0.2.0-dev.1', 'v0.2.0-dev.2', 'v0.2.0-qa.1', 'v0.3.0-qa.1'];
    expect(proximoN(tags, 'v0.2.0', 'dev')).toBe(3);
    expect(proximoN(tags, 'v0.2.0', 'qa')).toBe(2);
    expect(proximoN(tags, 'v0.3.0', 'qa')).toBe(2);
    // Versão nova começa do 1 mesmo com muita tag por perto.
    expect(proximoN(tags, 'v0.4.0', 'qa')).toBe(1);
  });
});

// ------------------------------------------------------------- 5. a âncora

describe('âncora da tag final', () => {
  const tags = ['v0.1.0', 'v0.2.0-dev.1', 'v0.2.0-qa.1', 'v0.2.0-qa.2'];
  const shas = {
    'v0.1.0': 'aaaa1111',
    'v0.2.0-dev.1': 'bbbb2222',
    'v0.2.0-qa.1': 'cccc3333',
    'v0.2.0-qa.2': 'dddd4444',
  };

  it('aprova quando o commit é o da ÚLTIMA -qa.N (fast-forward)', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'dddd4444');
    expect(r.ok).toBe(true);
    expect(r.tagEsperada).toBe('v0.2.0-qa.2');
  });

  // O caso NORMAL: promoção é `--no-ff`, então o sha de main nunca é o de qa.
  const contexto = {
    treeDoCommit: 'tree-igual',
    treePorTag: { 'v0.2.0-qa.2': 'tree-igual', 'v0.2.0-qa.1': 'tree-antiga' },
    paisDoCommit: ['mainvelha', 'dddd4444'],
  };

  it('aprova MERGE COMMIT: a -qa.N é pai e a árvore é idêntica', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'merge999', contexto);
    expect(r.ok).toBe(true);
    expect(r.tagEsperada).toBe('v0.2.0-qa.2');
  });

  it('REPROVA merge cuja árvore difere — o outro lado trouxe conteúdo', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'merge999', {
      ...contexto,
      treeDoCommit: 'tree-diferente',
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('árvore');
    expect(r.motivo).toContain('NÃO é o que passou');
  });

  it('REPROVA merge em que a -qa.N não é pai — entrou algo no meio', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'merge999', {
      ...contexto,
      paisDoCommit: ['mainvelha', 'outracoisa'],
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('NÃO é pai');
  });

  it('sem contexto, sha diferente reprova dizendo que faltou a árvore', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'merge999');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('não recebi a árvore');
  });

  it('REPROVA commit divergente sem contexto, dizendo os dois shas', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'eeee5555');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('eeee5555');
    expect(r.motivo).toContain('dddd4444');
  });

  it('REPROVA o commit de uma -qa ANTERIOR — vale a última, não qualquer uma', () => {
    const r = verificarAncora('v0.2.0', tags, shas, 'cccc3333');
    expect(r.ok).toBe(false);
    expect(r.tagEsperada).toBe('v0.2.0-qa.2');
  });

  it('REPROVA quando não há nenhuma -qa daquela versão', () => {
    const r = verificarAncora('v0.9.0', tags, shas, 'dddd4444');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('v0.9.0-qa.N');
  });

  it('REPROVA quando a tag não resolve — verificação impossível não é aprovação', () => {
    const r = verificarAncora('v0.2.0', tags, { ...shas, 'v0.2.0-qa.2': undefined as never }, 'x');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('impossível');
  });
});

// ------------------------------------------------------------ 6. o par

describe('par da esteira', () => {
  it('aceita as duas promoções adjacentes', () => {
    for (const entrada of ['dev->qa', 'dev → qa', 'dev:qa']) {
      const p = lerPar(entrada)!;
      expect(p).toEqual({ de: 'dev', para: 'qa' });
      expect(parEhAdjacente(p)).toBe(true);
    }
    expect(parEhAdjacente(lerPar('qa->main')!)).toBe(true);
  });

  it('REJEITA dev→main por pular qa, e ensina o caminho', () => {
    const p = lerPar('dev->main')!;
    expect(parEhAdjacente(p)).toBe(false);
    const m = explicarParInvalido(p);
    expect(m).toContain('pula');
    expect(m).toContain('`qa`');
    expect(m).toContain('etapas');
  });

  it('rejeita descida e diz que isso é retropropagação', () => {
    const p = lerPar('main->qa')!;
    expect(parEhAdjacente(p)).toBe(false);
    expect(explicarParInvalido(p)).toContain('retropropagação');
  });

  it('rejeita par igual e branch que não é permanente', () => {
    expect(parEhAdjacente(lerPar('dev->dev')!)).toBe(false);
    expect(explicarParInvalido(lerPar('dev->dev')!)).toContain('mesma branch');
    expect(lerPar('feature/x->dev')).toBeNull();
    expect(lerPar('dev->rc')).toBeNull();
    expect(lerPar('lixo')).toBeNull();
  });
});

// --------------------------------------------------- 7. a esteira inteira

describe('a esteira, de ponta a ponta', () => {
  it('reproduz o ciclo do critério de aceite', () => {
    // Estado inicial: só a final v0.1.0.
    let tags = ['v0.1.0'];

    // Ciclo com uma feature → v0.2.0.
    const versao = proximaVersao('v0.1.0', [pr(1, 'feature/a'), pr(2, 'docs/b')]);
    expect(versao).toBe('v0.2.0');

    // Merge em dev.
    const devTag = montarTag(versao, 'dev', proximoN(tags, versao, 'dev'));
    expect(devTag).toBe('v0.2.0-dev.1');
    tags = [...tags, devTag];

    // Promoção dev→qa.
    const qa1 = montarTag(versao, 'qa', proximoN(tags, versao, 'qa'));
    expect(qa1).toBe('v0.2.0-qa.1');
    tags = [...tags, qa1];

    // REPROVAÇÃO: corrige, mergeia em dev de novo, repromove.
    const qa2 = montarTag(versao, 'qa', proximoN(tags, versao, 'qa'));
    expect(qa2).toBe('v0.2.0-qa.2');
    tags = [...tags, qa2];

    // Promoção qa→main: a final ancora em qa.2, não em qa.1.
    const shas = { 'v0.2.0-qa.1': 'aaa', 'v0.2.0-qa.2': 'bbb' };
    expect(verificarAncora(versao, tags, shas, 'bbb').ok).toBe(true);
    expect(verificarAncora(versao, tags, shas, 'aaa').ok).toBe(false);
  });
});
