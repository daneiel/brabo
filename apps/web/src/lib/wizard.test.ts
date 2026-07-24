import { describe, expect, it } from 'vitest';
import {
  canAdvanceFromCredential,
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
