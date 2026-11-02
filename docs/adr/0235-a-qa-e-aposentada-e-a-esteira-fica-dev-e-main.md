# ADR 0235 — A `qa` é aposentada por hora e a esteira do repositório fica `dev → main`

- **Status:** aceito
- **Data:** 2026-11-02
- **Revisa:** a escada e o fluxo de promoção do
  [ADR 0030](0030-politica-de-branches-mecanizada.md) (de `dev → qa → main`
  para `dev → main`)
- **Revoga:** o mecanismo do [ADR 0217](0217-promocao-automatica-para-qa-em-fase-de-teste.md)
  (promoção automática para a `qa`, que sem `qa` não tem destino)
- **Contexto anterior:** [ADR 0034](0034-documentacao-publicada-por-degrau.md),
  [ADR 0071](0071-publicacao-simetrica-por-degrau.md) e
  [ADR 0073](0073-o-caminho-publicado-nomeia-o-ambiente.md) (um site por
  degrau: passa a haver um degrau a menos)

## Contexto

Em 02/11/2026 o dono decidiu: "aposentar por hora a `qa` e ficarmos apenas com
`dev` e `main`". Com um único mantenedor, o degrau de homologação repetia a
validação da `dev` e custava uma promoção inteira por ciclo. "Por hora" quer
dizer que a volta tem de ser barata.

## Decisão

1. **Escopo: só o REPOSITÓRIO do Brabo.** O Gitflow que o produto cria nos
   projetos dos usuários (bootstrap, RN-582/RN-664) NÃO muda, e a `qa` continua
   em `PROTECTED_BRANCHES` do produto, no molde do `rc` (ADR 0030): desproteger
   uma branch que existe custa caro.
2. A esteira passa a `dev → main`; a retropropagação é `main → dev`. A `qa`
   sai da `ESCADA`, do `ESTAGIO_POR_BRANCH`, da escada de aprovação e da ordem
   do gate. `qa` fica em `NUNCA_ARQUIVAR`: quem decide o destino dela é gente.
3. **Âncora de versão.** A tag final da `main` ancora na `-dev.N` do ciclo
   (merge com o segundo pai carimbado e a mesma árvore). As tags históricas
   `-qa.N` continuam sendo lidas.
4. **A `qa` é arquivada** em `refs/archive/qa` (mecanismo da AT-557), por gesto
   humano e só depois de a mudança estar na `dev` (o `backmerge-gate` buscava
   `refs/heads/qa`).
5. O site perde o degrau `/brabo/qa/`; o primeiro publish depois da mudança o
   remove sozinho (`keep_files: false`). O ADR 0073 segue valendo.

## Receita da volta

Reverter a PR da rodada (devolve `qa` à `ESCADA`, aos workflows e ao site),
reviver a branch (`git push origin refs/archive/qa:refs/heads/qa`), promover
`dev → qa` e só então reabrir `qa → main`.

## Consequências

- Não há RN nova: é política de CI do repositório, não regra do produto.
- Nenhum teto absoluto muda.
- Antes da mudança, `dev → main` reprovava (`PROMOCAO-NAO-ADJACENTE`) e, forçado,
  seria classificado como hotfix (PATCH); a âncora nova fecha esse caso.
