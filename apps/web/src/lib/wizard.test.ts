import { describe, expect, it } from 'vitest';
import {
  caminhoDentroDaBase,
  caminhoLocalParecePlausivel,
  caminhoSugeridoNaBase,
  canAdvanceFromCredential,
  canAdvanceFromDetails,
  canAdvanceFromMode,
  canAdvanceFromWorkspace,
  providerNeedsCredential,
  slugify,
} from './wizard';

describe('providerNeedsCredential', () => {
  it('github/gitlab exigem credencial; local não', () => {
    expect(providerNeedsCredential('github')).toBe(true);
    expect(providerNeedsCredential('gitlab')).toBe(true);
    expect(providerNeedsCredential('local')).toBe(false);
  });
});

describe('canAdvanceFromCredential', () => {
  it('local sempre avança, mesmo sem credencial', () => {
    expect(canAdvanceFromCredential('local', undefined)).toBe(true);
  });

  it('github sem credencial selecionada NÃO avança', () => {
    expect(canAdvanceFromCredential('github', undefined)).toBe(false);
  });

  it('github com credencial selecionada avança', () => {
    expect(canAdvanceFromCredential('github', 'cred-1')).toBe(true);
  });

  it('gitlab sem credencial NÃO avança', () => {
    expect(canAdvanceFromCredential('gitlab', undefined)).toBe(false);
  });
});

describe('slugify', () => {
  it('normaliza nome pra kebab-case sem acento', () => {
    expect(slugify('Loja Online')).toBe('loja-online');
    expect(slugify('  Coração  ')).toBe('coracao');
  });
});

describe('canAdvanceFromMode', () => {
  it('sem modo escolhido não avança — nenhuma das duas opções é o default', () => {
    expect(canAdvanceFromMode(undefined)).toBe(false);
  });

  it('qualquer um dos dois modos avança', () => {
    expect(canAdvanceFromMode('create')).toBe(true);
    expect(canAdvanceFromMode('adopt')).toBe(true);
  });
});

/**
 * A checagem BARATA do caminho Local (ADR 0072).
 *
 * O veredito que vale é o da api, que enxerga o sistema de arquivos de dentro
 * do container (RN-170). Isto aqui só evita a viagem ao servidor para o que já
 * se sabe errado — e é por isso que os casos abaixo são todos LÉXICOS.
 */
describe('caminhoLocalParecePlausivel', () => {
  it('caminho absoluto de pasta passa', () => {
    expect(caminhoLocalParecePlausivel('/home/voce/projetos/loja')).toBe(true);
    expect(caminhoLocalParecePlausivel('  /home/voce/loja  ')).toBe(true);
  });

  it.each([
    ['projetos/loja', 'relativo: dependeria do cwd de quem resolve'],
    ['/', 'a raiz do sistema'],
    ['/home/voce/../../etc', '`..` no meio: o caminho gravado não é o que se lê'],
    ['', 'vazio'],
  ])('recusa %j — %s', (caminho) => {
    expect(caminhoLocalParecePlausivel(caminho)).toBe(false);
  });
});

describe('canAdvanceFromWorkspace', () => {
  it('Container avança sem digitar nada — é o modo de sempre', () => {
    expect(canAdvanceFromWorkspace('container', '')).toBe(true);
  });

  it('Pasta montada só avança com caminho plausível', () => {
    expect(canAdvanceFromWorkspace('mounted', '')).toBe(false);
    expect(canAdvanceFromWorkspace('mounted', 'projetos/loja')).toBe(false);
    expect(canAdvanceFromWorkspace('mounted', '/home/voce/loja')).toBe(true);
  });

  // RN-423 (ADR 0104): `runner` usa o MESMO predicado léxico de `mounted` —
  // a diferença entre os dois é QUEM/QUANDO verifica o disco, não o que
  // conta como caminho plausível.
  it('Runner só avança com caminho plausível', () => {
    expect(canAdvanceFromWorkspace('runner', '')).toBe(false);
    expect(canAdvanceFromWorkspace('runner', 'projetos/loja')).toBe(false);
    expect(canAdvanceFromWorkspace('runner', '/home/voce/loja')).toBe(true);
  });
});

describe('canAdvanceFromDetails', () => {
  it('criar exige nome; o identificador é irrelevante', () => {
    expect(
      canAdvanceFromDetails('create', { name: 'checkout', externalId: '' }),
    ).toBe(true);
    expect(
      canAdvanceFromDetails('create', { name: '  ', externalId: 'acme/x' }),
    ).toBe(false);
  });

  it('adotar exige o identificador; o nome vem do provider', () => {
    expect(
      canAdvanceFromDetails('adopt', { name: '', externalId: 'acme/checkout' }),
    ).toBe(true);
    expect(
      canAdvanceFromDetails('adopt', { name: 'checkout', externalId: '  ' }),
    ).toBe(false);
  });
});

/**
 * A sugestão `<base>/<slug>` (RN-501/RN-513, ADR 0142/0146 ponto 4).
 *
 * Ela existe porque a validação de disco foi ADIADA: o assistente pode
 * propor uma pasta que ainda não existe, e a Infra a cria quando sobe o
 * container.
 */
describe('caminhoSugeridoNaBase', () => {
  it('compõe <base>/<slug>', () => {
    expect(caminhoSugeridoNaBase('/home/voce/projetos-brabo', 'loja')).toBe(
      '/home/voce/projetos-brabo/loja',
    );
  });

  it('barra final na base não vira barra dupla', () => {
    expect(caminhoSugeridoNaBase('/home/voce/projetos-brabo/', 'loja')).toBe(
      '/home/voce/projetos-brabo/loja',
    );
    expect(caminhoSugeridoNaBase('/home/voce/projetos-brabo///', 'loja')).toBe(
      '/home/voce/projetos-brabo/loja',
    );
  });

  it('sem base não há o que sugerir — vazio, nunca um caminho inventado', () => {
    expect(caminhoSugeridoNaBase(null, 'loja')).toBe('');
    expect(caminhoSugeridoNaBase('', 'loja')).toBe('');
    expect(caminhoSugeridoNaBase('   ', 'loja')).toBe('');
    // Base degenerada: `/` sem barra final é string vazia, e `//loja` não é
    // caminho que alguém tenha querido.
    expect(caminhoSugeridoNaBase('/', 'loja')).toBe('');
  });

  it('slug vazio deixa o campo vazio — a tela não nomeia a pasta do usuário', () => {
    expect(caminhoSugeridoNaBase('/home/voce/projetos-brabo', '')).toBe('');
    expect(caminhoSugeridoNaBase('/home/voce/projetos-brabo', '  ')).toBe('');
  });
});

/**
 * "Está dentro da base?" por SEGMENTO, nunca por prefixo de string — a mesma
 * armadilha que `dentroDoEscopo` (ADR 0055) resolve na api.
 */
describe('caminhoDentroDaBase', () => {
  const base = '/base';

  it('a base e tudo abaixo dela estão dentro', () => {
    expect(caminhoDentroDaBase('/base', base)).toBe(true);
    expect(caminhoDentroDaBase('/base/loja', base)).toBe(true);
    expect(caminhoDentroDaBase('/base/loja/', base)).toBe(true);
    expect(caminhoDentroDaBase('/base/a/b/c', base)).toBe(true);
  });

  it('/base-outra NÃO está dentro de /base, embora a string comece igual', () => {
    expect(caminhoDentroDaBase('/base-outra', base)).toBe(false);
    expect(caminhoDentroDaBase('/base-outra/loja', base)).toBe(false);
    expect(caminhoDentroDaBase('/basex', base)).toBe(false);
  });

  it('fora da base é fora', () => {
    expect(caminhoDentroDaBase('/tmp/loja', base)).toBe(false);
    expect(caminhoDentroDaBase('/', base)).toBe(false);
  });

  it('barra final na base não muda o veredito', () => {
    expect(caminhoDentroDaBase('/base/loja', '/base/')).toBe(true);
    expect(caminhoDentroDaBase('/base-outra', '/base/')).toBe(false);
  });

  it('sem base nada está dentro — não existe pasta dentro de base que não existe', () => {
    expect(caminhoDentroDaBase('/base/loja', null)).toBe(false);
    expect(caminhoDentroDaBase('/base/loja', '')).toBe(false);
  });

  it('caminho vazio não está dentro de base nenhuma', () => {
    expect(caminhoDentroDaBase('', base)).toBe(false);
    expect(caminhoDentroDaBase('   ', base)).toBe(false);
  });
});
