# 0186 — O handoff do PO ao Arquiteto é aceito sem clique quando o backlog está coberto e o repositório é local

## Status

**Accepted.** 2026-09-30 (AT-314, história HS-079, rodada 32; decisão do dono
em 30/09: *"Handoff oferecido pelo PO (LLM) pode provisionar o repositório local
sem clique?"* — **sim**). Sobre o
[ADR 0165](0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md), que pôs o
nascimento do repositório no aceite do handoff ao Arquiteto e tinha, como
premissa implícita, que esse aceite é sempre o clique de uma pessoa. Não o
edita: **acrescenta um segundo autor do mesmo aceite**, com condições
fechadas, e deixa o lugar do provisionamento exatamente onde o 0165 o pôs.

## Context

Medido no código de `dev` em 2026-09-30 (levantamento da AT-309):

- O PO termina o backlog e chama `offer_handoff(to_agent: "arquiteto")`
  (`po_server.ex`, kickoff: *"Cubra TODAS as regras com ao menos uma história.
  Quando o backlog estiver pronto, ofereça um handoff ao arquiteto"*). A oferta
  nasce `offered` e espera o clique "Aceitar handoff e iniciar Arquiteto".
- Esse clique é o que provisiona o repositório (`AcceptHandoffUseCase`,
  RN-582). Para o repositório `local` — o único que o aceite cria, porque é o
  único provider sem credencial — o clique não escolhe nada: não há hospedagem
  a decidir nem segredo a resolver. É um passo de confirmação num caminho sem
  alternativa.
- A cobertura do backlog já tem UMA conta no produto, `computeCoverage`
  (`domain/backlog/coverage.ts`), usada pela aba Backlog (`GetCoverageUseCase`)
  e pela ferramenta de leitura do PO (`ListBusinessRulesUseCase`, RN-164): uma
  regra é coberta quando ao menos uma história a cita em `businessRuleIds`.
- A tabela do levantamento contou ~11 cliques de decisão (+N promoções) do
  brief à execução; este é um dos que protegem só a si mesmos.

## Decision

1. **Quando.** A oferta `po → arquiteto` é aceita pelo sistema, na MESMA
   requisição em que o engine a cria (`POST /internal/sessions/:id/handoffs`),
   depois da transação da oferta e nunca dentro dela, se e somente se:
   - a oferta está `offered`;
   - o **backlog está coberto** — definição objetiva, medida sobre o que o PO
     grava: o projeto tem **ao menos uma** regra de negócio
     (`artifact.business_rule`) e **nenhuma** regra sem história que a cite em
     `businessRuleIds`, pela MESMA `computeCoverage` da aba Backlog. Zero
     regras não é coberto: "nada a cobrir" não prova que o PO trabalhou;
   - o repositório que o aceite toca é **local e sem credencial**: o projeto
     não tem repositório (o aceite provisionará `local`) ou o que tem é
     `local`, e o projeto não tem conexão de git (OAuth) cadastrada em
     `project_git_connections`;
   - quem abriu a sessão ainda tem, no projeto, o papel que a rota humana de
     aceite exige (`developer`, papel efetivo da RN-471).
   A decisão é o predicado puro `decidirAceiteAutomatico`
   (`domain/sessions/aceite-automatico-do-handoff.ts`); cada "não" tem motivo
   nomeado, e é ele que a resposta ao engine devolve.
2. **Quem aceita continua sendo `AcceptHandoffUseCase`.** O caso de uso novo
   (`AceitarHandoffAutomaticamenteUseCase`) só LÊ e DECIDE; com "sim" chama o
   aceite de sempre, que provisiona o repositório ANTES de `activateAgent`
   (RN-582, ADR 0165). Não há segundo caminho de provisionamento.
3. **Auditável.** O `handoff.accepted` do aceite automático é gravado com o ator
   de SISTEMA `{kind: 'system', id: 'handoff-auto-accept'}` e payload
   `automatico: true`, `emNomeDe` (quem abriu a sessão — é em nome dela que o
   repositório é provisionado, `provisionedBy`) e `criterio` (`regras`,
   `cobertas`, `repositorio`). O `agent.activated` que se segue leva o MESMO
   ator. O aceite humano não muda: ator `user`, sem esses campos.
4. **Falha não sobe.** A oferta já está commitada quando o aceite automático
   roda, e o engine espera a resposta dela; uma exceção ali viraria "falha ao
   oferecer handoff" sobre uma oferta que existe. Então a falha vira o evento
   NOVO `handoff.auto_accept_failed` (ator de sistema, `origem: 'infra'`,
   `error`) e a resposta diz `falhou`. O card da oferta continua ali quando o
   aceite não chegou a marcar `accepted`.
5. **O modelo é avisado.** A resposta da rota interna ganha
   `aceiteAutomatico: {aceito, criterio?, motivo?}` e, com `aceito: true`,
   `status: 'accepted'`; `offer_handoff` do engine diz ao PO que o Arquiteto
   já foi ativado e que não deve oferecer de novo (reofertar daria
   `409 agente_ja_ativo`, ADR 0182).

## Consequences

- O caminho comum (projeto novo, repositório local, PO que cobre as regras)
  perde um clique; o fio mostra o aceite com o critério ("o backlog cobre as N
  regras de negócio e o repositório é local").
- **Repositório remoto ou com credencial continua pedindo o clique**, como
  pedido pelo dono. Handoff manual (ADR 0109) também: ele não passa pela rota
  interna.
- Um handoff oferecido por um LLM passa a produzir um efeito de git (o
  `git init --bare` do provider `local` e o bootstrap de Gitflow) sem clique
  humano. É o preço declarado, e é o que o dono aprovou; os tetos absolutos
  (push, PR, deploy, merge em branch protegida — RN-418) não se movem, porque
  nada disso acontece no provisionamento local.
- A oferta a outros destinos, e a oferta ao Arquiteto por outro agente, NÃO
  ganham aceite automático. Estender a outro par é ADR novo.
- A resposta ao engine demora o que o provisionamento local e o
  `startAgent` demoram, dentro do `receive_timeout` padrão do `Req`. Não
  medido em instalação real nesta sessão.
- Não medido: o engine não foi compilado nem testado nesta sessão (sem Elixir
  no ambiente); a cláusula nova de `offer_handoff` e o teste ExUnit dela foram
  escritos e ficam para a CI.
