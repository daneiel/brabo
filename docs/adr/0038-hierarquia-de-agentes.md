# 0038 — Hierarquia de agentes: áreas, leads e delegação

## Contexto

Desde a Fase 3b, um handoff endereça qualquer agente do roster diretamente:
`CreateHandoffUseCase` recebe `toAgent` e cria o registro sem validar quem pode
ser alvo — `Handoff { fromAgent, toAgent, artifactId, status }`, com
`toAgent` livre (`apps/api/src/domain/sessions/handoff.entity.ts`). A única regra
de ativação hoje é `canActivateAgent` (`domain/sessions/agent-activation.ts`):
um agente só entra em cena com um handoff `accepted` endereçado a ele, exceto o
Criativo, que inicia por comando do usuário.

Isso funcionou até a Fase 4 porque cada agente era uma unidade só: um handoff,
um agente, um parecer. A Fase 8 introduz **subespecialidade dentro de área** — a
primeira instância é o QA (8b), que passa a ter QA de Automação e QA de
Performance/Segurança —, e nesse desenho um handoff endereçando diretamente uma
subespecialidade quebraria a premissa que todo o resto do sistema assume: **um
handoff, uma resposta**. Se o Arquiteto pudesse endereçar `qa-performance`
diretamente, quem consolida o parecer com o de `qa-automacao`? A resposta não
pode ser "ninguém" — o gate espera UM veredito por área
(`pr-gate-state-machine.ts:nextGateStatus`, que recebe um `GateVerdict` só).

Este ADR fixa o modelo genérico — área, lead, delegação, consolidação,
orçamento, falha — **antes** de qualquer subespecialidade existir. QA (8b) e o
subagente de Workflows no Infra (8c) são instâncias do mesmo modelo, não
desenhos próprios.

### Por que a ORIGEM da falha precisa ser tipada agora

O CLAUDE.md exige desde o ADR 0020 que todo desfecho de falha registre origem —
`infra | modelo | código | política` — e proíbe diagnóstico por eliminação. Na
prática, a origem é hoje **texto livre** dentro de `reason`/`diagnosis`: em
`qa_agent_server.ex:176-183`, `falha_do_qa({:limit_reached, _})` devolve a frase
*"limite de iterações atingido sem emit_qa_verdict"* — correta, mas não é um
valor que outro código possa ramificar sobre.

O item 4 desta fase exige que **o lead decida com base na origem**
(redistribuir | consolidar parcial | bloquear), e decisão automática não pode
ramificar sobre prosa. Portanto este ADR tipa `failure_origin` e **retrofita** os
pontos que já classificam falha informalmente — `task_blocked`, `dev.error`, os
pareceres de QA e SecOps — em vez de introduzir o tipo só para as delegações e
deixar o resto do sistema com dois vocabulários de falha coexistindo.

## Decisão

### 1. Área é de projeto, e tem exatamente um lead

`agent_areas` (uma linha por área, por projeto) e `agent_area_members` (quem
pertence, com um booleano `is_lead`). Duas invariantes garantidas **no banco**,
não só em aplicação — este repo trata constraint como regra de negócio
(`docs/.docmap.yml`, regra `schema-e-migrations`):

- `unique(project_id, agent)` em `agent_area_members` — um agente pertence a
  **no máximo uma** área, e o lead está sujeito à mesma regra: ele não pode ser
  também membro comum de outra área.
- `unique(area_id) where is_lead` — **no máximo um** lead por área. A
  *existência* de um lead (pelo menos um) é invariante de criação, validada no
  domínio quando a área é montada, não constraint de banco — uma área sendo
  composta membro a membro passaria por um estado transitório sem lead que o
  banco não tem como distinguir de um erro.

Agentes sem área — Criativo, PO, Arquiteto, Psicólogo, Anamnese — não entram em
`agent_area_members` e continuam exatamente como hoje: endereçáveis por handoff
direto. Este ADR não muda o fluxo deles.

**Dev fica de fora nesta fase.** `dev-<modulo>` é instanciado dinamicamente
por módulo (ADR da Fase 4) e não vira área — não há "Dev Lead" ainda. Registrado
como extensão futura, não implementado (ver Consequências).

### 2. Handoff externo só endereça lead ou agente sem área

`CreateHandoffUseCase` — o único lugar do sistema que hoje grava `toAgent` sem
validação — passa a chamar `assertHandoffTargetAllowed(toAgent, membrosDaÁrea)`
antes de criar o registro. Alvo que é subagente de uma área (membro, não lead)
é rejeitado com um erro tipado (`HandoffToSubagentError`, com o agente e a área
no erro), não filtrado em silêncio nem promovido ao lead por engano.

`OfferInfraHandoffUseCase` (a confirmação de prontidão que sinaliza o engine a
oferecer o handoff ao InfraAgent) **não** grava `toAgent` — ele só dispara o
engine, que é quem chama `CreateHandoffUseCase` depois. A validação mora num
lugar só, no ponto que efetivamente decide o alvo.

Isso é o precedente de `agent-activation.ts` estendido: aquele arquivo decide
"quem pode ATIVAR"; este decide "quem pode ser ALVO de handoff **externo**" — a
segunda pergunta não existia porque, até agora, todo agente era externo por
definição.

### 3. Delegação é o mecanismo interno, e é privado da área

`delegations`: um lead delega uma tarefa a um subagente da MESMA área.
`assertDelegationAllowed(lead, subagent, membros)` rejeita quem não é lead da
área e quem delega para fora dela. Delegação **nunca** aparece como handoff —
são tabelas e ciclos de vida diferentes, e a distinção é o que preserva a
propriedade "o lead é o único contato externo": nada fora da área observa uma
delegação individual, só o resultado consolidado.

### 4. Consolidação: um artefato só, contrato externo intocado

O lead fecha o handoff que recebeu com **um** artefato
`consolidated_verdict` — tipo novo em `ArtifactSchemas` (engine),
**server-emitted** como `task_blocked` e os `*_verdict` já são: nenhum dos três
é algo que o modelo escolhe emitir por tool call, são o registro de um desfecho
que o servidor determina. Payload: `área`, `veredito`, `resumo`, e
`delegações` — a lista dos pareceres internos referenciados por id, não
copiados (rastreabilidade sem duplicar conteúdo).

`ArtifactSchemas` valida a FORMA (toda delegação `completed` tem
`parecerArtifactId`; toda `failed` tem `failureOrigin`) — é a mesma pergunta que
`check_extra/2` já responde para `qa_verdict`/`secops_verdict` hoje. O domínio
da api valida a REGRA — só é possível consolidar com **todas** as delegações
resolvidas (`assertConsolidatable`, rejeitando com a lista do que falta) —
porque só a api tem a lista completa de delegações da área; o engine, no
momento de emitir o artefato, só sabe do que já recebeu.

**O contrato externo dos gates não muda.** `nextGateStatus` continua recebendo
um `GateVerdict` (`approved | changes_requested`) por gate — o `consolidated_verdict`
é o que o QA Lead **usa para decidir** aquele veredito único; quem chama o gate
nunca vê uma delegação. Esta é a garantia central deste ADR: a hierarquia é
invisível de fora da área.

### 5. Orçamento em cascata, falha com origem obrigatória

Teto na área (`agent_areas.budget_micros`), sub-teto por delegação
(`delegations.budget_micros`, opcional — nem toda delegação precisa de um).
Estouro do sub-teto vira `failed` com `failure_origin = politica` — é a mesma
classificação que orçamento de sessão/projeto já usa em
`budget-threshold.ts`, estendida à delegação.

**O `budgets` da Fase 1 não é tocado.** Ele tem `budgets_scope_check` fechado
para exatamente dois escopos (`project` XOR `session`); acomodar um terceiro
escopo ali alteraria uma tabela central por uma necessidade local da área. O
teto de área e o sub-teto de delegação vivem nas tabelas novas.

Toda falha de subagente — estouro, `task_blocked` equivalente, o que for —
chega ao lead com `failure_origin` preenchido. O lead decide um de três
desfechos, e a decisão **é** um evento (`area.decision`), nunca um efeito
colateral silencioso:

- **redistribuir**: nova delegação nasce, cobrindo o que a falha deixou
  pendente;
- **consolidar parcial**: o `consolidated_verdict` fecha com o que há, citando
  a delegação `failed` e sua origem — o consumidor externo vê um veredito
  completo, mesmo que internamente uma parte tenha falhado;
- **bloquear**: a área inteira fica bloqueada com a origem real propagada —
  nunca `changes_requested` genérico como o Fase 4a já corrigiu para o caso do
  QA sem parecer (ver o comentário em `qa_agent_server.ex:148-153`, que este
  ADR generaliza).

### 6. Origem da falha: tipo novo, retrofit em todo o sistema que já classifica falha

`failure_origin`: `infra | modelo | codigo | politica` (enum Postgres, sem
acento como os demais enums de `schema.ts`). Retrofit — decisão explícita, não
compromisso do modelo com delegação apenas:

- `tasks.blocked_origin` e `stories.blocked_origin` (colunas novas, ao lado de
  `blocked`/`blocked_reason` existentes — **campo novo, não substituição**);
- `Engine.Dev.AgentIo.block_task/3` ganha um 4º argumento; os ~18 pontos de
  chamada em `dev_agent_server.ex`/`noop_dev_agent_server.ex` são classificados
  um a um (worktree falhando é `infra`; contexto malformado é `codigo`; limite
  de iterações é `modelo`; orçamento é `politica`);
- `falha_do_qa/1` (`qa_agent_server.ex`) e o equivalente do SecOps passam a
  devolver origem junto de `reason`/`diagnosis`;
- `task_blocked` em `ArtifactSchemas` ganha `origin` nas chaves obrigatórias.

Nenhuma mensagem existente é removida ou reescrita — a origem é um campo NOVO
ao lado do texto livre, que continua existindo para o humano ler.

## Consequências

### O que fica disponível

- Handoff a subagente é erro em tempo de criação, não um bug latente que só
  apareceria quando alguém tentasse.
- O gate de QA (8b) e o subagente de Workflows no Infra (8c) têm o mecanismo
  pronto — nenhum dos dois precisa reinventar delegação ou consolidação.
- Toda decisão de falha parcial vira evento auditável (`area.decision`),
  fechando a lacuna que o CLAUDE.md já proibia em teoria e não tinha como
  impedir na prática — origem era texto, e texto não impede um `if` de
  adivinhar.

### O que fica registrado como extensão futura, não implementado

- **Dev Lead.** `dev-<modulo>` continua instanciado dinamicamente por módulo,
  sem lead. Se um dia precisar de área, o modelo já serve — área não pressupõe
  quantidade fixa de membros nem instrução fixa por subagente.
- **Áreas propostas pelo Arquiteto via `module_map`.** Hoje área é criada
  implicitamente pelo escopo de cada fase (QA em 8b, Infra em 8c); a ideia de o
  Arquiteto propor área nova dinamicamente, a partir do mapa de módulos que ele
  já produz, fica fora do escopo — exigiria um fluxo de aprovação próprio.

### Riscos assumidos

- **O retrofit da origem toca código da Fase 4 validado por execução real**
  (ADR 0020). Cada um dos ~18 pontos é classificado individualmente e nenhuma
  mensagem existente muda — o risco é de esquecer um ponto, não de quebrar um
  que já funciona; os testes cobrem os pontos, não uma amostra.
- **`delegation_status` nasce com um valor sem uso** (`dispensed`, reservado
  para o 8b — "sem RNF de performance, delegação dispensada"). Alterar um enum
  Postgres depois de escrito é migration com trava de tabela; nasce agora para
  não pagar esse custo duas vezes.
- **Sem varredura de delegação órfã.** Se o engine morrer entre iniciar uma
  delegação e reportar o resultado, ela fica `pending` para sempre nesta fase —
  o lead não consolida (comportamento correto: não fecha parecer incompleto em
  silêncio), mas também não há alarme automático. Fica para quando houver um
  caso real, não hipotético.

## Fechamento (Fase 8d)

As duas instâncias previstas neste ADR foram construídas — QA (8b) e o
subagente de Workflows no Infra (8c) — mais o lado de apresentação (8d:
painel do time agrupado por área, timeline de PR expandindo pareceres
internos, Insights agrupados por área, feed narrando delegação). Fechando o
que ficou decidido versus o que ficou pendente:

### `consolidated_verdict` não foi implementado — decisão validada na prática

A decisão #4 acima desenhou um artefato genérico `consolidated_verdict`. Nem
QA nem Infra o usam: os dois já tinham um contrato PRÓPRIO e ANTERIOR ao
ADR — `qa_verdict` (QA) e `open_infra_pr` (Infra) — e mudar esse contrato
quebraria `RecordGateVerdictUseCase`/`ExecuteInfraPrUseCase` e os demos que
já provavam o caminho feliz sem a hierarquia. `Engine.Gates.QaLead.
consolidar/1` produz exatamente a forma de `qa_verdict`;
`Engine.Infra.InfraLead.consolidar/2` produz a união de arquivos que
`open_infra_pr` já esperava. Quem consome nunca soube que existia mais de
um agente por trás — a garantia central do ADR (linha 118 acima) se provou
sem precisar do artefato genérico.

`consolidated_verdict` continua disponível em `ArtifactSchemas` como
DESENHO, não como código — uma área futura sem um artefato próprio pra
reaproveitar (ao contrário de QA/Infra, que já tinham um antes de virar
área) é o candidato natural a implementá-lo de verdade. Até lá, o padrão
estabelecido é: **prefira reaproveitar o artefato que a área já emitia
antes de virar área**; só implemente o genérico se não houver um.

### Dev Lead e áreas dinâmicas — ainda não implementados, e a semente registrada

Os dois itens que a seção "extensão futura" já registrava continuam de
fora, confirmados após três instâncias reais do modelo (QA, Infra, e a UI
que os expõe). Registrando a semente da segunda, como pedido:

**O `module_map` já dita QUANTOS dev agents existem** — um por módulo
(`devAgentId`/`Engine.Dev.*` derivam disso hoje, sem tabela própria: a
existência do dev é uma FUNÇÃO do module_map, não um registro paralelo). O
passo natural — não implementado aqui — é o Arquiteto propor não só os
módulos mas o AGRUPAMENTO deles em área: por exemplo, `payments-api` e
`payments-worker` sob uma área "payments", com um dos dois (ou um lead
dedicado) como contato externo. Isso viraria a mesma dinâmica de "área
existe porque o module_map diz que existe" que hoje só vale pra dev
individual — área deixaria de ser um catálogo fixo (QA, Infra) e passaria a
ser uma PROPOSTA do Arquiteto, com aprovação do usuário, como module_map já
é.

Pré-requisitos pra isso virar código, não só ideia: `agent_areas`/
`agent_area_members` de verdade (o aparato que 8b/8c cortaram de escopo
deliberadamente — hoje `area`/`subagent`/`leadAgent` em `delegations` são
TEXT, sem tabela de associação, porque só existiam duas áreas fixas
conhecidas de antemão); um fluxo de aprovação pra criação de área (mesmo
padrão de handoff/module_map, usuário decide); e uma resposta pra "quem
vira lead" quando a área nasce de proposta, não de um catálogo fixo — Dev
Lead e área dinâmica são o MESMO problema em aberto, não dois.
