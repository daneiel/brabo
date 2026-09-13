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

// --- Onde o comando executa (ADR 0072/0104) ---

/**
 * `container` é a pasta GERENCIADA pelo produto (o comportamento de
 * sempre); `mounted` (antigo `local`) é uma pasta DO USUÁRIO montada por
 * bind-mount; `runner` é uma pasta DO USUÁRIO sem bind-mount, confirmada
 * por um CLI (`brabo-runner`) rodando na máquina dela.
 *
 * Não confunda com o `GitProviderName` `'local'`, que é outra pergunta do
 * mesmo wizard: aquele diz onde o REPOSITÓRIO git vive, este diz onde o
 * COMANDO executa. As duas escolhas são ortogonais.
 */
export type ModoDeWorkspace = 'container' | 'mounted' | 'runner';

/**
 * O que a tela consegue julgar sozinha sobre o caminho, e só isso.
 *
 * O veredito que vale é o da API — para `mounted`, ela é a única que
 * enxerga o sistema de arquivos de dentro do container (RN-422); para
 * `runner`, a verificação de disco não acontece agora nenhuma, nem no
 * navegador nem na api (RN-423), só a forma. Esta função é a checagem
 * BARATA que evita mandar ao servidor o que já se sabe errado, e a
 * mensagem de recusa de verdade continua vindo do backend.
 */
export function caminhoLocalParecePlausivel(caminho: string): boolean {
  const limpo = caminho.trim();
  if (!limpo.startsWith('/')) return false;
  if (limpo === '/') return false;
  return !limpo.split('/').some((s) => s === '..' || s === '.');
}

/** Container avança sempre; mounted/runner só com um caminho plausível digitado. */
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

// --- A base dos projetos montados (ADR 0141/0142, RN-500/501, RN-513) ---

/**
 * Tira as barras finais SEM regex, igual a `semBarraFinal` do
 * `path-scope.ts` da api — `/base/` e `/base` são o MESMO lugar, e a base
 * chega da configuração do operador, que pode ter digitado a barra.
 *
 * Sem regex pelo mesmo motivo de lá: `\/+$` degrada em O(n²) numa string
 * cheia de barras (`js/polynomial-redos`). O laço é O(n) e equivalente.
 */
function semBarraFinal(caminho: string): string {
  let fim = caminho.length;
  while (fim > 0 && caminho[fim - 1] === '/') fim--;
  return caminho.slice(0, fim);
}

/**
 * O caminho SUGERIDO para um projeto `mounted`: `<base>/<slug>` (RN-501,
 * ADR 0142 — a validação de disco foi adiada JUSTAMENTE para que o
 * assistente pudesse propor uma pasta que ainda não existe).
 *
 * Devolve string VAZIA quando não há o que compor — base ausente, base
 * degenerada (`/`, `//`) ou slug vazio (o caso da adoção, onde o nome do
 * projeto vem do provider e o slug local nunca é preenchido). Vazio é a
 * resposta certa e não um erro: inventar um segmento seria a tela decidindo
 * o nome da pasta do usuário.
 *
 * A sugestão é só isso — o campo continua EDITÁVEL, e quem libera o passo
 * continua sendo `canAdvanceFromWorkspace`.
 */
export function caminhoSugeridoNaBase(
  base: string | null,
  slug: string,
): string {
  if (base === null) return '';
  const raiz = semBarraFinal(base.trim());
  const nome = slug.trim();
  if (raiz.length === 0 || nome.length === 0) return '';
  return `${raiz}/${nome}`;
}

/**
 * O caminho está DENTRO da base de projetos montados?
 *
 * Espelha `dentroDaBaseDeProjetos` da api (que é `dentroDoEscopo`, do escopo
 * de terminal do ADR 0055): comparação por SEGMENTO, nunca `startsWith` cru
 * — `/base-outra` **não** está dentro de `/base`, embora a string comece
 * igual. A própria base conta como dentro, como lá.
 *
 * Isto NÃO é a validação: quem recusa (400) é a api, em
 * `resolverWorkspacePath`. Aqui serve só para a tela dizer qual dos dois
 * estados o caminho digitado está — sob a base consentida, ou fora dela e
 * portanto recusado na criação (RN-500/501).
 *
 * Base ausente devolve `false`, e é a resposta correta à pergunta feita:
 * não existe pasta dentro de uma base que não existe. Quem precisa
 * distinguir "fora da base" de "não há base" pergunta pela base.
 */
export function caminhoDentroDaBase(
  caminho: string,
  base: string | null,
): boolean {
  if (base === null) return false;
  const raiz = semBarraFinal(base.trim());
  const alvo = semBarraFinal(caminho.trim());
  if (raiz.length === 0 || alvo.length === 0) return false;
  return alvo === raiz || alvo.startsWith(`${raiz}/`);
}
