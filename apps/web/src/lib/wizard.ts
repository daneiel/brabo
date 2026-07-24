import type { GitProviderName } from './api-types';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Só github/gitlab exigem um PAT do usuário pra provisionar; 'local' não
// precisa de credencial nenhuma. Type predicate pra estreitar o provider
// pra 'github' | 'gitlab' nos call sites.
export function providerNeedsCredential(
  provider: GitProviderName,
): provider is 'github' | 'gitlab' {
  return provider === 'github' || provider === 'gitlab';
}

// Gating do passo de credencial: local sempre avança; github/gitlab só
// avançam com uma credencial selecionada (existente ou recém-cadastrada).
export function canAdvanceFromCredential(
  provider: GitProviderName,
  selectedCredentialId: string | undefined,
): boolean {
  return !providerNeedsCredential(provider) || !!selectedCredentialId;
}
