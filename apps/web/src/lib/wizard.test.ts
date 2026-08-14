import { describe, expect, it } from 'vitest';
import {
  caminhoLocalParecePlausivel,
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

  it('Local só avança com caminho plausível', () => {
    expect(canAdvanceFromWorkspace('local', '')).toBe(false);
    expect(canAdvanceFromWorkspace('local', 'projetos/loja')).toBe(false);
    expect(canAdvanceFromWorkspace('local', '/home/voce/loja')).toBe(true);
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
