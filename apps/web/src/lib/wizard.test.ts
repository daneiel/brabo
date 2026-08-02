import { describe, expect, it } from 'vitest';
import {
  canAdvanceFromCredential,
  canAdvanceFromDetails,
  canAdvanceFromMode,
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
