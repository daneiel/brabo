# 0185 — "Estou pronto — a necessidade está validada": um clique fecha a prontidão, o gate `necessidade-validada` e o aceite do PO

## Status

**Accepted.** 2026-09-30 (AT-311 e AT-312, história HS-079, épico EP-031,
rodada 32). Decisão do dono, com as duas perguntas do levantamento da AT-309
respondidas SIM:

> "Um único clique 'Estou pronto — a necessidade está validada' pode fechar os
> dois gates, mesmo com o product_brief produzido depois do clique?"
>
> "O aceite do PO pode ser implícito no 'Estou pronto'?"

Revê o desenho do [ADR 0095](0095-gate-necessidade-validada.md) (o gate
`necessidade-validada` fecha com um clique SEPARADO) e a
[RN-406](../business-rules.md#rn-406). Não edita o 0095: registra o que muda e
o que dele continua valendo.

## Context

Medido em `origin/dev` (`94e5dc721d`), a partir do levantamento da AT-309:

- **"Validar necessidade" não travava nada.** O botão habilitava só com
  `artifact.product_brief` na sessão (`hasProductBrief`, `session-readiness.ts`),
  vinha DEPOIS de "Estou pronto para produzir", gravava só `necessity.validated`
  (`ValidateNecessityUseCase`), e o gate é `warn` em `docs/gates.yml` — a
  própria RN-406 diz que nada no produto CONSULTA a passagem.
- **Aceitar o PO era um clique a mais logo depois do "Estou pronto".** O
  handoff Criativo→PO nasce dentro do turno que o "Estou pronto" dispara
  (`CriativoServer.executar_confirm_readiness/1` → `EngineApiClient.create_handoff`
  → `POST /internal/sessions/:id/handoffs`), e o card de aceite chamava
  `AcceptHandoffUseCase`, que grava a transição para `accepted`,
  `handoff.accepted` (ator a pessoa), `agent.activated` (ator a pessoa) e, pela
  RN-635, o `handoff.superseded` das outras ofertas ao PO no projeto.
- Três cliques — pronto, validar, aceitar — para expressar uma intenção: "o
  que o Criativo levantou está certo, pode seguir".

O 0095 recusou explicitamente fundir a validação no `confirm_readiness`, com
um argumento que continua certo: o `confirm_readiness` sozinho é o PISO
estrutural ("≥1 regra capturada", RN-142), não um julgamento de MÉRITO, e
fundir os dois "manteria o piso raso disfarçado de gate novo". O que responde
a essa objeção aqui é o RÓTULO: o clique deixa de ser "Estou pronto para
produzir" e passa a ser "Estou pronto — a necessidade está validada". A pessoa
declara as duas coisas com as palavras das duas; o piso estrutural continua
sendo checado pelo engine, e o mérito continua sendo declarado por um humano.

## Decision

### 1. Um POST, dois eventos (RN-657)

`POST .../sessions/:id/readiness` (`ConfirmReadinessUseCase`) grava
`readiness.confirmed`, chama o engine e, **só se o engine aceitou o turno**,
grava `necessity.validated` com a mesma pessoa como ator,
`productBriefId: null`, `via: 'readiness.confirmed'` e o `readinessEventId`.
`productBriefId` nulo é a resposta à segunda metade da pergunta do dono: o
brief nasce do turno que o clique dispara, e o evento aponta para o CLIQUE,
não para um brief que ainda não existe.

A recusa do engine (409 turno em curso, 422 sem regra) sobe antes do segundo
evento: sem turno aceito não há brief a caminho, e a necessidade não fica
validada. O `readiness.confirmed` continua sendo gravado ANTES do comando,
como sempre (ADR 0163).

O gate segue `warn`. Nada passou a consultá-lo, e promovê-lo continua sendo
decisão de produto com ADR próprio, como o 0095 disse.

### 2. O aceite do PO é implícito, com os MESMOS eventos (RN-658)

O `readiness.confirmed` do clique novo leva a marca
`{ necessidadeValidada: true, aceiteImplicitoDoPo: true }`. Quando o engine
cria a oferta Criativo→PO pela rota interna, a api pergunta
(`decidirAceiteImplicitoDoPo`, regra pura) se ela é a oferta que aquele clique
pediu — `criativo` → `po`, `offered`, desta sessão, levando o `product_brief`
nascido DEPOIS do `readiness.confirmed` marcado mais recente — e, se for, a
aceita por `AcceptHandoffUseCase`, o MESMO caso de uso do card, em nome de quem
clicou.

A trilha auditável é a do card, sem evento novo: `handoff.accepted` e
`agent.activated` com a pessoa como ator, e a marca
`implicito: { via: 'readiness.confirmed', readinessEventId }` no payload dos
dois. Das duas opções que o dono deixou (evento novo, ou os mesmos com ator
humano e marca), a segunda foi a escolhida porque todo leitor de hoje —
`canActivateAgent`, a lista de handoffs, a projeção do grafo, a tela — já
entende `handoff.accepted`; um evento novo exigiria ensinar cada um, e um
esquecido leria o PO como nunca aceito. Nenhum evento é editado.

O aceite acontece na rota interna e não no POST do clique porque a oferta não
existe no momento do clique. A falha do aceite não sobe ao engine (o Criativo
narraria "não consegui oferecer o handoff", falso): vira `agent.error` durável,
ator `system`/`aceite-implicito`, com origem. O 400 "não está `offered`" não é
falha — outra aba decidiu a oferta no intervalo, e isso já está no log.

### 3. O engine não muda

Medido: o Criativo não espera nada do aceite (a resposta da rota interna só é
casada com `{:ok, _}`), e o PO é ativado pelo mesmo `startAgent` de sempre,
cujo `kickoff` é `GenServer.cast`. A única diferença é o MOMENTO: o PO sobe
dentro da chamada de criação da oferta, ainda no turno do Criativo, e não
depois de um clique humano.

### 4. A tela

O botão se chama "Estou pronto — a necessidade está validada" (en: "I'm ready
— the need is validated"), o título habilitado diz o que o clique fecha e que o
PO entra sozinho, e o aviso de sucesso repete isso. O botão "Confirmar
necessidade validada" saiu, com o `handleValidateNecessity` e o
`validateNecessity` do cliente. O clique também faz do PO o destinatário do
composer — é o gesto de chamá-lo, o mesmo que aceitar pelo card (RN-631).

## Consequences

**A favor**

- De três cliques para um, sem tocar teto nenhum: aceitar o PO não provisiona
  repositório (só Arquiteto e Dev Lead, RN-582), não faz merge nem push.
- A validação continua sendo de uma PESSOA, nunca do Criativo — o anti-padrão
  que o 0095 existia para evitar continua evitado.
- A trilha do aceite é a mesma do card, legível por todo consumidor existente,
  e a marca diz de qual clique ele veio.

**Contra, declarado**

- `necessity.validated` deixa de apontar para o brief que validou: a ligação é
  pelo `readinessEventId`, e o brief é o `artifact.product_brief` seguinte
  àquele clique. Quem precisar do par exato lê o log na ordem.
- A validação é declarada ANTES de a pessoa ler o resumo. Foi o que o dono
  decidiu; o gate é `warn` e mede a declaração, não a leitura.
- `POST .../agents/criativo/validate-necessity` continua na api, sem consumidor
  na tela: é o caminho de uma sessão cujo "Estou pronto" é anterior a este ADR
  (lá o card de aceite também continua, porque o evento antigo não tem a marca).
  Removê-lo é quebra de contrato de API e fica para quando não houver sessão
  antiga que o use.
- O PO sobe sem clique humano no momento da subida. O humano decidiu antes,
  no clique, e é ele o ator gravado.

## Alternatives considered

**Evento novo (`handoff.accepted_implicitly`).** Recusada: ver ponto 2 — cada
leitor de `handoff.accepted` teria de aprender o segundo tipo.

**Aceitar no POST do clique, pré-criando a oferta.** Recusada: a oferta leva o
`product_brief` como artefato e nasce do turno do Criativo; criá-la antes
exigiria mudar o engine e oferecer um handoff sem o artefato que o justifica.

**Deixar o engine chamar a rota humana de aceite.** Recusada: a rota humana
exige um usuário autenticado, e um agente ativando agente é exatamente o que
a descrição da rota interna recusa. Aqui quem decide é a api, pela marca que a
PESSOA gravou.

## References

- [ADR 0095](0095-gate-necessidade-validada.md) — o desenho que este revê
- [ADR 0163](0163-o-clique-responde-ao-aceitar.md) — o clique responde ao aceite
- [ADR 0182](0182-ciclo-de-vida-do-handoff.md) — `superseded`, preservado
- [RN-406](../business-rules.md#rn-406), [RN-657](../business-rules.md#rn-657),
  [RN-658](../business-rules.md#rn-658), [RN-633](../business-rules.md#rn-633),
  [RN-635](../business-rules.md#rn-635)
- `apps/api/src/domain/sessions/estou-pronto.ts`
- `apps/api/src/application/use-cases/agents/confirm-readiness.use-case.ts`
- `apps/api/src/application/use-cases/agents/aceite-implicito-do-po.use-case.ts`
