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

// --- Adoção (Fase 12a) ---

/**
 * `create` cria um repositório novo; `adopt` aponta o projeto para um que
 * já existe. É a primeira pergunta do wizard porque muda o resto do
 * fluxo: adotar pede o identificador do repositório em vez de nome e
 * visibilidade, e termina numa tela de PLANO em vez de no progresso.
 */
export type ModoDeRepositorio = 'create' | 'adopt';

/** O modo é uma escolha binária sem default — nenhuma das duas é "a normal". */
export function canAdvanceFromMode(
  modo: ModoDeRepositorio | undefined,
): boolean {
  return modo !== undefined;
}

/**
 * Na adoção, o identificador é obrigatório e é a única entrada — o nome
 * e a visibilidade vêm do provider, não do usuário.
 */
export function canAdvanceFromDetails(
  modo: ModoDeRepositorio,
  campos: { name: string; externalId: string },
): boolean {
  return modo === 'adopt'
    ? campos.externalId.trim().length > 0
    : campos.name.trim().length > 0;
}
