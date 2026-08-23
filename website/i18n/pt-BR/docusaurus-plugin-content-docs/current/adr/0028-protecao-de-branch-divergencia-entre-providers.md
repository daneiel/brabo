# 0028 — Proteção de branch: divergência entre providers e a matriz de aprovação

## Contexto

O [ADR 0001](0001-git-provider-contract-shape.md) normalizou nove operações de
git num contrato único. Oito delas divergem entre GitHub e GitLab apenas na
FORMA da API — nome de campo, formato de id, código de erro — e a normalização
resolve. `protectBranch` é a exceção: ali os dois divergem no **modelo**, e a
tradução não é possível sem perder significado.

A divergência estava registrada em comentário nos dois providers desde a Fase 2.
Este ADR a promove a decisão explícita porque, da Fase 4 em diante, o domínio
passou a ter a **sua própria matriz de aprovação** — QA → SecOps → usuário, com
o teto da trava de merge em `decide.ts` — e agora existem duas fontes de
autoridade sobre o mesmo merge. Essa sobreposição não existia quando o
comentário foi escrito.

## O que cada provider faz hoje

`ProtectBranchInput` (packages/shared) carrega **apenas** `externalId`,
`branchName` e `accessToken` — nenhuma configuração de política. Cada
implementação escolhe "o mais restritivo razoável" e isso cai em lugares
diferentes:

| provider | modelo da plataforma | o que aplicamos |
|---|---|---|
| **GitHub** | regras independentes num payload rico | `enforce_admins: true`, `required_approving_review_count: 1`, sem status checks, sem restrição de push |
| **GitLab** | dois níveis de acesso | `pushAccessLevel: MAINTAINER`, `mergeAccessLevel: MAINTAINER` |
| **local** | não existe plataforma | `capabilities.protectBranch: false`; a chamada rejeita com `GitNotSupportedError` |

O passo `protect_branches` do bootstrap consulta a capability antes de agir, e a
suite de contrato afirma por **capability**, não por provider — por isso a
divergência nunca quebrou teste: os dois caminhos são igualmente válidos para o
contrato.

## A assimetria que a matriz de aprovação expõe

As duas proteções não são "a mesma coisa escrita diferente". Elas interagem de
formas opostas com a matriz do domínio:

- **No GitHub, criamos uma segunda autoridade.** `required_approving_review_count: 1`
  exige uma aprovação DA PLATAFORMA que o domínio não conhece e não preenche —
  os pareceres de QA e SecOps são eventos nossos, não reviews do GitHub. Somado
  a `enforce_admins: true`, que remove o bypass de administrador, o merge manual
  do usuário — que o CLAUDE.md torna obrigatório — pode ficar **bloqueado pela
  plataforma** quando não há um segundo humano para aprovar a PR.
- **No GitLab, não criamos autoridade nenhuma.** Não há contagem de aprovação:
  quem tiver papel Maintainer faz push e merge direto. A matriz do domínio é o
  ÚNICO portão, e um token de Maintainer a contorna inteira.
- **No local, só existe o portão do domínio**, por construção.

Ou seja: o mesmo sistema é mais rígido que o pretendido num provider e mais
frouxo no outro, pelo mesmo `protectBranch()` sem argumentos.

## Decisão

**1. A matriz de aprovação do domínio é a fonte de verdade.** QA → SecOps →
usuário, com o teto de `decide.ts` (merge com destino em branch protegida nunca
é auto-aprovável). A proteção da plataforma é defesa em profundidade contra
acesso por fora do Brabo — não é o portão, e nenhuma lógica do domínio deve
depender dela.

**2. A divergência fica.** Traduzir os dois modelos para um denominador comum
significaria descer o GitHub ao nível do GitLab (perdendo `enforce_admins`) ou
inventar no GitLab um conceito de aprovação que a plataforma não tem no tier
livre. Cada lado aplica o mais restritivo que consegue expressar, e o contrato
promete apenas o observável: `listBranches` devolve `protected: true`.

**3. `ProtectBranchInput` NÃO ganha configuração agora.** Acrescentar
`requiredApprovals`, `enforceAdmins` e afins criaria um vocabulário que só um
dos providers sabe honrar, e o outro teria de ignorar em silêncio — que é pior
do que a divergência atual, porque passaria a mentir. Quando houver necessidade
real, o caminho é um `ProtectionPolicy` normalizado com o provider declarando
via `capabilities` o que sabe aplicar, e o bootstrap reportando o que foi
ignorado.

## Consequências

**Aceitas:**

- Rigidez diferente por provider, documentada aqui e nos comentários dos dois
  arquivos, que passam a apontar para este ADR.
- No GitHub, um repositório de dono único pode ter o merge manual bloqueado pela
  própria proteção que aplicamos. O contorno é do operador (reduzir
  `required_approving_review_count` a 0 no repositório), não do código —
  mudá-lo por padrão afrouxaria a proteção em todo repositório para resolver um
  caso particular.

**Não verificado:**

- **Nenhum destes dois caminhos foi exercitado contra API real neste
  repositório.** Os smokes (`github-provider.smoke.spec.ts`,
  `gitlab-provider.smoke.spec.ts`) são manuais e pulados sem
  `GITHUB_TEST_TOKEN` / `GITLAB_TEST_TOKEN`; o CI usa `LocalGitProvider`, cuja
  capability é `false`. O bloqueio de merge descrito acima é dedução do
  comportamento documentado das duas plataformas, não observação. **Ao ligar o
  primeiro repositório real, verificar isso é o primeiro teste a fazer.**

**Fora de escopo:**

- Refletir os pareceres de QA/SecOps como status checks do GitHub, que
  eliminaria a sobreposição transformando a matriz do domínio na condição de
  merge da plataforma. É a solução certa e depende de o Brabo ter um endpoint
  público para o GitHub chamar — ver o item de registry/exposição pendente no
  [ADR 0027](0027-fase5-backup-hardening-release.md).
