# 0027 — Backup/restore, hardening da api, superfície exposta e release

## Contexto

As sessões 1–3 da Fase 5 (ADRs [0024](0024-fase5-imagens-producao-ci.md),
[0025](0025-fase5-deploy-kubernetes-kustomize.md) e
[0026](0026-fase5-observabilidade-e-graceful-shutdown.md)) entregaram imagens de
produção, CI, deploy Kubernetes e observabilidade. Restavam os itens **6**
(backup e restore com runbook testado) e **7** (hardening da api) do escopo.

Esta sessão fecha os dois e acrescenta o que faltava para chamar o sistema de
"pronto para produção": runbooks operacionais, revisão da superfície exposta e
versionamento.

## Decisões

### 1. Retenção do backup por CONTAGEM, não por idade

`mc rm --older-than 7d` (ou uma regra de lifecycle no bucket) apaga backup bom
quando o CronJob passa dias sem rodar — exatamente a situação em que ele mais
importa. Manter os N mais recentes degrada bem: sem execução nova, nada é
apagado. `BACKUP_KEEP_DAILY=7` e `BACKUP_KEEP_WEEKLY=4`.

### 2. Métrica de backup vem de uma TABELA, não de um Pushgateway

O CronJob grava o resultado em `backup_runs`, e o `DomainGaugesCollector` da
api — que já roda num timer e já é scrapeado — publica
`brabo_backup_{last_success_timestamp_seconds,age_seconds,last_status,size_bytes}`.

Pushgateway seria um componente a mais, uma segunda fonte de verdade, e um lugar
onde a métrica **sobrevive ao fato que ela descreve** (a série continua
publicada depois que o job sumiu). A tabela ainda dá histórico consultável, que
é o que o runbook de restore usa para responder "quando foi o último backup bom".

Consequência: `-1` é usado para "nunca houve backup", distinguindo-o de "backup
de 1970" — sem isso o alerta de idade dispararia no primeiro dia de qualquer
ambiente novo.

### 3. Retentativa DENTRO do processo, não recriando o pod

O k3s programa as regras de NetworkPolicy **depois** de o pod ganhar IP. Um Job
que fala na primeira instrução recebe `connection refused` (REJECT, não
timeout) de uma regra que vai existir um segundo depois. Recriar o pod recria a
janela — seis tentativas seguidas falharam identicamente até isso ficar claro.

Backup, restore e a criação do bucket no bootstrap retentam de dentro do mesmo
container. Serve também em produção: object storage tem indisponibilidade
transitória, e um backup diário que desiste no primeiro erro de rede vira um dia
sem backup.

### 4. PostgreSQL 16 pinado no CloudNativePG

O cluster local subia a major default do operador (17.4) enquanto o CLAUDE.md
decide PostgreSQL 16 e o compose usa `pgvector/pgvector:pg16`. A divergência era
invisível até o backup: `pg_dump` 16 recusa servidor 17 com "server version
mismatch", e dump gerado num ambiente não restaura no outro.

`imageName: ghcr.io/cloudnative-pg/postgresql:16.10`, com minor pinada — deixá-la
flutuar reintroduz o problema no dia em que o operador mudar de default.

### 5. Rate limit com janela deslizante no Postgres

O CLAUDE.md proíbe Redis (as filas ficam no Postgres via Oban). A janela vive em
`rate_limit_hits`, com INSERT e contagem no mesmo statement por CTE.

**Custo assumido: um INSERT por request contado.** Redis resolveria melhor;
`RATE_LIMIT_ENABLED=false` desliga. A poda entra no timer do collector que já
existe, em vez de um CronJob próprio.

Detalhe que só aparece na borda: em Postgres, a linha inserida por uma CTE de
escrita **não é visível** ao resto do mesmo statement. Contar apenas a tabela
devolveria os hits anteriores a este, e o limite valeria um a mais do que o
configurado. Daí a soma explícita do `(select count(*) from novo)`.

Isentos: rotas `@Public()` (estrangular `/health` faz o kubelet reiniciar o pod,
transformando pico em queda) e o client `engine-service` (o engine chama a api a
cada evento de agente; limitá-lo é o sistema se auto-estrangulando).

Falha do banco **libera** a requisição: este guard protege contra abuso, não
contra acesso indevido — quem autoriza é o `JwtAuthGuard`, que já rodou.

### 6. CORS falha fechado em produção

`WEB_ORIGIN` passa a aceitar lista separada por vírgula. Sem ela, ou com `*`,
com `NODE_ENV=production` o **boot falha**. Antes o default silencioso era
`http://localhost:5173`: esquecer a variável num deploy não quebrava nada
visível, só deixava a api permissiva. Erro no start é barulhento e reversível;
api permissiva é silenciosa e não é.

### 7. helmet na api, CSP só na web

A api não emitia cabeçalho de segurança nenhum. `helmet` entra com
`contentSecurityPolicy: false`: ela serve JSON, e o CSP é da web, onde já existe
desde a sessão 1 e é mais específico (`connect-src` montado por ambiente).
`crossOriginResourcePolicy: false` porque a web é outra origem — o default
`same-origin` bloquearia o app inteiro, com sintoma confundível com CORS.

### 8. `mix_audit` além do `mix hex.audit`

`mix hex.audit` reporta pacote **aposentado**, não vulnerabilidade. Sozinho, o
gate do engine seria decorativo: nenhuma CVE reprovaria o build. `mix_audit` lê
a base de advisories do Elixir e é o que de fato detecta CVE. Os dois rodam; são
perguntas diferentes. O gate é em **crítica**, como o escopo pede — reprovar em
`moderate` num monorepo desta árvore viraria bloqueio permanente, e a reação
seria desligar o gate inteiro.

### 9. O documento de superfície é a FONTE do teste

`docs/security-surface.md` lista as 110 rotas com sua classificação.
`route-surface.spec.ts` sobe o `AppModule`, enumera as rotas **registradas em
runtime** (via `DiscoveryService`, não grep) e compara com a tabela parseada do
markdown: rota sem linha reprova, classificação divergente reprova, linha órfã
reprova.

No engine o teste é **comportamental**: cada rota registrada recebe uma
requisição sem token e o que se afirma é o que o cliente veria (401 para tudo
fora da lista de quatro exceções). A primeira versão lia `pipe_through` e foi
descartada por duas razões — o `__routes__/0` desta versão do Phoenix não expõe
pipeline, e mesmo que expusesse ela afirmaria sobre a ANOTAÇÃO: um pipeline
`:internal` esvaziado por engano continuaria "correto".

### 10. Rotação da chave mestra exigiu mudar o serviço

`EnvelopeEncryptionService` derivava UMA chave e nenhuma linha registra qual
chave a embrulhou. Trocar a variável tornava ilegível toda credencial existente,
sem erro no boot — a falha só aparecia no primeiro uso. Um runbook sobre isso
seria ficção.

Decisão: `CREDENTIALS_MASTER_KEY_PREVIOUS`, tentada quando a atual falha, mais
`src/scripts/rewrap-deks.ts` re-embrulhando o acervo. O script vive em `src/`
(e não em `apps/api/scripts/`, que está no `.dockerignore`) porque precisa estar
dentro da imagem de produção. Só o envelope muda; o texto cifrado do segredo
permanece byte a byte o mesmo, então interromper no meio deixa o acervo
consistente.

### 11. Release por tag, changelog por script próprio

`.github/workflows/release.yml` dispara em `v*` e valida que os quatro
manifests declaram a versão da tag — taggear `v0.2.0` com os `package.json` em
`0.1.0` produziria imagens rotuladas com uma versão que o código não declara.

`scripts/changelog.mjs` (~140 linhas) em vez de `standard-version`/`changesets`:
essas trazem opinião sobre bump, commit e tag — três coisas que aqui são decisão
do usuário. O script só gera texto.

## Consequências

**Aceitas:**

- Um INSERT por request no caminho autenticado (decisão 5).
- Uma quarta imagem para manter (`brabo-backup`), nos mesmos gates das outras:
  non-root, trivy e hadolint.
- MinIO no overlay local — componente a mais no cluster de desenvolvimento, em
  troca de o caminho S3 ser exercitado em todo ambiente em vez de só em produção.
- Duas chaves mestras aceitas durante a janela de rotação dobram a superfície de
  uma chave vazada. A api avisa no log a cada boot enquanto isso durar.
- `ALTER ROLE brabo CREATEDB` no cluster **local** para o teste de restore. Em
  produção não se faz: o restore usa credencial administrativa própria via
  `RESTORE_ADMIN_URL`.

**Fora de escopo, registrado:**

- **Publicar imagem em registry.** O overlay de produção ainda aponta para
  `ghcr.io/OWNER/*`. O workflow de release constrói e tagueia, mas não publica.
- **Criar a tag `v0.1.0`** — é ato do usuário, coerente com a regra do CLAUDE.md
  sobre branch protegida.
- **PITR.** A granularidade é o último dump. WAL archiving no CloudNativePG
  resolveria e não foi feito.
- **Backup do Keycloak e dos PVCs.** O escopo pede Postgres.
- **`GET /`**, o "Hello World!" do scaffold do NestJS, continua registrado e
  autenticado. Documentado como candidato a remoção; apagá-lo é decisão de
  produto.
- **Alertas continuam sendo regras do Grafana**, não do Prometheus — desvio já
  registrado no ADR 0026 e mantido aqui pelos dois alertas novos de backup.
