# 0165 — O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-18 (AT-092). Revisa o
GATILHO da [RN-522](../business-rules.md#rn-522), que tinha nascido para
cumprir a promessa da [RN-541](../business-rules.md#rn-541) ("o bootstrap é
adiado até o handoff do Arquiteto"). Nenhuma das duas veio de um ADR — as duas
nasceram de pedido direto do dono do produto e moram só em
`docs/business-rules.md` —, então este é o primeiro registro estrutural do
momento em que o repositório nasce. O MECANISMO de provisionamento não muda: é
o mesmo `ProvisionRepositoryUseCase`, idempotente por desenho desde o
[ADR 0005](0005-repo-bootstrap-idempotent-steps.md), chamado pelo mesmo
`AcceptHandoffUseCase`. A regra de alvo de handoff do
[ADR 0038](0038-hierarquia-de-agentes.md) (handoff externo endereça só lead de
área ou agente sem área) e a cadeia Arquiteto → Dev Lead do
[ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) seguem intactas.

## Context

Uma instalação real da v6.1.0, em 2026-09-14, produziu esta sequência no event
log de um projeto novo:

- 02:40:54 — o Arquiteto propõe `open_adr_pr` três vezes. O repositório ainda
  não existe, e a ferramenta falha nas três.
- 02:43:53 — `handoff.offered` para `infra` e para `dev-lead` (a confirmação
  de arquitetura pronta oferece os dois, `OfferInfraHandoffUseCase`).
- Só o de `infra` é aceito. O de `dev-lead` fica `offered`.
- 03:02:34 — `POST /projects/:id/execution/activate` responde **201**.
- `project_repositories`, `project_git_connections` e `repo_bootstraps` ficam
  vazias. O projeto fica sem repositório para sempre.

Os dois defeitos são independentes, e a RN-522 carregava os dois:

1. **O gatilho estava depois de quem precisa do repositório.** O Arquiteto é o
   primeiro agente com ferramenta que ESCREVE no repositório (`open_adr_pr`), e
   o Infra Lead, ativado pelo handoff Arquiteto → Infra, é o segundo
   (`open_infra_pr`). Os dois trabalham ANTES do aceite ao Dev Lead. A RN-541
   dizia "o repositório nasce quando o desenvolvimento começa", e o
   desenvolvimento, medido pelo que os agentes fazem, começa no Arquiteto.
2. **O único gatilho era PULÁVEL.** Ativar a execução não exige handoff aceito
   ao Dev Lead — exige `module_map` vigente, e mais nada. Quem ativa pela Visão
   Geral (ou pelo atalho "Ativar execução" do próprio card do handoff, RN-137)
   pula o aceite, e com ele o provisionamento. Nada no caminho recusava.

**Quem entrega ao Arquiteto, medido.** O Arquiteto só pode ser ativado com um
handoff `accepted` endereçado a ele (`canActivateAgent`,
`domain/sessions/agent-activation.ts`) — a exceção é só o Criativo. O handoff
nasce por duas portas, e as duas gravam pelo MESMO
`CreateHandoffUseCase`: o PO, ao terminar o backlog, com
`offer_handoff(to_agent: "arquiteto")` (a instrução de kickoff em
`po_server.ex` manda isso), ou o usuário, pelo handoff manual
(`RequestManualHandoffUseCase`, ADR 0109). E o aceite é um só:
`AcceptHandoffUseCase`, o mesmo que já hospedava o gatilho da RN-522. Não há
caminho em que o Arquiteto trabalhe sem ter passado por esse aceite.

## Decision

**1. O gatilho passa a ser o aceite do handoff endereçado ao `arquiteto`.** Em
`AcceptHandoffUseCase`, o ramo que chama `provisionarRepositorio` passa a
disparar para `toAgent === 'arquiteto'`, ANTES de `activateAgent` — a mesma
ordem que a RN-522 já usava, pelo mesmo motivo: o Arquiteto acorda num projeto
que já tem onde trabalhar, e o primeiro `open_adr_pr` encontra repositório.
Tudo o mais do ramo fica byte a byte: sempre `local` (o único provider sem
credencial), falha vira `repository.provision_failed` com origem e nunca
derruba o aceite, repositório ADOTADO sai antes sem ser falha.

**2. O gatilho antigo FICA, como segunda porta idempotente.** O aceite ao
`dev-lead` continua chamando o mesmo provisionamento. Três razões, em ordem de
peso:

- **É a saída dos projetos já quebrados.** Um projeto que passou do Arquiteto
  ANTES desta mudança (o `exp001` da AT-092 é exatamente isso: handoff ao
  Arquiteto aceito sob a regra velha, handoff ao Dev Lead ainda `offered`) tem
  um handoff pendente cujo aceite provisiona. Sem esta porta, a única saída
  seria a página de provisionamento manual, que nenhuma tela oferece a partir
  da sessão.
- **É a retomada natural de uma falha.** Se o provisionamento falhar no aceite
  ao Arquiteto, o evento fica no log, e o próximo passo que o usuário dá de
  qualquer jeito — aceitar o Dev Lead — tenta de novo, sem ninguém precisar
  saber que existe uma rota de provisionamento.
- **O preço é zero por construção.** Com o repositório `created` já de pé,
  `ProvisionRepositoryUseCase` não chama `createRepo`, não cria sessão nem
  bootstrap, e o runner reporta todos os passos como satisfeitos (ADR 0005).
  Isso já estava provado para três rodadas seguidas do caso de uso; o que este
  ADR acrescenta é a prova PELAS DUAS PORTAS: aceitar o Arquiteto e depois o
  Dev Lead, contra o Postgres e o `LocalGitProvider` de verdade, termina com
  UM `createRepo`, UMA linha em `project_repositories`, UMA em
  `repo_bootstraps`, e nenhum `repository.provision_failed`.

Tirar a segunda porta foi considerado e recusado: ela não tem custo, e a
alternativa deixa o `exp001` sem saída pela tela onde o usuário está.

**3. `execution/activate` sem repositório é RECUSADO com 409.** Em
`ActivateExecutionUseCase`, logo depois da checagem de `module_map` e ANTES de
qualquer efeito (persistir orçamento, semear `permissions.json`, criar sessão),
o caso de uso consulta `ProvisionedRepositoryRepository.findByProjectId`. Sem
linha, `ConflictException` com o motivo NOMEADO, escolhido pelo estado dos
handoffs do projeto (`HandoffRepository.findByProject`, leitura nova e só
leitura) por uma função pura de domínio:

- há handoff `offered` ao Arquiteto → "aceite o handoff ao Arquiteto";
- senão, há handoff `offered` ao Dev Lead → "aceite o handoff ao Dev Lead" (a
  segunda porta);
- senão, algum dos dois já foi aceito → o provisionamento automático rodou e
  não deixou repositório (o `repository.provision_failed` diz por quê), e o
  caminho é a página de provisionamento do projeto;
- senão → nenhum handoff ao Arquiteto foi aceito, e o repositório nasce nele.

Repositório ADOTADO conta como repositório. 409 e não 400 porque o pedido está
certo: é o ESTADO do projeto que ainda não permite. Reativar uma execução que
já roda continua não sendo conflito QUANDO há repositório; o `exp001`, que
ativou sem ter um, passa a receber o 409 também na reativação — e é o que se
quer, porque os dev agents dele nunca tiveram onde trabalhar.

**4. A tela não oferece ativar sem repositório, e diz por quê uma vez, em
texto.** A seção de Execução da Visão Geral lê `GET .../git/repository` (a
mesma `queryKey` `['repository', projectId]` que `ProjectPage`, `CodeShell` e
Configurações já usam — nenhuma requisição nova de verdade) e, com a resposta
`null` CONFIRMADA, deixa o botão inerte no lugar e escreve o motivo, com o link
para a página de provisionamento. Carregando ou com erro, o botão fica como
estava: "não sei" não vira "não tem", e o backend recusa de qualquer forma. No
card do handoff ao Dev Lead, dentro da sessão, o atalho "Ativar execução" some
enquanto o repositório não existe, e o card diz que aceitar o handoff o
provisiona — o botão de aceitar está ao lado. É a régua da RN-102 e do
ADR 0064: tira o controle, nunca a informação.

## Consequences

- **A RN-522 muda de gatilho, não de mecanismo.** A RN-582 registra a regra
  nova; a RN-522 e a RN-541 ganham nota apontando para ela, e o comentário do
  assistente de criação deixa de dizer "Dev Lead".
- **O caso Arquiteto → Infra antes do Dev Lead deixa de existir.** O Infra Lead
  é ativado pelo handoff do Arquiteto, que por construção só existe depois do
  aceite ao Arquiteto — então o repositório já nasceu quando ele acorda.
- **A recusa local de `open_adr_pr`/`open_infra_pr` (AT-088) continua
  necessária**, e complementar: ela cobre o provisionamento que FALHOU e o
  projeto legado, que este ADR não consegue impedir de existir.
- **Consequência medida no código e aceita: a sessão `git-bootstrap` passa a
  nascer no MEIO da fase do Arquiteto.** `ProvisionRepositoryUseCase` abre uma
  sessão própria para o log do bootstrap, e a Visão Geral e o resumo do
  workspace escolhem a sessão "mais recente" por `createdAt`. Sob a RN-522 essa
  sessão nascia no aceite ao Dev Lead e logo era ultrapassada pela de execução;
  agora ela vira a "mais recente" do projeto durante toda a conversa com o
  Arquiteto, até a próxima sessão nascer. A sessão de chat não é afetada (a
  tela dela lê o próprio id). Corrigir exige decidir se o log do bootstrap
  merece sessão própria, ou se "a mais recente" deve ignorar sessões de
  sistema — as duas mexem em regra de outra frente (RN-139, ADR 0005), e não
  são decididas aqui.
- **Projeto sem handoff ao Arquiteto nenhum, com `module_map` gravado por fora
  do fluxo**, cai no quarto motivo da recusa e sai pela página de
  provisionamento. Não há caminho automático para ele, e não precisa haver.
- **Recusado:** provisionar na criação do projeto (desfaria a RN-541, que é
  pedido do dono do produto); provisionar DENTRO de `execution/activate` (a
  ativação passaria a ter efeito de git escondido, e os agentes anteriores a
  ela continuariam sem repositório — o defeito 1 inteiro); e mover o gatilho
  sem manter a porta antiga (deixaria o `exp001` sem saída pela sessão).
