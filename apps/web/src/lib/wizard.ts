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

// --- Onde o código mora (ADR 0072) ---

/**
 * `container` é a pasta GERENCIADA pelo produto (o comportamento de sempre);
 * `local` é uma pasta DO USUÁRIO, de caminho livre.
 *
 * Não confunda com o `GitProviderName` `'local'`, que é outra pergunta do
 * mesmo wizard: aquele diz onde o REPOSITÓRIO git vive, este diz onde o
 * CÓDIGO em disco vive. As duas escolhas são ortogonais.
 */
export type ModoDeWorkspace = 'container' | 'local';

/**
 * O que a tela consegue julgar sozinha sobre o caminho, e só isso.
 *
 * O veredito que vale é o da API, que é a única que enxerga o sistema de
 * arquivos de dentro do container (RN-170) — o navegador não tem como saber
 * se `/home/voce/projetos/loja` existe lá dentro. Esta função é a checagem
 * BARATA que evita mandar ao servidor o que já se sabe errado, e a mensagem
 * de recusa de verdade continua vindo do backend.
 */
export function caminhoLocalParecePlausivel(caminho: string): boolean {
  const limpo = caminho.trim();
  if (!limpo.startsWith('/')) return false;
  if (limpo === '/') return false;
  return !limpo.split('/').some((s) => s === '..' || s === '.');
}

/** Container avança sempre; Local só com um caminho plausível digitado. */
export function canAdvanceFromWorkspace(
  modo: ModoDeWorkspace | undefined,
  caminho: string,
): boolean {
  if (modo === undefined) return false;
  return modo === 'container' || caminhoLocalParecePlausivel(caminho);
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
