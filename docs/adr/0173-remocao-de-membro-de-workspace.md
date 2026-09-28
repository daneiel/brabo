# 0173 — A remoção de membro de workspace nasce, protegida pela mesma cláusula

## Status

**Accepted.** É o QUARTO da linha aberta pelo
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) e continuada pelos
[ADR 0156](0156-teto-de-auto-rebaixamento-na-remocao.md) e
[ADR 0157](0157-teto-de-auto-movimento-no-upsert-de-workspace.md). Abre a porta
que o 0157 recusou abrir de passagem — *"Uma rota de remoção de membro de
workspace (…) Decisão separada, se alguém a pedir"* — por decisão do mantenedor
(2026-09-27, AT-115/HS-006): **a rota nasce, protegida por CLÁUSULA.** ADR
aceito não se edita: o 0157 segue dizendo que a rota não existe, e este é o que
diz que passou a existir.

## Context

Offboarding de membro de workspace era escrita direta no banco:
`WorkspacesController` não tinha `@Delete` de membro — medido durante o
`BRB-002` e usado pelo 0157 como parte do argumento. O 0157 deixou três
perguntas para quem abrisse esta porta, e a HS-006 mostrou que são a mesma
conversa:

1. **o último `owner`.** Hoje o invariante "nunca zero owners" vem de uma
   cláusula — tirar o último exigiria que ele mesmo o fizesse, e o teto 2
   impede. A HS-006 temia que uma rota de remoção reabrisse esse caminho e que
   a garantia tivesse de vir de uma contagem, que é o que o 0127 recusou
   (*"se enuncia numa cláusula, não tem número para envelhecer"*);
2. **o teto 1 no workspace.** Ele ficou de fora (0157, ponto 3) porque, somado
   à ausência de rota de remoção, faria de `owner` um estado absorvente;
3. **o teto 2 na remoção**: herda a delegação da remoção de projeto
   (`remocaoEhAutoRebaixamento`) ou pede enunciado próprio, já que aqui o
   "depois" é sempre *nenhum*?

## Decision

**1. Nasce `DELETE /workspaces/:workspaceId/members/:userId`, `owner`, 204.**
O mesmo mínimo do upsert: quem mexe na lista de membros é quem a mantém.
Idempotente como a remoção de projeto — alvo sem linha não é erro.

**2. O teto 2 é HERDADO, sem régua nova.** `RemoveWorkspaceMemberUseCase` chama
`remocaoEhAutoRebaixamento` passando o papel do ator no WORKSPACE como o efetivo
de hoje (no workspace não há composição: o efetivo é a linha) e `null` como o
papel de DEPOIS. Esse ramo já existia — é o do projeto sem linha de workspace,
*"o rebaixamento máximo"* —, e ele responde à pergunta 3: o "depois" aqui é
sempre *nenhum*, e a função já sabia enunciar *nenhum*. Remover a si mesmo do
workspace é **sempre 403**, com frase própria
(`MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`): quem clicou "remover" não pediu
mudança de papel, a mesma razão pela qual a remoção de projeto ganhou a dela no
0156. Os nomes dos parâmetros ficaram os do projeto: renomeá-los mudaria as
outras portas por uma leitura, e o docblock da função diz a leitura.

**3. O último `owner` está protegido pela MESMA cláusula, sem contar owners.**
A demonstração, no molde da que o 0157 fez para o upsert:

- a rota pede `owner` (`@RequireRole('owner')`), então **quem remove é sempre
  um `owner`** do workspace;
- **ninguém remove a si mesmo** (ponto 2);
- logo toda remoção bem-sucedida deixa de pé ao menos um `owner`: **o próprio
  chamador**. Tirar o último exigiria que ele se removesse — o movimento
  recusado.

A premissa da HS-006 ("a rota reabriria o caminho") não se confirmou: a rota
ABRE a remoção de outros, mas a remoção do último é justamente a auto-remoção,
e essa continua fechada pela cláusula que já fechava o auto-rebaixamento. A
contagem continua recusada pelos motivos do 0157, ponto 2. A demonstração está
em teste: *"com dois owners, qualquer sequência de remoções deixa ao menos um:
quem remove fica"*, e o mínimo `owner` da rota é asserido no teste do
controller, porque ele é METADE da prova — se o mínimo cair, a demonstração cai
junto.

**4. Remover OUTRO `owner` fica possível.** É a forma de revogar propriedade por
inteiro, e é a extensão natural do ponto 3 do 0157, que manteve rebaixar outro
dono. **O teto 1 continua sem par neste escopo** (pergunta 2): a premissa que a
HS-006 via cair — "não haver saída de `owner` por HTTP" — era o argumento de
CUSTO do 0157, e o de PRINCÍPIO segue de pé: o teto 1 é regra sobre inversão de
hierarquia, e `@RequireRole('owner')` torna a inversão impossível. A rota nova
só reforça o custo: com ela e um teto 1 espelhado, remover outro dono também
seria recusado, e `owner` voltaria a ser absorvente.

**5. A cascata, numa transação.** Remover a linha de `workspace_members` sozinha
seria cosmético: a sobreposição `projectRole ?? workspaceRole`
([RN-471](../business-rules.md#rn-471)) manteria o removido dentro de todo
projeto em que tivesse linha própria. Então, juntas:

- a linha de `workspace_members`;
- as linhas de `project_members` do removido **nos projetos deste workspace**
  (as de outros workspaces não são tocadas);
- as credenciais dele presas a esses projetos: as chaves de dispositivo de
  **PROJETO** (pela mesma coluna que a [RN-519](../business-rules.md#rn-519)
  lista) e os **PATs** — todo PAT é de um projeto (`project_id NOT NULL`) —,
  revogados com o motivo `workspace_member_removed`. Sem isso, ser reassociado
  um dia reativaria em silêncio um pareamento que a remoção devia ter
  encerrado.

**6. Depois do commit, a conexão viva cai pelo caminho da RN-520.** Um
`disconnectRunnerOfUser(projectId, userId)` por projeto do workspace — TODOS,
não só os de modo `runner`, porque o runner conecta também em
`container`/`mounted` (o espelho, [RN-516](../business-rules.md#rn-516)); sobrar
um projeto custa um `sem_runner`, faltar um deixa de pé o que a remoção existe
para derrubar. Em `try/catch` que só loga: efeito colateral nunca derruba o
efeito principal, a régua da [RN-520](../business-rules.md#rn-520).

## O que fica declarado e NÃO é feito

- **As chaves de MÁQUINA** (`project_id` nulo) ficam: são da CONTA e servem os
  outros workspaces da pessoa. Aqui elas já não alcançam nada — o
  `PatAuthGuard` resolve o papel contra o projeto pedido, e ele é nenhum.
- **Sessões abertas** seguem abertas: são do projeto, não da pessoa, e o event
  log é append-only. Um socket de sessão JÁ conectado pelo removido segue até
  cair; o ticket novo (RN-108) pede `viewer` e é recusado. Derrubar o canal de
  sessão por usuário exigiria um comando novo no engine — frente própria.
- **O terminal `:web`** do removido não é alvo da desconexão (a RN-520 só
  derruba `:runner`); mesma lacuna, mesmo motivo.
- **`workspaces.created_by` não muda.** É por ele que se resolve a chave de LLM
  que os agentes gastam ([RN-058](../business-rules/custo.md#rn-058)) e o dono
  do relatório de gasto. Remover o CRIADOR (outro `owner`) é permitido pelo
  ponto 4, e depois disso os agentes do workspace **continuam gastando a
  credencial de quem já não está nele**. Transferir essa propriedade — ou
  recusar remover o criador — é decisão de produto que a AT-115 não cobre, e
  fica **aberta, sem dono**, em vez de decidida aqui de passagem.
- **Tela.** Não existe seção de membros de workspace no `apps/web` (medido: o
  único vestígio de `/workspaces/:id/members` é o tipo gerado em
  `api-types.generated.ts`, e nem há `GET` de membros de workspace). Não se cria
  uma aqui; a rota é de API, como o upsert.

## Consequences

**Offboarding deixa de ser escrita no banco.** Um `owner` remove qualquer outra
pessoa, inclusive outro `owner`, e a remoção é real: sai do workspace e de todos
os projetos dele, e o runner dela cai.

**A linha dos tetos tem cinco portas e dois tetos.** Nenhum teto novo nasceu:
o teto 2 ganhou mais uma porta, pela mesma função, e o teto 1 segue só no
projeto. `docs/security-surface.md` ganha a nota da quinta rota.

**Duas frases antigas ficam falsas, e é este ADR que as substitui.** A do 0157
(*"`WorkspacesController` não tem `@Delete` de membro"*) e a mensagem de 403 do
auto-rebaixamento no workspace, que dizia *"não existe rota que remova membro"*
e deixou de dizer — a frase de erro não pode afirmar o que não é verdade.

**Uma consulta a mais antes de escrever** (o papel do ator), e N chamadas HTTP
ao engine depois, uma por projeto do workspace, na rota de administração menos
frequente do produto.
