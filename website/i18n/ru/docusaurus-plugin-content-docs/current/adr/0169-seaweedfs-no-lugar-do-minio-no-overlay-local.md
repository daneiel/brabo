---
traducao_de: 7b4435d8e9a6289bb11b8029fe64df5e4264ebf8
---

# 0169 — Назначением S3 локального overlay перестаёт быть MinIO и становится SeaweedFS

## Статус {#status}

**Accepted.** Решено 2026-09-27 (AT-200, issue #633) измерением, по
делегированию сопровождающего («ты измеряешь и выбираешь»). Ссылается на
[ADR 0027](0027-fase5-backup-hardening-release.md) (backup в S3 и замена `mc`
на `aws-cli`) и [ADR 0159](0159-imagem-de-terceiro-por-digest.md) (сторонний
образ по digest индекса). Не редактирует ни один из них.

## Контекст {#context}

Локальный overlay Kubernetes поднимает S3-сервер внутри namespace `brabo`,
чтобы backup, отрабатываемый локально, был ТЕМ ЖЕ, что в продакшене: скрипт
всегда и только говорит на S3, меняется лишь endpoint. Этим сервером был MinIO,
закреплённый начиная с ADR 0159 в
`quay.io/minio/minio@sha256:a1ea29fa…  # RELEASE.2025-04-22T22-12-26Z`.

MinIO перестала публиковать общественный образ. Измерено 2026-09-27, без
аутентификации:

| ссылка | ответ |
|---|---|
| `quay.io/v2/minio/minio/manifests/sha256:a1ea29fa…` | **401** |
| `quay.io/v2/minio/minio/tags/list` | **401** |
| `registry-1.docker.io/v2/minio/minio/manifests/RELEASE.2025-04-22T22-12-26Z` | **401** `UNAUTHORIZED` (репозиторий не существует для анонима) |
| `hub.docker.com/v2/repositories/minio/minio/tags` | **404** `object not found` |

Последствие было полным, а не частичным: `deploy/k8s/bootstrap.sh` ждёт
`rollout status deployment/minio` ДО seed и создания bucket, так что
`propriedades.yml` умирал в bootstrap, и **ни одно** из доказательств свойств
не выполнялось — даже те, что не касаются backup (`rollout-test`, `hpa-test`,
`test-reprojecao-k8s`).

Digest выполнил то, что обещал ADR 0159, — никто не подменил байты снизу, — и
этого не хватило: **digest гарантирует неизменяемость, а не доступность.** Pin
переживает владельца тега, двигающего тег; он не переживает владельца
registry, удаляющего репозиторий.

### Что зависит от этого S3 (отображено) {#o-que-depende-desse-s3-mapeado}

- **Сервер:** `deploy/k8s/overlays/local/minio/{minio,netpol}.yaml`,
  перечисленные в `kustomization.yaml` локального overlay. Только локальный
  overlay; staging и prod указывают на внешний bucket.
- **Клиент:** НЕ образ MinIO. `mc` ушёл в Фазе 5 (ADR 0027, решение 1b);
  backup, restore и создание bucket используют `aws-cli` из apk внутри
  `brabo-backup` (`docker/backup/Dockerfile.prod`), через адаптер
  `docker/backup/lib.sh`. S3-операций, которые он делает, семь: `s3 ls`,
  `s3 cp -` (stdin, multipart), `s3 cp` (загрузка), `s3api head-object`,
  `s3 cp` bucket→bucket (копирование на стороне сервера),
  `s3api list-objects-v2` и `s3 rm` — плюс `s3 mb` из bootstrap.
- **Учётные данные:** `BACKUP_S3_ACCESS_KEY`/`BACKUP_S3_SECRET_KEY` из Secret
  `brabo`, материализуемого ESO в `brabo-secrets`. Сервер читает ТУ ЖЕ пару.
- **Bootstrap:** `BACKUP_S3_ENDPOINT`, `rollout status`, ожидание `Endpoints`
  и эфемерный pod, создающий bucket.
- **Сеть:** две NetworkPolicy в overlay (вход на сервер, выход backup/restore),
  сопоставляющие порт POD.
- `make test-restore` (`deploy/k8s/test-restore.sh`) и CronJob backup видят
  только endpoint. Compose (`docker/backup/test-restore-compose.sh`)
  использует диск, а не S3, и не затронут.

## Решение {#decision}

**Сервером становится SeaweedFS, `docker.io/chrislusf/seaweedfs` 4.47,
закреплённый по digest ИНДЕКСА
(`sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882`),
работающий как `server -s3 -s3.port=9000`.** Ресурсы начинают называться
`s3-local` (Deployment, Service, PVC `s3-local-data`, метка
`app.kubernetes.io/name`), а папка — `overlays/local/s3/`.

### Кандидаты, по критериям в порядке, заданном сопровождающим {#as-candidatas-pelos-critérios-na-ordem-que-o-mantenedor-deu}

| кандидат | 1. официальный, анонимный, индекс amd64+arm64 | 2. реальный поток backup | 3. наименьшее изменение | 4. лицензия | исход |
|---|---|---|---|---|---|
| **SeaweedFS 4.47** (`chrislusf/seaweedfs`) | **да** — Docker Hub автора (README `seaweedfs/seaweedfs` указывает на него; метки OCI с `source`/`revision`), 200 анонимно, OCI-индекс с `amd64`, `arm64`, `arm/v7`, `386`; у тегов опубликована подпись cosign (`.sig`) | **да**, измерено (ниже) | меняется сервер; клиент, скрипт, Secret и порт остаются | Apache-2.0 | **выбран** |
| Garage v2.1.0 (`dxflrs/garage`) | да — 200 анонимно, индекс с `amd64`, `arm64`, `arm`, `386` | не измерен | требует файл конфигурации (ConfigMap с `rpc_secret`) и ПОСЛЕ загрузки `garage layout assign` + `layout apply` и `garage key import <key-id> <secret>` — новый административный шаг в bootstrap. Garage документирует собственный формат key-id (`GK…`), что вынудило бы сменить `BACKUP_S3_ACCESS_KEY=brabo-backup` (здесь не измерено) | AGPL-3.0 (без проблем для немодифицированного использования в тестовом overlay, но тяжелее первой) | отброшен по критерию 3 |
| MinIO из другого источника: `bitnami/minio` | **нет** — 404 анонимно (Bitnami тоже закрыл бесплатный каталог) | — | — | — | отброшен по критерию 1 |
| MinIO из другого источника: `bitnamilegacy/minio` | **нет** как живая публикация — репозиторий ЗАМОРОЖЕН, последнее обновление 2025-08-19; это зеркало без патчей и без активного публикатора | — | — | — | отброшен по критерию 1 |
| MinIO из другого источника: `cgr.dev/chainguard/minio` | частично — индекс amd64+arm64, анонимно, но бесплатен только `:latest`: нет стабильного тега для комментария pin, а публикатор — тот, кто перекомпилирует исходник, а не MinIO | — | — | AGPL-3.0 | отброшен по критерию 1 (без фиксированного тега; неофициальный публикатор) |
| Оригинальный MinIO (`quay.io`/`docker.io`) | **нет** — 401/404 (Контекст) | — | — | — | это и есть проблема |

«Остановитесь на первом, который выполнит всё»: SeaweedFS выполнил все четыре,
поэтому Garage не был доведён до реального потока — измерение остановилось
там, где правило велит остановиться, и колонка говорит это, а не заполняет её.

### Измерение критерия 2 {#a-medição-do-critério-2}

`brabo-backup`, собранный из этого checkout (`aws-cli/2.15.57`, Alpine 3.20),
запустил **реальный** адаптер (`docker/backup/lib.sh`, `destino_preparar` и
функции `destino_*`) против `weed server -s3` в контейнере как uid 1000, с парой
учётных данных в окружении и `/data`, ограниченным 4 GiB (размер PVC):

- неверный секрет → `aws s3 ls` **отклонён** (аутентификация действует);
- `s3 mb` из bootstrap → создал bucket;
- `destino_enviar` 30 MiB через stdin (multipart) → `head-object` вернул
  31457280, загрузка совпала по sha256;
- `destino_tamanho` несуществующего объекта → `0`;
- `destino_copiar` (копирование на стороне сервера), `destino_listar` (3
  ключа, пустой префикс без вывода) и `destino_remover` → корректны;
- `/healthz` на порту S3 → 200 примерно за 1 с, без аутентификации (это то,
  что используют probes); память ~470 MiB после загрузки, в пределах лимита
  1 GiB.

И в кластере, дважды:

- **CI**, `propriedades.yml` через `workflow_dispatch` на ветке, run
  `36362479629`: bootstrap, `smoke-k8s`, `hpa-test`, `rollout-test`,
  `test-restore`, `test-restore-mutacao` и `test-reprojecao-k8s` — все
  `success`, без изменения какого-либо доказательства.
- **Локально**, k3d на этой машине: `deploy/k8s/bootstrap.sh` вышел с 0
  (`rollout status deployment/s3-local` и создание bucket прошли), а
  `make test-restore` загрузил дамп 183 KB в
  `s3-local…/brabo-backups/daily/…`, скачал и восстановил 55 идентичных таблиц
  (выход 0); `make test-restore-mutacao` провалил поломку, назвав
  `zz_mutacao_restore` (выход 0). Деталь, ПОСТОРОННЯЯ S3, зафиксированная,
  чтобы её с ним не путали: при первом локальном запуске seed потерял
  активацию сессии в гонке с engine (`ECONNREFUSED …:4000`), дамп вышел без
  единого `session_event`, и доказательство провалилось из-за этого, как и
  должно; с тремя событиями, записанными через внутренний маршрут, на который
  указывает само сообщение доказательства, оно прошло. В CI seed активировал
  сессию с первого раза.

### Почему `server -s3`, а не `mini` {#por-que-server--s3-e-não-mini}

Образ рождается с `mini`, который добавляет WebDAV, Admin UI и каталог Iceberg.
`server -s3` поднимает master, volume, filer и шлюз S3 — минимум, отвечающий на
S3. Остальное было бы поверхностью и памятью без потребителя.

### Почему порт 9000 {#por-que-a-porta-9000}

NetworkPolicy сопоставляет порт POD, а не Service. С `-s3.port=9000` шлюз
слушает там, где слушал MinIO, и обе политики и `BACKUP_S3_ENDPOINT` меняют
только ИМЯ. Master (9333), volume (8080) и filer (8888) слушают внутри pod и
по-прежнему запрещены базовой политикой.

### Почему имя нейтральное {#por-que-o-nome-é-neutro}

Назвать `minio` Service, на котором работает SeaweedFS, сэкономило бы три
строки bootstrap и учило бы неправильно того, кто откроет кластер. Backup
потребляет ПРОТОКОЛ; называть по продукту за ним — то, что заставило бы
следующую замену повторить эту.

## Последствия {#consequences}

- Bootstrap снова проходит S3, и доказательства свойств снова выполняются
  (run `36362479629`, все шесть зелёные).
- **Клиент не изменился.** Ни одна строка `docker/backup/` не тронута, и то, что
  измеряют доказательства (`test-restore`, `test-restore-mutacao`), то же
  самое.
- **Объявленная цена: `readOnlyRootFilesystem` остаётся false**, как было с
  MinIO, — `weed` пишет сокет filer в `/tmp`. Компонент локального теста, без
  эквивалента в продакшене.
- **Объявленная цена: SeaweedFS — не MinIO.** Совместимость с S3 — контракт по
  операциям, а не печать. Восемь, которые использует продукт, измерены; НОВАЯ
  операция в `lib.sh` (lifecycle, версионирование, object lock) должна быть
  измерена против него, прежде чем войти, потому что именно здесь её проверят
  первой. Продакшен по-прежнему говорит с настоящим bucket, который не
  меняется.
- **Pin по digest не защищает от исчезновения публикатора** — и этот тоже.
  Сигнал, если это случится снова, тот же: bootstrap умирает на `rollout
  status` S3 с `ImagePullBackOff`. Урок ушёл в
  [`cadeia-de-suprimentos-do-ci.md`](../explanation/cadeia-de-suprimentos-do-ci.md).
- Число сторонних образов, закреплённых по digest, не меняется (один уходит,
  один входит): 39.
- RN не рождается: это инфраструктура локальной проверки, без бизнес-правила.
