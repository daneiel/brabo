---
traducao_de: 8841a171692a9823fb48590d1b9cbe883920fab4
---

# ADR 0197 — Образ workflows берётся из compose, и Dependabot для образов включается

## Статус {#status}

**Accepted.** 2026-10-01 (AT-246, история HS-024, эпик EP-016, раунд 36;
решение владельца от 01.10: *«убрать литерал из workflows»* — `image:` в
`services:` начинает приходить из предшествующего job, который читает compose,
единственного источника digest, и включается Dependabot
`docker`/`docker-compose`). Поверх
[ADR 0159](0159-imagem-de-terceiro-por-digest.md) (сторонний образ по digest
индекса) и [ADR 0178](0178-tag-inline-na-imagem-de-terceiro.md) (тег внутри
ссылки), не редактируя их: оба продолжают действовать во всём; этот закрывает
половину, которую 0178 объявил НЕ сделанной в *«Чего этот ADR НЕ делает»*.

## Контекст {#context}

ADR 0178 поместил тег внутрь ссылки — в форму, которую читает Dependabot, — и
оставил Dependabot для образов выключенным из-за ОДНОЙ блокировки: `pgvector`
и `ollama` жили дважды, в compose и как литерал в `services:` workflows. Ни
одна экосистема не читает `services:` workflow, поэтому каждый PR бота,
поднимающий одну из них в compose, рождался бы красным по правилу «тот же тег,
два digest» из `scripts/ci/imagens-pinadas.ts`; а шаг, который выравнивал бы
workflow в PR бота, должен был бы пушить коммит в `.github/workflows/`, чего
`GITHUB_TOKEN` не может, даже через `permissions:`. ADR перечислил четыре
выхода; владелец выбрал второй.

Измерено в `origin/dev` (d89f77714e) до изменения — каждый сторонний `image:`
в `.github/workflows/` и откуда каждый должен читать:

| workflow | job → сервис | образ | читает из |
|---|---|---|---|
| `ci.yml` | `test-api-shard` → `postgres` | `pgvector/pgvector:pg16@sha256:ccc6e83d…` | сервис `postgres` из `docker/docker-compose.yml` |
| `ci.yml` | `test-engine` → `postgres` | то же | то же |
| `golden-set-rag.yml` | `golden-set-rag` → `postgres` | то же | то же |
| `golden-set-rag.yml` | `golden-set-rag` → `ollama` | `ollama/ollama:0.33.1@sha256:075246f7…` | сервис `ollama` из `docker/docker-compose.yml` |
| `golden-set-qa.yml` | `golden-set-qa` → `postgres` | pgvector, то же | сервис `postgres` |
| `golden-set-qa.yml` | `golden-set-qa` → `ollama` | ollama, то же | сервис `ollama` |

Шесть литералов, два образа, все с тем же digest, что в compose DEV. Ни одного
`container:` у job и ни одного другого `image:` в workflows. Compose dev, а не
продакшена или установки, — правильный источник по двум уже существовавшим
причинам: именно против него в dev работают наборы тестов api и engine, и
именно за ним обещал следовать `golden-set-rag.yml` (порог golden-set
привязан к МОДЕЛИ, а не к окружению). Три compose сегодня несут один и тот же
digest, и lint гарантирует, что так и останется.

И у lint было слепое пятно, которое новая форма открыла бы, если бы никто не
посмотрел: шаблон `image:` был `(\S+)`, и строка с выражением (`${{ … }}`, где
есть пробел) НЕ совпадала — выпадала из проверки, вместо того чтобы быть
оценённой. Хуже: то, что совпадало с `$`, трактовалось как интерполяция и
пропускалось. `image: ${{ 'postgres:16' }}` прошёл бы зелёным.

## Решение {#decision}

**1. `services:` workflows читают образ из compose.** Новый переиспользуемый
workflow, `.github/workflows/imagens-do-compose.yml` (только
`workflow_call`), запускает `scripts/ci/imagens-do-compose.ts`, который читает
прямой дочерний `image:` каждого сервиса, перечисленного в
`IMAGENS_DOS_WORKFLOWS`, и возвращает его как `output`. Вызывающий делает:

```yaml
jobs:
  imagens:
    uses: ./.github/workflows/imagens-do-compose.yml
  test-engine:
    needs: imagens
    if: ${{ !cancelled() }}
    services:
      postgres:
        image: ${{ needs.imagens.outputs.pgvector }}
```

Скрипт ОТКЛОНЯЕТ несуществующий сервис или сервис без `image:` (переименование
в compose сразу роняет CI, а не отдаёт пустую строку) и ссылку вне формы
`imagem:tag@sha256:<índice>` — вторая дверь, потому что читающий job не может
зависеть от того, что `lint` выполнился раньше. Без `pnpm install`: скрипт
использует только `node:fs`, с разреженным checkout `docker/` и `scripts/ci/`.

Переиспользуемый, а не job, скопированный в каждый файл: вызывающих три, и три
копии одного и того же checkout + setup были бы тем дубликатом, который этот
ADR существует, чтобы убрать, уровнем выше.

**2. Lint понимает новую форму и закрывает дверь, которую она открывает.** В
файле из `.github/workflows/` `imagens-pinadas.ts` начинает читать `image:` и
короткую форму `container: <imagem>` шаблоном, допускающим пробел, и
проваливает:

- **`literal no workflow`** — любую литеральную стороннюю ссылку, ДАЖЕ
  закреплённую digest: это дубликат, который не читает ни одна экосистема;
- **`expressão de imagem fora da forma`** — всё, что не является РОВНО
  `${{ needs.<job>.outputs.<imagem> }}`: литерал внутри выражения, `||` со
  значением по умолчанию (до или после выхода), `env.`, `vars.`, `format()`,
  суффикс после `}}`, выражение без закрытия;
- **`imagem do workflow fora do compose`** — `needs.<job>`, чей job не вызывает
  `./.github/workflows/imagens-do-compose.yml`, или output, который он не
  объявляет.

Образ самого продукта (`brabo-*`) остаётся вне, как в других деревьях. Каждое
правило доказано МУТАЦИЕЙ в `imagens-pinadas.spec.ts`: отключить литерал,
ослабить форму выражения, не проверять job, не проверять output, игнорировать
остаток после `}}` или вернуть шаблон к `\S+` — каждая мутация роняет хотя бы
один тест (измерено: 4, 1, 2, 1, 1 и 12). А `imagens-do-compose.spec.ts`
привязывает переиспользуемый workflow к таблице: объявленные выходы — РОВНО
ключи `IMAGENS_DOS_WORKFLOWS`, каждый связан с шагом, запускающим скрипт, —
output посередине с литералом проваливается.

**3. Dependabot для образов включается** в `.github/dependabot.yml`, с
`target-branch: dev`, как остальные:

- `docker-compose` в `/docker` — там живут пять compose, поэтому одно
  поднятие обновляет dev, продакшен и установку в ОДНОМ PR;
- `docker` в `/docker/*` (`FROM`, по папке на образ) и `/deploy/k8s/**`
  (манифесты). НИКОГДА `/docker` без `/*`: экосистема `docker` тоже читает
  YAML с `image:` (так она покрывает Kubernetes — `YAML_REGEXP` из
  `shared_file_fetcher.rb` dependabot-core, прочитано 01.10), и прочитала бы
  compose, открыв второй PR для того же образа;
- каждая экосистема с ОДНОЙ группой (`patterns: ['*']`): `node:24-alpine`
  живёт в трёх Dockerfile dev, а `node:24.21.0-alpine3.23` — в трёх
  продакшена, каждый в своей папке, и без группы это были бы три PR с одним
  тегом и разными digest — красные по правилу;
- `ignore` для `brabo-*` (и `ghcr.io/*/brabo-*`): у образов, которые собирает
  этот репозиторий, нет стороннего registry, где искать.

**4. Обещание `golden-set-rag.yml` становится конструкцией.** Он говорил в
комментарии, что запускает «ту же закреплённую версию из
docker/docker-compose.yml». Начиная с ADR 0159 lint ПРОВЕРЯЛ это по правилу
«тот же тег, два digest»; теперь проверять нечего, потому что второй копии
нет: Ollama golden-set — по построению ссылка сервиса `ollama` из compose dev.
То же верно для `golden-set-qa.yml` и для Postgres наборов `ci.yml`.

## Последствия {#consequences}

**PR бота трогает только compose, и CI этого PR уже работает против нового
образа** — `services:` читает compose самого PR. Нет шага выравнивания, нет
учётных данных с `workflows`, нет push от `GITHUB_TOKEN` без checks.

**Два обязательных job получают зависимость и не могут стать `skipped`.**
`Testes do engine (ExUnit)` (обязательный check) и шарды api ждут job
`imagens`. По умолчанию GitHub ПРОПУСТИЛ бы job, если `imagens` упал, а
`skipped` считается зелёным для обязательного check — та же ловушка, которую
агрегатор api уже обходит с `if: always()`. Поэтому оба несут
`if: ${{ !cancelled() }}`: при красном `imagens` job запускается, получает
пустой образ и проваливается. Новый job (`imagens / Ler as imagens do
compose`) в ruleset НЕ входит. Цена по времени: пока не измерена — это
разреженный checkout и `setup-node` без кэша, выполняющиеся параллельно с
`lint`; `TODO(humano)` при первом запуске.

**Новый сервис workflow имеет единственный путь**: образ в compose, строка в
`IMAGENS_DOS_WORKFLOWS`, output в переиспользуемом (spec проваливается, если
они разойдутся), `needs: imagens` в workflow. Runbook (*Bumping a third-party
image*) это говорит.

**Подсчёт lint падает с 39 до 33** литеральных ссылок: шесть ссылок workflows
перестали существовать, и фраза в `cadeia-de-suprimentos-do-ci.md`, которую
проверяет `contagens-do-codigo.mjs`, следует за этим.

## Чего этот ADR НЕ делает {#o-que-este-adr-não-faz}

**Не решает дубликат МЕЖДУ экосистемами.** `neo4j:5.26-community` и
`ollama/ollama:0.33.1` живут также в `deploy/k8s/base/`
(`neo4j/statefulset.yaml`, `ollama/job-model-loader.yaml`), который относится к
экосистеме `docker`, тогда как compose относятся к `docker-compose`, — а
Dependabot не группирует между экосистемами. Два последствия, объявленные:

- когда бот поднимает ТЕГ (обычный случай), выходят два зелёных PR, каждый в
  своём месте; пока оба не войдут, compose и кластер работают на разных
  версиях — и lint не проваливает разные теги, только один тег с разными
  digest;
- когда registry ПЕРЕПУБЛИКУЕТ тот же тег с другим digest (`5.26-community` —
  движущийся тег), оба PR рождаются красными по правилу «тот же тег, два
  digest», и ревьюер объединяет оба поднятия в один PR (процедура runbook). Та
  же судьба ждёт перепубликованный digest `node:24-alpine`, если он однажды
  будет жить и в compose, И в Dockerfile.

Это не решено здесь, потому что любой выход — продуктовое решение, а не этого
ADR: выводить манифест из compose (трансформер kustomize всё равно хранит
литерал), забрать compose у `docker-compose` и отдать `docker` (который тоже
читает YAML, для compose не измерено) или ослабить правило между деревьями (то,
что правило защищает, — dev и кластер, работающие на одних и тех же байтах под
одним тегом, — реально).

**Не измеряет работу Dependabot.** Ни одного PR бота для образов ещё нет. Не
измерено исполнением: то, что `docker-compose` принимает пять имён файлов
(`docker-compose.<sufixo>.yml`) и игнорирует интерполированные ссылки
(`${BRABO_API_IMAGE:?…}`); то, что группировка по `directories` даёт ОДИН PR
между папками. Первый PR бота — доказательство, и то, чему он противоречит,
вернётся сюда в новом ADR.

**Не распространяет `dependabot-justifica-pin.ts` на pin образа.** PR бота
трогает `docker/**`, и drift (`config-e-inferencia`, `block`) потребует
`docs-not-needed:` от человека — решение AT-094 ограничило строку, пишущуюся
ботом, сменой pin ACTION, и ADR 0178 уже это объявил.

**Не покрывает то, что уже было вне.** В РУЧНОЙ процедуре runbook остаются, с
Dependabot или без: `imageName` у CloudNativePG (ключ, который не читает ни
одна экосистема) и `IMAGEM_DO_GOLDEN_SET_QA` (константа TypeScript, читаемая
`golden-set-qa.yml` через `sed`). Образы продукта, интерполированная ссылка и
стадия multi-stage остаются вне lint (ADR 0159).

**Не создаёт RN.** У правила образов нет RN, по той же причине, что у actions:
оно живёт в `CLAUDE.md` и в `docs/explanation/cadeia-de-suprimentos-do-ci.md`.
