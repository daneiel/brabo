# 0039 — actionlint e a validação do pipeline de CI gerado

## Contexto

CLAUDE.md 8c pede a segunda instância do modelo do ADR 0038: o InfraAgent
vira Infra Lead, e ganha o subagente Workflows, que gera o pipeline de CI do
projeto do usuário (GitHub Actions ou GitLab CI, conforme o provider — RN-037).
Este ADR não reabre o modelo genérico de área/lead/delegação (isso é o ADR
0038); fixa só a decisão nova e específica desta instância: como o Workflows
valida localmente o que gera, antes de propor, e o que fica sem validação por
falta de ferramenta.

O precedente é o hadolint do InfraAgent original (Fase 4a, ADR 0021): sem o
binário, o gate de QA de infra aprovava qualquer Dockerfile — inclusive um
que não parseava — porque a ausência era tratada como "pulado" em vez de
"reprovado por falta de prova". A mesma armadilha se aplica aqui: sem
validação nenhuma, o Workflows proporia um pipeline de CI sintaticamente
quebrado sem nenhum sinal disso na PR.

## Decisão

### 1. `actionlint` pinado no Dockerfile do engine, mesmo padrão do gitleaks/hadolint

`docker/engine/Dockerfile` (best-effort, `|| echo`) e `docker/engine/
Dockerfile.prod` (hard-fail, `ARG ACTIONLINT_SHA256` verificado com
`sha256sum -c -`, entra no bloco de probe que prova todo binário dos gates
presente e executável). Versão `1.7.12`, checksum conferido contra o
`actionlint_1.7.12_checksums.txt` publicado no release do `rhysd/actionlint`
e por download+`sha256sum` independente do tarball. Espelhado em
`.github/workflows/ci.yml` (`env.ACTIONLINT_VERSION`, instalado no job
`test-engine` — mesma paridade dev/prod/CI que gitleaks/hadolint já exigem).

Nasceu pinado em `1.7.7` (Go 1.23.4) e subiu pra `1.7.12` (Go 1.26.1) ainda
nesta entrega — o CI de imagem (`trivy`) reprovou o `1.7.7` por 15 CVEs de
Go stdlib herdados do binário oficial (1 CRITICAL). A versão nova não zera
a lista (o `rhysd/actionlint` mais recente ainda não empacota o patch de Go
mais novo pra cada CVE), mas derruba a CRITICAL e 3 das HIGH — as 12 HIGH
restantes ficam em `.trivyignore.yaml` com `expired_at`, mesmo padrão do
gitleaks: binário de terceiro só baixado (não compilado), já no último
release publicado, com data de expiração.

`Engine.Actions.ActionlintDetector` (Live + Fake) é mirror exato de
`Engine.Actions.HadolintDetector`: `System.find_executable/1`, degrada pra
`:unavailable` sem quebrar o turno, exit `0`/`1` normalizados (`1` = achados,
não falha de processo).

### 2. A validação acontece na GERAÇÃO, não num gate pós-PR novo

`Engine.Infra.Tools.ValidateInfraFile` (generalizada nesta fase — antes só
sabia hadolint) despacha por extensão de caminho: `Dockerfile*` → hadolint,
`.github/workflows/*.{yml,yaml}` → actionlint, `.gitlab-ci.yml` → sem
validação (item 3). O `WorkflowsAgent` chama esta tool antes de
`emit_infra_delegation_result` — a mesma disciplina que o Lead já seguia com
Dockerfiles.

**Não** criamos um terceiro gate pós-PR: `Engine.Infra.InfraGateRunner`
continua validando YAML genérico (compose + qualquer pipeline de CI) com
`yamllint`, sintático e superficial — checa se PARSEIA, não se as `actions`
referenciadas existem ou são versões válidas. `actionlint` faz uma análise
semântica mais profunda (nomes de action, tipos de expressão, contextos
válidos), e faz isso ANTES da PR existir — na geração, onde o Workflows ainda
pode corrigir sem gastar um ciclo de correção do gate. Rodar as duas
validações (yamllint pós-PR + actionlint pré-proposta) não é redundante: são
duas profundidades diferentes, no mesmo espírito de hadolint (sintático,
pré-proposta) coexistir com o scanner de segredo do SecOps (semântico,
pós-PR).

### 3. `.gitlab-ci.yml` fica sem validação estática local — gap documentado

Não existe um binário offline equivalente ao `actionlint` para GitLab CI — o
linter oficial (`POST /api/v4/projects/:id/ci/lint`) precisa de uma
instância GitLab viva, e o Workflows não tem (nem deveria ter) credencial de
GitLab pra chamar essa API só pra validar sintaxe. `ValidateInfraFile`
degrada com uma mensagem explícita ("sem linter estático local") em vez de
inventar uma validação parcial (ex.: um parser de YAML genérico que não
entenderia o schema de `.gitlab-ci.yml`) que daria falsa confiança. Registrado
como limite conhecido do ambiente (`docs/runbook.md`), não escondido.

## Consequências

- Todo Dockerfile OU workflow do GitHub Actions que o Workflows/Lead propõe
  já passou por uma validação sintática/semântica antes da PR existir — sem
  o binário, a mensagem "indisponível" fica registrada no `tool.result` do
  evento, e é isso que o demo `demo:infra-workflows-github` verifica (RN-037).
- `.gitlab-ci.yml` gerado por um projeto com `GithubProvider` nunca acontece
  (o Workflows decide o formato pelo `gitProvider` do contexto — RN-037);
  `.gitlab-ci.yml` só nasce pra projeto GitLab, e nasce sem validação local.
- Se o GitLab CI vier a ganhar um validador offline no futuro, o ponto de
  extensão é `Engine.Infra.Tools.ValidateInfraFile.gitlab_ci?/1` — trocar a
  branch de "sem linter" por uma chamada a um novo
  `Engine.Actions.GitlabCiLintDetector`, mesmo padrão dos outros três.
