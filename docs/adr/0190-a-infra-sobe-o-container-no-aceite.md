# 0190 — A Infra sobe o container no aceite do handoff, por passo do servidor e com a autonomia semeada

## Status

**Accepted.** 2026-10-01 (AT-260, história HS-065, épico EP-030, rodada 35;
decisão do dono em 01/10: *"`container_start` nasce seedado `auto_approve` no
aceite do handoff da Infra, e o servidor dispara a subida sozinho quando houver
`module_routing`, sem depender do modelo"*). Revisa a frase *"nunca seedada em
auto-aprovação"* do
[ADR 0133](0133-infra-elege-imagem-do-roteamento.md) (RN-491) e se apoia na
página de containers do
[ADR 0136](0136-pagina-global-de-containers.md) sem editar nenhum dos dois: o
caminho de eleição, os tetos e as recusas que eles puseram continuam; o que
muda é QUEM dispara a primeira subida e se ela espera um clique.

## Context

Medido no código de `dev` em 2026-10-01, antes de mudar:

- No uso real de 29/09 (sessão `be70`) a Infra escreveu que subiria o
  container "em paralelo" à PR de infra (seq 282) e não chamou
  `propose_container_start`; a única tentativa foi
  `container_start_via_runner` (seq 280), recusada por modo (`mounted`). O
  container só subiu às 06:47:53, por um humano na `/containers`.
- A subida dependia inteiramente do modelo: o kickoff do Infra Lead
  (`build_kickoff`) pedia a eleição no passo 4, e nada no código a fazia se o
  modelo não a fizesse. A AT-264 (RN-668) já tinha fechado as duas metades do
  SILÊNCIO — o lote inteiro da resposta é despachado antes do HALT da PR, e o
  fecho do turno diz, com frase do servidor, quando a subida NÃO foi
  proposta —, mas deixou declarado que a subida como passo do servidor era
  esta atividade. O que a RN-668 promete ("não foi proposta") era verdade, mas
  era o desfecho comum.
- O texto da card dizia que o kickoff tornava a subida opcional ("antes,
  depois, ou nunca", `infra_lead_server.ex:955-961`). **Não reproduz mais**: a
  RN-668 reescreveu o passo 4 ("só acontece se for chamada ANTES dela ou na
  MESMA resposta"). O resto reproduz.
- O aceite do handoff da Infra semeava DUAS autonomias
  (`INFRA_AUTONOMY_SEEDS` em `accept-handoff.use-case.ts`):
  `open_infra_pr: auto_approve` e `terminal: deny`. `container_start` ficava
  `require_approval` por padrão — `maintainer` em `decide.ts`, FORA do bloco de
  tetos absolutos e PROVADO capaz de chegar a `auto_approve` por
  `agent_autonomy` (`decide.spec.ts`, "agent_autonomy auto_approve CONSEGUE
  chegar a auto_approve") —, e `ProposeActionUseCase` já executa a subida no
  caminho `auto_approved` (o branch existia para quem configurasse
  `permissions.json`). Ou seja: o mecanismo inteiro já existia, faltava a
  semente e o disparo.
- A `/containers` (ADR 0136, RN-521) propõe como HUMANO (`actor.kind:
  'user'`), e `agent_autonomy` só é lida quando o ator é agente. Semear para a
  Infra não muda nada nessa página.

## Decision

1. **A semente.** O aceite do handoff endereçado a `infra` semeia uma
   TERCEIRA autonomia: `container_start: auto_approve`, ao lado das duas de
   sempre. Só ela: `container_start_via_runner` e `container_stop` seguem
   configuráveis e nunca semeados, e `container_remove` segue no teto
   absoluto de `decide.ts` (RN-495), que nenhuma autonomia atravessa.
2. **O disparo é passo do SERVIDOR, não tool nova.** No kickoff do Infra Lead
   — o turno que nasce do handoff aceito —, ANTES da primeira ida ao modelo,
   o servidor lê o contexto de infra (uma leitura, a mesma do texto do
   kickoff) e, se há roteamento VIGENTE (`artifact.module_routing` com
   `status: roteado` e ao menos uma candidata) e o projeto sobe pelo broker
   (`container`/`mounted`), propõe `container_start` pelo MESMO caminho da
   tool (`propor_container_start/2`): as recusas locais por modo e estado
   (RN-566, RN-610) primeiro, depois `propose_action`, onde a api recusa sem
   broker (RN-591), resolve a autonomia e — `auto_approved` — executa
   `ExecuteContainerStartUseCase`, que elege a imagem por
   `DecidirImagemDoProjetoUseCase` com `decidedBy: 'infra-lead'` (RN-491).
   Nenhum caminho paralelo de eleição nasce.
3. **A eleição do servidor é determinística.** A candidata do MAIOR número de
   módulos do roteamento; no empate, a que aparece primeiro. Rede `none` e
   recursos padrão — os mesmos defaults da tool. O `rationale` diz que foi o
   servidor e por quê ("a candidata do Arquiteto para N de M módulos"). É
   sempre uma das candidatas, e a api recusa qualquer outra.
4. **O rastro é de ferramenta, sem mentir sobre quem chamou.** O passo grava
   `tool.call` (com `origem: "servidor"`) e `tool.result` duráveis, e NÃO põe
   mensagem `role: "tool"` no histórico do modelo: não houve chamada dele, e
   uma resposta de ferramenta sem a chamada é recusada pelos providers. O
   modelo sabe da subida pelo TEXTO do kickoff, que passa a dizer o que JÁ
   aconteceu (proposta e o status devolvido, ou a recusa e o motivo) em vez de
   pedir a eleição.
5. **`runner` fica como está.** O caminho `container_start_via_runner` (sobe a
   imagem já decidida, na máquina do usuário) não ganha passo do servidor nem
   semente: a decisão do dono não o tocou. O kickoff de um projeto `runner`
   segue com os passos de sempre, e a subida segue proposta pelo modelo e
   decidida por humano.
6. **A RN-668 continua coerente.** O passo do servidor marca o turno pelo MESMO
   `registrar_subida/3` da tool: subida proposta pelo servidor não ganha a frase
   "não foi proposta" no fecho; subida do servidor RECUSADA (e não corrigida
   pelo modelo) ganha a frase de recusa, que é verdade. O fecho segue falando
   nos casos em que a subida não cabia ao servidor (sem roteamento, `runner`)
   e o modelo não a propôs.

## Consequences

- **A promessa vira verdadeira por construção no caso comum.** Projeto
  `container`/`mounted` com roteamento tem a subida proposta — e, com a
  semente, executada — antes de o modelo dizer qualquer coisa.
- **"Nunca seedada" deixa de ser verdade, e é a ÚNICA regra que muda.** O
  papel mínimo continua `maintainer`, lido como o papel EFETIVO de quem abriu
  a sessão (`resolveEffectiveRole.forProject(session.createdBy)`): sessão
  aberta por `developer` recebe `deny`, como antes, e o kickoff diz a recusa.
  `deny` de `permissions.json` continua vencendo a autonomia.
- **Desligar é mexer na regra ESPECÍFICA.** O toggle manual/auto do card do
  agente escreve a curinga (`*`, RN-153), e regra específica vence a curinga:
  pôr a Infra em "manual" NÃO desliga esta semente — a mesma situação que já
  valia para `open_infra_pr` desde a Fase 4a. Quem quiser a subida com clique
  precisa trocar a regra `container_start` da Infra. Declarado, não resolvido
  aqui.
- **Reaceitar a Infra re-semeia.** O aceite faz `upsert`, como já fazia com as
  duas sementes de antes: um handoff novo à Infra numa sessão nova volta a pôr
  `auto_approve`. Mesmo comportamento das sementes existentes.
- **O kickoff pode esperar a subida.** O `propose_action` de container
  executado auto-aprovado responde depois do `start` do broker (teto de 225 s
  no engine, RN-605), e o passo roda antes da primeira ida ao modelo: o turno
  do kickoff fica `working` esse tempo, numa Task, com "Parar" atendido como
  sempre. Imagem grande que estoura o teto de pull (RN-605) chega como
  `failed`, e o kickoff diz isso ao modelo.
- **Contexto de infra que falha não sobe nada.** Sem a leitura do contexto não
  há roteamento a eleger; o kickoff degrada como antes e a subida volta a
  depender do modelo naquele turno. A subida do servidor também só acontece no
  kickoff: correção de gate e mensagem do composer não a repetem.
- **O comentário de `decide.ts`** que diz *"não está semeado em
  `INFRA_AUTONOMY_SEEDS`"* fica desatualizado nesta mudança, porque o arquivo
  é de outra frente em curso na mesma rodada; a regra em si (`container_start`
  fora dos tetos, capaz de chegar a `auto_approve`) não muda.
