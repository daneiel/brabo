# ADR 0093 — O papel `dbre` vira dois scripts: linter de migration e relatório de backup

- **Status:** Aceito
- **Data:** 2026-08-17
- **Contexto:** decisão do dono do produto de antecipar parte do papel
  `dbre` declarado em `docs/fluxo.yml` (ADR 0085), sem esperar o gatilho
  ("volume real de dados") disparar
- **Revisa:** `docs/fluxo.yml`, bloco `id: dbre`

## Contexto

`docs/fluxo.yml` (ADR 0085) já declarava `dbre` como `proposto`, absorvido
por `dev-lead` (revisão de migração) e `platform` (tuning, quando ativar),
com o critério de separação: "volume real de dados no projeto gerenciado
(hoje o risco é de SCHEMA, não de carga)".

Essa frase já continha a resposta que faltava executar. Dos quatro
entregáveis alvo do papel — `parecer-de-migracao`, `plano-de-capacidade`,
`backup-restore-testado`, `tuning` —, só dois genuinamente dependem de
volume real de dados:

- **`plano-de-capacidade`** e **`tuning`** exigem carga real para significar
  algo. Simulá-los sem ela seria inventar um número — a mesma classe de erro
  que o [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
  já recusa para nota de modelo e o [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)
  recusa para ranking de capacidade.
- **`parecer-de-migracao`** é análise ESTÁTICA de texto SQL: um padrão de
  risco (`DROP COLUMN`, `ALTER COLUMN ... TYPE`, `ADD COLUMN ... NOT NULL`
  sem `DEFAULT`) é arriscado independente de o banco gerenciado ter dez ou
  dez milhões de linhas.
- **`backup-restore-testado`** já é real e testado HOJE — o CronJob de
  backup roda desde a Fase 5, grava em `backup_runs`, e o procedimento de
  restore foi EXECUTADO de verdade (`docs/runbook.md#restore`, RTO real
  ~40s contra um banco de ~108 KB). Faltava só um jeito de LER esse estado
  sob demanda, formatado como relatório.

Nenhum dos dois pede um agente LLM (não há julgamento de linguagem natural
a fazer — é reconhecimento de padrão em texto SQL e leitura de uma tabela)
nem um `GenServer` do engine (não há estado de longa duração nem laço —
cada execução é uma leitura pontual, disparada por um humano ou por CI). A
decisão foi tratá-los como o que são: dois scripts mecânicos, do mesmo
gênero de `scripts/ci/pr-police.ts` e `apps/api/scripts/medir-execucao.ts`.

## Decisão

1. **`apps/api/scripts/lint-migracao.ts`** varre TODO `apps/api/src/db/migrations/*.sql`
   (sem `--projeto` — é análise do repositório, não de uma execução) e
   sinaliza cinco padrões de risco, linha a linha: `DROP TABLE`, `TRUNCATE`,
   `DROP COLUMN`, `ALTER COLUMN ... TYPE`/`SET DATA TYPE`, e
   `ADD COLUMN ... NOT NULL` sem `DEFAULT`. A lógica é PURA
   (`lintarConteudo`, recebe nome + texto do SQL, devolve achados) separada
   do adaptador de I/O (`lintarDiretorio`/`principal`), mesmo desenho de
   `pr-police.ts` (`avaliarPr`). Linha comentária é ignorada, porque
   comentários deste repositório citam os próprios padrões em prosa para
   explicar por que foram EVITADOS (caso real:
   `0042_tough_captain_midlands.sql`, linha 3). Sai `!= 0` se achar
   qualquer ocorrência.
2. **`apps/api/scripts/relatorio-backup.ts`** lê `backup_runs` com a MESMA
   lógica de `DomainGaugesCollector.collectBackup()` (último SUCESSO —
   idade, tamanho — e como terminou a ÚLTIMA execução), formatada como
   relatório sob demanda — não um gauge Prometheus, uma leitura pontual
   para quem quer a resposta agora. Cita o procedimento de restore já
   testado em vez de reexecutá-lo. A lógica de classificação
   (`avaliarBackup`) é pura, testável com `backup_runs` mockado.
3. **Nenhum dos dois entra em CI por ora** — ver Consequências.
4. **`docs/fluxo.yml`**: `dbre` passa de `status: proposto` para
   `status: active`. `entregaveis_alvo` (lista plana) vira `entregaveis`
   (lista de objetos com `status`): `parecer-de-migracao` e
   `backup-restore-testado` marcados `real`, com o mecanismo que os prova;
   `plano-de-capacidade` e `tuning` mantidos `lacuna`, com o motivo
   explícito. `hoje_absorvido_por`/`criterio_de_separacao` continuam no
   bloco, agora descrevendo só o que resta — a regra de UMA migration por
   onda (`meta/_journal.json`) NÃO é mais chamada de "versão mecanizada do
   papel": ela evita CONFLITO de snapshot entre agentes em paralelo, uma
   preocupação ortogonal a "este SQL tem um padrão arriscado", que agora
   tem mecanismo próprio.

## Consequências

- **O linter varre o REPOSITÓRIO inteiro, não o diff de uma PR.** Rodá-lo
  contra as migrations reais de hoje ACHA três ocorrências em migrations já
  mergeadas e aceitas — `0006_whole_princess_powerful.sql:22` e
  `0034_quick_saracen.sql:33` (`DROP COLUMN`), `0007_groovy_bullseye.sql:2`
  (`ALTER COLUMN ... SET DATA TYPE`). Isso não é defeito a corrigir: são
  decisões já tomadas e aceitas, e corrigi-las de passagem apagaria a
  evidência de por que existiam (mesma regra do CLAUDE.md para os achados
  Z/AD/AE). É exatamente por isso que o script **não entrou como step de
  CI**: um gate que varre o repositório inteiro reprovaria toda PR, para
  sempre, por achados que não são dela. Torná-lo um gate de verdade exige a
  mesma técnica de `pr-police.ts` — escopar ao diff contra a base do PR —,
  deixada para quando o `dbre` precisar de fato BLOQUEAR merge; hoje ele é
  parecer, não veredito, e roda manual (`pnpm --filter api lint:migracao`).
- **O relatório de backup não reexecuta o restore.** Ele reusa
  exclusivamente a leitura que `collectBackup()` já faz; o procedimento de
  restaurar em si já está testado e documentado (`docs/runbook.md#restore`).
  Confundir os dois inflaria o escopo do script para reimplementar algo que
  já existe e já funciona.
- **O limiar de "backup atrasado" (26h) é duplicado**, não importado, do
  alerta `brabo-backup-atrasado`
  (`deploy/k8s/observability/alerts/brabo-alerts.yaml`) — o YAML do
  Grafana não é lido pelo processo Node do script. Os dois números podem
  divergir se alguém mudar um lado e esquecer o outro; aceito
  conscientemente, pelo mesmo custo que qualquer limiar duplicado no
  código teria.
- **`plano-de-capacidade` e `tuning` continuam LACUNA**, declarados em
  `docs/fluxo.yml`, sem prazo. O gatilho para separá-los continua sendo
  volume real de dados no projeto GERENCIADO — não o volume de
  `token_usage`/`session_events` do próprio Brabo, que já é grande, mas o
  do produto que os agentes constroem.
