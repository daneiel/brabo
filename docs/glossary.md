---
id: glossary
title: Glossário
sidebar_label: Glossário
sidebar_position: 9
description: A linguagem ubíqua do Brabo — os termos que aparecem no código, nas telas e nos ADRs, com o significado que têm aqui.
keywords: [glossário, linguagem ubíqua, harness, gate, handoff, DEK, outbox]
---

# Glossário

Os termos abaixo são **linguagem ubíqua**: o nome que aparece na tela é o mesmo
que está no código, no evento e no ADR. Vários deles existem fora daqui com
sentido mais largo — esta página diz o que significam **neste** sistema.

Ordenado por assunto, porque procurar "harness" sem saber que é um conceito de
agente é raro; o mais comum é chegar pelo tema.

---

## Sessão e evento

**Sessão** — uma conversa com efeito, do início ao encerramento. É a unidade de
trabalho, de custo e de rastreamento: uma sessão é uma trace raiz na
observabilidade e um escopo de orçamento. Passa por cinco estados
([RN-001](business-rules.md#rn-001)).

**Event log** — a tabela `session_events`. Append-only: nunca há `UPDATE`.
Cada linha tem uma `seq` contínua dentro da sessão. É a fonte de verdade do que
aconteceu e o que torna a evidência do Psicólogo rastreável
([RN-002](business-rules.md#rn-002)).

**`seq`** — o número de ordem do evento dentro da sessão. Densa: começa em 1 e
não tem buraco. Buraco na `seq` é corrupção, e o restore reprova por isso.

**`closing`** — estado de **passagem**, não de repouso. Sessão parada em
`closing` significa que o drain começou e não completou; há alerta para isso.

**Órfã** — sessão `active` na api sem processo dono vivo no engine. É o modo de
falha que o graceful shutdown existe para eliminar; a definição operacional
está no [runbook](runbook.md#quando-a-sessao-escapa).

**Outbox** — padrão *transactional outbox*. A api grava o evento e a intenção
de publicá-lo **na mesma transação**; o engine consome depois via Oban. É o que
faz "gravou o evento" e "o engine soube" nunca divergirem. Não há Redis — a
fila mora no Postgres.

---

## Agentes

**Agente** — processo de longa duração com um papel e uma identidade. Onze
papéis canônicos hoje, definidos em
`apps/engine/lib/engine/harness/agents.ex`:

| slug | papel |
|---|---|
| `criativo` | conduz a ideação com o usuário e emite regras de negócio |
| `po` | transforma o brief em backlog (épicos, histórias, tarefas) com DoD e DoR |
| `arquiteto` | decisões técnicas (ADRs) e o mapa de módulos |
| `dev-backend` · `dev-frontend` | implementam; rodam em worktree isolado |
| `infra` | provisionamento, deploy e ambientes — **propositivo**, não executor |
| `qa` | gate semântico: testes e critérios de aceite |
| `secops` | gate determinístico: segredos, segurança, conformidade |
| `psicologo` · `psicologo-leve` | analisam sessões e propõem hipóteses com evidência |
| `anamnese` | perfila a proficiência do usuário e propõe patches de instrução |

Os nomes são **papéis do produto**, escritos em maiúscula quando usados como
substantivo ("o Arquiteto propôs um ADR"). Devs são **dinâmicos**: um agente
por módulo do `module_map`, não uma lista fixa.

**Área** (Fase 8b/8c, [ADR 0038](adr/0038-hierarquia-de-agentes.md)) — `qa` e
`infra` da tabela acima viraram LEAD de área: continuam o único contato
externo (mesmo slug, mesmo comportamento visto de fora), mas passam a
**delegar** a subagentes — `qa-automacao`/`qa-performance-seguranca` (QA),
`infra-workflows` (Infra). Delegação é mecanismo INTERNO da área, nunca um
handoff; o que a área devolve pra fora continua sendo um artefato só
(`qa_verdict`, `open_infra_pr`) — quem consome nunca sabe que existe mais de
um agente por trás.

**Harness** — o invólucro obrigatório de todo agente. Nenhuma chamada de LLM ou
de ferramenta acontece fora dele. Cinco peças:

| peça | faz |
|---|---|
| **PromptAssembler** | monta o prompt em **camadas ordenadas** com orçamento de tokens por camada e corte **determinístico** — mesmo contexto, mesmo prompt |
| **ContextManager** | compacta quando o contexto cresce |
| **ToolLoop** | o laço pedido-de-ferramenta → execução → resultado, com teto de iterações |
| **InstructionFiles** | resolve os `AGENTS.md` em ordem crescente de precedência (raiz → diretório → banco) |
| **Hooks** | pontos de interceptação em volta do laço |

**Camada** (do prompt) — um bloco com `id`, conteúdo e política de corte
(`truncate_tail`, `keep_or_drop`, `drop_whole_units`). O orçamento é por
camada, e é isso que torna o corte previsível em vez de "cabe o que couber".

**ToolLoop** — o laço do agente. Um turno é: montar prompt → chamar o modelo →
o modelo pede uma ferramenta → a ferramenta vira `proposed_action` → política
decide → executa → resultado volta ao contexto. Tem teto de iterações; esgotado,
o agente encerra com artefato de bloqueio.

**Turno (agente conversacional)** — uma rodada de trabalho de um dos quatro
agentes conversacionais session-scoped (Criativo, PO, Arquiteto, Dev Lead):
uma chamada streamada ao LLM mais o loop de ferramentas que ela dispara.
Desde [RN-122](business-rules.md#rn-122) roda numa `Task` supervisionada
(`Engine.Agents.TurnoAssincrono`), não mais dentro do `handle_call` que
recebia a mensagem — é o que permite o botão **"Parar"** do composer
cancelar o turno DE VERDADE (mata a task, corta a conexão com a api) em vez
de só parar de renderizar no cliente. Cada um tem teto PRÓPRIO de voltas do
laço (Criativo e PO 12, Arquiteto e Dev Lead 14) — é constante do servidor do
agente, não o teto do `ToolLoop` (`Engine.Harness.Iteracoes`), que vale para os
agentes de execução e de gate. O Criativo foi o último a ganhar o laço, em
[RN-163](business-rules.md#rn-163): até então ele chamava o modelo uma vez por
turno e prometia uma correção que nunca acontecia. Esse teto próprio também
deixou de ser silencioso: esgotado, emite o MESMO `toolloop.limit_reached`
([RN-166](business-rules.md#rn-166)), porque é o mesmo fato e quem lê o event
log não deve precisar de um segundo nome.

**Handoff** — passagem explícita de trabalho de um agente para outro. Explícita
porque o destino e o motivo ficam registrados no event log, em vez de um agente
"assumir" o contexto do outro implicitamente.

**Artefato** — saída estruturada e validada de um agente. Sete schemas fechados
(`note`, `business_rule`, `product_brief`, `task_blocked`, `qa_verdict`,
`secops_verdict`, `infra_delegation_files`): campo faltando reprova a
emissão. É como o parecer de um gate vira dado, não texto. `business_rule`
reprova por um segundo motivo: título já registrado no projeto
([RN-080](business-rules.md#rn-080)) — como artefato é evento imutável, a
emissão é o único momento em que dá para recusar uma duplicata.

**Worktree** — `git worktree`: uma cópia de trabalho isolada por dev agent,
sobre o mesmo repositório. Dois devs mexem em branches diferentes sem se
atropelar. É por **agente**, não por task: quem reivindica a próxima task
substitui o diretório, e é isso que obriga o agente a segurá-lo enquanto um
gate ainda vai lê-lo.

**Modo de workspace** — onde o código de um projeto mora no disco, escolhido na
criação e **congelado** depois ([ADR 0072](adr/0072-projeto-local-ou-container.md),
[RN-169](business-rules.md#rn-169)). `container` é a pasta gerenciada sob
`PROJECT_WORKSPACES_ROOT` — o default e o comportamento de sempre; `local` é um
caminho absoluto do usuário, que só funciona se estiver montado no container.
Não confundir com **workspace** de IAM (o agrupamento de projetos e membros):
são a mesma palavra para coisas diferentes, e o modo é sobre disco.

**Estados do dev agent** — `working` (implementando), `awaiting_approval`
(propôs commit/push/PR e alguma ficou pendente de aprovação — **sem PR não se
abre gate**, [RN-050](business-rules.md#rn-050)), `awaiting_gate` (PR aberta,
esperando o veredito), `idle` (sem task pegável, processo vivo) e
`idle_tripped` (circuit breaker disparado, só sai por rearm explícito —
[RN-047](business-rules.md#rn-047)). Os três primeiros retêm o worktree.

---

## Aprovação

**`proposed_action`** — toda ação com efeito externo (comando de terminal,
commit, push, PR, merge, gasto) **nasce** aqui, não executa direto. Treze tipos.
Seis estados ([RN-003](business-rules.md#rn-003)).

**`permissions.json`** — o arquivo de política do projeto. Casa padrão de
comando (estruturado, não substring) e devolve `allow`, `deny` ou
`require_approval`.

**`deny` vence `allow`** — a regra que atravessa o sistema inteiro. A decisão
avalia IAM → `agent_autonomy` → `permissions.json`, e `deny` em qualquer
estágio retorna na hora ([RN-004](business-rules.md#rn-004)).

**Teto** — um rebaixamento aplicado **depois** de toda a política, que nenhuma
configuração consegue promover. Existem dois: merge em branch protegida
([RN-006](business-rules.md#rn-006)) e patch de instrução
([RN-007](business-rules.md#rn-007)). Um teto é a diferença entre "por padrão
não" e "não".

**`agent_autonomy`** — o modo de operação dos agentes num projeto: `manual`
(toda ação pede aprovação) ou automático. É o primeiro botão a desligar num
incidente de custo.

**Branch protegida** — `dev`, `qa`, `rc`, `main`. Merge com destino numa delas
é **sempre** decisão do humano. A proteção equivalente na plataforma
(GitHub/GitLab) diverge entre providers e **não** é o portão — o portão é o
domínio ([ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md)).

---

## Gates e execução

**Gate** — um portão obrigatório entre o PR do dev e o merge. Dois: **QA**
(semântico, roda LLM) e **SecOps** (determinístico, roda scanner). A ordem é
imutável: `awaiting_qa → awaiting_secops → awaiting_user`
([RN-014](business-rules.md#rn-014)).

**`awaiting_user`** — o estado terminal da máquina de gates. Terminal de
propósito: o sistema nunca mergeia.

**`changes_requested`** — devolução do gate ao dev, **na mesma branch**. Não
abre PR nova.

**Ciclo K** — o teto de correções por task. Cada devolução consome uma volta;
esgotado, a task é bloqueada com motivo em vez de girar para sempre. O
subagente herda o teto do agente base
([RN-015](business-rules.md#rn-015)).

**`task_blocked`** — o artefato emitido quando uma task não avança: carrega
`reason` e `diagnosis`. É registro de fracasso legível, não silêncio.

---

## Backlog e arquitetura

**Regra de negócio (RN)** — unidade emitida pelo Criativo e vinculada a
histórias. Regra sem história é **pendência de cobertura**, não erro
([RN-011](business-rules.md#rn-011)).

**História** — quatro estados; para sair de `draft` precisa de DoD, DoR, ao
menos um requisito funcional e ao menos uma regra vinculada
([RN-010](business-rules.md#rn-010)).

**DoD / DoR** — Definition of Done e Definition of Ready. Aqui não são
cerimônia: sem os dois, a história não muda de estado.

**`module_map`** — o mapa de módulos do sistema, do Arquiteto. Define quantos
dev agents existem (um por módulo) e a quem cada história pertence. Não pode ter
ciclo ([RN-013](business-rules.md#rn-013)); módulo removido rebaixa as
histórias que dependiam dele ([RN-012](business-rules.md#rn-012)).

**Imagem do projeto (`artifact.project_image`)** — a decisão do Arquiteto
sobre qual container roda o código do projeto: imagem OCI (tag explícita
obrigatória, `latest` recusado), postura de rede (`none` por default,
`egress` autorizado) e teto de recursos. Versionada no event log, como o
`module_map`. Enquanto não existe, é o estado `sem_decisao` que fecha a aba
Code ([RN-105](business-rules.md#rn-105)).

---

## Custo

**Metering** — o registro de consumo por chamada em `token_usage`: tokens,
custo em micros, latência, modelo, agente. É **registro, não estorno**.

**Budget** — teto de gasto com escopo exclusivo: projeto **ou** sessão, nunca
ambos ([RN-017](business-rules.md#rn-017)). Notifica em 70/90/100% sem repetir.

**`policy`** — o comportamento do budget no teto: `block` recusa a chamada,
`allow` só registra. Um projeto em `allow` **não para sozinho** — é a causa mais
comum de "o orçamento não segurou" ([RN-019](business-rules.md#rn-019)).

**Binding** — a amarração entre um escopo e um modelo de LLM. Resolve em
cascata: **sessão > agente > área > projeto > workspace**, o primeiro que
existir ([RN-020](business-rules.md#rn-020)). É por isso que dá para pôr um
modelo caro só no QA. `área` é o PADRÃO que lead e subagentes de uma área
compartilham, e o agente pode divergir ([RN-102](business-rules.md#rn-102)).

**Faceta de capability** — o que o **provider declara** sobre um modelo: lê
imagem, gera imagem, faz thinking, aceita `tools`. Vem do catálogo remoto no
sync; `false` quer dizer "não declarou", nunca "não faz"
([RN-056](business-rules.md#rn-056)).

**Uso do modelo** — para que **este workspace** usa aquele modelo (`codigo`,
`documentacao`, `analise`, `imagem`, `conversa`). É opinião de quem opera, não
capability: nenhum catálogo publica "bom para código". Marcar uso **não liga** o
modelo no seletor ([RN-057](business-rules.md#rn-057)).

---

## Psicólogo e Anamnese

**Hipótese** — a saída do Psicólogo: uma afirmação sobre o time com
`evidenceEventIds` apontando para eventos reais da sessão analisada. Sem
evidência válida não é gravada ([RN-021](business-rules.md#rn-021)).

**Causa de término** — classificação determinística de por que algo falhou:
`infra`, `modelo`, `código` ou `política`. Vem do motivo registrado, nunca de
julgamento do LLM e nunca por eliminação
([RN-023](business-rules.md#rn-023)).

**`proficiency_profile`** — o perfil de proficiência do usuário mantido pela
Anamnese, por competência. Seis competências de processo, **fechadas** (`git`,
`agile`, `arquitetura`, `testes`, `seguranca`, `infra`), mais as stacks técnicas
derivadas do `module_map`. Nada fora do catálogo tem caminho de escrita
([RN-024](business-rules.md#rn-024)) — a Anamnese perfila competência técnica,
não pessoa.

**`instruction_patch`** — proposta de mudança na instrução de um agente,
versionada. Nunca auto-aprovável ([RN-007](business-rules.md#rn-007)); negado
não é reproposto ([RN-026](business-rules.md#rn-026)); rollback cria versão
nova em vez de apagar ([RN-027](business-rules.md#rn-027)).

---

## Git e segredos

**GitProvider** — o contrato normalizado de doze operações que Local, GitHub e
GitLab implementam. Uma suite de contrato única roda contra os três.

**Capability** — declaração do que aquele provider suporta. Operação não
suportada é rejeitada com erro explícito, nunca falha silenciosa
([RN-028](business-rules.md#rn-028)).

**Bootstrap de Gitflow** — os seis passos que preparam o repositório (branches
permanentes, proteções, arquivos base). Idempotente e retomável: `skip` é
sucesso ([RN-029](business-rules.md#rn-029)).

**Envelope encryption** — cada segredo do usuário é cifrado com um **DEK** (data
encryption key) próprio, e o DEK é "embrulhado" pela `CREDENTIALS_MASTER_KEY`.
Rotacionar a mestra re-embrulha os DEKs sem tocar no texto cifrado — por isso a
rotação é interrompível ([runbook](runbook.md#rotacao-da-chave-mestra)).

**`wrapped_dek`** — o DEK embrulhado, como está no banco. **Não identifica qual
chave o embrulhou** — é essa propriedade que torna a rotação um procedimento de
três etapas e não uma troca de variável.

---

## Infra

**Oban** — a biblioteca de filas em Elixir que usa o **Postgres** como backend.
A profundidade da fila (`oban_queue_depth`) é a métrica que dirige o HPA do
engine.

**Drain** — a fase `preStop` do engine: `/ready` vira 503, sessões novas são
recusadas, e cada sessão do nó é oferecida a um par vivo. O que não for adotado
fecha como `closed_abnormally / node_shutdown` — encerramento correto, não
órfã.

**Adoção** — outro nó assumir o processo de uma sessão. Acontece no drain
(handoff ativo) e no `SessionAdoptionWorker`, que varre a cada 30 s para cobrir
`kill -9` e OOMKill, onde `preStop` não roda.

**`:global`** — o registro distribuído do Erlang. Garante **um dono por sessão
no cluster inteiro**; sem cluster Erlang formado, cada réplica vira uma ilha
([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)).

**Trace raiz** — uma sessão = uma trace, atravessando api ↔ engine. O
`traceparent` fica persistido em `sessions.trace_parent`, e é por ele que se
navega no Tempo. O `trace_id` nasce na **web** (o browser gera o `traceparent`) e
existe mesmo sem coletor: exportar é decisão separada de instrumentar
([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).

**Caminho entre camadas** — a sequência de fronteiras que uma requisição atravessa
na api (`interfaces` → `application` → `infrastructure`), com a duração de cada
passo, emitida como **uma** linha de log por requisição. Vem de um
`AsyncLocalStorage` alimentado pelo decorator `@Traced`, não de span — é o que faz
funcionar sem coletor. Ver [observabilidade](explanation/observability.md).

**Camada** — no caminho acima, o rótulo da fronteira: `interfaces`, `application`,
`domain` ou `infrastructure`. Corresponde aos diretórios de `apps/api/src/` e à
regra de dependência entre eles.
