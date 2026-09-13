# 0156 — O teto de auto-rebaixamento também na remoção de membro de projeto

## Status

**Accepted.** Fecha a lacuna que o
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) declarou por
escrito e fixou em teste. Não o revoga nem o revisa: os dois tetos daquele ADR
seguem exatamente como estão, e o que muda é o conjunto de PORTAS por onde o
teto 2 é avaliado. Corresponde ao `BRB-001`, P1 de segurança do registro do
mantenedor.

## Context

O ADR 0127 pôs dois tetos no caminho de ESCRITA de `project_members` — ninguém
rebaixa o `owner` do workspace, ninguém rebaixa a si mesmo — e escolheu
deliberadamente não cobrir um terceiro movimento, deixando o motivo e o custo
registrados na seção "Segue possível, com nome":

> **auto-rebaixamento pela REMOÇÃO.** `RemoveProjectMemberUseCase` NÃO ganhou
> teto (…) A premissa de que "a remoção é sempre benigna" é falsa, e fica
> escrita aqui para não ser redescoberta. Os dois casos estão FIXADOS em teste
> (…), inclusive o que segue aberto, para a próxima pessoa saber que é decisão
> e não esquecimento. Fechá-lo custa a assinatura de
> `RemoveProjectMemberUseCase.execute`, que hoje é chamada por
> `list-projects-and-members.use-case.spec.ts` com dois argumentos.

Este ADR é essa próxima pessoa, e o custo previsto foi exatamente o cobrado.

**O defeito, medido.** `RemoveProjectMemberUseCase.execute` recebia
`(projectId, userId)` — **não recebia o ator** — e o controller
(`@Delete(':projectId/members/:userId')`, `@RequireRole('maintainer')`) chamava
com os dois parâmetros de rota, sem `@CurrentUser()`. Como
`ResolveEffectiveRoleUseCase.forProject` é `projectRole ?? workspaceRole`
([RN-471](../business-rules.md#rn-471)), apagar a linha de projeto não apaga um
papel: ela TROCA o papel efetivo pelo segundo termo. Quando o papel de
workspace é menor, o efeito líquido é o rebaixamento que o teto 2 existe para
impedir, com a mesma irreversibilidade — voltar é `POST :projectId/members`,
que pede o `maintainer` que se acabou de abandonar. Sem papel de workspace
nenhum, a queda é para acesso NENHUM.

O caso estava reproduzido em teste desde o ADR 0127, com o nome dizendo o que
ele documentava: *"e a remoção SEGUE podendo rebaixar quem a chamou, quando o
workspace não segura — lacuna declarada no ADR 0127"*. Um `maintainer` cuja
autoridade vinha da linha de projeto, `viewer` no workspace, removia a própria
linha e caía para `viewer` sem volta pela tela.

**Por que é a mesma regra, e não uma nova.** O teto 2 compara o papel efetivo
de HOJE com o papel efetivo DEPOIS, e nunca precisou saber por qual rota o
segundo chegou. No `add` o papel-depois é o do corpo; na remoção é o do
workspace. Escrever uma segunda régua para a segunda porta seria a quarta cópia
de uma comparação que já mora em `domain/iam/tetos-de-rebaixamento.ts` — e
cópia de régua é o modo de falha que este repositório persegue em vários
lugares (a lista de áreas gerada, `roleAtLeast` com o mesmo nome dos dois
lados, `caminhoDeWorkspaceLocalValido` reusado em vez de reescrito).

## Decision

**1. A remoção passa a receber o ator e a recusar o auto-rebaixamento
líquido.** `RemoveProjectMemberUseCase.execute` vira
`(projectId, atorId, alvoId)` — a mesma ordem de `AddProjectMemberUseCase` — e
lança `ForbiddenException` (403) quando remover a linha do PRÓPRIO chamador o
deixaria com papel menor que o de hoje. O controller passa `@CurrentUser()`,
como o `add` já fazia.

**2. A regra é o teto 2 reusado, com o papel de workspace no lugar do papel
pedido.** Entra `remocaoEhAutoRebaixamento` no mesmo módulo de domínio, e ela
não reimplementa comparação nenhuma: delega a `ehAutoRebaixamento` passando
`papelPedidoNoProjeto: papelDoAtorNoWorkspace`. Ela existe, em vez de o caso de
uso chamar `ehAutoRebaixamento` direto, por UM caso que a assinatura da outra
não sabe enunciar — ator sem papel de workspace, onde o papel-depois é
"nenhum", que não é um `Role`. Esse caso é o rebaixamento máximo e recusa.

**3. O teto 1 NÃO ganha par, e a ausência é decisão.** Remover a linha de
projeto de quem é `owner` do WORKSPACE só pode ELEVAR o efetivo dele, ou
mantê-lo: `owner` é o topo do `ROLE_ORDER`, então não existe papel de workspace
para o qual a queda seja queda. Mais que inofensivo, o movimento é a ÚNICA
forma de desfazer a restrição que o teto 1 do ADR 0127 impede de criar — um
`owner` de workspace que já tinha linha `viewer` num projeto (gravada antes
daquele ADR, ou por uma escrita direta no banco) volta a alcançar o próprio
projeto exatamente assim. Um teto ali recusaria só movimentos benignos, e
tornaria permanente um estado que o ADR 0127 nasceu para eliminar. A ausência
está escrita no código, ao lado da função, e fixada em teste.

**4. Sem limiar, como o teto 2.** A recusa é "a si mesmo", não "abaixo de
`maintainer`", e o preço declarado do ADR 0127 vem junto: a auto-remoção que
derruba de `owner` de projeto para `maintainer` de workspace é reversível e
CAI TAMBÉM. Ela continua alcançável por outro `maintainer`. Esse caso passava
antes e passa a recusar — é a única mudança de comportamento que este ADR
introduz sobre um movimento benigno, e é a mesma troca que o ADR 0127 já tinha
aceitado para o `add`: uma cláusula sem número, contra uma exceção que precisa
ser explicada toda vez.

**5. A mensagem é PRÓPRIA, não a do `add`.** Quem clicou "remover" não pediu
para mudar papel nenhum, e uma frase falando de "rebaixar a si mesmo" não
explicaria o que aconteceu. `MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO` diz o
mecanismo: sem a linha de projeto o papel cai para o do workspace, e voltar
exige o papel abandonado.

**6. A descrição de OpenAPI passa a descrever o código.** A da rota dizia
apenas que "quem tem papel no workspace continua vendo o projeto por herança" —
verdade pela metade, e a metade que falta é o motivo desta decisão: a herança
pode ser MENOR que a linha. `openapi.json` e `api-types.generated.ts` saem do
gerador.

## O que este ADR recusa explicitamente

- **Um teto de `owner` do workspace na remoção.** Ver o ponto 3. Não é simetria
  esquecida: não existe remoção que rebaixe um `owner` de workspace.
- **Uma segunda régua de comparação de papéis.** Ver o ponto 2. A comparação
  continua morando num lugar só.
- **Mexer em `ResolveEffectiveRoleUseCase.forProject`.** `projectRole ??
  workspaceRole` fica byte a byte, nos dois sentidos — é a capacidade que o ADR
  0127 recusou eliminar, e nada aqui reabre a questão.
- **Estender o teto ao workspace.** `POST workspaces/:workspaceId/members` é um
  upsert sem teto nenhum, como o ADR 0127 já declarava — e a remoção nem
  existe lá: `WorkspacesController` não tem `@Delete` de membro (medido), então
  o movimento equivalente não é alcançável por HTTP nesse escopo. Escopo
  diferente, decisão separada.
- **Bloquear a remoção de OUTRA pessoa, mesmo quando ela cai de papel.** É a
  capacidade legítima de sempre — a mesma que restringe um `developer` a
  `viewer` num projeto sensível —, e vale para a remoção como vale para a
  escrita.
- **Gate na tela.** Ver Consequences.

## Consequences

**Um movimento benigno cai junto, e é o preço já aceito.** A auto-remoção de
quem tem `owner` no projeto e `maintainer` no workspace era permitida e passa a
ser 403. É reversível por outro `maintainer`, e o teste que fixava a permissão
passa a fixar a recusa, com o nome dizendo que é o preço do teto sem limiar.
Quem quiser sair de uma lista nessa situação pede a outro `maintainer` — o
mesmo desfecho que o teto 2 já produzia pelo `add`.

**A tela continua oferecendo o botão que a api recusa, e a recusa aparece.**
`MembersSection.handleRemove` já tem `try/catch` com `mensagemDaApi`
([RN-471](../business-rules.md#rn-471)), então a frase da api chega ao toast
sem uma linha de web. Diferente do teto 1, este gate É calculável no cliente
— `userIdDaSessao()` e o papel efetivo estão lá —, mas calcular só ele
produziria um botão honesto sobre uma recusa e calado sobre a outra, que é
exatamente o meio-gate que o ADR 0127 recusou. Fica para a PR de web que
resolver o problema inteiro.

**Duas consultas a mais por remoção**, inclusive quando o alvo é outra pessoa:
`forProject` do ator (que refaz o `findById`) e `forWorkspace`. É o custo que o
ADR 0127 já tinha aceitado no `add`, numa rota de administração, e a
alternativa — um `if (atorId === alvoId)` antes das leituras — repetiria no
caso de uso a cláusula que a função pura existe para conter.

**A assinatura mudou, e dois testes a chamavam.** `execute` tem três argumentos
agora; `list-projects-and-members.use-case.spec.ts` e
`tetos-de-rebaixamento.use-case.spec.ts` foram atualizados. Não há outro
chamador: o construtor ganhou `ResolveEffectiveRoleUseCase`, que já estava
registrado no `iam-use-cases.module.ts`.

**O teste de lacuna virou teste de teto.** O bloco que o ADR 0127 deixou
fixando o buraco ("a remoção SEGUE podendo rebaixar quem a chamou") foi
INVERTIDO em vez de apagado, e o nome guarda a origem. É a forma que este
repositório já usa para não perder a evidência de por que algo existiu.

**Segue possível, com nome:** rebaixar outra pessoa pela remoção da linha dela;
auto-PROMOÇÃO (inalterada); e o escopo de workspace inteiro, cujo `POST` de
membro segue sem teto.
