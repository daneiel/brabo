---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0096 — Настоящий SMTP в `MailSender`, за явным переключателем

- **Статус:** принят
- **Дата:** 2026-08-18
- **Предшествующий контекст:** [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
  (здесь родился `MailSender`, только пишущий в лог), [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)
  (зафиксировал «настоящий SMTP остаётся будущей конфигурацией» как принятое
  следствие), [ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md) (шаблон
  проверки секрета в production, который этот ADR повторно использует)

## Контекст {#contexto}

С Фазы 7a у `MailSender` (`apps/api/src/application/ports/mail-sender.port.ts`)
одна-единственная реализация, `LogMailSender`: подтверждение e-mail, сброс
пароля, первоначальная установка пароля (учётные записи, мигрированные из Keycloak) и уведомление о
дублирующейся регистрации никогда не покидают api — они идут только в лог. Этого хватило, чтобы
доказать поток auth от начала до конца, но оставило открытым с тех пор пункт
в `docs/explanation/backlog.md`: «Настоящий SMTP в MailSender».

Этот пункт — не новая функция, а закрытие уже зафиксированного пробела, с портом,
готовым со времён отказа от Keycloak: `MailSender.enviar(email)` не несёт
никакого мнения о транспорте, только о payload (`para`/`tipo`/`token?`/
`expiraEm?`). Настоящая работа — реализация SMTP и решение о том,
КАК её включить, не сломав тех, кто уже сегодня запускает продукт.

## Решение {#decisão}

### `nodemailer`, через чистый SMTP-транспорт {#nodemailer-via-transporte-smtp-puro}

`createTransport({ host, port, secure, auth })`. В отличие от JSON API
поверх HTTP, которые продукт интегрирует в остальном (LLM-провайдеры, поверх
чистого `node:http` — ADR 0041), SMTP — это СТРОЧНЫЙ протокол, с состоянием, MIME,
STARTTLS и несколькими механизмами AUTH. Реализовывать это вручную значило бы
заново изобретать чувствительное к безопасности колесо без какой-либо выгоды. `nodemailer` —
фактический стандарт экосистемы Node, без SDK провайдера (SES/SendGrid/
Mailgun) и без тяжёлого дерева зависимостей — ноль собственных зависимостей.

### `MAIL_TRANSPORT`: явный переключатель, никогда не вывод {#mail_transport-toggle-explícito-nunca-inferência}

`log` (по умолчанию, **включая production**) или `smtp`. Отправлять e-mail по-настоящему —
это opt-in оператора: без явного `MAIL_TRANSPORT=smtp`
поведение остаётся ровно сегодняшним, даже в production, и тот, кто уже
запускает продукт, не ломается при обновлении. У `docker-compose.prod.yml`/
`docker-compose.yml` нет никакого публичного fallback для пяти переменных
`SMTP_*`: каждая разрешается в пустую строку при отсутствии
(`${SMTP_HOST:-}`), тот же шаблон, который `AUTH_JWT_SECRET`/`BRABO_SERVICE_TOKEN`
уже используют там.

### Проверка по шаблону RN-114, с одним отличием {#validação-no-padrão-da-rn-114-com-uma-diferença}

Исходные RN-114 (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`) обрушивают boot в production,
потому что у переменной ЕСТЬ публичное значение по умолчанию для разработки, и «не пусто»
не поймало бы дефект. Здесь такого значения по умолчанию нет: `SMTP_HOST` остаётся
пустым, если никто его не задал. Линейка (отсутствует/только пробелы/значение-пример из
репозитория/неверный формат) применяется только при `NODE_ENV=production` —
вне production `MAIL_TRANSPORT=smtp` без переменных не обрушивает boot,
потому что это путь opt-in, который разработчик может тестировать против
локального SMTP (MailHog, например), ещё не определив значения.

`apps/api/src/infrastructure/mail/smtp-config.ts` (`resolverConfigSmtp`)
следует тому же формату, что `apps/api/src/infrastructure/security/
auth-key-material.ts`/`service-token.ts`: `SMTP_HOST`/`SMTP_USER`/
`SMTP_PASSWORD`/`SMTP_FROM` обязательны в production, когда режим —
`smtp`; `SMTP_HOST` дополнительно отклоняется, если равен опубликованному литералу
(закомментированному) в `.env.example`; `SMTP_FROM` должен соответствовать
`"Nome <email@dominio>"` или `email@dominio`. `SMTP_PORT` (по умолчанию `587`) и
`SMTP_SECURE` (по умолчанию `false`) — не секреты: у них значение по умолчанию ПРОДУКТА, а не
разработки, и они не проходят через линейку «обязательно в production».

Проверка выполняется внутри конструктора `SmtpMailSender`, проверяемого в
`useFactory` `AuthUseCasesModule`, — а не в нетерпеливом вызове в `main.ts`,
как четыре секрета RN-114. Отличие намеренное: `AuthUseCasesModule`
импортируется безусловно (через `AuthHttpModule`), а `useFactory`
разрешает `MailSender` во время `NestFactory.create()`, так что проверка
всё равно происходит при BOOT — просто не до него, потому что она важна лишь тогда, когда
оператор выбрал `smtp`. Это тот же дизайн, который уже использует `CREDENTIALS_MASTER_KEY`
(проверяется в конструкторе `EnvelopeEncryptionService`, проверяемого
сборкой графа providers).

### Выбор через `useFactory` {#seleção-via-usefactory}

`AuthUseCasesModule` заменяет `{ provide: MailSender, useClass: LogMailSender }`
на `useFactory`, который читает `resolverModoDeTransporte()` и создаёт
`SmtpMailSender` или `LogMailSender`. Ни один сценарий использования (`RegisterUseCase`,
`RequestPasswordResetUseCase`, `LoginUseCase`, скрипт
`migrate-keycloak-users.ts`) не меняется — все продолжают внедрять `MailSender` и
вызывать `.enviar()`.

### Тело простым текстом, никогда HTML {#corpo-em-texto-puro-nunca-html}

Порт не несёт структуры для богатого тела, а шаблонизатор был бы
поверхностью для инъекций/XSS ради выгоды, которую никто не просил. У каждого `tipo` есть
фиксированный текст на pt-BR, со ссылкой, когда это уместно, собранной из
`WEB_ORIGIN` (то же сырое чтение, которое `auth.controller.ts`/`git.controller.ts`
уже делают для redirects) + правильный веб-маршрут + `?token=`.

### Сырой токен и тело никогда не попадают в лог {#o-token-bruto-e-o-corpo-nunca-vão-para-o-log}

Та же линейка, что у `LogMailSender`: успех и сбой отправки упоминают `tipo` и
получателя, никогда токен или текст письма.

### Пробел ссылки подтверждения, закрытый заодно {#a-lacuna-do-link-de-verificação-fechada-junto}

При исследовании мест вызова перед реализацией: веб-маршрут `/definir-senha`
уже существует и обслуживает `password_reset`/`set_initial_password`
(`SetPasswordPage.tsx`), но **не было ни маршрута, ни экрана для
`email_verification`** — api уже предоставляла `POST /auth/verify-email`, и
веб-клиент (`apps/web/src/lib/auth.ts`, `verificarEmail`) уже существовал, но
без единого вызывающего. С `LogMailSender` этот пробел был невидим: ссылка
никогда не покидала лог, и никто по ней не кликал. С настоящим SMTP письмо пришло бы
с мёртвой ссылкой.

`/verificar-email?token=...` (`VerifyEmailPage.tsx`) закрывает это, повторяя
`SetPasswordPage.tsx`/`setPasswordRoute`: тот же шаблон `validateSearch` в
`router.tsx`, тот же единый ответ для несуществующей/истёкшей/уже использованной ссылки и
тот же исход — никого не авторизовывать, только здесь нет формы:
подтверждение запускается само при монтировании (пользователю нечего
заполнять), и поэтому экрану нужны три состояния RN-088
(загрузка/ошибка/успех), а не только два.

## Последствия {#consequências}

**Намеренно ничего не ломает.** Незаданный `MAIL_TRANSPORT` — в
любом окружении, включая production, — сохраняет сегодняшнее поведение
(только лог). Кто хочет настоящий e-mail, делает явный opt-in и получает
пять переменных, проверяемых при boot, когда работает в production.

**Новая production-зависимость:** `nodemailer` (+ `@types/nodemailer` как
dev dependency). Ноль собственных транзитивных зависимостей.

**Новый инфраструктурный секрет:** `SMTP_PASSWORD` — того же семейства, что
`AUTH_JWT_SECRET`/`GIT_OAUTH_STATE_SECRET` (простая переменная окружения,
проверяемая при boot), а не пользовательский секрет (не проходит через
`EncryptionService`/envelope encryption, который только для учётных данных LLM/git
по ЗАПИСИ в базе).

**Новый внешний сетевой путь** в чувствительном потоке аутентификации — RN-030
по RN-033 (защита от перечисления) остаются нетронутыми: реализация SMTP не
меняет НИ ОДНОГО места вызова и ни payload, который решают отправлять сценарии использования, — только
доставку.

**Зафиксировано, а не закрыто здесь:** нет механизма повторных попыток
для e-mail, который не удалось отправить по SMTP (таймаут, учётные данные, отклонённые
провайдером). `LoginUseCase.enviarDefinicaoDeSenha` уже намеренно проглатывал сбой
(не меняет HTTP-ответ); `RegisterUseCase`/
`RequestPasswordResetUseCase` распространяют исключение, и недоступный SMTP-провайдер
становится 500 на маршруте auth. Это уже было верно для любой синхронной реализации
`MailSender` и с этой не становится хуже — outbox/очередь отправки, если
когда-нибудь понадобится, — это отдельное продуктовое решение, вне охвата этого ADR.
