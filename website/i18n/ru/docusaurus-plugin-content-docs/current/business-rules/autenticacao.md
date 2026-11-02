---
id: autenticacao
title: 'Бизнес-правила — Аутентификация'
sidebar_label: Аутентификация
description: 'RN first-party auth: refresh с ротацией, сессия в cookie, PAT, OAuth и ключ устройства.'
keywords: [бизнес-правила, аутентификация, refresh, cookie, PAT, OAuth]
traducao_de: 35a0dc07ccbd159e749036b48dc8d249d4e3b8f8
---

# Аутентификация

> Эти RN вынесены из [`business-rules.md`](../business-rules.md) без
> изменения ни единой запятой содержания: единая страница превышала 640 KB, и
> одни эти два раздела составляли её половину. Якоря `#rn-NNN`
> остались идентичными — изменился только файл, в котором они находятся.

Правила first-party auth. Все они действуют в домене api, который начиная с
7.2 является также **эмитентом** access tokens — Keycloak ушёл в атомарном
срезе, без периода сосуществования.
Решения — в [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
и [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

### RN-030 — Повторное предъявление уже использованного refresh отзывает всё семейство {#rn-030}

Каждый refresh потребляет предъявленный токен и выпускает дочерний с **тем же**
`family_id` и тем же `family_started_at`. Предъявление уже потреблённого
токена — признак кражи: кто-то использует копию, — и ответом является отзыв
всех живых токенов этого семейства, с событием безопасности.

Легитимный пользователь тоже разлогинивается. Это правильное поведение, а не
дефект: на стороне сервера двойная отправка клиента и replay вора
идентичны.

- **Где:** `apps/api/src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **Тест:** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **Граничный случай:** тот, кто предъявляет токен **уже отозванного** семейства, —
  пострадавший ниже по течению, а не новая кража: регистрируется
  `refresh_revoked` и **не** запускается второй каскад. Без этого различия
  каждая вкладка легитимного пользователя порождала бы ложную тревогу во время
  инцидента.
- **Источник:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — Неудачный вход считается по e-mail и по IP, и блокировка нарастает {#rn-031}

Скользящее окно в 15 минут в Postgres, без Redis. Две корзины на попытку, и
побеждает более строгая: e-mail (5 неудач → 30s, 8 → 5min, 12 → 15min) и IP
(20 → 30s, 30 → 2min). Успешный вход очищает корзину e-mail; корзина IP
опустошается только со временем.

Ключ корзины — **нормализованный e-mail**, никогда не id пользователя. С id
корзина существовала бы только после нахождения учётной записи, и сама
блокировка превратилась бы в оракул существования.

- **Где:** `apps/api/src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **Тест:** `test/application/use-cases/auth/lockout.spec.ts`
- **Граничный случай:** пока действует блокировка, попытка **не** регистрируется.
  Если бы регистрировалась, атакующий держал бы учётную запись жертвы
  запертой вечно, просто продолжая пытаться, — блокировка превратилась бы в
  отказ в обслуживании против того, кого она защищает.
- **Почему:** корзину IP нельзя очищать при успехе; тот, у кого есть
  действительная учётная запись, обнулял бы окно по желанию и рассыпал бы
  догадки без ограничения.
- **Источник:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — Ни один ответ не отличает существующую учётную запись от несуществующей {#rn-032}

Любой ответ, отличный от единообразной неудачи, достижим только **после**
успешной проверки пароля. При входе несуществующий e-mail, неверный пароль и
заблокированная учётная запись возвращают один и тот же 401 и тратят одно и
то же время — ветка без учётной записи проверяет по фиктивному хэшу,
сгенерированному с **теми же параметрами**, что и настоящий. При регистрации и
запросе сброса известный и неизвестный адреса возвращают 202.

- **Где:** `apps/api/src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **Тест:** `test/application/use-cases/auth/enumeracao.spec.ts`
- **Граничный случай:** проверка блокировки по e-mail выполняется **после**
  argon2, а не до. Ранний выход — оптимизация, которую предложил бы любой
  ревьюер, и это ровно утечка — тест становится красным, если кто-то её
  внесёт.
- **Граничный случай:** пользователь, МИГРИРОВАННЫЙ из Keycloak (есть в `users`,
  без строки в `auth_credentials`), тоже получает единообразный 401 — а ссылка
  «задать пароль» отправляется молча. Ответ `password_pending` подтвердил бы,
  что адрес существует **и** что это унаследованная учётная запись. Поэтому
  `findByEmail` — это LEFT JOIN в одном запросе: два последовательных запроса
  заставили бы эту ветку платить лишний поход в базу, и часы раскрыли бы то,
  что скрывает тело.
- **Почему:** утверждается «ни одна ветка не пропускает дорогую работу и ни
  одна не даёт различимого ответа», **а не** постоянное время. См. следствия
  в ADR.
- **Источник:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  граничный случай мигрированного — в
  [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — Токен подтверждения и сброса действует только один раз {#rn-033}

Потребление через условный UPDATE с `returning`: сам UPDATE и есть защита.
Ноль строк покрывает несуществующий, другого назначения, уже потреблённый,
аннулированный и истёкший — все с одинаковым ответом. Запрос новой ссылки
аннулирует предыдущую. Завершение сброса отзывает **все** сессии
пользователя и не выпускает токенов.

- **Где:** `apps/api/src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **Тест:** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **Граничный случай:** две одновременные отправки не проходят обе. Гонка —
  **нормальный** случай, а не исключение: корпоративный сканер почты открывает
  каждую ссылку каждого сообщения, так что робот обычно потребляет токен до
  того, как человек кликнет.
- **Почему:** сброс намеренно не выпускает сессию — вход напрямую по ссылке,
  полученной по почте, сделал бы компрометацию почты равносильной захвату
  учётной записи, без второго шага.
- **Источник:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — Веб-сессия живёт в cookie httpOnly, с CSRF {#rn-034}

Refresh token идёт в cookie `brabo_refresh` (`httpOnly`, `SameSite=Strict`,
`Path=/auth`, `Secure` в production) и **не** появляется в теле ни одного
ответа. Access token на 15 минут хранится в памяти клиента и передаётся в
`Authorization: Bearer`.

`/auth/refresh` и `/auth/logout` требуют `X-CSRF-Token`, равный cookie
`brabo_csrf`, сравниваемый за постоянное время.

- **Где:** `apps/api/src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **Тест:** `test/interfaces/session-cookies.spec.ts`
- **Граничный случай:** провал CSRF — **403**, а не 401. С 401 клиент
  попытался бы обновить сессию и попал бы в цикл — учётные данные в порядке,
  неверен запрос.
- **Почему:** возврат refresh также в теле свёл бы на нет `httpOnly` —
  достаточно было бы XSS прочитать ответ входа, и он унёс бы долгую сессию
  вместо 15 минут access.
- **Источник:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — Внутренний трафик engine ↔ api требует сервисного секрета {#rn-035}

32 маршрута `/internal/*` — это `@ServiceRoute()`: они вне пользовательского
JWT и вне rate limit. Аутентифицирует `EngineServiceGuard`, сравнивая
`X-Brabo-Service-Token` с `BRABO_SERVICE_TOKEN` за постоянное время. Один и
тот же секрет действует в обоих направлениях, а `BRABO_SERVICE_TOKEN_PREVIOUS`
принимается только при проверке, чтобы у ротации не было окна недоступности.

- **Где:** `apps/api/src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **Тест:** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`,
  `test/interfaces/route-surface.spec.ts` и, для ротации на стороне api
  (предыдущий принимается только при проверке, вызывающий отправляет текущий,
  после удаления предыдущего старый отпадает),
  `test/infrastructure/security/service-token.spec.ts`
  (describe "rotação do BRABO_SERVICE_TOKEN") и
  `test/interfaces/engine-service.guard.spec.ts` ([RN-597](#rn-597))
- **Граничный случай:** освобождение от rate limit берётся из МЕТАДАННЫХ
  маршрута, а не из guard. `RateLimitGuard` — это `APP_GUARD`, и он
  выполняется до любого guard controller — когда он принимает решение,
  `EngineServiceGuard` ещё не выполнился.
- **Источник:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-597 — Смена pepper — это глобальный выход {#rn-597}

У pepper, которым ключуется HMAC непрозрачных токенов, нет `_PREVIOUS`, и его
смена имеет следствие, а не процедуру: каждый refresh token в обращении,
каждая открытая ссылка подтверждения e-mail и сброса пароля и каждый личный
токен доступа (PAT) перестают находиться, потому что хэш, пересчитанный с
новым pepper, не совпадает с записанным. Отклонённый refresh регистрирует
`refresh_unknown` (а не `refresh_reuse_detected`), ссылка говорит "Link
inválido ou expirado", а корзины lockout меняют ключ — заблокированная учётная
запись разблокируется. ПАРОЛЬ переживает (argon2id с солью на запись, без
pepper): смена pepper стоит одного входа, никогда учётной записи, и api
нормально стартует с новым значением.

До [RN-613](#rn-613) pepper без собственного значения падал на
`AUTH_JWT_SECRET`, и ротация JWT была также ротацией pepper, со всеми
следствиями выше. Начиная с неё pepper обязателен в production и никогда не
заимствуется у JWT.

- **Где:** `apps/api/src/infrastructure/security/auth-key-material.ts:212`
  (`pepper`), `:228` (`hashDeToken`), `:247` (`baldeDeEmail`);
  `apps/api/src/interfaces/http/auth/pat-auth.guard.ts:142`
- **Тест:** `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`,
  против тестового Postgres
- **Граничный случай:** ЦЕЛЬ «смены» включает ошибку того, кто отделяет pepper
  от JWT, генерируя новое значение вместо копирования текущего, — это та же
  смена, и она разлогинивает так же (зафиксировано в том же spec, «a ordem
  errada»).
- **Источник:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  AT-196

### RN-613 — `AUTH_TOKEN_PEPPER` обязателен и собственный; при миграции он задаётся текущим `AUTH_JWT_SECRET` {#rn-613}

Pepper HMAC непрозрачных токенов (refresh, ссылки учётной записи, PAT,
корзина lockout) перестал падать на `AUTH_JWT_SECRET`. Молчаливый fallback
(`AUTH_TOKEN_PEPPER ?? passphraseAtual()`) превращал каждую ротацию JWT «без
простоя» в смену pepper, и это был ОБЫЧНЫЙ путь: composes production и
установки даже не передавали переменную. В production api ОТКАЗЫВАЕТСЯ
стартовать без него, и отказ называет исправление — *"defina com o valor ATUAL
de AUTH_JWT_SECRET para não deslogar ninguém"*, — потому что очевидное
исправление (сгенерировать случайное) — то, которое разлогинивает всех. С
pepper, равным старому JWT, хэш байт в байт прежний, refresh tokens и PAT
остаются действительными, и с этого момента JWT ротируется самостоятельно.
Pepper, равный JWT, НЕ отклоняется: это легитимное состояние каждой
мигрированной установки. Действуют правила JWT (RN-114): пустое значение, два
примерных литерала репозитория и менее 16 символов роняют загрузку. Вне
production действует СОБСТВЕННОЕ значение по умолчанию для разработки
(`dev-auth-token-pepper-change-me`), никогда не значение JWT.

Миграцию выполняет `install.sh`: НОВАЯ установка генерирует случайный pepper;
при наличии предыдущего `.env` в папке он ЧИТАЕТСЯ (никогда не исполняется)
перед перезаписью, и его pepper сохраняется — или, без pepper, рождается с его
`AUTH_JWT_SECRET`. Терминал говорит, откуда пришло значение, никогда само
значение.

- **Где:** `apps/api/src/infrastructure/security/auth-key-material.ts:168`
  (`pepperAtual`), `:212` (`pepper`); `apps/api/src/main.ts:46` (проверка при
  загрузке); `install.sh:702` (`valor_no_env_anterior`), `:734` (`gerar_segredos`),
  `:831` (`dizer_a_origem_do_pepper`); переменная в трёх composes
  (`docker/docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.install.yml`), в `docker/smoke.sh` и в `.env.example`
- **Тест:** `test/infrastructure/security/auth-key-material.spec.ts`
  (describe "pepperAtual (RN-613)": отказ без pepper даже с JWT, сообщение,
  примеры, нижняя граница, равенство JWT принимается, значение по умолчанию
  для dev);
  `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` (describe "a
  migração do RN-613": refresh, записанный по СТАРОЙ формуле, остаётся
  действительным с pepper, равным старому JWT, и переживает смену JWT;
  describe `AUTH_JWT_SECRET`: без pepper вне production смена JWT не
  разлогинивает);
  `scripts/dev/install-env.spec.ts` (describe "o AUTH_TOKEN_PEPPER do
  instalador (RN-613)", против `docker compose config`, значение целиком)
- **Граничный случай:** установщик видит только `.env` папки, в которой
  запущен. Установка, чей `.env` живёт в другом месте, собственный compose и
  Kubernetes с `ExternalSecret` выполняют миграцию вручную, по runbook, — в
  Kubernetes свойство `AUTH_TOKEN_PEPPER` уже существовало в `ExternalSecret` и
  в `bootstrap.sh`, а провайдер, у которого его нет, уже проваливал
  синхронизацию. И миграция установщика удаляет тома (ADR 0150): refresh
  переживает только для того, кто восстанавливает dump Postgres, — это и есть
  важный случай.
- **Источник:** AT-210 (находка AT-196), решение сопровождающего: миграция с
  текущим значением

### RN-595 — Каждая `_PREVIOUS`, которую читает сервис, доходит до него через три compose, пустая по умолчанию {#rn-595}

Три ротации без простоя (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`) зависят от того, что процесс видит старое значение
в переменной `_PREVIOUS` в течение окна. Compose не передаёт окружение хоста,
и ни одной из трёх не было в `environment:` ни одного compose: задание
`_PREVIOUS` в `.env` не имело эффекта, и тот, кто следовал runbook, сам того не
зная, делал сухую замену, которой ротация существует, чтобы избежать. Теперь
api получает все три, а engine и broker получают `BRABO_SERVICE_TOKEN_PREVIOUS`,
в composes разработки, production и установки, всегда с ПУСТЫМ значением по
умолчанию — заданная означает идущую ротацию, а заполненное значение по
умолчанию оставляло бы установку вечно посреди ротации. Пустая — то же, что
отсутствующая, у всех трёх читателей.

- **Где:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml` и
  `docker/docker-compose.install.yml` (сервисы `api`, `engine` и `broker`);
  читатели — `apps/api/src/infrastructure/security/auth-key-material.ts:136`
  (`passphraseAnterior`), `apps/api/src/infrastructure/security/service-token.ts:92`
  (`tokenDeServicoAnterior`), `apps/api/src/infrastructure/security/envelope-encryption.service.ts:93`,
  `apps/engine/config/runtime.exs:70` и `apps/broker/src/config.ts:85`
- **Тест:** `scripts/ci/previous-nos-composes.spec.ts` — ВЫВОДИТ из кода трёх
  сервисов список читаемых `_PREVIOUS` и проваливает ту, что отсутствует или
  приходит с непустым значением по умолчанию, в любом из трёх compose; блок
  "ExternalSecret do k8s" проваливает `ExternalSecret` без `dataFrom.extract`,
  `_PREVIOUS` в `data:` и Deployment api/engine без `envFrom: brabo-secrets`
- **Kubernetes (AT-220, решение сопровождающего):** Pods читают
  `envFrom: brabo-secrets`, а `ExternalSecret`
  (`deploy/k8s/base/common/externalsecrets.yaml`) забирает объект `brabo`
  ЦЕЛИКОМ из store через `dataFrom.extract` — `_PREVIOUS` входит, когда
  существует, и уходит, когда изъята, при следующей синхронизации. Её нельзя
  перечислять в `data:`: у ESO нет необязательного ключа, а отсутствующее
  свойство (нормальное состояние) проваливает синхронизацию всего Secret.
  Объявленная цена: КАЖДЫЙ ключ объекта становится переменной api, engine,
  миграций и backup, а отсутствие ОБЯЗАТЕЛЬНОГО ключа перестало проваливать
  синхронизацию — обнаруживает потребитель. Синхронизация реальным ESO была
  отработана вручную в одноразовом k3d, а не в CI
- **Источник:** AT-201 (находка AT-196), тот же класс, что RN-540; половина
  Kubernetes — в AT-220

### RN-598 — ПРЕДЫДУЩИЙ сервисный токен проходит то же правило, что и текущий {#rn-598}

Во время ротации `BRABO_SERVICE_TOKEN_PREVIOUS` открывает `/internal/*` в той
же мере, что и текущий. Он проходит ОДНО правило, то же, что у текущего
(`exigirTokenDeProducao`), и ни одной его копии. Окружающие пробелы
отбрасываются, а значение только из пробелов считается отсутствующим. В
production публичный литерал разработки (`dev-service-token-change-me`) и
значение короче 16 символов после trim РОНЯЮТ загрузку api с сообщением,
называющим `BRABO_SERVICE_TOKEN_PREVIOUS`. До этого переменная сравнивалась
сырой: предыдущий с примерным значением открывал внутреннюю дверь любому,
кто читал этот репозиторий, и без какой-либо ошибки. Обязательность —
единственная часть правила текущего, которая НЕ копируется, потому что вне
ротации отсутствие предыдущего — нормальное состояние. Предыдущий, равный
текущему (после trim), по-прежнему не считается ротацией.

- **Где:** `apps/api/src/infrastructure/security/service-token.ts:63`
  (`exigirTokenDeProducao`), `:92` (`tokenDeServicoAnterior`);
  `apps/api/src/main.ts:50` (`tokenDeServicoAnterior`), выполняемый при загрузке рядом с текущим
- **Тест:** `test/infrastructure/security/service-token.spec.ts` (describe
  "tokenDeServicoAnterior (RN-598)")
- **Граничный случай:** эта RN — сторона api. Engine и broker применяют то же
  правило начиная с [RN-601](#rn-601).
- **Источник:** AT-205 (находка AT-196)

### RN-601 — Engine и broker применяют к обоим сервисным токенам правило api {#rn-601}

Три процесса, сравнивающие сервисный токен, используют то же правило
[RN-598](#rn-598), каждый на своём языке. Окружающие пробелы отбрасываются, а
значение только из пробелов считается отсутствующим. В production
отсутствующий `BRABO_SERVICE_TOKEN`, публичный литерал разработки
(`dev-service-token-change-me`) или значение короче 16 символов после trim
РОНЯЮТ загрузку с сообщением, называющим переменную. Два последних отказа
действуют также для `BRABO_SERVICE_TOKEN_PREVIOUS`, когда он задан.
Предыдущий, равный текущему, не считается ротацией. Вне production
применяется только trim, а пустой текущий падает на значение по умолчанию
для dev.

Раньше engine читал оба сырыми в `config/runtime.exs`: без trim, без нижней
границы, а в production стартовал с публичным значением по умолчанию, когда
переменная отсутствовала (и с пустой строкой, когда compose передавал её
пустой). Установку защищало только то, что api отказывалась стартовать.
Broker уже применял правило к текущему, но к предыдущему — только trim.

Два расхождения по форме, объявленные. В engine «production» — это
`config_env() == :prod` (release), а не `NODE_ENV`, который он не читает;
образ production — всегда release `:prod`. И правило находится inline в
`runtime.exs`, а не в модуле `lib/`, потому что в release этот файл
выполняется в config provider до загрузки кода приложения.

Следствие: каждому процессу, который вычисляет этот `runtime.exs` в release
`:prod`, нужен токен, включая миграцию (`bin/engine eval
Engine.Release.migrate()`). Поэтому сервис `migrate-engine` composes
production и установки начал получать `BRABO_SERVICE_TOKEN` и
`BRABO_SERVICE_TOKEN_PREVIOUS`, без значения по умолчанию. Smoke CI это
показал: без них миграция умирала, не успев мигрировать. Job миграции
Kubernetes уже получал их через `envFrom` из `brabo-secrets`.

- **Где:** `apps/engine/config/runtime.exs:85`
  (`exigir_token_de_servico_de_producao`), `:105` (`service_token`), `:121`
  (`service_token_previous`); `apps/broker/src/config.ts:89` (`anterior`),
  `:125` (`exigirTokenDeProducao`)
- **Тест:** `apps/engine/test/engine/runtime_service_token_test.exs` (вычисляет
  настоящий `runtime.exs` через `Config.Reader.read!/2`, с `env: :prod` и
  `:dev`); `apps/broker/src/config.spec.ts` (describe "lerConfiguracao —
  produção, o token ANTERIOR (RN-601)")
- **Граничный случай:** правило скопировано в три процесса, а не общее: это
  три языка или runtime, и ни один тест не проверяет, что три копии остаются
  одинаковыми. Нижняя граница считает символы (`String.length` в Elixir,
  `.length` в TS), что различается только для токена вне ASCII.
- **Источник:** AT-216 (находка AT-205)

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` проверяются ДО того, как стать сегментом URL внутреннего запроса к engine {#rn-128}

`HttpApiToEngineClient` подставляет эти значения в template string, чтобы
собрать URL `/internal/*`, — без DTO/`class-validator` посередине, как и в
[RN-127](../business-rules/custo.md#rn-127): они приходят из `@Param`/поиска
сессии без pipe валидации в каком-то месте цепочки, и ничто не гарантирует
их форму до подстановки. Вредоносное значение могло бы внедрить
дополнительный сегмент пути или символы, ломающие собранный URL, —
`EngineServiceGuard` аутентифицирует ВЫЗЫВАЮЩЕГО (RN-035), но не
ПРОВЕРЯЕТ, что вызывающий отправляет в URL.

`garantirSegmentoDeUrlInterna` переиспользует ту же ширину, что
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, дефис и подчёркивание, от 1 до 64
символов, — и вызывается в ДВУХ местах, покрывая ВСЕ методы, подставляющие id
в URL, а не только те, о которых сообщил CodeQL:

- внутри `postCommand`, который уже использует большинство методов
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — вызывающий перечисляет кортежи `(nome, valor)`, которые
  уже подставил в `path`, а `postCommand` проверяет ВСЕ до сборки запроса;
- напрямую в `reanalyzeSession`/`runAnamnese`, которые не проходят через
  `postCommand` (им нужно отличать 503 от сбоя транспорта) и поэтому были
  двумя единственными точками, до которых дотянулся CodeQL.

Счастливый путь не меняется: `sessionId`/`projectId` — всегда UUID из базы, а
`agent`/`agentId` — всегда короткий slug.

- **Где:** `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Тест:** `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (некорректный id отклоняется ДО обращения к сети — доказано направлением
  `ENGINE_URL` на порт, который никто не слушает, — а счастливый путь доходит
  до выполнения запроса)
- **Источник:** КРИТИЧЕСКОЕ предупреждение CodeQL (URL внутреннего запроса,
  собранный из непроверенного значения), блокировавшее продвижение qa→main,
  обнаружено во время PR #256; тот же шаблон, что
  [RN-092](../business-rules/custo.md#rn-092)

### RN-105 — Без образа, выбранного Arquiteto, контейнер не поднимается и Code не открывается {#rn-105}

Вкладка Code (`GET /projects/:id/code/*`, [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))
отвечает **409**, пока проект находится в `sem_decisao` — начальном
состоянии каждого проекта. `sem_decisao` становится `decidido` только когда
Arquiteto выпускает `artifact.project_image` инструментом
`choose_project_image`, с образом OCI с явным тегом (`latest` отклоняется),
`rationale` и сетевой позицией.

Проверка находится в ТОЙ ЖЕ воронке, что и ограничение пути
[RN-095](../business-rules/custo.md#rn-095) (`ReadProjectCodeUseCase.alvo`), а
не в каждом из семи маршрутов (дерево, файл, поиск, diff PR,
[blame](#rn-110), [список PR](#rn-111) и [подробные ветки](#rn-112),
ФАЗА 26b) — проверка, продублированная в семи вызывающих, — это проверка,
которая однажды разойдётся в одном из них
([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).
Счёт исправлен здесь: эта запись говорила «четыре маршрута» с ФАЗЫ 26 и
устарела, когда ФАЗА 26b добавила последние три в ту же воронку, а это число
никто не пересмотрел.

У артефакта нет таблицы: это само событие в event log, версионированное
(`version` растёт с каждой эмиссией, действующим является событие с
наибольшим `version`), так же, как `artifact.module_map`. Пересмотр образа —
это эмиссия новой версии, никогда не перезапись предыдущей.

- **Где:** `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts` (метод
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Тест:**
  `apps/api/test/domain/containers/project-container.spec.ts`,
  `apps/api/test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (блок "o portão do container")
- **Граничный случай:** 409, а не 403 — ничего не так ни с тем, кто запросил,
  ни с его разрешением; ресурса ещё нет В ЭТОМ СОСТОЯНИИ. И не 404: вкладка
  существует, просто не открыта. Сообщение говорит, чего не хватает, чтобы
  экран показал причину, а не немую ошибку (RN-088).
- **Источник:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`, PR и deploy не выходят через терминал — даже внутри области видимости проекта {#rn-106}

**ПЕРЕСМОТРЕНО [RN-418](../business-rules.md#rn-418) (ADR 0102, ГЛОБАЛЬНОЕ
решение владельца продукта)**: описанный в этой записи `deny` стал
АБСОЛЮТНЫМ ПОТОЛКОМ (безусловный `require_approval`) — остальная часть этой
записи историческая, верная тому, что действовало до пересмотра.

Внутри контейнера проекта агент свободен (ADR 0065): allowlist глаголов
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) не
сходится (находки Z и AD — глагол, форма и вызов являются разными
пространствами), и выход — стена, а не более длинный список. Но три эффекта
пересекают стену и попадают в мир, и решение пользователя было дословным:
*«агент свободен делать что угодно, лишь бы это не были команды git, связанные
с deploy и PR, — эти действия по-прежнему должны быть человеческими»*.

`decide()` распознаёт `git push`, `git remote add/set-url`, `git merge`, CLI
провайдеров (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases и
workflow dispatch) и распространённые команды deploy (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) по ПРЕФИКСУ
токенов, игнорируя глобальные флаги посередине (`git -C /tmp push`
совпадает). Любой совпадающий сегмент составной команды — **`deny`**, а не
`require_approval`: «всегда разрешать» записывает шаблон в `allow`, и одного
клика хватило бы, чтобы вторая дверь осталась открытой навсегда. `deny`
побеждает `allow` на любом этапе и применяется ДО любого разрешающего этапа в
`decide()`.

Отказ не отнимает у агента власти: сообщение перенаправляет на ТИПИЗИРОВАННОЕ
действие (`git_push`, `git_merge`, `pr_open`) — которое рождается
`proposed_action`, имеет собственную минимальную роль и регистрирует в event
log, что было отправлено и куда. Это путь, которым dev agent уже пользуется
(`agent_io.ex` предлагает `git_push`); меняется то, что теперь это
гарантировано `deny`, а не просто договорено по соглашению.

- **Где:** `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/domain/actions/decide.ts` (блок "FRONTEIRA DO CONTAINER")
- **Тест:** `apps/api/test/domain/actions/external-effect.spec.ts`,
  `apps/api/test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Граничный случай:** граница НЕ перекрывает блокировку merge в защищённую
  ветку (RN-014, всегда вручную) и область видимости пути (RN-095/ADR 0055) —
  три правила сосуществуют, каждое накладывает вето по своей причине.
- **Источник:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-107 — У вкладки Code есть ЧЕТВЁРТОЕ состояние: заблокирована ожидающим решением {#rn-107}

Три состояния [RN-088](../business-rules.md#rn-088) (загрузка/ошибка/пусто)
не описывают `sem_decisao` ([RN-105](#rn-105)): это не загрузка (api уже
ответила), не ошибка (она ответила ВЕРНО) и не пусто (не хватает не данных —
не хватает РЕШЕНИЯ, а это другое). Трактовка `sem_decisao` как «пусто»
показала бы редактор без файлов, наводя на мысль, что репозиторий пуст;
трактовка как «ошибка» заставила бы экран предлагать «попробовать снова» для
того, что решает только Arquiteto.
Вкладка запрашивает состояние контейнера ДО попытки прочитать код
(`GET /projects/:id/container`), вместо того чтобы ждать, пока первое дерево
или файл вернут 409, — та же проверка, которую api уже делает в воронке
`ReadProjectCodeUseCase` (RN-105), только заданная первой, чтобы четвёртое
состояние рождалось как собственное сообщение, а не как подвал общей ошибки.
Пока вкладка заблокирована, экран сам перезапрашивает каждые 15s — после
того как образ выбран, он не меняется без нового действия человека, а
постоянный перезапрос стабильного состояния был бы тем же семейством
лишнего трафика, что и в ПОСЛЕ-ФАЗЫ 15.

Представление четвёртого состояния было ВЫДЕЛЕНО в `ContainerImageGateNotice`
(`apps/web/src/components/ContainerImageGate.tsx`) — находка из использования:
вкладка PRs (`apps/web/src/routes/code/PrListAndDiff.tsx`, используемая
`ProjectPrsTab.tsx` и `CodeDiffPanel.tsx`) вызывает `getCodePullRequests`/
`getCodeDiff`, которые проходят через ТУ ЖЕ воронку (RN-105) и могут вернуть
ТОТ ЖЕ 409 — но, в отличие от этой вкладки, не спрашивая заранее. Она
показывала этот 409 в баннере общей ошибки с "Tentar de novo" — неверная
подсказка для состояния, которое решает только Arquiteto.
`isContainerImageGateError` (`apps/web/src/lib/api-client.ts`) определяет
причину по `status === 409` — единственной причине `ConflictException` в
`ReadProjectCodeUseCase.alvo`, — и `PrListAndDiff` заменяет баннер на
`ContainerImageGateNotice`, когда она совпадает, без собственной
предварительной проверки (реагирует на 409 запроса, который и так
выполнялся бы).

- **Где:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx` (общее представление),
  `apps/web/src/routes/code/PrListAndDiff.tsx` (потребитель, реагирующий на
  409), `apps/web/src/lib/api-client.ts`
  (`isContainerImageGateError`)
- **Тест:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("o gate do container não é
  erro genérico")
- **Граничный случай:** проверка во front НЕ заменяет проверку api — это
  удобство UX. Если api сменит состояние между запросом gate и настоящим
  чтением, маршрут чтения всё равно отклонит с 409 (RN-105); front лишь
  избегает обычного случая, когда на мгновение показывается пустой редактор.
  Вкладка PRs не делает предварительной проверки: она обнаруживает блокировку,
  когда запрос уже упал, потому что там нет ни дерева, ни файла для того
  «пустого» мгновения, которого избегает предварительная проверка вкладки
  Code.
- **Источник:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-110 — `blame` — 13-я операция `GitProviderContract`, с тем же словарём отсутствия, что и у других чтений {#rn-110}

Фундамент задолженности по blame, объявленной в ФАЗЕ 26 (ни один экран пока
его не потребляет — это в следующей волне). `blame(ref, path)` возвращает
`GitBlame | null`, где `null` означает ровно то, что уже означает в
`getFileContent`/`listTree`: файл отсутствует в этой ref, или ref не
существует. Два словаря «не существует» для одной вкладки заставили бы экран
обрабатывать один случай двумя способами — та же причина, что уже действовала
для двух предыдущих операций.

Каждый провайдер вычисляет СОБСТВЕННЫМИ средствами, потому что общего
endpoint нет: у GitHub нет blame в REST (только GraphQL — единственная
операция провайдера, говорящая на GraphQL), у GitLab есть
`repository/files/:path/blame`, а локальный берётся из `git blame --porcelain`,
единственный из трёх, протестированный против настоящего репозитория в этой
сессии (два других — только против fake backend контрактного теста — без
`GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` в окружении против реального API
доказывает ручной smoke). `GIT_BLAME_LINE_LIMIT` (2000) отсекает действительно
огромный файл — уже обрезанный по байтам в маршруте содержимого, но `blame`
читает весь файл у провайдера, прежде чем принять решение.

- **Где:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (метод `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Тест:** `apps/api/test/contract/git-provider.contract.ts` (блок "blame"),
  выполняемый тремя spec провайдеров — `local` против настоящего git — и
  `read-project-code.use-case.spec.ts` (блок "blame")
- **Источник:** ФАЗА 26b (фундамент объявленных задолженностей ФАЗЫ 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` — 14-я операция `GitProviderContract`; навигируемый список открывает тот же diff по id {#rn-111}

`CodeDiffPanel.tsx` потребляет `listPullRequests(state?)` в кликабельном
списке (id/номер/заголовок/автор/состояние/ветки, с фильтром по состоянию);
клик по элементу переиспользует ТОТ ЖЕ поток diff по id, который уже
существовал, — нового пути чтения нет, только способ ДОБРАТЬСЯ до id без
необходимости знать его наизусть. Тот, кто уже знает id (например, пришёл из
Aprovações), по-прежнему может вставить его напрямую.

`listPullRequests(state?)` возвращает СВОДКУ по PR
(`GitPullRequestSummary`: id, номер, заголовок, автор, состояние, ветки,
`updatedAt`) — а не `GitPullRequest`, который является типом ЗАПИСИ
(открыть/смержить) и никогда не имел ни заголовка, ни автора, потому что ни
одной из двух операций это не требовалось. Собственный тип не даёт записи
получить поля, которые использует только чтение.

У `local` ЕСТЬ PR — sidecar store Фазы 4a уже является источником, а
предположение формулировки («PR не существует в концепции чистого локального
репозитория») не подтвердилось: самодостаточность dev agents с тех пор
создавала локальные PR. Все три capabilities — `true`. `GIT_PR_LIST_LIMIT`
(100) — одна страница, без последующей пагинации: человеческая навигация, а
не синхронизация истории.

- **Где:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (метод
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (кликабельный список, фильтр
  по состоянию, переиспользование потока diff по id)
- **Тест:** `git-provider.contract.ts` (блок "listPullRequests"),
  `read-project-code.use-case.spec.ts` (блок "lista de PRs"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Источник:** ФАЗА 26b

### RN-112 — `listBranchesDetailed` — СОБСТВЕННАЯ операция, отдельная от `listBranches` {#rn-112}

Фундамент богатого выпадающего списка, теперь потребляемый
`CodeBranchPicker.tsx` (`ahead`/`behind`, бейдж PR — волна после ФАЗЫ 26b
закрыла задолженность, которую объявлял `CodeShell.tsx`). Решение было НЕ
расширять `listBranches` — исходную 13-ю операцию, которую bootstrap Gitflow
вызывает, не нуждаясь ни в чём из этого: обогащение стоит дополнительного
вызова провайдера НА КАЖДУЮ ВЕТКУ (два в GitLab, у которого нет endpoint,
возвращающего обе стороны сравнения за один вызов, в отличие от
`compareCommitsWithBasehead` в GitHub и `git
rev-list --left-right --count` в локальном). Прицепить эту стоимость к
каждому принятию/созданию ветки превратило бы bootstrap в дорогой обход. Обе
операции сосуществуют в контракте: `listBranches` для bootstrap,
`listBranchesDetailed` (15-я) для вкладки Code — `GitBranchDetail`
расширяет `GitBranch` только по ФОРМЕ, никогда по КОНТРАКТУ вызывающего.

`ahead`/`behind` всегда относительны к ветке ПО УМОЛЧАНИЮ репозитория
(`ListBranchesDetailedInput.defaultBranch`, которую вызывающий уже знает —
запрашивать её у провайдера снова было бы лишним вызовом только ради того,
чтобы переоткрыть уже известное). `null` в обоих, когда провайдер не может
вычислить (осиротевшая ветка, несвязанная история), — честная деградация,
никогда не выдуманное число. `GIT_BRANCH_DETAIL_LIMIT` (30) отсекает по тем
же причинам трафика, что и пункт 34 ФАЗЫ 26, — без него репозиторий с сотнями
веток превращался бы в сотни вызовов при каждом открытии выпадающего списка.

- **Где:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (метод
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  в web — `apps/web/src/lib/api-client.ts` (`getCodeBranches`) и
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — сам выпадающий список,
  открываемый из `CodeShell.tsx`
- **Тест:** `git-provider.contract.ts` (блок "listBranchesDetailed"),
  `read-project-code.use-case.spec.ts` (блок "branches detalhadas"),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Граничный случай:** метод `branches()` живёт в ТОМ ЖЕ сценарии
  использования, что и остальные шесть чтений (`ReadProjectCodeUseCase`), а не
  рядом с bootstrap — это ЧТЕНИЕ вкладки Code, с тем же разрешением учётных
  данных и теми же воротами контейнера (RN-105), что и остальные; трактовка её
  как операции bootstrap продублировала бы и то и другое. Ref вне списка веток
  (тег или sha) остаётся достижимой — в подвале выпадающего списка есть
  ручное поле, потому что `listBranchesDetailed` не перечисляет эти две вещи.
- **Источник:** ФАЗА 26b (фундамент); следующая волна закрыла UI

### RN-113 — Blame в редакторе — это аннотация ПО ЗАПРОСУ — переключатель, никогда не встроенная в чтение файла {#rn-113}

UI, потребляющий фундамент [RN-110](#rn-110), вступает здесь: редактор вкладки
Code (`CodeEditor.tsx`) вызывает `getCodeBlame` только когда пользователь
включает переключатель "Blame" — никогда вместе с чтением файла, которое и так
запускается само при открытии вкладки. Причина та же, что у бюджетов
составного чтения (ADR 0060): blame — это ВТОРОЙ вызов провайдера на каждый
открытый файл, а файл около потолка (`GIT_BLAME_LINE_LIMIT`, 2000 строк) уже
достаточно дорог, чтобы не
платить за него бесплатно при каждой навигации. `truncated` (который RN-110
уже раскрывает) становится видимым предупреждением, по тому же образцу, что и
предупреждение `fileQuery.data.truncated`.

Последовательные строки ОДНОГО коммита показывают автора и короткий sha только
в ПЕРВОЙ строке блока — повторение одного и того же текста в каждой строке
блока из десятков строк было бы шумом, а не аннотацией; строка исчезает
только из текста, но никогда из аннотации (`title` элемента сохраняет полную
дату и сводку коммита в любой строке блока).

- **Где:** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **Тест:** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **Источник:** волна UI ФАЗЫ 26b (blame — богатый выпадающий список веток и
  список PR — это UI двух других агентов, без риска коллизии)

### RN-115 — Anamnese может быть приостановлена глобально; пауза принадлежит ПРОДУКТУ и никогда не удаляет данные {#rn-115}

`ANAMNESE_ENABLED` (переменная окружения engine, boolean, по умолчанию
`false` начиная с этого правила) решает, может ли произойти НОВЫЙ прогон
Anamnese — периодический (`AnamneseSchedulerWorker`) или по запросу
(`AnamneseCommandController`). Решение ПРОДУКТА пользователя от 2026-08-10
(«сегодня он не приносит особо ценных данных»), не баг — см.
docs/explanation/backlog.md. При отключении НИКАКИЕ существующие данные не
затрагиваются: уже записанные гипотезы, профили квалификации и патчи
инструкций остаются нетронутыми и видимыми, а opt-out ДЛЯ УЧАСТНИКА (RN-025)
остаётся отдельным понятием — пауза принадлежит СИСТЕМЕ, а не
индивидуальному профилированию.

`AnamneseSchedulerWorker.kickoff/0` (вызывается один раз при загрузке) НЕ
планирует периодический job, когда функция отключена, вместо того чтобы
планировать и позволять `perform/1` ничего не делать на каждом тике, —
дешевле (очередь Oban не получает job каждые `ANAMNESE_INTERVAL_SECONDS` лишь
для того, чтобы ничего не делать) и понятнее для того, кто инспектирует
очередь. **Исправление от 2026-08-10** (реальная находка при исполнении, а не
гипотеза): исходная версия этого правила намеренно оставляла `perform/1`
безусловным, чтобы цепочка между прогонами не несла с собой решение
включить/выключить, — но это означало, что цепочка, запланированная ДО
появления флага (или до того, как кто-то его выключил), продолжала
перепланировать себя вечно, выполняя настоящую Anamnese при флаге,
говорящем `false`. Именно это произошло в dev Postgres, более старом, чем
исходный PR, и было устранено вручную отменой запланированных jobs.
`perform/1` теперь проверяет `enabled?/0` на каждом тике, как и `kickoff/0`:
при отключении не происходит ни `enqueue_projects/0`, ни перепланирования, и
цепочка умирает там — что также САМО ИЗЛЕЧИВАЕТ сценарий старого job, который
всё ещё срабатывает один раз, без необходимости ручного вмешательства.

`AnamneseCommandController.run/2` (маршрут по запросу, "reanalisar agora" в
Настройках) отвечает **503** с телом `{"error": "anamnese_desativada"}`, когда
функция отключена, — намеренно отличным от пустого 409, который уже
существовал для «проекта без сессии» (эти два было легко спутать в голом 409,
а причины совсем разные). `RunAnamneseUseCase` на стороне api превращает 503
engine в `ServiceUnavailableException` с `reason: "anamnese_disabled"` в
теле — никогда не общий 500 и не переиспользованный 409. Web
(`ProjectSettingsTab.tsx`) узнаёт состояние при первом клике "Rodar agora"
(сегодня нет предварительного чтения глобального состояния) и с этого
момента отключает кнопку и держит объяснение ВИДИМЫМ на экране — а не просто
исчезающий toast (RN-088: никогда тихий или запутанный сбой).

- **Где:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **Тест:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` не планирует при отключении, планирует при включении,
  выключено по умолчанию; `perform/1`, отключённый посреди цепочки, не делает
  fan-out и не перепланирует),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 отличен от 409, с сессией и без),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Граничный случай:** флаг ГЛОБАЛЬНЫЙ (все проекты/workspaces), а не по
  проекту — в отличие от потолка параллелизма (RN-083) или наследуемой модели
  по области (RN-102), которые являются решениями по области видимости.
  Включение обратно — это `ANAMNESE_ENABLED=true` и перезапуск engine; кнопки в
  UI для этого нет (это операционное действие, а не предпочтение проекта).
- **Источник:** без ADR — обратимое решение продукта, а не структурное
  изменение архитектуры. См. docs/explanation/backlog.md.

### RN-117 — Psicólogo может быть приостановлен глобально; пауза принадлежит ПРОДУКТУ и никогда не удаляет данные {#rn-117}

`PSYCHOLOGIST_ENABLED` (переменная окружения engine, boolean, по умолчанию
`false`) решает, может ли произойти НОВЫЙ прогон Psicólogo — автоматический
(закрытие сессии, маршрутизируемое `Engine.Outbox.Drain`) или по запросу
(`PsychologistCommandController.reanalyze/2`). То же решение ПРОДУКТА
пользователя от 2026-08-10, уже применённое к Anamnese (RN-115, «сегодня он
не приносит особо ценных данных»), — не баг, см. docs/explanation/backlog.md.
При отключении НИКАКИЕ существующие данные не затрагиваются: уже выпущенные
анализы и гипотезы остаются нетронутыми и видимыми.

В отличие от Anamnese (чей автоматический триггер — периодический ТИК, о
перепланировании которого решает сам флаг), автоматический триггер
Psicólogo — закрытие сессии: `Engine.Outbox.Drain` маршрутизирует
`session.closed`/`session.closed_abnormally` в `PsychologistWorker` только
когда `PsychologistWorker.enabled?/0` равно true (`Drain.handlers_for/1`); при
отключении выполняется только `SessionLifecycleWorker`, и job Psicólogo даже
не рождается. `PsychologistWorker.perform/1` намеренно остаётся
безусловным — но это УЖЕ НЕ «тот же шаблон», что у `AnamneseSchedulerWorker`
(см. исправление от 2026-08-10 в RN-115 выше): там `perform/1` начал
проверять флаг, потому что он САМ перепланирует цепочку на каждом тике, и
старый job, срабатывавший безусловно, снова открывал Anamnese при
выключенном флаге. У Psicólogo нет никакой цепочки, которая перепланировала
бы себя сама, — каждый job рождается от ОДНОГО события (`session.closed`), и
решает `Drain` в момент, когда ПОЛУЧАЕТ событие, а не worker в момент, когда
ВЫПОЛНЯЕТСЯ; job Psicólogo, поставленный в очередь до выключения флага, — это
в лучшем случае последний ожидающий прогон, никогда не бесконечная цепочка.
Поэтому существовавший набор тестов `PsychologistWorker` (который вызывает
`perform/1` напрямую) менять не пришлось.

`PsychologistCommandController.reanalyze/2` (маршрут по запросу,
"Reanalisar" на вкладке Insights) отвечает **503** с телом
`{"error": "psicologo_desativado"}`, когда функция отключена, даже не создавая
job. `ReanalyzeSessionUseCase` на стороне api превращает 503 engine в
`ServiceUnavailableException` с `reason: "psychologist_disabled"` в теле —
никогда не общий 500. Это обнаруживает паузу, когда уже есть анализ для
повторной обработки; у экрана ВООБЩЕ без гипотез есть собственное
предварительное чтение, которого здесь не было, — см.
[RN-454](../business-rules.md#rn-454).

- **Где:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Тест:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` ставит
  Psicólogo в очередь только при включении),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 без создания job, 202 с job в очереди при включении),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Граничный случай:** флаг ГЛОБАЛЬНЫЙ (все проекты/workspaces), как и у
  Anamnese. Включение обратно — это `PSYCHOLOGIST_ENABLED=true` и перезапуск
  engine; кнопки в UI для этого нет.
- **Источник:** без ADR — обратимое решение продукта, а не структурное
  изменение архитектуры. См. docs/explanation/backlog.md.

### RN-108 — Сокет сессии требует непрозрачного одноразового ticket, а не переиспользованного JWT {#rn-108}

`EngineWeb.SessionSocket.connect/3` отклонял подключение целиком, требуя лишь,
чтобы `session_id` (UUID) существовал в Registry, — тот, кто узнавал UUID,
входил в канал `session:<id>` и получал все живые broadcasts сессии. Закрытие
этого было намеренным ограничением, задокументированным в самом модуле ещё с
Фазы 3.

`POST /projects/:projectId/sessions/:sessionId/socket-ticket` (`scope:
"heartbeat"|"terminal"`) выпускает непрозрачный ticket (32 байта CSPRNG,
`TokenFactory`), TTL **30 секунд**, одноразовый. `scope: "heartbeat"` требует
роли `viewer`; `scope: "terminal"` требует `developer` — той же минимальной
роли, что `MIN_ROLE_FOR_ACTION_TYPE.terminal` в `domain/actions/decide.ts`
(сегодня ни один путь по-настоящему не запрашивает `terminal`; значение
рождается правильным для ФАЗЫ 25, интерактивного терминала). Api хранит
только ХЭШ (**чистый** SHA-256, а не `hashDeToken`/HMAC — у engine нет pepper
api, а 256-битному токену из CSPRNG pepper против словаря не нужен, то же
рассуждение, которое уже записывает сам `hashDeToken`), никогда сам токен.

Потребление принадлежит ENGINE, который читает `session_socket_tickets`
напрямую (тот же шаблон, что `Engine.Outbox.Event` над `outbox_events` —
никогда changeset/insert, только узкая запись, которой требует
одноразовость) в ДВА этапа:
`SocketTicket.validar/1` (peek, ничего не помечая — вызывается `connect/3`,
который ещё не знает, какой `session_id` будет запрошен) и
`SocketTicket.consumir/2` (условный `UPDATE`, требующий совпадения
`session_id` топика с `session_id` строки — вызывается `SessionChannel.join/3`,
который также сверяет `project_id` ticket с проектом сессии, эшелонированная
защита от ticket одного проекта, открывающего канал другого). Без ticket или
с недействительным подключение отклоняется целиком (`{:error, %{reason:
"unauthorized"}}`), а не только join канала.

Web (`session-channel.ts`) получает НОВЫЙ ticket перед КАЖДЫМ
`socket.connect()` — в том числе при автоматическом переподключении, которое
существует. Встроенный reconnect `Phoenix.Socket` переиспользовал бы те же
`params` конструирования (старый ticket, уже истёкший или потреблённый),
поэтому он нейтрализован (`reconnectAfterMs`, который практически никогда не
срабатывает), а переподключение становится целиком ручным, с получением
свежего ticket при каждой попытке.

Эта нейтрализация действует для КАЖДОГО клиента сокета, а не только для web, —
включая сокет `/runner`, чей ticket (`POST .../runner-ticket`) того же
калибра. Она не сработала в ДВУХ из четырёх конструкторов `Socket`
репозитория, и цена была измерена при реальном исполнении:
`apps/runner/src/
channel.ts` создавал сокет без опции — пока docblock модуля УТВЕРЖДАЛ, что
reconnect «поэтому нейтрализован», — и автопереподключение повторяло тот же
уже потреблённый ticket каждые **~5,13s** (потолок внутреннего backoff
phoenix.js), давая **61 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`** за несколько часов. В сумме с СОБСТВЕННОЙ политикой
runner (`index.ts`, эта правильная) результатом стали **530 запросов за
минуту** при потолке 300 у `RATE_LIMIT_USER` — а поскольку лимит на
ПОЛЬЗОВАТЕЛЯ, 429 появлялся в БРАУЗЕРЕ владельца учётной записи. Два
следствия, и второе хуже 429: пока runner в этом цикле, он НЕ подключён, так
что `RunnerReadiness` (RN-507) отказывает, и проект выглядит «без локального
агента». `apps/web/src/lib/fs-browser-channel.ts` имел ТУ ЖЕ строку дефекта
(тот же одноразовый ticket и без собственной политики переподключения — его
`onClose` говорит «закройте и откройте снова») и был исправлен вместе.

Третий экземпляр предотвращает МЕХАНИЗМ, а не комментарий: в runner опции
`Socket` стали типом с ОБЯЗАТЕЛЬНЫМ `reconnectAfterMs` (`OpcoesDoSocket` в
`channel.ts`), а обе стороны получили тест, проверяющий ОПЦИЮ, ПЕРЕДАННУЮ в
конструктор, — тест, проверяющий только «подключается», проходил при
действующем дефекте, и проходил. Вместе с этим `conectarERodar` (`index.ts`)
начал явно ОТБРАСЫВАТЬ упавшее подключение (`conexao.desconectar()`): без
этого `Socket` предыдущего раунда переживал создание следующего, и каждое
падение оставляло ещё один живой объект, пытающийся с мёртвым ticket.

- **Где:** `apps/api/src/db/schema/sessions.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (маршрут
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts` (`OpcoesDoSocket`,
  `NUNCA_RECONECTAR_SOZINHO_MS`), `apps/runner/src/index.ts`
  (`conectarERodar`, отбрасывание упавшего подключения)
- **Тест:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (повторное
  использование падает, неверный session_id падает, в конкурентной гонке
  побеждает только один),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (без ticket
  подключение отклоняется),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket
  другого проекта: join падает), `apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts` ("neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"; проверяет ОПЦИЮ,
  переданную в конструктор, и проваливается без неё),
  `apps/web/src/lib/fs-browser-channel.test.ts` (то же, в транспорте через
  runner браузера папок)
- **Граничный случай:** ticket — НЕ переиспользованный JWT: короткий TTL,
  одноразовость, замкнутая область видимости, и рождается он из собственного
  маршрута, который уже проверяет эффективную роль, а не из декодирования
  существующего access token.
- **Источник:** без ADR — точечное выделение/усиление, а не структурное
  изменение.

### RN-109 — Имя папки workspace замораживается при создании, а старый проект сохраняет UUID {#rn-109}

Физическая папка проекта в `PROJECT_WORKSPACES_ROOT` была голым UUID —
нечитаемым при открытии на диске. `projects.workspace_dir_name` (NOT NULL,
UNIQUE) стал хранить настоящее имя: `<slug>-<8 символов id>` для НОВОГО
проекта (`workspaceDirNameFor` в
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`),
генерируемое в коде — id рождается из `crypto.randomUUID()` в
`CreateProjectUseCase`, а не из `defaultRandom()` Postgres, потому что имени
папки нужен id ДО insert. 8 символов следуют тому же соглашению, что и метка
сессии (`apps/web/src/lib/session-label.ts`).

Имя ЗАМОРАЖИВАЕТСЯ в момент создания и никогда не пересчитывается:
`UpdateProjectUseCase` позволяет потом редактировать `slug`, и это НЕ
затрагивает `workspace_dir_name` — резервирование физической папки, с
возможно открытыми working tree и worktrees агентов, — реальный риск, которого
решение избегает по построению, а не дисциплиной вызывающего.

Проект, созданный ДО этой миграции (0042), сохранил уже имевшуюся физическую
папку: backfill записывает `workspace_dir_name = id` для каждой существующей
строки — то же значение, которое уже было истиной на диске, — и НИКОГДА не
переименовывает ни одного каталога. Триггер `BEFORE INSERT`
(`projects_workspace_dir_name_default_trg`) применяет ТОТ ЖЕ fallback
(`id::text`) для любого insert, пришедшего без поля, — страховочная сеть для
того, кто забудет его записать (никогда не основной путь, который всегда
записывает явно), и то, что поддерживает работу десятков существующих
тестовых fixtures, не знающих этой концепции, без необходимости переписывать
каждую.

Вывод пути из имени (`projectScopeRoot`, RN-092/RN-075) стал получать
`workspace_dir_name` вместо сырого `projectId` — та же проверка набора
символов, та же чистота. Engine читает ТУ ЖЕ колонку
(`Engine.Projects.Project.workspace_dir_name/1`), чтобы разрешить
`Engine.Actions.Workspace.workspace_dir/1`, никогда не пересчитывая имя из id:
два вывода (api и engine) на практике — одно и то же чтение из одной и той же
базы, — именно это гарантирует, что RN-075 (область видимости терминала) и
RN-092 (чтение кода) продолжают указывать на ТУ ЖЕ папку, которую реально
использует engine.

- **Где:** `apps/api/src/db/schema/iam.ts` (`projects.workspaceDirName`),
  `apps/api/src/db/migrations/0042_tough_captain_midlands.sql`,
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Тест:**
  `apps/api/test/db/workspace-dir-name-migration.spec.ts` (триггер,
  эквивалентный backfill, уникальность),
  `apps/api/test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` рождается `<slug>-<8 символов>`, два проекта с одним
  slug в разных workspaces не конфликтуют по папке),
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Граничный случай:** потолок параллелизма и gate merge не меняются — RN-109
  касается только ИМЕНИ папки, никогда политики. Переименование slug после
  создания не переименовывает папку; папка читается только по записанному
  `workspace_dir_name`.
- **Источник:** ADR 0066 (пересматривает ADR 0055).

### RN-129 — ToolLoop никогда не записывает пустой `agent.response`; сбой транспорта становится долговечным `agent.error` {#rn-129}

[RN-059](../business-rules/custo.md#rn-059) закрыла пустой пузырь для четырёх
разговорных агентов, но они не проходят через `Engine.Harness.ToolLoop` —
каждый вызывает `EngineApiClient.llm_turn_stream/6` в собственном модуле.
`ToolLoop` (используемый dev agents, QA Automação/Performance-Segurança,
Infra-Workflows, Anamnese и Psicólogo) имел ТОТ ЖЕ дефект на другом пути: он
выпускал `agent.response` на каждой итерации, даже когда модель только
вызвала инструмент без текста или завершила ход, ничего не произведя, — а
сбой транспорта (провайдер недоступен, timeout) становился `agent.response` с
отсутствующим `content`, столь же неотличимым от успеха.

Обнаружено вживую в сессии реального исполнения (dev agents): два пузыря с
текстом совместимости RN-059 ("resposta vazia — evento anterior...") появились
в сессии, созданной несколькими минутами ранее, — это были не старые события,
а тот же дефект, повторившийся снова, только на вкладке исполнения.

Два исправления, в СТРУКТУРНОЙ точке, общей для каждого потребителя
`ToolLoop`, а не по модулям:

1. **Пустое содержимое никогда не становится `agent.response`.** Итерация,
   которая только вызвала инструмент, уже описана `tool.call`/`tool.result`;
   итерация, которая ничего не произвела (ни текста, ни вызова инструмента),
   оставляет исход на решение того, кто вызвал цикл, — `ctx.last_error`/`{:ok,
   ctx}` несут информацию, а потребитель (например,
   `DevAgentServer.handle_outcome/4`) уже записывает долговечное событие
   СОБСТВЕННОГО домена (`dev.blocked`, с `origem`).
2. **Сбой транспорта становится долговечным `agent.error`**, с `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — ТОТ ЖЕ helper, который используют
   четыре разговорных агента, без дублирования классификации) и `mensagem` на
   португальском — больше никогда `agent.response` без `content`.

- **Где:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Тест:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Источник:** RN-059 (правило, которое это расширяет) — обнаружено вживую в
  сессии реального исполнения с dev agents

### RN-139 — Вкладка Executores читает ДЕЙСТВУЮЩУЮ сессию исполнения, никогда не самую свежую сессию проекта {#rn-139}

`ProjectExecutorsTab` искал события dev agent/QA по сессии, которую возвращал
`useLatestSession`, — сессии проекта с самым свежим `createdAt`, без фильтра по
`kind` и без требования `execution.activated`. Это работало лишь по
**совпадению**: сессия исполнения обычно самая новая. Как только после неё
рождается любая сессия — новая идеация, консультативный чат, — вкладка
начинает смотреть на эту новую сессию, пустую по событиям исполнения, молча:
ничто на экране не подсказывало, какая сессия показывается.

Правильное чтение уже существовало в backend: `findActiveExecutionSession`
(`SessionRepository`) — самая свежая сессия `active`, несущая
`execution.activated`, — но использовалось оно только внутри
`ActivateExecutionUseCase`, чтобы решить, активировать повторно или создать.
Исправление открывает ТОТ ЖЕ критерий по HTTP вместо дублирования во front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) возвращает
  действующую сессию или `null` — никогда не выводит по самой свежей;
- `ProjectExecutorsTab` заменяет `useLatestSession` на
  `useActiveExecutionSession` (новый hook над маршрутом выше) как источник
  сессии, которую читает вся вкладка;
- заголовок вкладки всегда показывает, КАКАЯ сессия отображается, — её метку
  (хэштег + имя) со ссылкой на `SessionPage` или "Nenhuma execução ativa",
  когда `null`, — больше никогда не неявно. Три состояния
  [RN-088](../business-rules.md#rn-088) применяются к самому поиску сессии:
  загрузка, ошибка (с `trace_id`) и пусто (`null`) — три разных рендера,
  никогда `if (!sessão) return null`, который их сливает.

- **Где:**
  `apps/api/src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `apps/api/src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Тест:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — показывает сессию
  исполнения даже при наличии более свежей сессии в проекте, явное состояние
  "nenhuma execução ativa" и обработанную сетевую ошибку (не пустой экран)
- **Источник:** находка исследования кода + живой тест — тот же класс
  дефекта, который RN-088 закрыла для 429, теперь для «на какую сессию
  смотрит экран»

### RN-141 — Содержимое, прочитанное `read_file`, тоже имеет потолок в байтах {#rn-141}

[RN-074](../business-rules/custo.md#rn-074) закрыла вывод **терминала** от
`{413, "request entity too large"}`, но оставила открытой ту же дверь через
`read_file`: он читал файл ЦЕЛИКОМ, без потолка, и это содержимое входило в
историю цикла и путешествовало в каждом последующем ходе. PR с большим файлом
(lockfile, bundle, сгенерированный файл) было достаточно, чтобы заклинить
dev agents И QA Performance/Segurança — у которого есть только
`ReadFile`/`SearchWorkspace` (без `Terminal`, намеренно) для исследования PR,
так что у него не было никакого пути отступления, когда файл был слишком
большим.

Содержимое обрезается до `READ_FILE_MAX_BYTES` (по умолчанию 32 KiB, то же
значение, что в RN-074, по совпадению контекста, а не из-за связанности — две
переменные независимы), прежде чем стать результатом инструмента, с меткой,
называющей файл и оба размера:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

Те же три свойства, что у RN-074 (потолок — `>`, а не `>=`; обрезка не
разрывает многобайтовый символ; метка адресована модели и говорит, что
делать). Усечение живёт в ИНСТРУМЕНТЕ (`Engine.Harness.Tools.ReadFile`), а не
в `Engine.Harness.WorkspaceFiles.read_file/2` — это общая основа доступа к
файлам, разделяемая `write_file`/`search_workspace`, и усечение там обрезало
бы содержимое у тех, кому этот потолок не нужен.

`search_workspace` не получил такой же обработки: он возвращает только
совпавшие ПУТИ (`matched_content` — булево значение), никогда содержимое
файла — вектор переполнения, мотивировавший эту RN, к нему не применим.

- **Где:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), потолок в `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Тест:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Источник:** обнаружено вживую в event log реального исполнения — 4 dev
  agents проекта и QA Automação/Performance-Segurança заблокированы с
  `{413, "request entity too large"}`, та же первопричина, что у RN-074,
  другая дверь

### RN-144 — Вкладка Criativo не перечисляет действующую сессию исполнения {#rn-144}

Сессия, получающая `execution.activated` и события tool-call dev agents,
должна рождаться с `kind: 'criativa'` — структурное правило (RN-097,
`garantirQuePodeAtivarExecucao`), без этого событие отклоняется. Поскольку
`ProjectSessionsTab` (вкладка Criativo, RN-104) перечисляет сессии, фильтруя
только по `session.kind === 'criativa'`, сессия исполнения появлялась
ВПЕРЕМЕШКУ в списке рядом с настоящими идеациями — её открытие в
`SessionPage.tsx` показывает целую ленту tool-calls dev agent, выглядящую
(для пользователя) как «dev пишет в чат Criativo». Подтверждено вживую:
реальная сессия с 35+ событиями dev agent нормально появлялась в списке
рядом с настоящими сессиями идеации.

Исправление переиспользует сигнал, который уже раскрывает [RN-139](#rn-139), —
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session`, —
вместо того чтобы backend вычислял новое поле по сессии
(`hasExecutionActivated` или аналог). Вкладка Criativo получает действующую
сессию и исключает её из отрисованного списка:

- запрос выполняется только на вкладке Criativo (`enabled` выключен при
  `kind !== 'criativa'`) — вкладка Chat никогда этого вызова не делала и
  по-прежнему не делает;
- фильтр — по `id`, после уже существующего фильтра по `kind`, — он не
  меняет того, что список ЕСТЬ, только то, что он ИСКЛЮЧАЕТ.

**Намеренное решение по рамкам:** это покрывает только ДЕЙСТВУЮЩЕЕ
исполнение, а не СТАРЫЕ, уже завершённые исполнения (`execution.activated`,
записанный в сессии, которая сейчас `closed`). Их вычисление потребовало бы
от backend аннотировать по сессии, записано ли в ней событие, — изменение в
репозитории и в endpoint листинга ради остаточного случая: СТАРАЯ сессия
исполнения появляется с бейджем `closed`, что уже сигнализирует «это не
активная идеация» гораздо менее двусмысленно, чем действующая (которая
появлялась `active`, неотличимой от идущей идеации). Если на практике это
снова начнёт путать, выход — чтобы endpoint листинга возвращал сигнал по
сессии, а не ещё один `filter` во front по старой сессии.

- **Где:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`ProjectSessionsTab`)
- **Тест:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — действующая
  исчезает из списка Criativo при обычных сессиях рядом, вкладка Chat не
  вызывает поиск действующего исполнения, а без действующего исполнения
  (`null`) список появляется целиком
- **Источник:** находка исследования кода + живой тест — реальная сессия с
  активным исполнением появлялась вперемешку на вкладке Criativo

### RN-145 — У Arquiteto тоже есть кнопка готовности, и ТО ЖЕ подтверждение предлагает Infra и Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) уже
существовал с Фазы 4a — записывает `architecture.readiness_confirmed` и
вызывает engine, который предлагает handoff Infra и, в ТОМ ЖЕ подтверждении,
Dev Lead (ФАЗА 14d/ADR 0053). Не хватало способа до него добраться: ни одно
место frontend не вызывало endpoint. Кнопка "Confirmar arquitetura pronta"
существует для Criativo с самого начала ("Estou pronto para produzir",
[RN-131](../business-rules.md#rn-131)/[RN-142](../business-rules.md#rn-142)) —
у Arquiteto не было никакого эквивалента, и без клика handoff никогда не
рождался: исправление приоритета карточки в ленте
([RN-125](../business-rules.md#rn-125)) оставалось без практического эффекта,
потому что показывать было нечего.

`arquitetoActive` зеркалит `criativoActive` (в этой сессии есть
`agent.activated` для Arquiteto), а `arquiteturaJaDeclarada` зеркалит
`prontidaoJaDeclarada` (есть ЛЮБОЙ handoff, исходящий от Arquiteto, —
доказательство того, что подтверждение уже произошло, поскольку
`OfferInfraHandoffUseCase` создаёт как минимум handoff Infra в том же вызове).
Кнопка появляется в composer только когда первое истинно, а второе нет, —
исчезает после клика по той же причине, по которой кнопка Criativo исчезает
после готовности.

В отличие от Criativo, у Arquiteto НЕТ серверного guardrail, блокирующего
подтверждение без `module_map`, — `ArquitetoServer.offer_infra_handoff`
ничего не отклоняет, в отличие от `CriativoServer.confirm_readiness`
([RN-142](../business-rules.md#rn-142)). Кнопка отключается только во время
`streaming`; не повторять здесь `disabled={!hasModuleMap}` из Visão Geral —
намеренное решение, по
тому же рассуждению, что уже действует для "Ativar execução" в карточке Dev
Lead ([RN-137](../business-rules.md#rn-137)) — когда эта карточка существует,
Arquiteto уже решил архитектуру.

- **Где:** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, ранее существовавший маршрут), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  кнопка "Confirmar arquitetura pronta")
- **Тест:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — кнопки нет без активного Arquiteto, счастливый путь вызывает
  выделенный endpoint, сбой показывает toast ошибки, а кнопка исчезает при уже
  объявленной архитектуре
- **Источник:** исследование кода — endpoint и логика engine существовали с
  Фазы 4a/14d без ЕДИНОГО пути UI к ним

### RN-146 — `agent.response` несёт имя модели, сгенерировавшей ответ {#rn-146}

Имя модели существовало только в `token_usage`, без связи с конкретным
событием `agent.response`, которое она произвела, — `SessionPage.tsx`
показывала ФИКСИРОВАННУЮ строку `"modelo"` рядом с именем агента, никогда не
настоящее имя.

Изменение проходит через три слоя, все с ОДНИМ И ТЕМ ЖЕ именем поля
(`modelName`), чтобы не нужно было переводить между ними:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` уже разрешали модель
   (`resolveModelBinding` → `models.findById`) для вызова провайдера; кадр
   `final`/`RunLlmTurnResult` получают `modelName: string |
   null`. `null` — только когда ход упал ДО разрешения модели (нет binding или
   binding на несуществующую модель); во всех остальных случаях, включая
   превышение бюджета, binding уже разрешился, и имя передаётся даже в кадре
   ошибки.
2. **engine** — четыре разговорных агента (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) извлекают
   `Map.get(frame, "modelName")` из кадра `final` и включают его в payload
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` читает `event.payload.modelName`. Событие,
   ЗАПИСАННОЕ до этого изменения, не имеет ключа (`undefined`), а ход, для
   которого api не разрешила никакой модели, записывает `null` — оба
   деградируют до общей метки `"modelo"`, никогда до `undefined`/`null` на
   экране; тот же шаблон, что `text === ''` уже использует для ответа,
   предшествующего RN-059.

- **Где:** `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `apps/api/src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (блок
  `agent.response` ленты)
- **Тест:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `apps/api/test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` на счастливом пути, при ошибке провайдера и без binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` несёт имя модели; граничный случай кадра без ключа),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — настоящее имя, старое событие без ключа, `modelName: null`
- **Источник:** исследование кода — подтверждено, что данные уже существовали
  в `token_usage`, но никогда не доходили до payload события

### RN-147 — Заголовок свёрнутой группы показывает иконку агента, а не только имя {#rn-147}

`Disclosure` из `timelineAgrupada` ([RN-138](../business-rules.md#rn-138))
получал в `titulo` только СТРОКУ имени — у каждого развёрнутого сообщения уже
есть аватар (`.avatar` + иконка), а свёрнутый заголовок терял эту визуальную
подсказку ровно там, где она больше всего помогает просматривать ленту.

`AvatarDoAgente` переиспользует ТОТ ЖЕ блок `.avatar` развёрнутых сообщений,
но выбранная иконка — из ROSTER (`AGENTS[id].icon`), того же источника, что
уже обозначает «кто говорит» в индикаторе streaming (`agenteExibido.icon`,
[RN-131](../business-rules.md#rn-131)), а не иконка по ТИПУ события, которую
использует каждая развёрнутая запись (`ModelIcon` в `agent.response`,
`StackIcon` в `backlog.*_created`, `AlertCircleIcon` в `agent.error`).
Свёрнутая группа может смешивать такие типы записей одного агента; заголовок
представляет АГЕНТА, а не его последнюю запись, и для этого стабильна только
иконка roster. Без `id` или для агента вне roster он деградирует до
`ModelIcon` — никогда до пустого блока.

- **Где:** `apps/web/src/routes/SessionPage.tsx` (`AvatarDoAgente`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroupTitulo`)
- **Тест:** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  describe "problema 3" — свёрнутый заголовок содержит PATH иконки PO
  (`UserIcon`), а не просто общий декоративный SVG
- **Источник:** исследование кода — `Disclosure` уже принимал `ReactNode` в
  `titulo`; не хватало передать аватар вместе с именем

### RN-148 — Истории с одновременно ожидающим продвижением становятся каруселью, а не N карточками {#rn-148}

PO создаёт истории по одной, и каждое `backlog.story_promotion_proposed`
([RN-126](../business-rules.md#rn-126)) становилось отдельной карточкой в
ленте — в партии из нескольких историй это складывало N одинаковых карточек,
борющихся за одно и то же место, вперемешку с остальным повествованием.

**Партия** — это множество предложений продвижения, ВСЁ ЕЩЁ ОЖИДАЮЩИХ в
сессии, оцениваемое при каждом рендере, — а не «созданные подряд без
перерыва». Критерий — ТОТ ЖЕ, что каждая отдельная карточка уже использовала
сама, чтобы решить, стала ли она действенной карточкой или разделителем
(никакого последующего `backlog.story_transitioned`/`backlog.story_promotion_returned`
с тем же `storyId`), только применённый сразу ко всей сессии:

- **0 или 1 ожидающее:** ничего не меняется — обычная отдельная карточка
  (деградация намеренна: карусель из одного слайда ничего не выигрывает,
  становясь каруселью).
- **2+ ожидающих одновременно:** становятся ОДНИМ `Carousel` (новым в design
  system, `apps/web/src/components/ui/Carousel.tsx`), вставленным на место
  ПЕРВОГО всё ещё ожидающего предложения; остальные исчезают как отдельные
  карточки — каждое становится его СЛАЙДОМ. Каждый слайд показывает ту же
  фразу, что и отдельная карточка ("história … pronta, aguardando sua
  promoção"), резюме/RF, если payload их несёт (сейчас не несёт — см. ниже), и
  кнопки Promover/Devolver для конкретной истории, вызывающие ТЕ ЖЕ
  `promoteStories`/`returnStory`, что и всегда.
- **"Aprovar todas"** в заголовке карусели вызывает `promoteStories` с id
  ВСЕХ ожидающих одним вызовом — endpoint уже был пакетным
  (`promoteStories(projectId, storyIds[])`, RN-048), так что изменения
  контракта не было никакого, только того, кто собирает список.
- История, решённая (продвинутая или возвращённая), пока карусель открыта,
  выходит из партии при следующем рендере (запрос событий инвалидируется в
  обоих действиях) — если остаётся только 1 ожидающая, карусель
  распадается сама, и карточка снова становится отдельной.

`resumo`/RF в слайде — ГОТОВОЕ, но неиспользуемое поле: `CreateStoryUseCase`
сейчас записывает в payload `backlog.story_promotion_proposed` только
`storyId`/`epicId`/`title` — без описания и функциональных требований. Слайд
уже умеет показывать `description`/`rf`, если payload однажды их понесёт
(до тех пор деградирует до одного заголовка); расширение payload осталось вне
этой поставки, поскольку его не просили.

- **Где:** `apps/web/src/components/ui/Carousel.tsx` (новый компонент, общая
  навигация), `apps/web/src/routes/SessionPage.tsx`
  (`promocoesPendentes`, `ehLevaDeHistorias`, `StorySlide`,
  `handlePromoteAll`), `apps/web/src/routes/SessionPage.module.css`
  (`.storySlide`)
- **Тест:** `apps/web/src/components/ui/Carousel.test.tsx` (навигация,
  ARIA, смонтирован только текущий слайд, индекс ограничивается при
  сокращении списка),
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx` (3+
  ожидающих становятся каруселью; "Aprovar todas" отправляет всю партию;
  одиночные продвижение и возврат продолжают работать со слайда, на который
  перешли; 1 ожидающая деградирует до простой карточки; решённая история
  выходит из партии, и карусель пересчитывает количество)
- **Источник:** просьба пользователя — истории, произведённые PO партией,
  было трудно решать по одной в ленте

### RN-149 — Уровень Container диаграммы C4 выводится из module_map, никогда не набирается моделью заново {#rn-149}

`create_c4_diagram` (новый инструмент Arquiteto) генерирует оба синтаксиса
Mermaid диаграммы C4 (Context + Container, модель Саймона Брауна). Вызов
инструмента несёт только `system_name`/`system_description`/`actors` —
модули и зависимости уровня Container НЕ входят во ввод: сценарий
использования ищет ДЕЙСТВУЮЩИЙ `module_map` проекта
(`ModuleMapRepository.findCurrent`, то же чтение, что у
`GetArchitectureUseCase`) и выводит из него уровень Container, с ТЕМИ ЖЕ
именами и зависимостями, которые `create_module_map` уже проверил на
отсутствие циклов.

Очевидная альтернатива — позволить модели снова описать модули в вызове
инструмента диаграммы, как она уже делает для `create_module_map`, — была
отброшена намеренно: второе место, где модель пишет «модули — это X, Y, Z», —
второе место, где этот список может разойтись с первым, и расхождение было
бы МОЛЧАЛИВЫМ — ничто не отклонило бы диаграмму с модулем, которого больше
нет в реальной карте. Вывод из репозитория закрывает это расхождение
по построению: диаграмма может УСТАРЕТЬ, если `module_map` потом изменится
(повторная эмиссия — это повторная генерация, без блокировки, — см.
ADR 0068), но она никогда не ЛЖЁТ о том, что существовало в момент
генерации.

Без действующего `module_map` `create_c4_diagram` отклоняется с 400 — нет
уровня Container без модулей для отрисовки, а сообщение об ошибке
инструктирует Arquiteto сначала вызвать `create_module_map` (RN-061: отказ
возвращается через tool-result, с полной причиной).

Артефакт `artifact.c4_diagram` версионируется в event log без собственной
таблицы — та же конструкция, что у `artifact.project_image` (ADR 0065):
действующий — с наибольшим `version`, а пересмотр — это повторная
генерация, никогда не перезапись.

- **Где:** `apps/api/src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, чистые),
  `apps/api/src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (отрисовка, три состояния —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (`mermaid` изолирован здесь,
  динамический `import()`)
- **Тест:** `apps/api/test/domain/architecture/c4-diagram.spec.ts` (валидный
  синтаксис Mermaid из примерного `module_map`, висячее ребро
  игнорируется, id дедуплицируются),
  `apps/api/test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (без module_map отклоняет с 400 и ничего не записывает; Container отражает
  реальные модули/зависимости; версионирует при повторной эмиссии),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (успех становится SVG,
  синтаксическая ошибка становится читаемым Alert без поломки экрана, пустая
  диаграмма не пытается отрисоваться)
- **Источник:** просьба пользователя — диаграмма C4 Arquiteto в Visão Geral
  проекта (ADR 0068)

### RN-150 — У `search_workspace` есть потолок КОЛИЧЕСТВА совпадений и БАЙТОВ, у каждого своя метка {#rn-150}

Обнаружено при ревью PR: `search_workspace` (dev agents и два агента
QA/gate, `qa_tools.ex` и `qa_performance_seguranca_agent.ex` — у последнего
есть только `read_file`/`search_workspace`, без `Terminal`, намеренно)
возвращал ВСЕ результаты поиска без какого-либо потолка — тот же класс, что
находка S (`Engine.Actions.TerminalExecutor.truncate/2`) и исправление
`read_file` (`Engine.Harness.Tools.ReadFile.truncate/2`): результат остаётся в
истории цикла и путешествует в каждом последующем ходе, и большого дерева
достаточно, чтобы вызвать `{413, "request entity too large"}` провайдера.

Два независимых потолка, потому что поиск переполняется двумя разными
способами:

1. **Количество совпадений** — дерево с тысячами файлов, совпадающих с
   термином, производит тысячи строк `- caminho`, даже если ни один файл в
   отдельности не велик. Обрезка только по БАЙТАМ в конце всё равно платила
   бы за сканирование и чтение содержимого каждого из этих файлов до сборки
   строки. Поэтому потолок количества (`SEARCH_WORKSPACE_MAX_HITS`, по
   умолчанию 500) живёт в `WorkspaceFiles.search/3`, который уже ПРЕКРАЩАЕТ
   потреблять поиск, как только нашёл достаточно совпадений, — конвейер
   работает над `Stream`, и `Enum.take(stream, max_hits + 1)` читает из
   источника только то, что нужно для первых `max_hits + 1` результатов.
   «+1» позволяет сказать, что БЫЛО больше, не продолжая сканировать
   остаток, чтобы посчитать точный итог, — подсчёт итога снова оплатил бы
   I/O, ради избегания которого существует потолок, поэтому метка говорит
   «показаны первые N» и никогда не выдумывает итог.
2. **Байты итогового текста** — даже при ограниченных совпадениях очень
   длинные пути могут дать большую строку. Потолок байтов
   (`SEARCH_WORKSPACE_MAX_BYTES`, по умолчанию 32.768), тот же шаблон, что
   `terminal_output_max_bytes`/`read_file_max_bytes`, — СОБСТВЕННАЯ
   переменная, не переиспользующая две другие: тот же класс переполнения, но
   расхождение одной не должно требовать трогать другие.

Метка усечения адресована МОДЕЛИ, а не человеку: она говорит, что было
обрезано (совпадения и/или байты), и инструктирует уточнить поисковый
термин — в том же духе, что метки `TerminalExecutor`/`ReadFile`.

- **Где:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Тест:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` с `max_hits` обрезает КОЛИЧЕСТВО и помечает усечение только
  когда их больше потолка),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (поиск с
  небольшим числом результатов не изменяется; поиск с числом совпадений больше
  потолка усекается с понятным предупреждением; итоговый текст больше потолка
  байтов тоже обрезается)
- **Источник:** находка ревью PR — вторая реальная причина 413 при ревью,
  после исправления `read_file`

---

### RN-151 — Бейдж проекта в боковой панели — это ожидающие одобрения, а не непрочитанная активность {#rn-151}

Число рядом с именем каждого проекта в `Shell.tsx` бралось из
`useProjectsUnread` — `latestSeq` (самый свежий уже записанный `seq` в
сессии) минус курсор «последнего просмотра», который браузер хранит в
`read-state.ts`. Это считает ЛЮБОЕ новое событие — `tool.call`,
`agent.response`, чат, — а не только ожидающее решение. Тестовый проект
показывал «392» в боковой панели (накопленная активность реального
исполнения), тогда как вкладка Aprovações ТОГО ЖЕ проекта показывала «8»
(настоящий счёт). Число, которое не соответствует ничему действенному при
клике, хуже, чем никакое.

Read model панели (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) получил `pendingApprovalsCount`: `COUNT(*)` по `proposed_actions` со
`status = 'pending'`, агрегированный по `project_id` одним дополнительным
запросом в уже существующем `Promise.all` — та же форма, что
`storiesAwaitingPromotion` (RN-048), без роста числа походов в базу на
проект. Сумма — по ВСЕМУ проекту, все сессии, — намеренно иначе, чем вкладка
Aprovações (`ProjectApprovalsTab.tsx`), показывающая только ожидающие САМОЙ
СВЕЖЕЙ сессии: бейдж — по ПРОЕКТУ, а не по сессии, и ожидающее действие в
старой сессии по-прежнему ожидает.

`Shell.tsx` перестал импортировать `useProjectsUnread` — единственным его
потребителем там был этот бейдж. `Dashboard.tsx`/`ProjectCard.tsx` получили
ту же нить: у prop `unreadCount` в `ProjectCard` никогда не было вызывающего
(`ProjectCardContainer` его не передавал), и он стал `pendingApprovalsCount` с
тем же значением, что в боковой панели, — два экрана, одно число, один
источник.

- **Где:** `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, агрегированный запрос над `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Тест:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, считается только
  `pending`, не протекает между проектами, число запросов остаётся
  постоянным),
  `apps/web/src/routes/Shell.test.tsx` (бейдж ожидающих одобрений)
- **Источник:** находка пользователя при навигации по приложению — бейдж
  боковой панели показывал «392» против настоящих «8» на вкладке Aprovações
  того же проекта

---

### RN-152 — Ветка задачи говорит, какому dev agent и модулю она принадлежит, в выпадающем списке вкладки Code {#rn-152}

`CodeBranchPicker` уже перечислял каждую ветку репозитория, включая ветки dev
agents (`feature/task-XXXXXXXX`, `Engine.Dev.AgentIo`), но без какой-либо
подсказки, кто её создал, — только сырое имя. `ReadProjectCodeUseCase.branches`
решает это без лишнего вызова git-провайдера: 8 символов после
`feature/task-` — это ровно первая группа через дефис uuid задачи
(`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`, а не
произвольная подстрока), поэтому они сопоставляются с `TaskRepository
.findByProjectAndIdPrefix` (join по ПРОЕКТУ, чтобы 8-символьный префикс
никогда не протёк задачей другого проекта). `assignedTo` задачи — это
agent_id (`dev-<modulo>`/`dev-<modulo>-2`, RN-087); модуль разрешается
сравнением с ДЕЙСТВУЮЩИМ `module_map` проекта ТЕМИ ЖЕ функциями, которые его
сгенерировали (`devAgentId`/`extraDevAgentId` в `activate-execution.use-case.ts`), —
никогда обратным regex, который выродился бы в неоднозначность для имени
модуля со специальным символом.

`producedBy: { agentId, moduleId } | null` — честная деградация, так же как
`ahead`/`behind`: `null` для ветки без шаблона (ручной ветки пользователя или
`main`/`dev`/`qa`), а также когда шаблон совпадает, но задача/модуль больше
не разрешимы (задача удалена, модуль убран из действующей карты), — никогда
не выдуманное значение. В выпадающем списке каждая ветка, произведённая dev,
получает иконку и цвет агента (`AGENTS`/`agents.ts`, RN-087),
переиспользуя ТУ ЖЕ деградацию, которую `apps/web/src/lib/agent-status.ts`
уже применяет для живого roster: модуль без фиксированного ключа в `AGENTS`
наследует иконку/цвет `dev-backend`.

- **Где:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`branches`/`producedBy`/`moduloDoAgente`),
  `apps/api/src/application/ports/backlog-repository.port.ts`
  (`TaskRepository.findByProjectAndIdPrefix`),
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  (`CodeBranchProducedByResponseDto`), `apps/web/src/lib/api-types.ts`
  (`CodeBranchProducedBy`), `apps/web/src/routes/code/CodeBranchPicker.tsx`
  (`IconeDoAgenteProdutor`/`defDoAgenteProdutor`)
- **Тест:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (describe "producedBy da branch de task" — задача разрешена с модулем и с
  дополнительным агентом `-2`, ветка вне шаблона никогда не получает
  `producedBy` даже при задаче с совпадающим префиксом, префикс без задачи в
  проекте, модуль, убранный из действующей карты, и задача ещё без владельца
  деградируют до `null`),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx` (ветка задачи
  показывает значок dev agent-владельца; ветка без шаблона никакого значка не
  получает)
- **Источник:** просьба пользователя — никакой визуальной подсказки, кто
  создал ветку, в богатом выпадающем списке ФАЗЫ 26b

### RN-153 — «Auto mode»: `ApprovalCard` включает автономию для ЛЮБОГО будущего действия агента {#rn-153}

> **Пересмотрено [RN-603](#rn-603)** (ADR 0167): `decide()` начал получать
> также ИСТОЧНИК автономии, и автоматический режим (подстановочный знак в
> `auto_approve`) больше не проходит через потолок области видимости пути.
> То, что ниже говорится о том, что `decide()` «не меняется», описывает
> исходную конструкцию.

До этой RN `agent_autonomy` умел предоставлять автономию только по
`(проект, агент, ТИП действия)` — одна строка на тип, upsert ОДНОГО правила
за раз (`SetAgentAutonomyUseCase`,
`apps/api/src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Широкое доверие агенту требовало строки на каждый тип — `terminal`,
`write_file`, `pr_open`… — а новый тип рождался без правила, возвращаясь к
`require_approval`.

«Auto mode» — это специальное значение `actionType: "*"` в ТОЙ ЖЕ таблице и
ТОМ ЖЕ endpoint (`PUT /projects/:projectId/agent-autonomy`) — не новый
механизм, а существующая колонка (`agent_autonomy.action_type`, свободный
`text`, без enum и FK — `apps/api/src/db/schema/agents.ts`), принимающая ещё
одно значение. Подстановочный знак означает «автономия для любого типа
действия ЭТОГО агента» и разрешается в `DrizzleAgentAutonomyRepository.findMode`
(`apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
он ищет КОНКРЕТНОЕ правило и подстановочный знак в одном запросе, и
конкретное всегда побеждает — запись `terminal: deny` при уже включённом
`"*": auto_approve` продолжает запрещать `terminal` этому агенту и разрешать
остальное. `decide()` (`apps/api/src/domain/actions/decide.ts`) не меняется:
он получает уже разрешённый `PermissionPolicy` в `ctx.autonomyMode`, ровно как
до появления подстановочного знака, — именно поэтому абсолютные потолки
действуют, не нуждаясь в знании о существовании «auto mode» (см.
[RN-154](#rn-154)).

`ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) получает кнопку
"Modo automático" рядом с "Sempre permitir", видимую только когда: (a)
действие в состоянии `pending`, (b) предложил его АГЕНТ (`actor.kind ===
'agent'` — нет автономии агента, которую можно предоставить пользователю) и
(c) вызывающий (`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) уже подтвердил
роль `maintainer`/`owner` в workspace — то же требование, что у endpoint
(`@RequireRole('maintainer')`, неизменный). Prop `onActivateAutoMode` равен
`undefined` для того, у кого нет роли, — карточка СКРЫВАЕТ кнопку, а не
показывает её отключённой, и проверка живёт у вызывающего, а не в карточке
(презентационный компонент, без собственного запроса).

**Выключение** переиспользует переключатель manual/auto, который уже был у
карточки агента (Фаза 8d), — никакого нового экрана. `AgentTeamGrid.tsx`
начинает искать правило-подстановку агента ДО представительного
(`autonomyActionTypeFor`): если оно существует, переключатель карточки
отражает и редактирует ПОДСТАНОВКУ, а не представительный тип, — выключение
означает запись той же подстановки как `require_approval`, и переключатель в
карточке агента и есть это «выключение».

- **Где:** `apps/api/src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` с приоритетом конкретное > подстановка),
  `apps/api/src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (принимает `"*"`), `apps/web/src/components/ApprovalCard.tsx` (кнопка "Modo
  automático"), `apps/web/src/components/AgentTeamGrid.tsx` (переключатель
  начинает отдавать приоритет подстановке), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  и `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, gate
  роли через `useCurrentWorkspaceWithRole`)
- **Тест:**
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (приоритет конкретное > подстановка; подстановка — по агенту; выключение —
  перезапись подстановки как `require_approval`),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode автоодобряет обычное действие БЕЗ обращения к `permissions.json`;
  конкретное правило в `deny` побеждает подстановку),
  `apps/api/test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` по-прежнему требуют `maintainer`; DTO принимает `"*"` и
  отклоняет строку вне списка), `apps/web/src/components/ApprovalCard.test.tsx`
  (кнопка исчезает без `onActivateAutoMode`; клик вызывает callback; заметка
  объясняет потолки, которые по-прежнему требуют решения)
- **Источник:** просьба пользователя — "Sempre permitir" записывает лишь
  конкретный шаблон команды, а `agent_autonomy` покрывал только один тип
  действия за раз; не хватало способа широко довериться агенту одним кликом

### RN-154 — Три абсолютных потолка продолжают блокировать ДАЖЕ при включённом «auto mode» {#rn-154}

> **Пересмотрено [RN-603](#rn-603)** (ADR 0167): перечисленные здесь потолки
> продолжают действовать в автоматическом режиме; для него перестал
> действовать потолок ОБЛАСТИ ВИДИМОСТИ ПУТИ (ADR 0055), которого никогда не
> было в этом списке.

Конструкция «auto mode» ([RN-153](#rn-153)) намеренно неспособна пробить три
потолка, уже существовавших в `decide()`, — они применяются ПОСЛЕДНИМИ, над
`current.policy`, не глядя, откуда пришла разрешительность (`agent_autonomy`
с конкретным типом, подстановка или `permissions.json` — функция никогда не
умела различать источники и по-прежнему не умеет):

1. **Merge в защищённую ветку** (`git_merge` с назначением
   `dev`/`qa`/`rc`/`main`, [RN-006](../business-rules.md#rn-006)) — блокировка
   merge (`isProtectedBranch`) всегда понижает `auto_approve` до
   `require_approval`, даже при включённом для агента `"*": auto_approve`.
2. **`instruction_patch`** ([RN-007](../business-rules.md#rn-007)) — изменение
   инструкции другого агента требует, чтобы человек увидел diff; auto mode
   этого не меняет.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](../business-rules/custo.md#rn-086)) —
   поднять потолок параллелизма или попросить агентов сверх него
   по-прежнему решает пользователь; агент с включённым auto mode не может сам
   себе предоставить больше полномочий тратить.

Доказательство — ПО ПОСТРОЕНИЮ, а не от случая к случаю: поскольку три
потолка проверяют только `current.policy === 'auto_approve'` — никогда
источник, — а «auto mode» может прийти к `current.policy === 'auto_approve'`
только ТЕМ ЖЕ путём, которым уже пользовалось конкретное правило
`agent_autonomy` (`ctx.autonomyMode`), потолки, уже сдерживавшие
`agent_autonomy`, продолжают сдерживать подстановку без нового кода.
Реальным риском был не потолок — а то, что кто-то, обобщая `agent_autonomy`
для приёма `"*"`, вставит проверку подстановки ДО потолков и снова откроет
дверь; поэтому `AGENT_AUTONOMY_ALL_ACTIONS` был разрешён целиком в
РЕПОЗИТОРИИ (до запуска `decide()`), а сама `decide()` не получила ни одной
новой строки — ровно столько, чтобы подстановке негде было пробить.

- **Где:** `apps/api/src/domain/actions/decide.ts` (три блока потолков,
  строки ~207–258, не изменённые этой функцией)
- **Тест:**
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — все три с `agent_autonomy` "*",
  записанным как `auto_approve`, и вердиктом, остающимся `require_approval`)
- **Источник:** ограничение дизайна, подтверждённое пользователем при запросе
  «auto mode», — три потолка являются гарантией, которая не может
  регрессировать

### RN-603 — Автоматический режим освобождает область видимости пути, и только её {#rn-603}

Решение владельца продукта от 2026-09-26 (AT-226,
[ADR 0167](../adr/0167-modo-automatico-libera-o-escopo-de-caminho.md)): при
включённом у агента "Modo automático" — подстановке `"*"` из
[RN-153](#rn-153), разрешённой как `auto_approve`, — агент выполняет ЛЮБУЮ
команду терминала без запроса одобрения, В ТОМ ЧИСЛЕ вне папки проекта.
Потолок области видимости пути из ADR 0055 перестаёт действовать для этого
агента. Измерено в `exp001` (режим `mounted`, контейнер запущен): 51 команда
запросила одобрение при включённом режиме, 47 — только из-за упоминания
`/work` или `/tmp`: dev agent работает в контейнере, а область видимости
сравнивается с корнем ХОСТА.

`decide()` начинает получать ИСТОЧНИК автономии (`ctx.autonomyOrigin`:
`'especifica'` или `'curinga'`), разрешаемый ТЕМ ЖЕ репозиторием, который уже
разрешал приоритет, — `findMode` стал прочтением `resolve`, а не вторым
правилом. Автоматический режим — только подстановка в `auto_approve`
(`modoAutomaticoDoAgente`); отсутствующий источник считается конкретным. В
автоматическом режиме исчезают два запроса: потолок ОБЛАСТИ ВИДИМОСТИ и
`require_approval`, который синтезирует СОСТАВНАЯ команда, когда у сегмента
нет никакого правила в `permissions.json` (файл без мнения, который никогда
не понижает предыдущий этап), — без второго `cd /work && npm test` продолжал
бы спрашивать.

Всё остальное остаётся как было, и в автоматическом режиме тоже: `deny` (из
файла, встроенных шаблонов или конкретной автономии) побеждает; ЗАПИСАННЫЙ в
файле `ask` спрашивает; потолок внешнего эффекта/привилегированной команды
(push, PR, deploy, `sudo`/`doas`, [RN-418](../business-rules.md#rn-418))
выполняется раньше и не смотрит на источник; merge в защищённую ветку,
`instruction_patch`, `parallelize`/`raise_max_parallel` и `container_remove`
никогда не автоодобряются ([RN-154](#rn-154)). Конкретное правило типа
побеждает подстановку в репозитории и приходит как `'especifica'`:
`terminal: require_approval` при включённой подстановке продолжает
спрашивать. Выключение (переключатель карточки агента записывает
подстановку как `require_approval`) восстанавливает потолок. Начиная с
[RN-670](../business-rules.md#rn-670) (ADR 0189) конкретное `auto_approve`
под подстановкой `auto_approve` — то, что записывает "Sempre permitir" dev
agent, — разрешается как ПОДСТАНОВКА и больше не выключает автоматический
режим; а вне его область видимости сравнивается с РЕАЛЬНОЙ папкой исполнения
([RN-669](../business-rules.md#rn-669)).

Экран до клика говорит, что режим освобождает и что продолжает спрашивать:
заметка `ApprovalCard` появляется в ОБОИХ вариантах (чат и очередь
Aprovações), а карточка агента показывает фразу под переключателем — только
когда включена ПОДСТАНОВКА, потому что переключатель над представительным
типом записывает конкретное правило, которое область видимости не
освобождает.

- **Где:** `apps/api/src/domain/actions/decide.ts:295` (`modoAutomaticoDoAgente`),
  `apps/api/src/domain/actions/decide.ts:370` (игнорируемый синтезированный
  вердикт составной команды), `apps/api/src/domain/actions/decide.ts:455`
  (пропущенный потолок области видимости),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  (`resolve`, с источником),
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:216`
  (`autonomyOrigin`), `apps/web/src/components/AgentTeamGrid.tsx:108`
  (`autonomyHint`), `apps/web/src/components/ApprovalCard.tsx:313` (заметка
  в обоих вариантах)
- **Тест:** `apps/api/test/domain/actions/decide.spec.ts` ("modo automático
  libera o escopo de caminho (RN-603)": вне области видимости и составная
  команда автоодобряются; push/`sudo`/`deny`/записанный `ask` остаются;
  конкретное правило и выключенная подстановка не освобождают; остальные
  потолки не меняются),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (сквозной, с реальным репозиторием),
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (`resolve` возвращает источник), `apps/web/src/components/AgentTeamGrid.test.tsx`,
  `apps/web/src/components/AgentCard.test.tsx`,
  `apps/web/src/components/ApprovalCard.test.tsx`
- **Источник:** решение владельца продукта (AT-226) после теста в `exp001`

### RN-155 — упорядочение ленты использует связь `proposed_action.created`, никогда сырой `action.seq` {#rn-155}

`timeline` в `SessionPage.tsx` упорядочивает события и предложенные действия
по единой сравнимой числовой оси. Для событий это `event.seq` (без пропусков,
по сессии). Для действий — `seq` соответствующего события
`proposed_action.created` (находимого по `payload.actionId === action.id`,
записанного `ProposeActionUseCase` в ТОЙ ЖЕ транзакции, что создаёт
действие), — никогда `action.seq`, который является уникальным глобальным
`bigserial` всей таблицы `proposed_actions`, общим для всех сессий и проектов
системы и потому несравнимым с `event.seq` (намеренный контраст, см.
`apps/api/src/db/schema/actions.ts`). Прямое сравнение двух давало
непредсказуемый порядок каждый раз, когда `ApprovalCard` смешивался с
обычными событиями. Действия без этой связи (только bootstrap Gitflow —
`git_repo_create`/`git_branch_create`, которые пишут только outbox)
деградируют до позиции, интерполированной по `createdAt` и привязанной к
последнему предшествующему событию.

- **Где:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Тест:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Источник:** находка PR #286 — карточки одобрения появлялись не по
  порядку в ленте, вперемешку с обычными событиями

### RN-156 — у индикатора ожидания 5s фиксированный текст, без подстановки агента {#rn-156}

Индикатор, появляющийся после 5s без ответа (`pensandoVisivel`), показывает
фиксированную фразу "Reunindo informações...", без подставленного имени
агента, — она заменяет прежний текст "{Agente} está escrevendo…". Имя агента
уже видно в заголовке, как только начинается streaming настоящего текста;
повторять его в индикаторе ожидания не помогало чтению.

- **Где:** `apps/web/src/routes/SessionPage.tsx`
- **Тест:** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Источник:** находка PR #286 — прежний текст называл агента, который уже
  был виден в заголовке

### RN-157 — создание эпика/истории PO становится компактным уведомлением, а не полным пузырём {#rn-157}

События `backlog.epic_created`/`backlog.story_created` перестают
отрисовываться как полный пузырь сообщения (`.message`/`.bubble`, аватар
32px — тот же визуальный вес, что у настоящего ответа агента) и начинают
использовать тот же формат компактного уведомления, что
`.handoffDivider`/`.handoffPill` уже используют для передачи эстафеты:
центрированная строка с горизонтальной линией и компактной плашкой, с
сохранением ссылки "Ver no Backlog". `agentId` по-прежнему заполнен в
`TimelineEntry` — в отличие от разделителя handoff, это не отмечает переход
между агентами, это действие PO внутри его собственного хода, и оно остаётся
подлежащим свёртке по агенту ([RN-138](../business-rules.md#rn-138)).

- **Где:** `apps/web/src/routes/SessionPage.tsx`
- **Тест:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Источник:** находка PR #286 — полный пузырь имел тот же визуальный вес,
  что настоящий ответ агента, для действия PO с метаданными

### RN-158 — Лёгкий Markdown с подсветкой в чате {#rn-158}

`agent.response` в ленте Сессии отрисовывает подмножество Markdown
(полужирный `**texto**`, курсив `*texto*`/`_texto_`, встроенный код
`` `texto` ``, заголовок `#`/`##`/`###`, список `-`/`1.`, ссылка
`[texto](url)` и блок кода ```` ```linguagem ````) через собственный
парсер на regex (`apps/web/src/lib/markdown.ts`), без новой зависимости.
`chat.message` (текст, набранный пользователем) остаётся буквальным —
Markdown применяется только к ВЫВОДУ агента/LLM, никогда к человеческому
вводу.

Безопасность: парсер никогда не производит HTML — он возвращает дерево
данных, которое `MarkdownMessage.tsx` превращает напрямую в React-элементы
(никогда `dangerouslySetInnerHTML`). Ссылка становится кликабельным
`<a href>` только когда схема URL — `http`, `https` или относительная
(`/...`, `#...`); любая другая схема (`javascript:`, `data:` и т.д.)
деградирует до текста ссылки, никогда до исполнимого `href`.

Код внутри блока получает подсветку по токенам, переиспользуя
`highlightLine`/`highlightFile` из `apps/web/src/routes/code/highlight.ts` —
ту же функцию, что уже раскрашивает вкладку Code. `sh`/`bash` получили
собственный словарь ключевых слов shell (раньше у них был сопоставлен только
однострочный комментарий `#`, и они падали на fallback JS). Блоки
```` ```sh ````/```` ```bash ```` получают визуальную эстетику терминала
(приглашение `$` на каждую строку команды), согласованную с `$ comando`,
который `ApprovalCard` уже использует для действия `terminal`.

- **Где:** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **Тест:** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **Источник:** PR #288 — ответы агента со списками, кодом и ссылками
  приходили в ленту сырым текстом, без всякой структуры

### RN-159 — Сгенерированные артефакты сгруппированы по агенту {#rn-159}

Панель "Artefatos gerados" Сессии (`ContextAside` в `SessionPage.tsx`)
перечисляет PR dev (`pr_open`), PR ADR от Arquiteto (`open_adr_pr`) и
эпик/историю, созданные PO (`backlog.epic_created`/`backlog.story_created`),
сгруппированные по `agentId` — кто сгенерировал каждый артефакт, — по тому же
шаблону сворачиваемого `Disclosure`, что и [RN-138](../business-rules.md#rn-138)
(имя агента + количество, разворачиваемое до заголовка каждого артефакта).

Каждый артефакт ведёт туда, где он живёт: PR (dev или ADR) открывает
настоящий URL (`executionResult.pullRequestUrl`, то же поле, которое
`ProjectOverviewTab.tsx` уже читает для PR ADR); эпик/история ведёт на
`/projects/:projectId?tab=backlog` (тот же шаблон `Link`, уже используемый в
компактных уведомлениях PO в основной ленте, [RN-124](../business-rules.md#rn-124)/
[RN-157](#rn-157)). PR ещё без `pullRequestUrl` (исполнение ожидает)
появляется в панели, не становясь кликабельной ссылкой.

Вне рамок, по решению, записанному в комментарии в коде (`ContextAside` в
`SessionPage.tsx`): module_map/C4 — это ДЕЙСТВУЮЩЕЕ состояние проекта (одна
текущая версия, перезаписываемая при каждой генерации), а не датированный
по СЕССИИ артефакт, как PR/эпик/история; вкладка Visão Geral
(`ProjectOverviewTab.tsx`) уже сегодня их место, без собственного якоря, —
решать это вне рамок этой поставки.

- **Где:** `apps/web/src/routes/SessionPage.tsx` (`ContextAside`)
- **Тест:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **Источник:** PR #288 — панель не различала, кто сгенерировал каждый
  артефакт, и не покрывала PR ADR и эпик/историю, только PR dev

### RN-160 — "Confirmar arquitetura pronta" требует как минимум 1 продвинутой истории {#rn-160}

Кнопка "Confirmar arquitetura pronta" (handoff Arquiteto→Dev Lead, через
`confirmArchitectureReadiness`) рождается `disabled`, пока в backlog проекта
нет хотя бы 1 истории со статусом, отличным от `draft`, — то есть уже
продвинутой `PromoteStoriesUseCase`/`TransitionStoryUseCase`
([RN-048](../business-rules/custo.md#rn-048)); одного наличия захваченного
бизнес-правила недостаточно. `in_progress`/`done` тоже считаются, потому что
туда попадают, только пройдя через `ready`. Источник — ТОТ ЖЕ, что уже
использует вкладка Backlog (`useBacklog`, `ProjectBacklogTab.tsx`, тот же
queryKey `['backlog', projectId]`), — без нового round-trip. Пока
продвинутой истории нет, кнопка показывает подсказку в `title`, объясняющую
причину.

- **Где:** `apps/web/src/routes/SessionPage.tsx` (`hasPromotedStory`,
  отрисовка кнопки)
- **Тест:** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **Источник:** просьба пользователя — у кнопки handoff Arquiteto→Dev Lead
  не было никакого gate

Это действовало только на КЛИЕНТЕ: прямой HTTP-вызов игнорировал правило.
Закрыто [RN-404](../business-rules.md#rn-404) (ADR 0094), которая повторно
проверяет в backend.

### RN-161 — Принятие handoff к Dev Lead сцепляет активацию исполнения, когда эффективная роль уже это разрешает {#rn-161}

> **Пересмотрено [RN-677](../business-rules.md#rn-677) (ADR 0194, решение
> владельца от 01.10):** принятие handoff к Dev Lead перестало сцеплять
> активацию исполнения, для ЛЮБОЙ роли — принятие лишь приводит его
> ПЛАНИРОВАТЬ, а активирует ОДОБРЕНИЕ его плана (`propose_execution_plan`).
> Текст ниже описывает слияние таким, каким оно было.

`handleAcceptHandoff` (`SessionPage.tsx`) автоматически сцепляет
`activateExecution`, когда `toAgent === 'dev-lead'` И ЭФФЕКТИВНАЯ роль
принимающего — прочитанная из того же `useCurrentWorkspaceWithRole()`, что
уже авторизует «Auto mode» ([RN-153](#rn-153)) и экраны
Aprovações/Configurações, — `owner` или `maintainer`. Для `developer` (или
ещё не разрешённой роли) текущий поток остаётся нетронутым: принятие ничего
не активирует, и "Ativar execução" остаётся второй кнопкой. Проверка только
на клиенте — `POST .../execution/activate` по-прежнему требует `maintainer` в
backend ([RN-137](../business-rules.md#rn-137)); слияние лишь избавляет от
лишнего клика того, у кого уже были обе роли. Переиспользует ТУ ЖЕ
`handleActivateExecution`, которую уже вызывает кнопка "Ativar execução",
которая сама обрабатывает ошибку (toast + `mensagemDaApi`) и никогда не
перебрасывает её, — это не даёт поздней ошибке активации сообщиться как «не
удалось принять handoff».

- **Где:** `apps/web/src/routes/SessionPage.tsx`
  (`podeFundirHandoffComExecucao`, `handleAcceptHandoff`)
- **Тест:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 4"
- **Архитектурное решение:** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **Источник:** просьба пользователя (одобренный дизайн)

### RN-162 — Структурированные вопросы Criativo {#rn-162}

Criativo может, когда задаёт НЕСКОЛЬКО вопросов в одном ответе, выдать
список в СТРУКТУРИРОВАННОМ формате вместо того, чтобы пользователь отвечал
пункт за пунктом свободным текстом, — новый инструмент
`ask_structured_questions`
(`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
`:direct`), зарегистрированный рядом с `emit_artifact`. Схема:
`{ questions: [{ id, label, type?, options? }] }` — `id` уникальный и
непустой, `label` непустой, `type` ∈ `text|textarea|select` (по умолчанию
`text`), `options` обязателен и непуст при `type: select`. Записывает
`chat.structured_question`.

Frontend (`StructuredQuestionCard`, `SessionPage.tsx`) отрисовывает форму с
полем на каждый вопрос — `Input`/`Textarea`/`Select` из design system, в
зависимости от `type`. `POST .../agents/:agent/structured-
question/:questionSetId/answer` (`AnswerStructuredQuestionUseCase`)
проверяет, что у каждого вопроса непустой ответ, записывает
`chat.structured_question_answered` (ссылаясь на `questionSetId` = id события
вопроса) и ПЕРЕИСПОЛЬЗУЕТ `SendAgentMessageUseCase` — ответы становятся
сцеплённым сообщением ("1. {label}: {resposta}\n2. ..."), как если бы
пользователь набрал его в ленте; нового канала «агент читает
структурированный ответ» нет. На набор вопросов можно ответить только ОДИН
раз: повторная отправка отклоняется с 409, а форма даже не появляется снова —
карточка становится только для чтения, как только существует последующий
`chat.structured_question_answered` с тем же `questionSetId`.

- **Где:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx` (`StructuredQuestionCard`)
- **Тест:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **Источник:** просьба пользователя — без прецедента структурированного
  ввода в чате

### RN-163 — Criativo выполняет обещание попробовать снова {#rn-163}

Каждый ход Criativo выполняет **ограниченный цикл tool use** с потолком **12**
обращений к модели — та же конструкция, что уже была у PO и Arquiteto. Раньше
модель вызывалась ОДИН раз за ход: результат инструмента добавлялся в историю
в памяти, и больше его никто не читал, так что фраза *«исправлю и попробую
снова»* — буквальная в коде — выполнялась, только если пользователь отправлял
ещё одно сообщение. Для пользователя Criativo просто переставал отвечать,
сказав, что исправит.

Четыре следствия, и каждое — правило:

1. **Ошибка инструмента — это ввод, а не конец пути.** Причина возвращается
   модели как сообщение `tool`, и цикл снова вызывает модель, которая
   повторно выдаёт исправленное ВНУТРИ того же хода.
2. **Не объявляется ничего, чего код не выполнит.** Фраза о повторной попытке
   решается после диспетчеризации инструментов и с знанием того, сколько
   кругов осталось: при доступном круге агент говорит, что исправит; без круга
   он не обещает.
3. **Сбой инструмента стал долговечным `agent.error`, с источником**
   ([RN-059](../business-rules/custo.md#rn-059)) — раньше это был
   `agent.response`, неотличимый в event log от обычного ответа. `origem:
   infra`, когда api отклонила `append_event`; `origem: modelo` для payload,
   написанного моделью (неверный ключ, `origin`, не являющийся списком,
   дублирующееся правило, тип, выпускаемый системой). Payload несёт `tool` и
   `retentativa`.
4. **Исчерпанный потолок не заканчивается молчанием.** Он становится
   `agent.error` с `reason: "limite_de_iteracoes"` и `origem: modelo`, тем же
   прочтением, что `toolloop.limit_reached` у `ToolLoop`. Имя события НЕ
   переиспользуется: этот агент не работает внутри `ToolLoop`, и событие
   солгало бы о том, кто его произвёл.

Две границы цикла, обе намеренные: успешный `ask_structured_questions`
**завершает** ход (мяч у пользователя, и ответы возвращаются в будущем ходе —
[RN-162](#rn-162)); а ход, в котором был сбой на каком-либо круге, закрывается
КОНСОЛИДИРОВАННЫМ исходом в ленте, чтобы последним словом не была ошибка
круга, которая потом уже была исправлена.

- **Где:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`run_turn_capturing/3`, `continuar/4`, `emit_falha_de_ferramenta/4`,
  `emit_falha_limite/2`)
- **Тест:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (цикл, который действительно исправляет, исчерпанный потолок описан,
  источник `infra` против `modelo`, структурированный вопрос, завершающий ход)
- **Источник:** реальное использование в проекте `exp001` — «Criativo не
  ответил после того, как сказал, что исправит и попробует снова»

### RN-169 — Проект выбирает, где живёт код: Local или Container {#rn-169}

**ПЕРЕСМОТРЕНО [RN-421](../business-rules.md#rn-421) (ADR 0104)**:
`workspace_mode`/`local` стали `execution_mode` с ТРЕМЯ значениями
(`container`/`mounted`/`runner`, миграция `0048`) — остальная часть этой
записи историческая, верная тому, что действовало до пересмотра.

Проект рождается с **режимом workspace** (`projects.workspace_mode`,
миграция `0043`), и именно он решает, откуда выводится корень области
видимости:

- **`container`** (ПО УМОЛЧАНИЮ и поведение, существовавшее всегда): папка,
  УПРАВЛЯЕМАЯ продуктом, `join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  ([RN-109](#rn-109));
- **`local`**: папка ПОЛЬЗОВАТЕЛЯ, по абсолютному пути
  `projects.workspace_path`.

Пара связана CHECK в базе
(`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`), а не только
сценарием использования: колонку читают ДВА процесса (api и engine) и пишут
скрипты seed/backfill, которые через него не проходят. `local` без пути был
бы областью видимости терминала, указывающей в никуда; `container` с путём
был бы вторым источником истины, ждущим расхождения с первым.

Вывод остаётся **единственным** — `projectScopeRoot` начал получать
местоположение (`{workspaceDirName, workspaceMode, workspacePath}`) и
выбирает ветку; ни один из четырёх потребителей
([RN-092](../business-rules/custo.md#rn-092)) не получил собственной
проверки. Engine разрешает тот же локатор при ЗАПРОСЕ (имя папки в
`container`, абсолютный путь в `local`) и различает их по начальной косой
черте, что однозначно, потому что имя папки проверяется по
`^[A-Za-z0-9_-]{1,64}$`.

Два явных следствия режима `local`:

1. **Ворота образа Arquiteto ([RN-105](#rn-105)) НЕ действуют.**
   **ОТМЕНЕНО [RN-494](../business-rules.md#rn-494) (ADR 0135)**:
   освобождение закончилось — все три режима начинают требовать решения об
   образе перед открытием вкладки Code. Остальная часть этого пункта —
   историческая. Проект Local не поднимает контейнер, поэтому вкладка Code
   открывалась, не дожидаясь решения, которое никогда бы не произошло.
   Освобождение жило в той же воронке, что и ворота в api, и экран был
   согласен: `ProjectCodeTab` даже не спрашивал состояние контейнера
   ([RN-107](#rn-107)), когда проект был Local, — если бы освобождала только
   api, вкладка оставалась бы заблокированной на экране несуществующим
   решением.
2. **`permissions.json` живёт в папке пользователя**, вместе с кодом, —
   потому что политика должна читаться из ТОГО ЖЕ корня, который
   авторизует область видимости терминала.

`workspace_mode` не путается с `GitProviderName` `'local'`: один говорит, где
на диске живёт КОД, другой — где живёт git-РЕПОЗИТОРИЙ, и эти два выбора
ортогональны.

- **Где:** `apps/api/src/db/schema/iam.ts` (`projects`),
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `apps/api/src/domain/iam/project.entity.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`), `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex` (который был вторым
  выводом, написанным вручную, и начал использовать единственный),
  `apps/web/src/routes/NewProjectWizard.tsx`
- **Тест:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot no modo local"),
  `apps/api/test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (permissions.json в папке пользователя),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (проект Local не проходит через ворота),
  `apps/api/test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  (режим заморожен: PATCH его не меняет),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (экран тоже освобождает от gate),
  `apps/engine/test/engine/actions/workspace_test.exs`
  (describe "workspace_dir/2 com o localizador já resolvido"),
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Архитектурное решение:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Источник:** просьба пользователя (его решение, с явно выбранным вариантом
  свободного пути)

### RN-170 — Путь Local проверяется при СОЗДАНИИ, и отказ обучает {#rn-170}

**ПЕРЕСМОТРЕНО [RN-422](../business-rules.md#rn-422) (ADR 0104)**: проверка
при создании начала РАСХОДИТЬСЯ по режиму — `mounted` (переименованный
`local`) по-прежнему обращается к диску, как описано здесь, `runner`
проверяет только ЛЕКСИКУ, без I/O, — остальная часть этой записи
историческая, верная тому, что действовало до пересмотра.

Создание проекта в режиме `local` с путём, до которого api не дотягивается,
даёт проект, который **заклинивает позже** — на первом инструменте первого
агента, далеко от экрана, где было принято решение. Поэтому создание
**отклоняется с 400**, и сообщение говорит, что нужно сделать.

Путь должен быть:

1. **абсолютным**, без `..` и `.` ни в одном сегменте (записанный путь — это
   читаемый путь; `/srv/app/../../etc` — это `/etc`, и так не выглядит);
2. **существующим и папкой** внутри контейнера api;
3. **доступным процессу для записи** (`access(W_OK|X_OK)`) — образы работают
   non-root ([ADR 0024](../adr/0024-fase5-imagens-producao-ci.md)), и папка
   хоста с другим владельцем на практике приходит смонтированной только для
   чтения;
4. **вне корня и системных папок** (`/`, `/etc`, `/usr`, `/var`, `/data`… и
   всего под ними): корень проекта — это область видимости, которая
   АВТОРИЗУЕТ терминал агента ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)),
   и проект с корнем в `/etc` превращает «агент пишет в свой проект» в
   «агент переписывает контейнер»;
5. **без пересечения с checkout Brabo, в ОБОИХ направлениях** — папка,
   СОДЕРЖАЩАЯ monorepo, и папка ВНУТРИ него. Второй случай — проблема,
   которая, по сообщению ADR 0055, реально происходила.

Записывается **нормализованный** путь, а не сырая строка: проверить одну
строку и записать другую — это то, как проверка перестаёт действовать на
следующий день. `workspacePath`, отправленный вместе с
`workspace_mode: container`, ОТКЛОНЯЕТСЯ, а не игнорируется — молча
отброшенное поле превращается в «но я же настроил».

ЛЕКСИЧЕСКАЯ часть (пункты 1, 4 и 5) выполняется **также при чтении**, при
каждом выводе `projectScopeRoot`: единственный способ обойти создание —
записать напрямую в базу, а выигрыш там — область видимости терминала в `/`.
ДИСКОВАЯ часть (пункты 2 и 3) выполняется только при создании, где
пользователь ещё может исправить.

Отказ из-за отсутствующей папки несёт инструкцию по монтированию — файл, два
сервиса и строку (`- <caminho>:<caminho>`), со ссылкой на
[runbook](../runbook.md). Монтирование только в api даёт проект, который api
принимает, а engine не видит: она проверяет то, что видит сама, и не может
знать, что смонтировано в другом контейнере.

- **Где:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`validarCaminhoDeWorkspaceLocal`, `CaminhoLocalInvalidoError`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `apps/api/src/interfaces/http/iam/dto/create-project.dto.ts`,
  `apps/web/src/lib/wizard.ts` (`caminhoLocalParecePlausivel`)
- **Тест:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "validarCaminhoDeWorkspaceLocal"),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (describe "a criação RECUSA o caminho que travaria depois"),
  `apps/web/src/lib/wizard.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Архитектурное решение:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Источник:** защита, требуемая вариантом свободного пути (ADR 0072)

---

### RN-164 — PO ЧИТАЕТ то, что уже существует, в рамках проекта {#rn-164}

PO получил два инструмента ЧТЕНИЯ — `listar_regras_de_negocio` и
`listar_backlog` (`:direct`, вообще без параметров), — обслуживаемые двумя
внутренними маршрутами в рамках **проекта**:
`GET /internal/projects/:projectId/business-rules`
и `GET /internal/projects/:projectId/backlog`.

Первый возвращает каждый `artifact.business_rule` сессий проекта с полным
`description`, какие истории уже ссылаются на каждое правило, и
`uncoveredCount`; второй возвращает ТО ЖЕ дерево эпик → история → задача, что
и вкладка Backlog, через тот же `ListBacklogUseCase` (три чтения на проект,
никогда N+1). Текст, возвращаемый модели, ставит НЕПОКРЫТЫЕ правила первыми
и ОСИРОТЕВШИЕ эпики перед деревом — это то, что порождает работу.

Что исправляет правило: до сих пор у PO было **четыре инструмента, и все
записывающие**. Его контекст собирался один раз, при kickoff, из 200
последних событий **сессии** — после этого он не знал, какие правила
существуют, какие он уже покрыл и что уже создал. Область видимости — проект,
а не сессия, намеренно: правило, захваченное в предыдущей сессии, — ровно то,
что скрывало чтение по сессии.

Чтение **не** становится `proposed_action` (это не внешний эффект), но оно
ОГРАНИЧЕНО в смысле ADR 0060: ни один из двух маршрутов не принимает
параметров кроме id проекта — ни поиска, ни пагинации, ни фильтра, —
стоимость вызова постоянна, а текст, отдаваемый модели, имеет потолок строк,
сообщающий реальный итог при усечении.

- **Где:** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **Тест:** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **Источник:** реальное использование в проекте `exp001` — «создай
  инструмент, чтобы PO мог перечислять бизнес-правила»

---

### RN-165 — За эпик без истории спрашивают, и PO спрашивает, когда не знает {#rn-165}

Когда PO завершает ход, создав эпик и **ни одной истории для него**, это
становится ЯВНЫМ исходом: долговечное событие `backlog.epic_without_story`
(с `origem: "modelo"`, id и заголовками эпиков и сообщением) плюс broadcast
`agent.error` — шаблон [RN-059](../business-rules/custo.md#rn-059): лог — то,
что выживает, broadcast — агент, говорящий в ленте. Спрос — по
СЛУЧАЮ: сообщённый один раз, список задолженностей очищается и не
превращается в тревогу, повторяющуюся на каждом ходе.

Считается создание, которое **удалось**: `create_story`, отклонённый api
(например, несуществующий `business_rule_id`), не погашает эпик. Трактовать
его так, будто погашает, значило бы сменить одно молчание на другое.
Ожидающие эпики живут в state `PoServer` и НЕ регидратируются: спрос касается
обязательства, взятого в ходе, а его восстановление из event log снова
открыло бы старый эпик, который пользователь уже решил иначе.

Вместе пришли две недостающие части, чтобы у PO был выход помимо остановки:
`ask_structured_questions` — ТОТ ЖЕ инструмент, что у Criativo
([RN-162](#rn-162)), лишь начавший объявляться в `po_server`, — и инструкция
kickoff, прямо говорящая, что эпик без истории заклинивает исполнение и что
**при нехватке информации СПРАШИВАЮТ**, никогда не останавливаются и не
выдумывают. Предыдущая инструкция не говорила ни слова о том, что делать
перед пробелом, а перед пробелом без инструкции модель выбирает между
выдумыванием и остановкой.

- **Где:** `apps/engine/lib/engine/agents/po_server.ex`
  (`anotar_obrigacao/4`, `encerrar_turno/1`, `obrigacoes/0`),
  `apps/engine/lib/engine/harness/tools/create_epic.ex` (`id_no_resultado/1`),
  `apps/web/src/lib/activity.ts`
- **Тест:** `apps/engine/test/engine/agents/po_server_test.exs`
  (describe "RN-165"), `apps/web/src/lib/activity.test.ts`
- **Источник:** реальное использование в проекте `exp001` — backlog без
  истории, а значит без задачи, а значит заклинившее исполнение без видимой
  ошибки

---

### RN-166 — Потолок итераций PO оставляет след {#rn-166}

При исчерпании потолка итераций цикла инструментов `PoServer` (12) ход
выпускает `toolloop.limit_reached` с `{iteration, max_iterations}` — ТОТ ЖЕ
тип и тот же payload, что `Engine.Harness.ToolLoop` уже выпускал с Фазы 3.
Раньше условие возвращало state, и всё: снаружи исчерпанный цикл был
неотличим от хода, который просто закончился.

Переиспользование идентификатора вместо создания `po.*` намеренно: это тот же
факт (цикл упёрся в потолок), и читающему event log не нужно учить второе имя
из-за того, что у разговорного агента собственный цикл вместо `ToolLoop`.

- **Где:** `apps/engine/lib/engine/agents/po_server.ex` (`run_turn/2`,
  условие `remaining <= 0`)
- **Тест:** `apps/engine/test/engine/agents/po_server_test.exs`
  ("teto de iterações emite toolloop.limit_reached")
- **Источник:** расследование заклинивания `exp001` — цикл завершался молча

---

### RN-172 — Handoff и одобрение — это ИСХОД хода {#rn-172}

В ленте сессии **предложенный handoff** и **карточка одобрения** появляются
ПОСЛЕ последней реплики хода, в котором они родились, — никогда в его
середине.

Это **не исправляет упорядочение**: RN-155 продолжает действовать целиком, и
лента по-прежнему упорядочена по `seq` event log. То, что записывает лог, —
правда: `po_server.ex` (`run_turn/2`) выпускает в ТОЙ ЖЕ итерации
`agent.response` хода, ЗАТЕМ `tool.call` от `offer_handoff` (который
записывает `handoff.offered`) и ТОЛЬКО ПОТОМ рекурсирует к завершающему
`agent.response`. `seq` handoff честно меньше, чем у последней реплики. То же
верно для `proposed_action.created`, который рождается посреди хода, пока
агенту ещё есть что сказать. Показывать «передал эстафету» или «одобрите
это» посреди разговора — неверное прочтение верных данных, поэтому правило
относится к ПРЕДСТАВЛЕНИЮ, применяется отдельным явным проходом
(`afundarDesfechos`) после `sort` по `seq`, а не спрятано в компаратор из трёх
членов.

Разные ходы **никогда не смешиваются**. Исход опускается до конца отрезка
прямо под ним и останавливается на первой записи, не выполняющей любое из
трёх условий:

1. **тот же ход** — ход — это `seq` последнего ОТКРЫТИЯ перед записью, а
   открытие — событие актора `user` (`chat.message`, `agent.activated`,
   продвижение/возврат истории). Защищает случай, когда у границы между двумя
   ходами нет никакой ВИДИМОЙ записи: `agent.activated` открывает ход и не
   становится элементом ленты.
2. **тот же автор** — в сессии ИСПОЛНЕНИЯ несколько агентов пишут без того,
   чтобы пользователь сказал хоть слово, и все оказываются в одном ходе;
   исход одного не может пересечь реплику другого.
3. **не является исходом** — два исхода подряд сохраняют порядок между собой
   (`handoff.offered` Infra перед Dev Lead, в одном подтверждении).

Актор `system` НЕ открывает ход: это инфраструктурный шум посреди ленты, а не
решение того, кто разговаривает.

- **Где:** `apps/web/src/routes/SessionPage.tsx`
  (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos` и поля
  `autor`/`turno`/`desfecho` в `TimelineEntry`)
- **Тест:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describes "RN-172 — turno e desfecho (unidade)" и "RN-172 — a sequência
  REAL do engine, renderizada")
- **Источник:** реальное использование в `exp001` — «передача эстафеты от PO
  к архитектору появляется над последним сообщением PO» и «сообщение об
  одобрении появилось над чатом архитектора, пока он не закончил ответ»

---

### RN-173 — Лента следует за всем, что растёт, и только для того, кто уже был в конце {#rn-173}

Чат прокручивается в конец, когда содержимое растёт, — **и не только когда
приходит новое событие**. Два источника ленты — РАЗНЫЕ запросы (`events` и
`actions`), а высота меняется и без них обоих: открытие/закрытие
`Disclosure` (свёртка по агенту из RN-138, "Detalhes" карточки одобрения),
перекомпоновка Markdown, диаграмма, отрисовывающаяся позже. Поэтому
механизмов два: зависимости эффекта покрывают то, что знает React
(`events.length`, `actions.length`, `streamingText`), а `ResizeObserver` над
СОДЕРЖИМЫМ ленты покрывает то, что знает только layout.

Защита остаётся **неизменной и намеренной**: прокручивается только тот, кто
уже находится менее чем в 120px от конца. Того, кто поднялся перечитать
историю, не тащат — лента следует за разговором, а не похищает чтение.

В той же ленте карточка одобрения перестаёт занимать все 780px колонки: она
получает потолок 560px и центрируется, как уже сделаны
`.handoffCard`/`.handoffDivider`. Отступ в 45px, как у пузырей, был бы
ошибкой — карточка не чья-то реплика, это решение, запрошенное у
пользователя. Очередь вкладки Aprovações не меняется: там карточка ДОЛЖНА
заполнять колонку сетки. Начиная с AT-322 карточка ОДНА на всех
поверхностях и заполняет контейнер — потолок и центрирование в ленте
применяет её контейнер (`.acaoNoFio`), а не вариант карточки.

- **Где:** `apps/web/src/routes/SessionPage.tsx` (`acompanharOFim` и два
  эффекта, которые его вызывают); `apps/web/src/components/ApprovalCard.module.css`
  (`.card`) и `apps/web/src/routes/SessionPage.module.css` (`.acaoNoFio`)
- **Тест:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describe "RN-173 — o fio acompanha o que cresce", со случаем, когда
  пользователь прокрутил вверх)
- **Источник:** реальное использование в `exp001` — «прокрутка чата всегда
  должна оставаться в конце, следуя за чатом» и «одобрение плохо свёрстано,
  должно быть по центру»

### RN-171 — У вопроса-списка есть выход свободным текстом, по умолчанию {#rn-171}

Вопрос `type: "select"` из `ask_structured_questions` (RN-162) принимает
ответ **вне списка**. Поле — `allowOther`, и **по умолчанию `true`**: тот,
кто ничего не объявляет, предлагает выход. Закрытие списка требует явного
`allowOther: false` и имеет смысл только когда он действительно закрыт
("Sim"/"Não").

Открытое значение по умолчанию — не стилистическое предпочтение. Список,
закрытый по ЗАБЫВЧИВОСТИ модели, заклинивает весь разговор, и пользователь
не может разблокировать его снаружи — ровно это обнаружило реальное
использование: модель предложила вариант вроде «Напишите сами», а в форме
негде было писать, потому что схема инструмента не умела выразить «помимо
этих — что захотите». Список, открытый по ошибке, в худшем случае
предлагает лишнее поле. Две ошибки стоят не одинаково. По той же причине
описание инструмента **запрещает** создавать вариант «Другое» внутри
`options`: форма предлагает его сама, а два выхода в одном списке путают.

`allowOther` существует только в `select` — в `text`/`textarea` поле и так
свободный текст, и engine нормализует эти два в `false` вместо записи
бессмысленного состояния в event log. На экране выбор "Outra (escrever)"
заменяет `Select` на `Input`: сентинел интерфейса (`__outra__`) **никогда**
не уходит в backend, уходит набранный ТЕКСТ. Кнопка отправки
по-прежнему требует заполнения ВСЕХ вопросов — `AnswerStructuredQuestion
UseCase` отклоняет с 400, перечисляя недостающее, так что включение с пустым
полем лишь породило бы ошибку сервера, — а нахождение в "Outra" с ещё
пустым текстом НЕ считается заполненным.

Карточка также перестала быть единственным элементом ленты, ни к чему не
выровненным: она центрируется с тем же потолком 560px, что и `ApprovalCard`
в варианте `chat` ([RN-173](#rn-173)), и получает аватар и цвет агента, что
заставляет её читаться как РЕПЛИКА кого-то, а не осиротевшая форма. Раньше
она рождалась прижатой к левому краю с потолком 480px, тогда как пузыри
начинаются с отступом 45px.

- **Где:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  (схема, проверка и `normalizar/1`), `apps/web/src/lib/api-types.ts`
  (`StructuredQuestion.allowOther`), `apps/web/src/routes/SessionPage.tsx`
  (`StructuredQuestionCard`, `OUTRA_RESPOSTA`, `permiteOutra`),
  `apps/web/src/routes/SessionPage.module.css` (`.structuredQuestionCard`,
  `.structuredQuestionCabecalho`)
- **Тест:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  (открытость по умолчанию, явный `false`, небулев `allowOther` отклоняется),
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  (describe "saída por texto livre no select")
- **Источник:** реальное использование в `exp001` — «всегда давай
  возможность ввода пользователю, когда он выбирает Напишите»

### RN-174 — Действие, запускающее ход агента, включает индикатор ленты {#rn-174}

Индикатор «агент работает» (три точки после 5s,
[RN-131](../business-rules.md#rn-131)/[RN-156](#rn-156)) появляется только
пока действуют `streaming` или `statusAgent`, а их включали в трёх местах:
composer (`handleSend`), подтверждения готовности и канал Phoenix.
**Каждое действие экрана, запускающее синхронный ход в engine, теперь тоже
его включает.**

Их два, и ни одно не является composer:

1. **Ответ на форму структурированных вопросов** —
   `AnswerStructuredQuestionUseCase` переиспользует `SendAgentMessageUseCase`
   ([RN-162](#rn-162)), и вызов разрешается только после всего хода.
2. **Возврат истории PO** — `ReturnStoryUseCase` вызывает `reviseStory`,
   который является `handle_call({:revise, …})` в `po_server`: HTTP-ответ
   ждёт, пока PO перепишет историю.

Канал Phoenix не закрывает дыру, и именно это делает исправление необходимым,
а не избыточным: когда он ещё не закончил подключаться (ticket + join,
[RN-108](#rn-108)), broadcast `agent.status` "working" не имеет слушателя и
теряется — экран пребывает в абсолютной тишине десятки секунд, что
неотличимо от «ничего не произойдёт».

Пара — это `iniciarTurnoDoAgente(agente)` **до** `await` (`agent.status`
канала может прийти первым, и без зафиксированного агента индикатор родился
бы, не зная, кто говорит) и `finalizarTurnoDoAgente()` в `finally` — на ОБОИХ
путях, потому что ошибка, оставившая `streaming` включённым, заклинила бы
composer до следующего хода. Разрешение вызова — такой же надёжный сигнал
конца хода, как `agent.done` канала, а `finalizarTurnoDoAgente`
идемпотентна. Срок 5s не меняется: ход, отвечающий быстро, по-прежнему ничего
не показывает.

- **Где:** `apps/web/src/routes/SessionPage.tsx` (`iniciarTurnoDoAgente`,
  `handleReturnStory`, `StructuredQuestionCard`)
- **Тест:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  и `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (describes RN-174, со случаем сбоя, доказывающим, что индикатор не
  зависает)
- **Источник:** реальное использование в `exp001` — «если web, api и engine
  отвечают дольше 5s, web должен показывать в чате анимацию, что агент
  думает»

### RN-175 — Каждый ответ агента говорит, какой моделью он сгенерирован {#rn-175}

`agent.response` несёт `modelName` во **всех трёх** производителях события, а
не только в четырёх разговорных агентах:

| производитель | кто через него проходит | раньше |
|---|---|---|
| четыре разговорных (`criativo`/`po`/`arquiteto`/`dev_lead`) | чат | уже записывал, начиная с [RN-146](#rn-146) |
| `Engine.Harness.ToolLoop` | КАЖДЫЙ агент исполнения и gate — `dev-*`, QA, SecOps, Infra-Workflows, Psicólogo, Anamnese | **никогда не записывал** |
| `SendChatMessageUseCase` (api) | чат без активного агента, где отвечает модель | **никогда не записывал** |

Ни одного нового вызова: `RunLlmTurnUseCase` уже возвращает `modelName` в
теле, а `StreamLlmTurnUseCase` уже кладёт его в кадр `final` — значение есть
имя модели **разрешённого binding** (`model.name`), а не эхо провайдера. Оно
`null`, когда ход упал до разрешения binding, и отсутствует в событии,
записанном до этого правила.

На экране модель перестала быть отдельным словом `modelo` моноширинным 10px
`--text-muted` рядом с именем агента — что читается так, будто модель
НАЗЫВАЕТСЯ «modelo», и что проваливает контраст читаемого текста. Она стала
**чипом** с иконкой модели, `--text-secondary` на `--surface-2`, а метка
неизвестного стала "modelo não registrado". Экран **не** угадывает модель по
ТЕКУЩЕМУ binding агента, когда данных нет: приписать старому ответу модель,
которой, возможно, даже не существовало при его генерации, значило бы
выдумать происхождение, а выдуманное происхождение хуже отсутствующего — тот
же аргумент, что у замороженной цены в `token_usage`
([RN-044](../business-rules/custo.md#rn-044)).

Вне рамок, объявлено: `agent.error` по-прежнему без модели в четырёх
серверах, даже когда api прислала её в кадре ошибки (например, при
превышении бюджета). Это изменение другого события, с другим вопросом, на
который нужно ответить.

- **Где:** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx` (чип в `agent.response`),
  `apps/web/src/routes/SessionPage.module.css` (`.messageModelo`)
- **Тест:** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts` (пара чипа)
- **Источник:** реальное использование в `exp001` — «PO не показал модель,
  которую использовал; все агенты должны показывать свою модель рядом с
  именем»

### RN-176 — Таблица в Markdown в ленте становится настоящей таблицей {#rn-176}

Лёгкий Markdown чата ([RN-158](#rn-158)) начинает распознавать **таблицу
GFM** и отрисовывать её через `Table` из design system — тот же компонент,
что в Configurações, Gastos и Executores, а не собственную `<table>`: «как
Brabo рисует таблицу» — одно решение. Раньше таблица Карты модулей, которую
Arquiteto пишет в ответе, выходила абзацем с буквальными вертикальными
чертами.

Таблицу от прозы с `|` отличает **строка-разделитель**, и она обязательна,
как в GFM: без неё блок остаётся абзацем, так что «выбор между a | b | c» не
становится таблицей по ошибке. Заголовок задаёт число колонок — короткая
строка получает пустую ячейку, длинная теряет излишек, — экранированный `\|`
остаётся внутри ячейки, а выравнивание берётся из двоеточий разделителя. Ноль
новых зависимостей: парсер по-прежнему собственный, на regex, а дерево
данных по-прежнему превращается напрямую в React-элементы (никакого
`dangerouslySetInnerHTML`).

**Артефакт `artifact.module_map` остаётся ВНЕ ленты**, и выбор намеренный:
это ДЕЙСТВУЮЩЕЕ состояние проекта, а не артефакт, датированный по сессии, —
то же решение, уже записанное в [RN-159](#rn-159), — и он живёт в Visão
Geral. Пользователь просил таблицу **внутри сообщения**, и именно она стала
отрисовываться; исправление служит ЛЮБОМУ агенту, пишущему таблицу, а не
только Карте модулей.

В пузыре таблица **прокручивается по горизонтали**, а не сжимает колонки:
лента ~700px, а у `module_map` 4 колонки.

- **Где:** `apps/web/src/lib/markdown.ts` (блок `table`, `celulasDaLinha`),
  `apps/web/src/components/ui/MarkdownMessage.tsx` (`TabelaMarkdown`),
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **Тест:** `apps/web/src/lib/markdown.test.ts` (describe "tabela (RN-176)"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Источник:** реальное использование в `exp001` — «таблица внутри
  сообщения Карты модулей архитектора должна быть хорошо структурирована в
  формате таблицы, использовать собственный design system Brabo»

### RN-177 — Лог показывает всё, а история сворачивается по ИСТОЧНИКУ {#rn-177}

Лента активности скрывала шесть типов событий (`tool.call`, `tool.result`,
`agent.response`, `agent.delta`, `agent.status`, `context.compacted`) **не
предлагая никакой альтернативы**: тому, кто хотел видеть, чем обмениваются
агент и harness, приходилось открывать базу. Фильтр остаётся и остаётся
**выключенным по умолчанию** — его причина не изменилась (116 из 193 реальных
событий были этих типов, см. `isMachineEvent`), — но стал **выбором**: кнопка
"Eventos de máquina" на той же полосе, что и чипы типов.

Показ всего решает лишь половину: длинная сессия становится списком, который
никто не просматривает. Поэтому **5 самых свежих остаются открытыми**, а
остальное уходит в свёртки по **ИСТОЧНИКУ** — НОВОЙ классификации, которая не
заменяет `ActivityKind`: `kind` говорит, о каком ПРЕДМЕТЕ событие (commit, PR,
разрешение), и решает иконку и цвет; `origem` говорит, из какого СЛОЯ оно
пришло, и именно она делает историю читаемой порциями. Шесть выводятся из
существующих данных — `actor.kind` и
префикса `type`, — никогда из предположений:

| источник | что в него попадает |
|---|---|
| `harness` | `tool.*`, `toolloop.*`, `agent.status`, `context.compacted` |
| `llm` | `agent.response`, `agent.delta`, `llm.*` |
| `usuario` | любое событие с `actor.kind === 'user'` |
| `sistema` | любое событие с `actor.kind === 'system'` |
| `agente` | остальные `agent.*`, `handoff.*`, `delegation.*`, `chat.*` от агента |
| `eventos` | доменный event log (backlog, git, PR, артефакт, bootstrap…) |

**Приоритет** делает классификацию предсказуемой, и он задан порядком `if`:
механизм (`harness`, `llm`) побеждает актора, потому что `tool.call`
принадлежит harness, каков бы ни был актор; а актор побеждает префикс агента,
потому что `chat.message` существует с обеих сторон, и различает их тот, кто
говорил. Непредусмотренный тип попадает в `eventos` — никогда не исчезает,
никогда не выдумывает категорию.

**То же правило действует в ЛЕНТЕ сессии**, с обращённой осью: лента
возрастающая (самое новое у composer), поэтому 5 последних записей остаются
открытыми внизу, а свёрнутая история — ВВЕРХУ. Отсечение делается по списку,
уже сгруппированному по агенту ([RN-138](../business-rules.md#rn-138)), —
считается то, что видит пользователь, и свёртка из двенадцати сообщений — это
ОДНА запись на экране. **Пересмотрено в ленте [RN-644](../business-rules.md#rn-644):**
там отсечение считает только СООБЩЕНИЯ, отступает до открытия хода, а
история — ОДИН хронологический блок, а не группы по источнику (которые
ставили ответ над вопросом). Панель лога остаётся такой, как описано здесь.

- **Где:** `apps/web/src/lib/activity.ts:94` (`OrigemDeEvento`), `:125`
  (`origemDoEvento`), `:152` (`agruparPorOrigem`);
  `apps/web/src/components/ActivityFeed.tsx:34` (отсечение 5), `:66`
  (переключатель); `apps/web/src/routes/session-fio.tsx:119` (отсечение ленты), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
  переключатель); `apps/web/src/routes/session-fio.tsx:119` (отсечение ленты), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
- **Тест:** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx` (describe "ordem,
  agrupamento e o toggle de máquina"),
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx` (describe
  "RN-177")
- **Источник:** реальное использование в `exp001` — «в логе событий
  показывать также лог системы, сводить сообщения в группы, то есть
  оставлять последние 5 сообщений, а ниже — группы лога событий, системы,
  llm, harness, агента, пользователя»

### RN-178 — Панель сессии читается от последнего к первому, а список правил пагинируется {#rn-178}

Четыре раздела панели контекста (бизнес-правила, сгенерированные артефакты,
затронутые файлы и лог событий) были **возрастающими**: они открывались на
начале сессии. В сессии из тысяч событий это даёт не тот экран — тот, кто
открывает панель, хочет то, что только что произошло. Все четыре стали
**убывающими**, в том числе внутри дерева backlog ([RN-179](#rn-179)).

Пришедшее вместе следствие: кнопка "Carregar mais antigos" ленты
([RN-099](../business-rules.md#rn-099)) **сменила сторону**. Она была НАД
списком, потому что список был возрастающим, и прошлое было наверху; при
обращённом порядке прошлое в конце, и кнопка наверху просила бы
прокручивать в направлении, противоположном тому, что она загружает, — тот же
аргумент, что и раньше, с обратным знаком.

И **свыше 5 правил список пагинируется**, а не растёт бесконечно: панель
шириной в одну колонку, а сессия идеации без усилий переходит за двадцать
правил. Текущая страница разрешается через *clamp* (`min(pagina, total - 1)`),
а не эффектом синхронизации: новое правило, приходящее через poll, удлиняет
список, и `useEffect` один раз отрисовал бы с недопустимой страницей, прежде
чем исправить. При 5 или меньше пагинатора **не существует** — элемент
управления, ничего не пагинирующий, — это шум, занимающий высоту.

- **Где:** `apps/web/src/routes/ContextAside.tsx:109` (`REGRAS_POR_PAGINA`) и
  упорядочение четырёх разделов в том же файле;
  `apps/web/src/components/ActivityFeed.tsx:98` (убывающий `sort`)
- **Тест:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-178"), `apps/web/src/components/ActivityFeed.test.tsx`
- **Источник:** реальное использование в `exp001` — «показывать лог
  событий, затронутые файлы и бизнес-правила всегда в порядке от последнего к
  первому по дате» и «если бизнес-правил больше 5, нужно пагинировать»

### RN-179 — Артефакт PO — это ДЕРЕВО: эпик → история → задача {#rn-179}

Панель "Artefatos gerados" ([RN-159](#rn-159)) перечисляла эпик и историю
бок о бок, плоско, и **игнорировала `backlog.task_created`** — именно то, что
dev agent берёт в работу. Все три образовали дерево, с дочерним внутри
свёртки родителя, а задачи рождаются ЗАКРЫТЫМИ: эпик с тридцатью задачами
занял бы всю панель, хотя никто об этом не просил.

Родство выводится из **связи, которую событие уже несёт** —
`backlog.story_created` записывает `epicId`, `backlog.task_created`
записывает `storyId`, — никогда из соседства в логе. Узел, чей родитель не
среди загруженных событий, **поднимается в корень**, а не подвешивается к
ближайшему эпику: выдумывать родство хуже, чем показать узел отдельно, а
задача, чья история осталась вне окна, — нормальный случай, а не ошибка.

Каждый уровень остаётся **ссылкой** на Backlog, а свёртка дочерних идёт ПОД
строкой, а не внутри заголовка, — заголовок `Disclosure` является
`<button>`, а `<a>` внутри `<button>` — невалидный HTML и неоднозначная цель
клика. Счётчик заголовка раздела считает ВСЁ дерево, а не только корни:
сказать «3» при восемнадцати задачах внутри было бы тем же видом числа, не
соответствующего ничему, которое [RN-151](#rn-151) убрала из боковой
панели.

- **Где:** `apps/web/src/lib/session-backlog-tree.ts:68`
  (`montarArvoreDeBacklog`), `apps/web/src/routes/ContextAside.tsx:210`
  (корни становятся элементами), `:225` (подсчёт дерева)
- **Тест:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  (случаи "épico/história/tarefa do PO viram árvore" и "nó sem pai carregado
  aparece na raiz")
- **Источник:** реальное использование в `exp001` — «показывать также
  задачи, созданные в артефакте PO, но под эпиком и с возможностью
  свернуть»

### RN-180 — Панель говорит, чего она НЕ показывает {#rn-180}

`useSessionEvents` запрашивает `{ limit: 200, latest: true }`, а панель
контекста читала этот срез через prop. Следствие: в сессии из тысяч событий
четыре раздела показывали хвост **так, будто это вся сессия** — бизнес-правило,
захваченное в начале идеации, просто не существовало, без какого-либо
предупреждения.

Панель начала читать ту же пагинированную историю, которую уже использовала
вкладка Atividade в Visão Geral ([RN-099](../business-rules.md#rn-099)), с
`queryKey` хвоста, общим с лентой, — **ноль дополнительных запросов** в цикле
poll ([RN-090](../business-rules.md#rn-090)/[RN-091](../business-rules.md#rn-091)).
С этим изменились две вещи:

1. **Лента получила пагинатор, который у компонента был всегда.** Props
   `onLoadOlder`/`hasOlder`/`loadingOlder` необязательны с RN-099, и это
   место вызова никогда их не передавало — именно поэтому сессия молча
   теряла начало.
2. **Заметка считает, сколько событий не хватает.** Число берётся ВЫЧИТАНИЕМ
   по `seq` (без пропусков и по сессии): `меньший загруженный seq − 1`.
   Никогда из дополнительного запроса — тот же механизм, что «+ N более
   старых» у колокольчика ([RN-100](../business-rules.md#rn-100)). При
   достижении начала сессии заметка **исчезает**, а не утверждает ноль.

Производные разделы читают `baixados` (всё, что уже пришло), а не `events`
(окно ленты в 100): они не пагинируются поэлементно, и обрезка их окном
заставила бы их показывать МЕНЬШЕ, чем до этого изменения. Обоих питает одна
и та же кнопка.

`pausarPoll` спускается через `useSessionEventHistory` до `useSessionEvents`, и
это не деталь: интервал refetch принадлежит каждому НАБЛЮДАТЕЛЮ, а не
запросу. Второй наблюдатель того же ключа с включённым таймером воскресил бы
poll, который экран приостанавливает во время хода, — а с ним и визуальный
дубликат пузыря в streaming.

- **Где:** `apps/web/src/lib/hooks.ts:262` (`pausarPoll` истории),
  `:388` (`baixados`); `apps/web/src/routes/ContextAside.tsx:154`
  (`eventosAnteriores`) и `ActivityFeed` с пагинатором, в конце того же
  файла
- **Тест:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-180")
- **Источник:** ревью собственного раунда — потолок 200 существовал молча во
  всех четырёх разделах

### RN-181 — Делегирование области появляется в ленте {#rn-181}

Когда область (QA, Infra) делегирует подагентам и консолидирует вердикт, три
исхода, которые регистрирует lead, — `delegation.completed`,
`delegation.failed` и `delegation.dispensed` — существовали только в панели
лога. Тот, кто следил за сессией, видел, как gate открывается и закрывается
**без какого-либо сигнала** о том, что внизу была вторая попытка.

Все три стали описываться в ленте как **компактное уведомление**, в формате
[RN-157](#rn-157), — не пузырь: это уведомление о том, что произошло внутри
области, а не реплика. ФРАЗА берётся из `classifyEvent`, той же, что в
панели, потому что две
формулировки одного события расходятся при первом же изменении payload; и
она уже называет подагента и область, так что lead **не** ставится в
префикс (получилось бы "QA Lead QA Automação concluiu a delegação (qa)").

Внешний контракт области **не меняется** (ADR 0038): лента не начинает
обращаться к подагенту, а лишь описывает то, что lead уже зарегистрировал.
Источник сбоя передаётся вместе в `delegation.failed`, по той же причине, что
и [RN-059](../business-rules/custo.md#rn-059), — именно он говорит, будет ли
следующим шагом смена ключа, ожидание провайдера или заведение бага.

- **Где:** `apps/web/src/routes/session-timeline-montagem.tsx:754`
- **Тест:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-181")
- **Источник:** реальное использование в `exp001` — «когда есть новая
  попытка и консолидация какого-либо агента, это должно показываться в чате»

### RN-182 — Тема выбирается, сохраняется и применяется до первой отрисовки {#rn-182}

Светлая тема существует в `design/tokens.css` с самого начала, под
`[data-theme='light']`, и **ничто в `apps/web` не записывало этот атрибут**:
единственный способ увидеть светлую тему был ввести атрибут в DevTools. Она
становится достижимой.

Предпочтение живёт в `localStorage['brabo.theme']`, принимает **только**
`'dark'` или `'light'`, а по умолчанию — `dark`, основная тема design
system. Применяет его `apps/web/public/theme-boot.js`, **синхронно в
`<head>` и до bundle**: `data-theme` решает цвета всего `tokens.css`, и его
применение после гидратации заставило бы пользователя светлой темы видеть
тёмную вспышку при каждой загрузке.

Это **файл, а не inline-скрипт**, и причина та же, что сделала шрифты
самостоятельно размещёнными (ADR 0036): образ production отдаётся под
`script-src 'self'` (`docker/web/nginx.conf`), без `'unsafe-inline'` и без
nonce. Inline работал бы в `pnpm dev:web` и был бы **заблокирован в
опубликованном образе** — худший возможный режим отказа, потому что он
проявляется только после deploy.

Весь путь деградирует, а не ломается: `localStorage` может выбросить
исключение (приватный режим, хранилище, заблокированное в iframe), а тема —
предпочтение, а не функция; неизвестное значение падает на значение по
умолчанию, а не становится `data-theme`, которого CSS не знает и который
отрисовался бы вообще без темы.

- **Где:** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **Тест:** `apps/web/src/lib/tema.test.ts` (describe "contrato com o script
  de boot")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — У предпочтения темы один источник, а атрибут `<html>` — это истина {#rn-183}

Чтение, запись, переключение и наблюдение темы — это
`apps/web/src/lib/tema.ts`: кнопка живёт в shell и потребляет этот API,
никогда не записывая `data-theme` сама.

Три решения внутри него:

1. **`temaAtual()` читает АТРИБУТ первым**, и только потом `localStorage` и
   значение по умолчанию. Атрибут — это то, что показывает экран; падение на
   записанное предпочтение раньше него заставило бы UI утверждать иную тему,
   чем видна, ровно в том случае, когда boot не сработал.
2. **`lerTemaSalvo()` возвращает `null`, а не значение по умолчанию**, когда
   записанного предпочтения нет. Тот, кто никогда не выбирал, однажды сможет
   следовать операционной системе (`prefers-color-scheme`), и стирание этого
   различия здесь лишило бы информации того, кто решит это позже.
3. **`observarTema()` покрывает событие `storage`**, которое браузер
   отправляет в ДРУГИЕ вкладки того же origin. Без этого две открытые вкладки
   оставались бы в разных темах до следующей перезагрузки.

Ключ и значение по умолчанию повторены в `public/theme-boot.js`, потому что он
выполняется до bundle и ничего не может импортировать. Это единственное
дублирование, способное молча разойтись, и поэтому тест читает файл boot и
проваливается, если они перестанут совпадать.

- **Где:** `apps/web/src/lib/tema.ts:73`
- **Тест:** `apps/web/src/lib/tema.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — Контраст измеряется в ОБЕИХ темах {#rn-184}

Пока светлая тема была недостижима ([RN-182](#rn-182)), измерение только
тёмной было честным: измерять экран, который никто не может открыть, — значит
измерять намерение. С кнопкой темы отказ от измерения светлой начал бы
скрывать половину видимой поверхности продукта — поэтому пары начинают
проверяться в обеих темах, с той же нижней границей (4,5:1 для текста, 3:1 для
элемента интерфейса).

Для этого **шесть токенов светлой темы изменили значение**. Самый
требовательный фон светлой темы — `--code-bg` (бумага, `#efe4d2`, в шаге от
поверхностей), и то, что проходит против него, проходит против остального:
`--accent` 3,56 → 4,81, `--warning` 3,15 → 4,98, `--success` 3,89 → 5,12,
`--violet` 4,16 → 4,95, `--text-muted` 2,76 → 5,17, а `--accent-hover` пошёл
за accent на ступень ниже. Тёмная тема **не изменила ни одного значения**, и
её известный долг оставался зафиксированным теми же пятью числами (3,89 /
3,10 / 3,88 / 3,88 / 4,41) до [RN-640](../business-rules.md#rn-640)
(ADR 0181), которая закрыла его нейтральной палитрой и превратила в нижнюю
границу.

`--text-muted` светлой темы не был долгом: при 2,40:1 на `--surface-2` он
проваливал даже нижнюю границу **элемента интерфейса**, самую низкую из
существующих. Это был дефект, и светлой теме незачем быть хуже основной.

- **Где:** `design/tokens.css:208`
- **Тест:** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — Восемь ролей синтаксиса, и значение из handoff входит только измеренным {#rn-185}

Палитра подсветки состояла из трёх собственных токенов (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) и пяти переиспользований
семантических (`--accent`, `--warning`, `--violet`, `--success`,
`--text-primary`). Именно это переиспользование заставляло измерять палитру
только в тёмной теме: в светлой семантические проваливались против
бумажного `--code-bg`.

Теперь у неё **восемь ролей** из handoff, с префиксом `--syntax-*`, который
уже использует репозиторий, и у каждой — собственное значение для каждой
темы. Именование всех восьми — то, что позволяет подсветке разойтись с
семантикой в тот день, когда это понадобится.

**Значение из handoff входит, только когда измерение его одобряет.** Против
собственного `--code-bg` handoff пять из восьми проваливают 4,5:1, которых
требует текст кода, — `--syn-cm` 4,09:1 в тёмной и 2,32:1 в светлой,
`--syn-kw` 4,34:1, `--syn-str` 4,20:1, `--syn-fn` 4,14:1, `--syn-op` 4,00:1.
Там, где handoff проваливается, действует измеренное число: это то же
правило, что в ADR 0036, — намерение handoff действует, механизм (или
число), ломающий продукт, — нет.

Пять семантических по-прежнему красят (`SyntaxTokens.module.css` в этой
поставке не изменился) и поэтому **измеряются рядом** с восемью: пока они
являются настоящим пикселем, нижняя граница спрашивается с них. В светлой
теме у каждой роли сегодня ТО ЖЕ число, что у семантического, который её
красит, — намеренно: два источника с разными числами для одного пикселя
разошлись бы при первом исправлении, сделанном только с одной стороны.

- **Где:** `design/tokens.css:111`
- **Тест:** `apps/web/src/lib/contraste.test.ts` (describe "contraste — paleta
  de sintaxe sobre --code-bg")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — Боковая панель сворачивается в полосу иконок, с сохранённым предпочтением {#rn-195}

`Shell.tsx` имел фиксированную ширину (248px) и никакого способа сжаться.
Теперь он переключается между `--sidebar-w` (264px) и
`--sidebar-w-collapsed` (62px) — двумя токенами, которые Волна 1/фронт A уже
создала в `design/tokens.css`, — с `transition: width .18s ease`. Свёрнутая,
она становится вертикальной полосой: квадрат с инициалами на каждый проект
(рамка цвета идентичности, [RN-197](#rn-197)) плюс иконка Atividades; клик
по проекту в полосе снова разворачивает панель, открывает этот проект и
переходит к нему.

Предпочтение принадлежит пользователю и переживает перезагрузку:
`brabo.sidebar.collapsed` (`'1'`/`'0'`) в `apps/web/src/lib/sidebar-state.ts`.
Оно **только ручное** (`colapsadoManual`): было второе, **автоматическое**
состояние (`autoColapsado`), складывавшееся через OR вкладкой Código, и оно
было удалено [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) —
см. [RN-201](#rn-201). Ни один экран не сворачивает боковую панель сам; то,
что видно свёрнутым, попросил пользователь, и это записано.

- **Где:** `apps/web/src/routes/Shell.tsx:340-351` (состояние и
  переключатель), `apps/web/src/routes/Shell.module.css` (`.sidebar`,
  `.colapsado .sidebar`, `.trilha*`), `apps/web/src/lib/sidebar-state.ts`
  (`lerColapsado`/`gravarColapsado`)
- **Тест:** `apps/web/src/lib/sidebar-state.test.ts` (describe "colapso"),
  `apps/web/src/routes/Shell.test.tsx`
- **Источник:** ПРОГРАММА 28, Волна 2, фронт B —
  `design_handoff_brabo/README.md`, раздел "Navigation shell"

### RN-196 — Раскрываемые проекты показывают вкладки проекта, N одновременно {#rn-196}

Каждый проект в боковой панели получает шеврон: клик по нему раскрывает
строку и показывает список вкладок этого проекта (Visão geral, Executores,
Criativo, Chat, Code, Backlog, Aprovações, Insights, Gastos, Configurações),
каждая — ссылка на `/projects/$projectId?tab=<chave>`. Несколько проектов
могут быть открыты одновременно — состояние является `Set<string>` из id,
сохраняемым в `brabo.sidebar.open`.

Список вкладок и метки берутся из `ABAS_DO_PROJETO`
(`apps/web/src/routes/project-tabs.ts`, владелец — фронт C, работающий
параллельно в этой же волне) — боковая панель только **читает**
экспортированный массив, никогда не переписывает имена вкладок.
**Предположение о форме**, для сверки с тем, что сдал фронт C: у
`AbaDoProjeto` есть `key: string`, `label: string` и
`count?: (contagens: ContagensDeAba) => number | undefined`, где
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`. Боковая панель может бесплатно заполнить только
`aprovacoesPendentes` (`pendingApprovalsCount` уже приходит в сводке панели,
[RN-151](#rn-151)); `promocoesPendentes`/`hipotesesPendentes` входят как
`0` — их вычисление потребовало бы нового запроса НА КАЖДЫЙ ОТКРЫТЫЙ проект
в боковой панели, тот же класс N+1, который RN-090/091 закрыли на панели.
Оба значка остаются верными в рамках правила самой `ProjectPage`; частичен
только предпросмотр в боковой панели, и это намеренное упущение, а не баг.

Проект ТЕКУЩЕГО маршрута всегда показывается раскрытым
(`projetosAbertosEfetivo`), даже не находясь в сохранённом `Set`, —
«бесплатное» открытие через маршрут ничего не записывает; в
`brabo.sidebar.open` попадает только явный клик по шеврону.

**Начиная с [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404) этот список — ЕДИНСТВЕННАЯ навигация проекта:** вертикальная полоса
ушла, и он получил всё, что было только у неё, — три группы с заголовками,
отмеченную активную вкладку, вертикальный `tablist`, названный по проекту,
клавиатуру (`ArrowDown`/`ArrowUp`/`Home`/`End` с переходом по кругу, сквозь
группы) и ПЯТЬ счётчиков, каждый на своей вкладке и никогда не суммируемые.
Намеренное упущение выше остаётся в силе для ЗАКРЫТОГО проекта и для
открытого проекта вне рамки (например, на экране Сессии): только Aprovações,
из сводки. При смонтированной рамке проекта пять чисел берутся из ТОГО ЖЕ
hook, что использует она (`useContagensDoProjeto`), без нового запроса. В
свёрнутом виде квадрат открытого проекта открывает flyout с теми же
вкладками.

- **Где:** `apps/web/src/routes/Shell.tsx:557` (`projetosAbertosEfetivo`),
  `:505` (`useContagensDoProjeto`), `:512` (`irParaAba`), `:527`
  (`flyoutAberto`), `:215` (`contagensDoResumo`);
  `apps/web/src/routes/AbasDoProjeto.tsx:78` (`AbasDoProjeto`), `:34`
  (`itensDasAbas`), `:95` (`aoTeclar`);
  `apps/web/src/lib/contagens-do-projeto.ts:22` (`useContagensDoProjeto`),
  `:70` (`publicarAbaAtiva`), `:86` (`pedirAba`);
  `apps/web/src/lib/sidebar-state.ts` (`lerProjetosAbertos`/`gravarProjetosAbertos`)
- **Тест:** `apps/web/src/lib/sidebar-state.test.ts` (describe "conjuntos"),
  `apps/web/src/routes/Shell.test.tsx` (describe "Shell — abas do projeto
  aberto (ADR 0211)": 12 вкладок, пять раздельных счётчиков, активная, клик и
  стрелка, выполняющие навигацию, свёрнутый flyout, выдвижная панель на
  телефоне и случай сбоя — без смонтированной рамки только число из
  сводки),
  `apps/web/src/routes/AbasDoProjeto.test.tsx` (группы, активная, счётчики,
  клавиатура, roving tabindex, ссылка по проекту), `apps/web/src/routes/project-tabs.test.tsx`
- **Источник:** ПРОГРАММА 28, Волна 2, фронт B; ADR 0211 (AT-404)

### RN-197 — Два цвета проекта, два назначения: идентичность — не статус {#rn-197}

Handoff просит «цветную точку проекта» в раскрытой строке и тот же принцип
цвета в свёрнутой полосе. В продукте там уже была точка — `NavStatusDot`, —
но это **статус** (бюджет/недавняя активность, выводимый без собственного
запроса из `useProjectsSummary`/`useProjectsStatus`, RN-039), а не
идентичность: её цвет МЕНЯЕТСЯ со временем.

Решение, задокументированное, а не разрешённое: раскрытая строка
по-прежнему показывает только `NavStatusDot` (это действенная информация;
дублирование второй точкой рядом было бы шумом). Цвет ИДЕНТИЧНОСТИ —
стабильный для проекта, детерминированный хэш id по фиксированной палитре
токенов (`corDoProjeto`, без новой таблицы, та же идея, что
`AGENTS[key].color`), — появляется только в свёрнутой полосе, как рамка
квадрата с инициалами, где нет места для двух точек и где именно
идентичность (а не статус) помогает найти нужный проект среди нескольких
похожих квадратов.

Точно так же handoff просит «бейдж с общим числом последних итераций» у
проекта; продукт использует `pendingApprovalsCount` начиная с RN-151, которая
позже handoff и решает реальный дефект (число, не соответствовавшее ничему
действенному при клике). Этот бейдж **не меняется** — RN-151 продолжает
действовать, и здесь расходится handoff.

- **Где:** `apps/web/src/lib/sidebar-state.ts` (`corDoProjeto`),
  `apps/web/src/routes/Shell.tsx` (`NavStatusDot`, комментарий о
  расхождении)
- **Тест:** `apps/web/src/lib/sidebar-state.test.ts` (describe "corDoProjeto")
- **Источник:** ПРОГРАММА 28, Волна 2, фронт B — расхождение между
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` и RN-151

### RN-198 — Atividades группирует по РЕАЛЬНОМУ базовому агенту/экземпляру, никогда по выдуманному счётчику {#rn-198}

Раздел Atividades боковой панели — та же логика группировки, что у
`AgentTimelineTree.tsx`/`timeline-tree.ts` (уже используемая в Visão geral
проекта), перенесённая в новое место, — не переписанная. `montarArvore` уже
группирует по `evento.actor.id`; новое — `agruparPorInstancia`
(`apps/web/src/lib/timeline-tree.ts`), которая решает, какие ветви образуют
визуальную группу из двух уровней.

«Экземпляр» — это не перенумерованный счётчик (`-01`/`-02`), а РЕАЛЬНЫЙ
`agent_id`, который продукт уже пишет: `devAgentId`/`extraDevAgentId`
(`apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:27-38`)
производят `dev-<modulo>` и `dev-<modulo>-2` (суффикс всегда ровно `-2`,
потому что потолок — ДВА на модуль, [RN-154](#rn-154)). Ветвь становится
«дополнительным экземпляром» другой, только если у базового агента (без
суффикса) ТОЖЕ есть ветвь в том же списке, — иначе это сам агент. Агент с
одним экземпляром открывается сразу на событиях; с двумя — показывает второй
уровень, по строке на экземпляр, каждая со своим счётчиком, —
переиспользуя `getAgentLastSeenSeq`/`setAgentLastSeenSeq` (`read-state.ts`),
которые уже существовали для счётчика новизны дерева.

Рамки: только проект ТЕКУЩЕГО маршрута (`pathname`), а не все проекты
workspace — агрегирование всех потребовало бы запроса событий НА КАЖДЫЙ
проект, тот же класс N+1, который RN-090/091 закрыли на панели.
Переиспользует ТУ ЖЕ пару hooks, что уже используют
`AgentTimelineTree`/`SessionPage` (`useActiveExecutionSession` +
`useSessionEvents`, тот же `queryKey`), — ноль новых запросов, когда оба
экрана смонтированы вместе.

То, что открыто/закрыто, сохраняется в `brabo.sidebar.agents`, с форматом
handoff, адаптированным к реальным id: `agenteBase` (открытая группа,
например `dev-backend`) или `${agenteBase}/${instancia}` (открытый конкретный
экземпляр, например `dev-backend/dev-backend-2`).

- **Где:** `apps/web/src/lib/timeline-tree.ts` (`agruparPorInstancia`,
  `GrupoDeAgente`), `apps/web/src/routes/Shell.tsx:237-311`
  (`GrupoDeAtividade`, `InstanciaDeAgente`), `apps/web/src/routes/Shell.tsx:376-399`
  (рамки и сохранение)
- **Тест:** `apps/web/src/lib/timeline-tree.test.ts` (describe
  "agruparPorInstancia"), `apps/web/src/lib/sidebar-state.test.ts`
- **Источник:** ПРОГРАММА 28, Волна 1/фронт B0 (находка, без кода) и Волна
  2/фронт B (реализация)

### RN-199 — Кнопка темы в подвале, работающая в свёрнутом виде {#rn-199}

Подвал боковой панели получает кнопку солнце/луна, которая потребляет API
`apps/web/src/lib/tema.ts` из Волны 1/фронта A (`temaAtual`,
`alternarTema`, `observarTema`), ничего не переписывая, — нова только
КНОПКА. Работает в свёрнутом виде (62px): текстовая метка исчезает, но
`aria-label`/`title` продолжают описывать текущую тему, а клик продолжает
переключать.

- **Где:** `apps/web/src/routes/Shell.tsx:130-148` (`BotaoDeTema`)
- **Тест:** `apps/web/src/lib/tema.test.ts` (API, не изменённый этой RN)
  — `Shell.test.tsx` не дублирует набор тестов темы, а только монтирует Shell
- **Источник:** ПРОГРАММА 28, Волна 2, фронт B

### RN-200 — Глобальные элементы — только Projetos и Atividades {#rn-200}

Два элемента без маршрута в подвале навигации ("Chat global"/"Configurações",
`title="em breve"`) уходят. Handoff явно говорит: ГЛОБАЛЬНЫЕ элементы —
только Projetos и Atividades, всё остальное привязано к проекту.
"Configurações" продолжает существовать как ВКЛАДКА проекта
([RN-196](#rn-196)) внутри раскрытой строки — уходит отдельный элемент без
назначения.

- **Где:** `apps/web/src/routes/Shell.tsx` (блок `.globalNav`/
  `.inertNavItem` из ФАЗЫ 17a удалён, без глобальной замены)
- **Тест:** `apps/web/src/routes/Shell.test.tsx` (describe "sem itens
  globais inertes")
- **Источник:** ПРОГРАММА 28, Волна 2, фронт B —
  `design_handoff_brabo/README.md`, раздел "Navigation shell"

### RN-201 — Активные проект/вкладка сохраняются между страницами; сворачивание боковой панели — ТОЛЬКО по воле пользователя {#rn-201}

Два финальных ключа handoff: `brabo.project` (активный проект) и
`brabo.tab` (активная вкладка) — записываются, когда пользователь кликает по
ссылке вкладки
В БОКОВОЙ ПАНЕЛИ (`LinhaDeAba`/ссылка имени проекта). `?tab=` в URL
действует только как НАЧАЛЬНАЯ глубокая ссылка (`project-tabs.ts`, ФАЗА 24) —
смена вкладки внутри `ProjectPage.tsx` является локальным состоянием и не
пишет в URL после первой загрузки, так что эти ключи — единственный способ,
которым предпочтение переживает переход от одной навигации к другой. **Эта
половина никогда не менялась.**

**Автосворачивание вкладки Código УШЛО (ADR 0126).** До сих пор вкладка
Código сама сворачивала боковую панель, чтобы дать ширину редактору, не
записывая предпочтения: `AutoCollapseContext`/`useAutoCollapseSidebar` в
`sidebar-state.ts`, регистрируемые `ProjectCodeTab.tsx` (единственным
вызывающим) и складываемые через OR с ручным сворачиванием внутри `Shell`.
Контекст, hook, состояние `autoColapsado`, `Provider` вокруг `<Outlet />` и
`disabled` кнопки сворачивания — существовавший только для защиты этого
пути — были удалены.

Причина структурная: при всегда присутствующей вертикальной полосе проекта
(`routes/ProjectRail.tsx`, удалённой в ADR 0211) сохранение автосворачивания
поставило бы полосу иконок Shell вплотную к полосе проекта — ДВЕ смежные
вертикальные полосы, постоянные, на самой тяжёлой вкладке продукта.

Что начинает действовать: **сворачивание боковой панели — решение
ПОЛЬЗОВАТЕЛЯ, и только его.** Оно остаётся ручным, остаётся сохранённым в
`brabo.sidebar.collapsed` ([RN-195](#rn-195)), и ни один экран не сворачивает
боковую панель сам.

**Цена, принятая и объявленная:** вкладка Código начинает открываться с
РАЗВЁРНУТОЙ боковой панелью (264px) + полосой проекта (180px) + полосой
самого `CodeShell` (48px) — 492px рамки до первого символа кода, ИЗМЕРЕННЫХ в
браузере, против ~110px раньше (62px свёрнутой боковой панели + 48px полосы
Código). Ручное сворачивание по-прежнему возможно и по-прежнему даёт полосу
Shell рядом с полосой проекта — разница в том, что теперь выбрал
пользователь, а не система.

**Пересмотрено [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404):** полоса проекта ушла, и рамка вкладки Código стала **312px** при
развёрнутой боковой панели (264 + 48 у `CodeShell`) и **110px** в свёрнутом
виде (62 + 48) — без двойной полосы ни в одном из случаев. Сворачивание
остаётся только за пользователем. Активная вкладка, которую отмечает боковая
панель, берётся из рамки проекта (`publicarAbaAtiva`), а не только из
`brabo.tab`.

- **Где:** `apps/web/src/lib/sidebar-state.ts:80-105`
  (`lerProjetoAtivo`/`gravarProjetoAtivo`, `lerAbaAtiva`/`gravarAbaAtiva` и
  комментарий, фиксирующий удаление), `apps/web/src/routes/Shell.tsx:366-369`
  (остался только `colapsadoManual`), `apps/web/src/routes/ProjectCodeTab.tsx`
  (ни одного вызова сворачивания)
- **Тест:** `apps/web/src/lib/sidebar-state.test.ts` (describe "projeto e
  aba ativos"), `apps/web/src/routes/Shell.test.tsx` (describe "Shell —
  colapso da sidebar": предпочтение рождается только из клика по кнопке и
  всегда записывается). Describe "useAutoCollapseSidebar" удалён вместе с
  hook.
- **Источник:** ПРОГРАММА 28, Волна 2, фронт B —
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md`, раздел 1; половина
  автосворачивания пересмотрена
  [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md)
### RN-202 — Вкладка `sessions` остаётся "Chat", никогда не "Chat RAG" {#rn-202}

Самый свежий дизайн-handoff ПРОГРАММЫ 28 называет консультативную вкладку
"Chat RAG" (`designs/Brabo Chat.dc.html`), но в продукте нет такой
функциональности: нет конвейера индексации по проекту, нет векторного
индекса, нет UI цитирования источника. ADR 0075 поместил `embed` в контракт
`LLMProvider` — операция существует и ДОКАЗАНА на Ollama, — но ничто её пока
не ПОТРЕБЛЯЕТ. Сегодняшняя вкладка `sessions` — обычный консультативный Chat
из [RN-104](../business-rules.md#rn-104): агент, отвечающий с контекстом
сессии, не производящий backlog, без какого-либо RAG за ним.

Пометить вкладку "Chat RAG" сегодня означало бы объявить несуществующую
возможность — та же ошибка, которую
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
уже отвергает для модели каталога («не активировать обнаруженную модель
автоматически»). Метка меняется в день, когда придёт функциональность, вместе
с данными за ней, — никогда раньше.

- **Где:** `apps/web/src/routes/project-tabs.ts:144` (запись `key:
  'sessions'`)
- **Тест:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — Handoff — визуальный ориентир, а не потолок числа вкладок продукта {#rn-203}

Дизайн-handoff перечисляет 7 вкладок проекта (Visão geral, Criativo, Código,
Chat RAG, Gastos, Aprovações, Configurações); реестр
(`apps/web/src/routes/project-tabs.ts`) содержит 10. Три лишние —
`executores` ([RN-121](../business-rules.md#rn-121)), `backlog`
([RN-048](../business-rules/custo.md#rn-048)) и `insights` (гипотезы
Psicólogo, ожидающие решения), — родились ПОСЛЕ того, как был нарисован
handoff, все с реальными данными, счётчиком, выведенным из запроса, и как
минимум одной собственной RN с тестом.

Handoff фиксирует, как каждый экран должен ВЫГЛЯДЕТЬ, — цвета, типографику,
отступы, рисунок рамки, — и эта часть была строго соблюдена в этом же
изменении (заголовок, линейка, прокрутка, ширина содержимого). Он не
замораживает инвентарь вкладок на день, когда был написан. Удаление трёх ради
«совпадения» с handoff уничтожило бы информацию, которую продукт уже умел
показывать, по неверной причине.

- **Где:** `apps/web/src/routes/project-tabs.ts:91` (`REGISTRO`)
- **Тест:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
### RN-210 — «Рекомендуемая» — это реальное использование и стоимость, никогда не вычисленная оценка {#rn-210}

Блок "Melhores modelos por capacidade" (Configurações) не имеет колонки
оценки. Handoff показывает оценку по возможности (код 9.4, изображение
9.1…), но это ВЫМЫШЛЕННЫЕ данные макета — ни один провайдер не публикует
«качество кода», и продукт нигде этого не измеряет. Вычисление числа здесь
было бы той же «догадкой, одетой в данные», которую
[ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
запрещает для capability МОДЕЛИ, теперь применительно к качеству.

Вместо этого «рекомендуемая»/«альтернатива» выводятся из двух реальных
сигналов среди моделей, которые курирование ЭТОГО workspace отметило для
данной возможности (`uses`, [RN-057](../business-rules/custo.md#rn-057)):
сначала наиболее используемые агентами ЭТОГО проекта — тот же каскад, что
разрешает действующий binding каждого агента, — с ценой (из каталога, по
возрастанию) как разрешением ничьей. «То, что команда уже выбрала» — самый
честный доступный сигнал без выдумывания оценки. Возможность без какой-либо
курированной модели показывает "sem cobertura curada" — никогда не скрывает
строку, тот же шаблон, что колонка Origem в `ModelsSection` уже использует для
пропущенного binding.

- **Где:** `apps/web/src/routes/settings/MelhoresModelosPorCapacidadeSection.tsx`
- **Тест:** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  (describe "MelhoresModelosPorCapacidadeSection")
- **ADR:** [0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — Расход по провайдеру на экране — это Ranking, а не выдуманная категориальная палитра {#rn-211}

Handoff просит ежедневные столбцы, сложенные по провайдеру, и разбивку по
провайдеру. Skill dataviz репозитория требует проверять категориальную
палитру скриптом перед использованием, никогда на глаз: `validate_palette.js`
проваливает каждую комбинацию из 3+ токенов `design/tokens.css` хотя бы в
одной из двух тем — `--accent`+`--violet` — единственная пара, проходящая в
обеих (несколько `--syntax-*` буквально тот же hex, что
`--warning`/`--violet`/`--success`, измерено). При 9 провайдерах (ADR 0043) и
2 проверенных цветах зацикливание палитры — анти-шаблон, который сама skill
называет ("a 9th series is never a generated hue"), а выдумывание нового hex
нарушило бы инструкцию этого фронта. Разбивка по провайдеру становится
`Ranking` — той же деталью, что "Por modelo"/"Por projeto"/"Por agente e
pessoa", без идентичности по цвету. ЕЖЕДНЕВНЫЙ ряд по провайдеру не
поставляется: `sumGroupedBy` (ADR 0076) группирует по одному измерению за
раз, и в backend этой волны нет перекрёстной агрегации день×провайдер.

- **Где:** `apps/web/src/lib/spend.ts` (блок "Gasto por PROVIDER na
  tela"), `apps/web/src/routes/ProjectSpendTab.tsx` (`GastoDoWorkspace`)
- **Тест:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "a
  audiência do owner" — `'mostra os cinco recortes do workspace,
  incluindo provider'`)
- **ADR:** [0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — Блок «по проекту» — это TokenMeter, подключённый к реальному бюджету {#rn-212}

Вкладка Gastos получает блок по ПРОЕКТУ (а не по аудитории):
`OrcamentoDoProjeto` читает `GET /projects/:id/budget` и подаёт результат
прямо в существующий `TokenMeter`, который уже реализует пороги 70/90
(`tokenThreshold`), — ни одного нового компонента. Три прочтения: загрузка
(тихо, чтобы не мигать до того, как роль разрешит нижнюю аудиторию), бюджет
не задан (заметка текстом, без CTA) и ошибка (тихо — на практике почти
всегда 403 у того, у кого есть роль WORKSPACE, но кто не `maintainer` в
ПРОЕКТЕ, и показ баннера был бы ложной тревогой для большинства участников,
тот же шаблон, что уже используется компактным `TokenMeter` в
`ProjectPage.tsx`).

- **Где:** `apps/web/src/routes/ProjectSpendTab.tsx`
  (`OrcamentoDoProjeto`)
- **Тест:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-213 — Предупреждение о расходе — это чтение `lastThresholdNotified`, никогда не пересчёт {#rn-213}

`alertaDeOrcamento` не реализует заново `crossedThresholds`
(`apps/api/src/domain/llm/budget-threshold.ts`): он читает поле, которое
backend уже записывает в момент, когда реальный вызов пересекает 70/90/100%,
и решает только цвет (`warning` ниже 90, `danger` от 90) и должен ли текст
предупреждать об активной блокировке (`policy === 'block' && spentMicros >=
limitMicros`). Никакого нового бизнес-правила — чистое представление уже
существующих данных.

- **Где:** `apps/web/src/lib/spend.ts` (`alertaDeOrcamento`)
- **Тест:** `apps/web/src/lib/spend.test.ts` (describe "alertaDeOrcamento
  (RN-213)"); `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-214 — KPI экономии с локальной моделью исключён из-за отсутствия контрфактической цены {#rn-214}

У `TokenMeter` уже есть `savingsBRL`/`savingsPct`, готовые принять число, и
они намеренно остаются без данных. Карточка потребовала бы
КОНТРФАКТИЧЕСКОЙ цены — сколько тот же вызов стоил бы в платной модели, —
которой нет нигде в продукте: каталог (ADR 0042) замораживает только цену
РЕАЛЬНО использованной модели (RN-044), и нет объявленного соответствия
«локальная модель X ~ платная модель Y». Выдумать его здесь было бы тем же
классом «оценки, одетой в данные», который RN-210 уже отвергла для рейтинга
возможностей. Задолженность записана в backlog на время, когда появится
защитимая и версионированная контрфактическая цена.

- **Где:** `apps/web/src/routes/ProjectSpendTab.tsx` (комментарий "KPI de
  economia com modelos locais — CORTE DECLARADO", конец файла)

### RN-215 — Вкладка Problemas рождается с честным пустым состоянием {#rn-215}

Нет ни lint, ни интегрированных тестов над кодом управляемого проекта;
вкладка Problemas нижней панели (handoff `design_handoff_brabo`) говорит
это явно, а не показывает выдуманный счётчик (макет handoff несёт бейдж
"3"). Тот же шаблон, что уже используют Terminal (ФАЗА 25b) и отключённый
пункт "Testes" полосы.

- **Где:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Тест:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` —
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — Вкладка Saída рождается с честным пустым состоянием {#rn-216}

На этой вкладке нет потока команды build/deploy — он зависел бы от
интерактивного терминала (ФАЗА 25b), которого нет. Вкладка объясняет это и
напоминает, что `git push`/PR/deploy в любом случае не выходят через терминал
(RN-106).

- **Где:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Тест:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` — "Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — Строка состояния вкладки Código показывает только реальные данные {#rn-217}

Строка состояния высотой 24px (`CodeShell.tsx`) показывает `↑N ↓M` коммитов
текущей ветки (через `getCodeBranches`, тот же `queryKey`, что у
`CodeBranchPicker`, — дедупликация, ноль лишних запросов, RN-090/091) и язык
активного файла (`linguagemPorCaminho`). Позиция курсора и счётчик
ошибок/тестов из макета handoff остались за рамками: `CodeEditor` не
раскрывает отслеживаемое выделение/каретку, и нет интегрированных
lint/тестов (то же решение, что RN-215).

- **Где:** `apps/web/src/routes/code/CodeShell.tsx`
- **Тест:** `apps/web/src/routes/code/CodeShell.test.tsx` — "a status bar
  mostra ↑/↓ real da branch atual" и "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — Видимый фокус на собственных вкладках нижней панели {#rn-218}

Вкладки `CodeBottomPanel.tsx` — собственная реализация (не `Tabs` из design
system) и не наследовали откалиброванный `:focus-visible`, который
`Tabs.module.css` получил в Волне 2/фронте C. Исправлено по тому же
шаблону, что `Input.module.css` (ADR 0036), включая `forced-colors`.

- **Где:** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-219 — Три области индекса чанков честны и взаимоисключающи через CHECK {#rn-219}

Индекс Chat RAG покрывает только три источника текста, о которых продукт уже
знает, откуда они пришли: `docs`, `adr` и `session`. Исходный код и Pull
Requests намеренно исключены — их индексация без watcher переиндексации при
каждом `push` заставила бы индекс лгать о покрытии, тот же класс ошибки,
который ADR 0042 уже отвергает для capability модели. `session_id`/`source_path`
взаимоисключающи через CHECK, а не по соглашению приложения, тот же шаблон,
что `projects.workspace_mode`/`workspace_path` (ADR 0072): `scope =
'session'` требует `session_id` и отклоняет `source_path`; `docs`/`adr`
требуют `source_path` и отклоняют `session_id`. Замок стоит в базе, потому
что писать в эту таблицу будет конвейер (Волна 4), который не обязательно
каждый раз проходит через тот же сценарий использования.

- **Где:** `apps/api/src/db/schema/rag.ts` (`chunkScopeEnum` и два CHECK
  таблицы `chunks`)
- **Тест:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("recusa chunk de docs sem source_path — o CHECK da migração 0045, não
  validação de aplicação")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-220 — Вектор и лексический поиск живут в одной строке, никогда в отдельных таблицах {#rn-220}

`chunks.embedding` (pgvector) и `chunks.search_vector` (tsvector) — соседние
колонки ОДНОЙ таблицы, а не две таблицы, связанные `chunk_id`. Разделение
потребовало бы JOIN при каждом гибридном поиске (Волна 4) и открыло бы
возможность их расхождения — фрагмент с вектором, но без лексической записи,
или наоборот, — без какого-либо механизма базы, который бы этому мешал.
Одна строка — один источник истины для обеих половин поиска.

- **Где:** `apps/api/src/db/schema/rag.ts` (таблица `chunks`)
- **Тест:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  (все три spec пишут и читают обе колонки в одной строке)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-221 — `search_vector` никогда не пишется приложением — это колонка GENERATED {#rn-221}

`search_vector` — это `GENERATED ALWAYS AS (to_tsvector('portuguese', content))
STORED`. Ни один сценарий использования, репозиторий или скрипт в неё не
пишет — Postgres поддерживает её согласованной с `content` по построению,
готовой в той же транзакции `INSERT`, без зависимости от ответа какого-либо
провайдера LLM (в отличие от `embedding`, который приходит только когда
появится конвейер индексации).

- **Где:** `apps/api/src/db/schema/rag.ts` (колонка `search_vector`)
- **Тест:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor e devolve o search_vector gerado pela
  GENERATED ALWAYS AS")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-222 — Размерность вектора задокументирована, а не угадана, и `embedding` приходит после чанка {#rn-222}

`chunks.embedding` — это `vector(768)`, реальная размерность
`nomic-embed-text` из Ollama, единственного провайдера, который сегодня
объявляет `capabilities.embeddings:
true` (RN-191, ADR 0075). У векторного индекса ФИКСИРОВАННАЯ размерность:
смена модели embedding в будущем — это новая миграция, никогда не параметр
runtime. Колонка NULLABLE: эта таблица хранит ЧАНК (вырезанный текст), а
ВЕКТОР может прийти позже через асинхронный конвейер индексации, которого
ещё нет (Волна 4), — без этого chunking пришлось бы ждать embedding, смешивая
два сбоя разной природы (разбор документа против сетевого вызова к
провайдеру) в одной атомарной записи.

- **Где:** `apps/api/src/db/schema/rag.ts` (колонка `embedding`)
- **Тест:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor..." пишет с заполненным `embedding`;
  два других spec пишут без него, подтверждая допустимость NULL)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md); [RN-191](../business-rules/custo.md#rn-191)

### RN-223 — Векторный индекс — HNSW, а не IVFFlat, потому что таблица рождается пустой {#rn-223}

IVFFlat нужны уже загруженные строки для обучения списков (`lists`), и он
получается плохим, если построен над пустой таблицей, — а это ровно
состояние этой таблицы при рождении, ещё без конвейера индексации (Волна
4). HNSW строит граф инкрементально, вставка за вставкой, без этапа
обучения — хорош с первой строки. `vector_cosine_ops`, потому что это
метрика, которую обычно ожидают текстовые embeddings (ранжирование по
сходству не должно меняться с величиной вектора).

- **Где:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
  (`chunks_embedding_idx`)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-224 — Миграция сама создаёт расширение pgvector, идемпотентно {#rn-224}

Миграция `0045` выполняет `CREATE EXTENSION IF NOT EXISTS vector` до создания
таблицы, вместо того чтобы предполагать, что `docker/postgres/init.sql` уже
отработал, — этот файл выполняется только при ПЕРВОЙ инициализации тома
Postgres, и в окружении со старым томом расширения может не быть.
`IF NOT EXISTS` идемпотентен: локальное окружение (где расширение уже было
установлено) и новое проходят через одну и ту же строку без разницы в
поведении.

- **Где:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-225 — Миграция, которая может потребовать привилегии оператора, рождается в `breaking/` {#rn-225}

Создание расширения требует, чтобы у роли приложения был `CREATEDB` (или
чтобы расширение было помечено DBA как «trusted»). Локально роль —
суперпользователь, но ничто не гарантирует этого в production — управляемые
сервисы Postgres часто не дают приложению суперпользователя. Если миграция
там упадёт, это действие ОПЕРАТОРА перед deploy (выполнить `CREATE
EXTENSION vector;` один раз от суперпользователя), а не баг продукта, —
критерий CLAUDE.md для рождения в `breaking/` вместо
`feature/`/`bugfix/`.

- **Где:** ветка `breaking/tabela-de-chunks`,
  `apps/api/src/db/migrations/0045_shallow_randall.sql` (комментарий,
  документирующий решение внутри самой миграции)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-226 — `ChunkRepository` покрывает только базовые запись/чтение; `createMany` — пакетная операция {#rn-226}

У порта есть только `create`, `createMany`, `findById` и `listByProject` —
гибридный поиск (вектор + лексика, веса, порог) относится к Волне 4 (G2) и
намеренно СЮДА НЕ входит: порт хранит данные, сценарий использования решает,
что с ними делать. `createMany` существует, потому что индексация нарезает N
фрагментов документа/сессии разом, избегая N походов на каждый
индексируемый документ.

- **Где:** `apps/api/src/application/ports/chunk-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Тест:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("createMany grava um lote e listByProject filtra por escopo, sem
  misturar docs e session")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-227 — Значок статуса сессии покрывает 5 реальных состояний, а не 4 из handoff {#rn-227}

Handoff просит 4 значка (активна/ожидает/закрыта/прервана) для 5 реальных
состояний машины (`created/active/closing/closed/closed_abnormally`).
`closed_abnormally`→прервана и `created`→ожидает — прямые. `closing` НЕ
сливается с «закрыта»: он получает собственный значок («завершается», тон
`accent`, пульсирующий), потому что в `closing` исход (`closed` или
`closed_abnormally`) ещё неизвестен — назвать её «закрытой» значило бы
солгать об этом.

- **Где:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`SELO_DO_STATUS`)
- **Тест:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — Фильтр-плашка группирует 2 состояния без собственной плашки по ТРАЕКТОРИИ {#rn-228}

Фильтры-плашки handoff (все/активные/закрытые/прерванные) покрывают только 4
из 5 состояний. `created` (ожидает) входит в плашку "Ativas" — ещё никуда не
пришла, это «сессия в игре». `closing` входит в плашку "Fechadas" — уже на
пути к закрытию без ошибки. ЗНАЧОК каждой строки (RN-227) никогда не
переписывается фильтром; плашка лишь группирует.

- **Где:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`correspondeAoFiltro`)
- **Тест:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — KPI «стоимость месяца» вкладки Criativo — это расход АКТОРА, а не итог проекта {#rn-229}

Переиспользует `getMySpend(projectId, 30)` — ТОТ ЖЕ queryKey, что
`ProjectSpendTab.tsx#MeuConsumo` использует для представления участника
(RN-101, ADR 0063), без новой агрегации. НИКОГДА не показывает итог проекта,
суммирующий всех (`porProjeto` в `getWorkspaceSpendReport`), потому что эти
данные только для owner, а вкладку Criativo видит любой участник проекта, —
показ общего итога раскрыл бы чужие расходы тому, кому RN-060/101 не
разрешает их видеть.

- **Где:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Тест:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "KPIs da aba Criativo", случаи "caminho feliz" и "CASO DE FALHA"

### RN-230 — KPI «доля идеация → commit» объявлен отсутствующим, никогда не вычисляется {#rn-230}

Нигде в продукте нет связи между творческой сессией и коммитом, который она
произвела. Вкладка Criativo показывает «—» с фразой "não medido: sessão não
é vinculada a commit hoje" вместо выдумывания вычисления — тот же класс
ошибки, который ADR 0042 уже отвергает для оценки модели.

- **Где:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Тест:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — "'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"
