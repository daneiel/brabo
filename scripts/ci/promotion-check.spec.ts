import { describe, expect, it } from 'vitest';
import { esperarCarimbo, estagioExigido, tagsDoCommit } from './promotion-check.ts';

/**
 * O `promotion-check` é **check required** no PR de promoção, e era o único da
 * família sem spec própria — `pr-police`, `approval-ladder` e `gate` têm.
 *
 * O que ele guarda: um commit só sobe um degrau se **já foi carimbado no degrau
 * de baixo**. Sem isso, `main` receberia código que nunca passou por `dev`, e a
 * escada existiria só no desenho.
 *
 * Os testes abaixo afirmam a REGRA, não a implementação: dizem qual carimbo é
 * exigido para cada destino e o que conta como carimbo daquele commit.
 */

describe('estagioExigido — que carimbo o destino cobra', () => {
  it('subir para `main` cobra o carimbo de `dev`', () => {
    expect(estagioExigido('main')).toBe('dev');
  });

  it('`dev` não cobra carimbo nenhum — é o primeiro degrau', () => {
    // Não há degrau abaixo de `dev`; exigir carimbo aqui tornaria impossível
    // a primeira promoção de qualquer código.
    expect(estagioExigido('dev')).toBeNull();
  });
});

describe('tagsDoCommit — o que conta como carimbo DAQUELE commit', () => {
  const sha = 'abc123';
  const outro = 'def456';

  it('a tag do estágio apontando para o commit conta', () => {
    const tags = tagsDoCommit(
      ['v1.2.0-dev.1'],
      { 'v1.2.0-dev.1': sha },
      sha,
      'dev',
    );

    expect(tags).toEqual(['v1.2.0-dev.1']);
  });

  it('tag do estágio apontando para OUTRO commit não conta', () => {
    // O ponto do check: o carimbo tem de ser deste commit. Aceitar qualquer
    // tag do estágio deixaria passar código que nunca foi promovido.
    const tags = tagsDoCommit(
      ['v1.2.0-dev.1'],
      { 'v1.2.0-dev.1': outro },
      sha,
      'dev',
    );

    expect(tags).toEqual([]);
  });

  it('tag de OUTRO estágio não conta, mesmo apontando para o commit', () => {
    // Um carimbo de `dev` não autoriza subir para `main` com uma tag `-qa.N` histórica.
    const tags = tagsDoCommit(
      ['v1.2.0-dev.1'],
      { 'v1.2.0-dev.1': sha },
      sha,
      'qa',
    );

    expect(tags).toEqual([]);
  });

  it('tag que não é de estágio é ignorada sem quebrar', () => {
    // Tags de release (`v1.2.0`) e qualquer coisa que alguém empurre à mão
    // convivem no repositório; o parser devolve `null` e a linha some.
    const tags = tagsDoCommit(
      ['v1.2.0', 'nao-e-tag-de-versao', 'v1.2.0-dev.1'],
      { 'v1.2.0': sha, 'nao-e-tag-de-versao': sha, 'v1.2.0-dev.1': sha },
      sha,
      'dev',
    );

    expect(tags).toEqual(['v1.2.0-dev.1']);
  });

  it('devolve TODAS as tags do estágio que apontam para o commit', () => {
    // Repromoção do mesmo commit gera `dev.2`, `dev.3`… e todas são carimbo
    // válido: o check pergunta "existe carimbo?", não "existe exatamente um".
    const tags = tagsDoCommit(
      ['v1.2.0-dev.1', 'v1.2.0-dev.2'],
      { 'v1.2.0-dev.1': sha, 'v1.2.0-dev.2': sha },
      sha,
      'dev',
    );

    expect(tags).toEqual(['v1.2.0-dev.1', 'v1.2.0-dev.2']);
  });

  it('sem tag nenhuma, não há carimbo', () => {
    expect(tagsDoCommit([], {}, sha, 'dev')).toEqual([]);
  });

  it('tag do estágio sem sha conhecido não conta', () => {
    // `shaPorTag` vem de um `git show-ref`; uma tag que não resolveu não pode
    // virar carimbo por omissão.
    expect(
      tagsDoCommit(['v1.2.0-dev.1'], {}, sha, 'dev'),
    ).toEqual([]);
  });
});

describe('esperarCarimbo (AT-663)', () => {
  const relogio = () => {
    let t = 0;
    return { agora: () => t, dormir: async (ms: number) => void (t += ms) };
  };

  it('espera o tag-release em andamento e aprova quando a tag aparece', async () => {
    const r = relogio();
    let buscas = 0;
    const res = await esperarCarimbo({
      procurar: () => (++buscas >= 3 ? ['v7.1.0-dev.287'] : []),
      tagReleaseEmAndamento: () => true,
      ...r,
      prazoMs: 600_000,
      intervaloMs: 20_000,
    });
    expect(res).toEqual({ tags: ['v7.1.0-dev.287'], motivo: 'achou' });
    expect(r.agora()).toBe(40_000);
  });

  it('sem tag-release rodando, responde na hora (não espera)', async () => {
    const r = relogio();
    const res = await esperarCarimbo({
      procurar: () => [],
      tagReleaseEmAndamento: () => false,
      ...r,
      prazoMs: 600_000,
      intervaloMs: 20_000,
    });
    expect(res.motivo).toBe('sem-tag-release');
    expect(r.agora()).toBe(0);
  });

  it('desiste no prazo e reprova, nunca aprova sem tag', async () => {
    const r = relogio();
    const res = await esperarCarimbo({
      procurar: () => [],
      tagReleaseEmAndamento: () => true,
      ...r,
      prazoMs: 60_000,
      intervaloMs: 20_000,
    });
    expect(res).toEqual({ tags: [], motivo: 'prazo' });
  });

  it('o run terminou entre a busca e a pergunta: a última olhada acha a tag', async () => {
    const r = relogio();
    let buscas = 0;
    const res = await esperarCarimbo({
      procurar: () => (++buscas >= 2 ? ['v7.1.0-dev.1'] : []),
      tagReleaseEmAndamento: () => false,
      ...r,
      prazoMs: 600_000,
      intervaloMs: 20_000,
    });
    expect(res.motivo).toBe('achou');
  });
});
