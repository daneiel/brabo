# ADR 0097 — Leitura direta do schema do engine para o "N agentes online" do dashboard

- **Status:** Aceito
- **Data:** 2026-08-18
- **Contexto:** fechamento do item de backlog "N agentes online no dashboard"
  (RN-409), herdado da colheita do dogfooding (FASE 13c)

## Contexto

O dashboard precisava de um número de liveness DE VERDADE — quantos agentes
estão trabalhando ou com pendência esperando decisão agora, nunca tamanho de
equipe ou presença histórica (decisão de produto já tomada, ver RN-409). A
investigação prévia confirmou que esse dado só existia em DOIS lugares
diferentes, e nenhum servia ao dashboard como estava:

1. Status ao vivo de verdade só existia no CLIENTE, derivado do event log
   (`deriveAgentRoster`), e só quando um projeto está ABERTO — o dashboard
   lista todos os projetos de uma vez, sem abrir sessão nenhuma.
2. O estado atual de cada dev agent já é persistido — `dev_agent_states`,
   uma tabela do ENGINE, no schema Postgres `"engine"` (Ecto), com chave
   composta `(project_id, agent_id)` e `status` num de cinco valores
   (`working`/`idle`/`idle_tripped`/`awaiting_gate`/`awaiting_approval`,
   RN-047/ADR 0052).

`api` e `engine` compartilham o MESMO banco físico (`brabo`/`brabo_test`),
com o MESMO usuário/role de conexão (`brabo`), separados por schema — não
por instância nem por credencial. A convenção de comunicação declarada em
CLAUDE.md ("eventos via Postgres + HTTP interno com service token para
comandos síncronos") cobre EFEITOS — comandos que mudam estado do outro
lado —, não leitura de relatório. E já existe precedente de leitura direta
cross-schema: `apps/api/scripts/medir-execucao.ts` (FASE 13b) já lê
`engine.oban_peers` via SQL cru pelo mesmo caminho, para detectar restart do
engine durante uma execução medida — só que como SCRIPT manual, nunca
coberto por teste automatizado.

O read model do dashboard (`DrizzleProjectsSummaryRepository`, RN-090) exige
UMA consulta agregada por WORKSPACE INTEIRO, nunca uma por projeto — é a
propriedade que `projects-summary.repository.spec.ts` prova constante contra
2 e 20 projetos.

## Decisão

A contagem de dev agents online lê `engine.dev_agent_states` DIRETO, via SQL
cru batelado por workspace (`WHERE project_id IN (...) AND status NOT IN
('idle', 'idle_tripped') GROUP BY project_id`), dentro do MESMO
`Promise.all` que já batela as outras onze consultas do read model — elevando
o padrão de `medir-execucao.ts` de script manual para código de produção
testado (fixture da tabela em `test/support/global-setup.ts`, sob o mesmo
schema `"engine"`).

A alternativa considerada e RECUSADA foi expor uma rota HTTP interna nova no
engine (`GET /internal/dev-agent-states/online-counts?projectIds=...`) e
chamá-la da api. Três razões:

1. **A propriedade de RN-090 é sobre consultas SQL, não sobre chamadas de
   rede.** Uma dependência HTTP dentro de `DrizzleProjectsSummaryRepository`
   — hoje um repositório PURO de leitura de banco — introduziria uma
   falha de rede num caminho que hoje só pode falhar por Postgres fora do
   ar, e o teste de contagem de consultas (`pool.query`) deixaria de
   enxergar o custo real da chamada.
2. **O dado é ESTADO, não COMANDO.** A convenção de HTTP interno existe para
   sincronizar AÇÃO entre os dois lados (ativar agente, revalidar
   instrução) — ler uma tabela de estado que já existe fisicamente ao lado
   é o mesmo tipo de leitura que a api já faz de si mesma, só que através
   de um schema diferente.
3. **Menor superfície nova.** Uma rota HTTP interna exigiria autenticação
   por service token, DTO próprio, teste de contrato dos dois lados — peso
   maior que uma consulta SQL a mais dentro de um `Promise.all` que já
   soma catorze.

## Consequências

- `DrizzleProjectsSummaryRepository` passa a depender de uma tabela que a
  api NÃO migra. A suposição aceita: quem opera o produto migra os dois
  lados juntos (`db:migrate` E `engine:migrate`) — já é a suposição
  implícita de todo o resto do produto (sem `engine:migrate`, nenhum agente
  sobe, e o dashboard mostraria zero histórico de qualquer forma). Se só a
  api migrou, a consulta FALHA — não há try/catch escondendo o erro; o
  dashboard inteiro erraria alto e visível, não um card silenciosamente sem
  o número.
- `brabo_test` (a base de testes do vitest da api) ganhou uma fixture MÍNIMA
  do schema `"engine"` — `CREATE SCHEMA IF NOT EXISTS engine` +
  `CREATE TABLE dev_agent_states (project_id, agent_id, status)` — em
  `test/support/global-setup.ts`, DECLARADA como cópia parcial da migration
  real do engine
  (`apps/engine/priv/repo/migrations/20260724124356_create_dev_agent_states.exs`),
  não um segundo migrator. Se a migration real mudar o nome/tipo dessas
  duas colunas, esta fixture precisa acompanhar manualmente — é o preço
  declarado desta decisão.
- Se um dia o engine ganhar MAIS consumidores de estado de dev agent a
  partir da api (não só contagem), a pressão para promover isto a uma rota
  HTTP interna própria — com contrato e teste dos dois lados — cresce.
  Esta ADR não fecha essa porta; só declara que UM consumidor de leitura
  batelada não paga o custo de abri-la ainda.
