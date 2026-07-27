import { describe, expect, it } from 'vitest';
import {
  aprovadoresValidos,
  avaliarEscada,
  emparelhar,
  formatarEscada,
  type EntradaEscada,
  type Review,
} from './approval-ladder.ts';

const SHA = 'abc123';
const SHA_ANTIGO = 'velho99';
const OWNER = 'daneiel';

function aprovou(autor: string, commitId = SHA): Review {
  return { autor, estado: 'APPROVED', commitId };
}

function solo(over: Partial<EntradaEscada> = {}): EntradaEscada {
  return {
    modo: 'solo',
    destino: 'dev',
    autorDoPr: 'contribuidor',
    shaDoUltimoCommit: SHA,
    reviews: [],
    owner: OWNER,
    ...over,
  };
}

/** Time de exemplo do modo community, com papéis SEM sobreposição. */
const TIMES = {
  devs: ['ana', 'bruno', 'carla'],
  po: ['paula'],
  gestao: ['gustavo'],
};

function community(over: Partial<EntradaEscada> = {}): EntradaEscada {
  return {
    modo: 'community',
    destino: 'dev',
    autorDoPr: 'contribuidor',
    shaDoUltimoCommit: SHA,
    reviews: [],
    aprovadores: TIMES,
    ...over,
  };
}

// ------------------------------------------------------------- 1. modo solo

describe('modo solo', () => {
  it('PR de terceiro SEM aprovação fica vermelho, dizendo de quem se espera', () => {
    const v = avaliarEscada(solo());
    expect(v.ok).toBe(false);
    expect(v.faltando.join(' ')).toContain('aguardando aprovação do owner');
    expect(v.faltando.join(' ')).toContain(OWNER);
  });

  it('PR de terceiro COM aprovação do owner fica verde', () => {
    const v = avaliarEscada(solo({ reviews: [aprovou(OWNER)] }));
    expect(v.ok).toBe(true);
    expect(v.preenchidas.map((p) => p.quem)).toEqual([OWNER]);
  });

  it('PR do próprio owner passa SEM review', () => {
    // O GitHub não deixa ninguém aprovar o próprio PR; exigir isso produziria
    // um check eternamente vermelho.
    const v = avaliarEscada(solo({ autorDoPr: OWNER }));
    expect(v.ok).toBe(true);
    expect(v.dispensadoPorAutoria).toBe(true);
    expect(v.preenchidas).toHaveLength(0);
    expect(formatarEscada(solo({ autorDoPr: OWNER }), v)).toContain('merge manual');
  });

  it('aprovação de quem NÃO é o owner não basta', () => {
    const v = avaliarEscada(solo({ reviews: [aprovou('ana'), aprovou('bruno')] }));
    expect(v.ok).toBe(false);
    expect(v.aprovadoresSemVaga).toEqual(['ana', 'bruno']);
  });

  it('registra que a exigência de pessoas distintas está suspensa', () => {
    expect(avaliarEscada(solo()).avisos.join(' ')).toContain('SUSPENSA');
  });

  it('sem OWNER_HANDLE definido, reprova dizendo qual variável falta', () => {
    const v = avaliarEscada(solo({ owner: undefined }));
    expect(v.ok).toBe(false);
    expect(v.faltando.join(' ')).toContain('OWNER_HANDLE');
  });

  it('vale para qualquer degrau — solo não escala por destino', () => {
    for (const destino of ['dev', 'qa', 'main']) {
      expect(avaliarEscada(solo({ destino, reviews: [aprovou(OWNER)] })).ok).toBe(true);
      expect(avaliarEscada(solo({ destino })).ok).toBe(false);
    }
  });
});

// -------------------------------------------------------- 2. modo community

describe('modo community — os quatro degraus', () => {
  it('dev exige 1 dev', () => {
    expect(avaliarEscada(community({ destino: 'dev' })).ok).toBe(false);
    expect(avaliarEscada(community({ destino: 'dev', reviews: [aprovou('ana')] })).ok).toBe(true);
  });

  it('qa exige 2 devs — um só não basta', () => {
    const um = avaliarEscada(community({ destino: 'qa', reviews: [aprovou('ana')] }));
    expect(um.ok).toBe(false);
    expect(um.faltando.join(' ')).toContain('1 de 2');

    const dois = avaliarEscada(
      community({ destino: 'qa', reviews: [aprovou('ana'), aprovou('bruno')] }),
    );
    expect(dois.ok).toBe(true);
  });

  it('main exige 1 po + 1 gestao — dois devs não servem', () => {
    expect(
      avaliarEscada(
        community({ destino: 'main', reviews: [aprovou('ana'), aprovou('bruno')] }),
      ).ok,
    ).toBe(false);

    const v = avaliarEscada(
      community({ destino: 'main', reviews: [aprovou('paula'), aprovou('gustavo')] }),
    );
    expect(v.ok).toBe(true);
  });

  it('reprova quando a lista de um papel exigido está vazia', () => {
    const v = avaliarEscada(
      community({
        destino: 'main',
        aprovadores: { ...TIMES, po: [] },
        reviews: [aprovou('gustavo')],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.faltando.join(' ')).toContain('APROVADORES_PO');
  });
});

// ------------------------------------------------- 3. sobreposição de papéis

describe('pessoas distintas em main', () => {
  // `paula` acumula po E gestao. Contar por papel isoladamente aprovaria o PR
  // com UMA aprovação só — que é exatamente o que a regra impede.
  const ACUMULA = { ...TIMES, po: ['paula'], gestao: ['paula', 'gustavo'] };

  it('quem acumula po e gestao NÃO preenche as duas vagas sozinho', () => {
    const v = avaliarEscada(
      community({ destino: 'main', aprovadores: ACUMULA, reviews: [aprovou('paula')] }),
    );
    expect(v.ok).toBe(false);
    expect(v.preenchidas).toHaveLength(1);
    expect(v.faltando.join(' ')).toContain('DIFERENTE');
  });

  it('com uma segunda pessoa, fecha', () => {
    const v = avaliarEscada(
      community({
        destino: 'main',
        aprovadores: ACUMULA,
        reviews: [aprovou('paula'), aprovou('gustavo')],
      }),
    );
    expect(v.ok).toBe(true);
    expect(new Set(v.preenchidas.map((p) => p.quem)).size).toBe(2);
  });

  it('o emparelhamento acha a atribuição certa mesmo quando a gulosa erraria', () => {
    // `paula` é a ÚNICA de po, mas também está em gestao. Uma atribuição
    // gulosa que desse a vaga de gestao a ela deixaria po descoberta.
    const atribuicao = emparelhar(
      ['gestao', 'po'],
      ['paula', 'gustavo'],
      (pessoa, papel) =>
        papel === 'gestao' ? ['paula', 'gustavo'].includes(pessoa) : pessoa === 'paula',
    );
    expect(atribuicao).toHaveLength(2);
    expect(atribuicao.find((v) => v.papel === 'po')!.quem).toBe('paula');
    expect(atribuicao.find((v) => v.papel === 'gestao')!.quem).toBe('gustavo');
  });
});

// --------------------------------------------------- 4. reviews que contam

describe('reviews que contam', () => {
  it('review em commit ANTIGO não conta — push novo invalida', () => {
    const v = avaliarEscada(solo({ reviews: [aprovou(OWNER, SHA_ANTIGO)] }));
    expect(v.ok).toBe(false);
  });

  it('o autor nunca conta como aprovador de si mesmo', () => {
    const v = avaliarEscada(
      community({ destino: 'dev', autorDoPr: 'ana', reviews: [aprovou('ana')] }),
    );
    expect(v.ok).toBe(false);
    expect(aprovadoresValidos({ ...community(), autorDoPr: 'ana', reviews: [aprovou('ana')] }))
      .toHaveLength(0);
  });

  it('CHANGES_REQUESTED depois de APPROVED derruba a aprovação', () => {
    const v = avaliarEscada(
      solo({
        reviews: [
          aprovou(OWNER),
          { autor: OWNER, estado: 'CHANGES_REQUESTED', commitId: SHA },
        ],
      }),
    );
    expect(v.ok).toBe(false);
  });

  it('COMMENTED depois de APPROVED NÃO derruba — comentar não é desaprovar', () => {
    const v = avaliarEscada(
      solo({
        reviews: [aprovou(OWNER), { autor: OWNER, estado: 'COMMENTED', commitId: SHA }],
      }),
    );
    expect(v.ok).toBe(true);
  });

  it('APPROVED depois de CHANGES_REQUESTED conta — vale o último estado', () => {
    const v = avaliarEscada(
      solo({
        reviews: [
          { autor: OWNER, estado: 'CHANGES_REQUESTED', commitId: SHA },
          aprovou(OWNER),
        ],
      }),
    );
    expect(v.ok).toBe(true);
  });

  it('a mesma pessoa aprovando duas vezes conta como UMA', () => {
    const v = avaliarEscada(
      community({ destino: 'qa', reviews: [aprovou('ana'), aprovou('ana')] }),
    );
    expect(v.ok).toBe(false);
  });
});

// ------------------------------------------------------- 5. troca de modo

describe('troca de modo é só configuração', () => {
  it('a MESMA entrada dá vereditos diferentes em solo e community', () => {
    const reviews = [aprovou('ana')];
    const comum = {
      destino: 'qa',
      autorDoPr: 'contribuidor',
      shaDoUltimoCommit: SHA,
      reviews,
      owner: OWNER,
      aprovadores: TIMES,
    };

    // Em solo, `ana` não é o owner: reprovado.
    const emSolo = avaliarEscada({ ...comum, modo: 'solo' });
    expect(emSolo.ok).toBe(false);
    expect(emSolo.faltando.join(' ')).toContain(OWNER);

    // Em community, `ana` é dev — mas `qa` exige DOIS devs.
    const emCommunity = avaliarEscada({ ...comum, modo: 'community' });
    expect(emCommunity.ok).toBe(false);
    expect(emCommunity.faltando.join(' ')).toContain('devs');

    // Nada além do campo `modo` mudou entre as duas chamadas.
    expect(emSolo.modo).toBe('solo');
    expect(emCommunity.modo).toBe('community');
  });

  it('o mesmo PR que passa em solo pode não passar em community', () => {
    const comum = {
      destino: 'main',
      autorDoPr: 'contribuidor',
      shaDoUltimoCommit: SHA,
      reviews: [aprovou(OWNER)],
      owner: OWNER,
      aprovadores: TIMES,
    };
    expect(avaliarEscada({ ...comum, modo: 'solo' }).ok).toBe(true);
    // O owner não está em nenhuma lista de papel — em community, não basta.
    expect(avaliarEscada({ ...comum, modo: 'community' }).ok).toBe(false);
  });
});

// ------------------------------------------------------------- 6. o resumo

describe('resumo legível', () => {
  it('mostra o modo ativo, quem aprovou em qual papel e o que falta', () => {
    const entrada = community({
      destino: 'main',
      reviews: [aprovou('paula')],
    });
    const texto = formatarEscada(entrada, avaliarEscada(entrada));

    expect(texto).toContain('modo: community');
    expect(texto).toContain('paula');
    expect(texto).toContain('po');
    expect(texto).toContain('AGUARDANDO APROVAÇÃO');
    expect(texto).toContain('gestao');
  });

  it('lista quem aprovou sem preencher vaga, em vez de ignorar', () => {
    const entrada = community({ destino: 'main', reviews: [aprovou('ana')] });
    const texto = formatarEscada(entrada, avaliarEscada(entrada));
    expect(texto).toContain('não preenchem vaga');
    expect(texto).toContain('ana');
  });

  it('destino que não é permanente reprova com mensagem própria', () => {
    const v = avaliarEscada(solo({ destino: 'feature/x' }));
    expect(v.ok).toBe(false);
    expect(v.faltando.join(' ')).toContain('não é uma branch permanente');
  });
});
