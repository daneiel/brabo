# ADR 0089 — `analytics` e `delivery-metricas` viram script de relatório

- **Status:** Aceito
- **Data:** 2026-08-16
- **Contexto:** decisão do dono do produto de antecipar dois papéis do
  modelo-alvo (`docs/fluxo.yml`) sem esperar o gatilho orgânico
- **Peça irmã:** [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  (`docs/fluxo.yml`); precedente direto de FORMA:
  `apps/api/scripts/medir-execucao.ts` (Fase 13b)

## Contexto

`docs/fluxo.yml` já descrevia dois papéis do modelo-alvo como
`status: proposto`, cada um com o critério de separação que faltava para
virarem `active` já escrito:

- `analytics` (Analytics Engineer, métrica de PRODUTO) — "absorvido por
  `medicao` (que só cobre métrica de EXECUÇÃO)", com o critério "o dia em
  que `metricas-de-produto` virar entrada obrigatória do PO";
- `delivery-metricas` (Delivery Manager, fluxo — DORA) — "absorvido por
  `medicao` (parcialmente)", com o critério "nunca vira agente; vira
  RELATÓRIO do `medicao` (lead time, deployment frequency, MTTR, change
  failure rate extraídos do event log + `gates.yml`)".

Nenhum dos dois gatilhos disparou organicamente. O dono do produto decidiu
antecipar a construção mesmo assim: o funil sessão → commit → PR → merge e
uma fatia real de DORA (lead time, deployment frequency) já são
extraíveis do dado que o produto já grava — `proposed_actions.execution_result`
para as três ações git que o dev agent produz
(`apps/api/src/domain/git/git-action-execution-result.ts`) e
`docs/gates.yml` para o gate `backmerge`. Esperar o gatilho orgânico
adiaria um relatório que já é possível.

## Decisão

Os dois papéis viram `status: active` em `docs/fluxo.yml`, e o que os
materializa é UM SCRIPT só — `apps/api/scripts/analise-funil.ts`
(`pnpm --filter api analise:funil -- --projeto <uuid> [--json]`) — no
MESMO formato de `apps/api/scripts/medir-execucao.ts`:
`NestFactory.createApplicationContext(AppModule)`, argumento
`--projeto <uuid>` obrigatório, leitura pura via Drizzle, zero escrita no
banco, saída Markdown por padrão e `--json` para consumo programático.

Isto não é uma feature nova de produto: é a forma que o próprio
`docs/fluxo.yml` já prescrevia para os dois papéis, só que construída
antes do gatilho previsto. Nenhum GenServer, nenhum agente de LLM, nenhuma
rota HTTP nova.

### O que o script mede DE VERDADE

- **Funil real** (`calcularFunil`): quantas sessões produziram pelo menos
  um `git_commit`, uma `pr_open` e um `git_merge` `executed`, e a taxa de
  conversão entre etapas consecutivas. Conta SESSÃO, não ação.
- **Lead time real** (`calcularLeadTimes`): do primeiro `git_commit`
  `executed` ao primeiro `git_merge` `executed` da mesma sessão, usando
  `updated_at` — o instante em que `ExecuteGitActionUseCase` gravou o
  `execution_result` de verdade, não quando a ação foi proposta.
- **Deployment frequency real** (`deploymentFrequencyPorDia`): `git_merge`
  `executed` cujo `targetBranch` está em `PROTECTED_BRANCHES`, agrupado por
  dia. Cruza por REFERÊNCIA com o gate `backmerge` (`docs/gates.yml`) — a
  evidência dele é CI (`.release/gate.json`), fora do alcance de um script
  que só lê o banco, então não há junção de dado nenhuma, só o mesmo
  recorte de branch.

### O que o script DECLARA ausente, e por quê isso não é "dado que falta"

Três métricas ficam numa seção "Não medido, de propósito" da saída, e a
decisão de mantê-las assim é permanente enquanto as pré-condições abaixo
não mudarem — não é lacuna a fechar na próxima rodada:

1. **Funil de produto completo (ideação → commit).** `sessions` não tem
   `storyId` — [RN-230](../business-rules.md#rn-230) já declara essa
   lacuna na aba Criativo (`apps/web/src/routes/ProjectSessionsTab.tsx`).
   Fechá-la exigiria schema novo (coluna nova, possivelmente migration em
   `sessions` ou tabela de vínculo), fora de escopo desta frente por
   princípio: **nenhuma migration nesta rodada**.
2. **Evidência de adoção por feature.** Diferente da primeira, esta não é
   dado que falta COLETAR: é uma capacidade que o produto não tem CAMINHO
   nenhum para ter hoje. O Brabo não instrumenta os projetos que ele
   CONSTRÓI — não existe pipeline de telemetria de uso saindo do código
   gerado, nem decisão de produto sobre como ele existiria. Declarar
   "ausente" aqui seguiu o mesmo princípio do ADR 0042 para nota de
   modelo e do ADR 0077 (RN-210) para ranking "ideal": nunca aproximar com
   um número que pareceria real.
3. **MTTR e change failure rate.** As duas exigem sinal de INCIDENTE de
   produção real, a mesma dependência que `docs/fluxo.yml` já registra
   para os papéis `secops-runtime`/`platform` (`status: proposto`/
   `planned`, ativação sincronizada com `DEPLOY_ENABLED`). É trabalho de
   outra frente, não desta.

## Consequências

- `docs/fluxo.yml`: `analytics` e `delivery-metricas` saem de
  `status: proposto` para `status: active`, com `saidas_alvo` reescrito
  para `saidas` (o que é real hoje) mais um campo `lacunas` explícito
  (o que continua `status: lacuna`, sem apagar a declaração).
- `apps/api/package.json`: nova entrada `"analise:funil"`.
- Nenhuma migration, nenhuma rota HTTP nova, nenhuma tela nova.
- RN-320..322 em `docs/business-rules.md` cobrem a forma do script (RN-320),
  a semântica do funil e do lead time (RN-321), e a deployment frequency
  mais as três ausências declaradas (RN-322).

## Alternativas consideradas

**Esperar o gatilho orgânico de cada papel.** Era o plano-padrão do
`docs/fluxo.yml` e continua sendo o comportamento default do modelo de
time para os outros papéis `proposto`. Recusada aqui só porque o dono do
produto decidiu explicitamente antecipar — não é precedente para
antecipar os demais papéis `proposto` sem decisão equivalente.

**Um agente `analytics` de LLM lendo o banco e narrando o funil.**
Recusada pelo próprio critério de separação que `docs/fluxo.yml` já
declarava para `delivery-metricas` ("nunca vira agente") e que esta
decisão estende a `analytics`: o relatório é determinístico — soma,
agrupa, filtra por status — e não precisa de um modelo para interpretá-lo.
Um agente aqui seria custo de LLM sem ganho de informação.

**Aproximar as três métricas ausentes com um proxy** (ex.: contar
`chat.message` como proxy de "uso", ou tempo até o próximo commit como
proxy de MTTR). Recusada: um proxy que se parece com a métrica real e não
é ela é o erro que o ADR 0042 já nomeou para nota de modelo — melhor "—"
com o motivo escrito do que um número que ensina errado.

## Referências

- `docs/fluxo.yml` (blocos `id: analytics`, `id: delivery-metricas`)
- `apps/api/scripts/analise-funil.ts` / `apps/api/scripts/medir-execucao.ts`
  (precedente de forma, Fase 13b)
- `apps/api/src/domain/git/git-action-execution-result.ts`
- `docs/gates.yml` (gate `backmerge`)
- [RN-230](../business-rules.md#rn-230) — a lacuna ideação → commit, já
  declarada na aba Criativo
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) —
  o princípio de nunca fingir dado que não existe
- [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) —
  a mesma recusa aplicada a "modelo ideal"
