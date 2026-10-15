---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# 0039 — actionlint и валидация генерируемого конвейера CI

## Контекст {#contexto}

CLAUDE.md 8c требует второго экземпляра модели ADR 0038: InfraAgent
становится Infra Lead и получает субагента Workflows, который генерирует конвейер CI
проекта пользователя (GitHub Actions или GitLab CI, в зависимости от provider — RN-037).
Этот ADR не открывает заново общую модель области/lead/делегирования (это ADR
0038); он фиксирует лишь новое и специфичное решение этого экземпляра: как Workflows
локально валидирует то, что генерирует, перед предложением, и что остаётся без валидации из-за
отсутствия инструмента.

Прецедент — hadolint исходного InfraAgent (Фаза 4a, ADR 0021): без
бинарника gate QA инфраструктуры одобрял любой Dockerfile — включая тот,
что не разбирался, — потому что отсутствие трактовалось как "пропущено", а не как
"отклонено из-за отсутствия доказательства". Та же ловушка применима здесь: без
какой-либо валидации Workflows предлагал бы синтаксически сломанный конвейер CI
без какого-либо сигнала об этом в PR.

## Решение {#decisão}

### 1. `actionlint` закреплён в Dockerfile engine, по тому же шаблону, что gitleaks/hadolint {#1-actionlint-pinado-no-dockerfile-do-engine-mesmo-padrão-do-gitleakshadolint}

`docker/engine/Dockerfile` (best-effort, `|| echo`) и `docker/engine/
Dockerfile.prod` (hard-fail, `ARG ACTIONLINT_SHA256`, проверяемый через
`sha256sum -c -`, входит в блок probe, доказывающий, что каждый бинарник gates
присутствует и исполняем). Версия `1.7.12`, контрольная сумма сверена с
`actionlint_1.7.12_checksums.txt`, опубликованным в релизе `rhysd/actionlint`,
и независимым скачиванием+`sha256sum` tarball. Отражено в
`.github/workflows/ci.yml` (`env.ACTIONLINT_VERSION`, устанавливается в job
`test-engine` — тот же паритет dev/prod/CI, которого уже требуют gitleaks/hadolint).

Родился закреплённым на `1.7.7` (Go 1.23.4) и поднялся до `1.7.12` (Go 1.26.1) ещё
в этой поставке — CI образа (`trivy`) отклонил `1.7.7` из-за 15 CVE
стандартной библиотеки Go, унаследованных от официального бинарника (1 CRITICAL). Новая версия не обнуляет
список (самый свежий `rhysd/actionlint` ещё не упаковывает новейший патч Go
для каждой CVE), но убирает CRITICAL и 3 из HIGH — оставшиеся 12 HIGH
находятся в `.trivyignore.yaml` с `expired_at`, по тому же шаблону, что
gitleaks: сторонний бинарник, только скачанный (не скомпилированный), уже последний
опубликованный релиз, с датой истечения.

`Engine.Actions.ActionlintDetector` (Live + Fake) — точное зеркало
`Engine.Actions.HadolintDetector`: `System.find_executable/1`, деградирует до
`:unavailable`, не ломая ход, exit `0`/`1` нормализованы (`1` = находки,
а не сбой процесса).

### 2. Валидация происходит при ГЕНЕРАЦИИ, а не в новом gate после PR {#2-a-validação-acontece-na-geração-não-num-gate-pós-pr-novo}

`Engine.Infra.Tools.ValidateInfraFile` (обобщён на этой фазе — раньше умел
только hadolint) диспетчеризирует по расширению пути: `Dockerfile*` → hadolint,
`.github/workflows/*.{yml,yaml}` → actionlint, `.gitlab-ci.yml` → без
валидации (пункт 3). `WorkflowsAgent` вызывает этот tool перед
`emit_infra_delegation_result` — та же дисциплина, которой Lead уже следовал с
Dockerfiles.

Мы **не** создали третий gate после PR: `Engine.Infra.InfraGateRunner`
продолжает валидировать общий YAML (compose + любой конвейер CI) через
`yamllint`, синтаксически и поверхностно — проверяет, РАЗБИРАЕТСЯ ли он, но не существуют ли
упомянутые `actions` и валидны ли их версии. `actionlint` делает более глубокий
семантический анализ (имена actions, типы выражений, допустимые контексты),
и делает это ДО существования PR — при генерации, где Workflows ещё
может исправить, не тратя цикл исправления gate. Выполнение обеих
валидаций (yamllint после PR + actionlint до предложения) не избыточно: это
две разные глубины, в том же духе, в каком hadolint (синтаксический,
до предложения) сосуществует со сканером секретов SecOps (семантический,
после PR).

### 3. `.gitlab-ci.yml` остаётся без локальной статической валидации — задокументированный пробел {#3-gitlab-ciyml-fica-sem-validação-estática-local--gap-documentado}

Не существует офлайн-бинарника, эквивалентного `actionlint` для GitLab CI, —
официальный линтер (`POST /api/v4/projects/:id/ci/lint`) требует живого
экземпляра GitLab, а у Workflows нет (и не должно быть) учётных данных
GitLab для вызова этого API лишь ради проверки синтаксиса. `ValidateInfraFile`
деградирует с явным сообщением ("sem linter estático local") вместо
выдумывания частичной валидации (напр.: общего YAML-парсера, который не
понимал бы схему `.gitlab-ci.yml`), что дало бы ложную уверенность. Зафиксировано
как известное ограничение окружения (`docs/runbook.md`), а не скрыто.

## Последствия {#consequências}

- Каждый Dockerfile ИЛИ workflow GitHub Actions, который предлагают Workflows/Lead,
  уже прошёл синтаксическую/семантическую валидацию до существования PR — без
  бинарника сообщение "indisponível" остаётся записанным в `tool.result`
  события, и именно это проверяет демо `demo:infra-workflows-github` (RN-037).
- `.gitlab-ci.yml`, сгенерированный для проекта с `GithubProvider`, никогда не случается
  (Workflows выбирает формат по `gitProvider` контекста — RN-037);
  `.gitlab-ci.yml` рождается лишь для проекта GitLab и рождается без локальной валидации.
- Если у GitLab CI в будущем появится офлайн-валидатор, точка
  расширения — `Engine.Infra.Tools.ValidateInfraFile.gitlab_ci?/1` — заменить
  ветвь "без линтера" вызовом нового
  `Engine.Actions.GitlabCiLintDetector`, по тому же шаблону, что остальные три.
