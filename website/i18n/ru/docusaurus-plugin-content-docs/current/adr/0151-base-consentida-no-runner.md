---
traducao_de: 213fbcc7470e8f4bae01648d030a1e3437751cf6
---

# ADR 0151 — Согласованная база в runner и создание папки через канал

## Статус {#status}

**Proposed.** Намеренно узкий срез: runner **на машину** остался
вне [ФАЗЫ 29](../explanation/fase-29-instalacao-de-uma-linha.md) и
объявлен областью следующей фазы, с уже выполненным измерением (см.
Consequences).

## Контекст {#context}

Продуктовое направление — пользователь выбирает проект в web и **видит, как папка
появляется** на его машине. Сегодня этого не происходит, и причина не в отсутствии
агента — `brabo-runner` уже живёт там. Дело в том, что он рождается без понятия о том, где
что живёт.

**У runner нет базы.** Единственный корень — `--dir`, разрешаемый `resolverDir`
(`apps/runner/src/guard.ts:221-227`) относительно `INIT_CWD ?? process.cwd()`; без
`--dir` корень **является cwd** (`apps/runner/src/index.ts:242-250`). `estado.dir`
(`index.ts:366-368`) — это *один* путь, в единственном числе, и именно он идёт в
`validarCwdDentroDaRaiz`, в `GerenciadorDePty`, в `cwdParaContainer` и
в `workspace_confirm` (`index.ts:725`). В `apps/runner/src/` нет ни константы, ни переменной
окружения, ни поля базы — слово встречается только в
комментариях.

**База существует, но в api, и ей запрещено спускаться.**
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts` содержит
`baseDeProjetos()` (`:68`), `dentroDaBaseDeProjetos` (`:93`) и
`segmentoSobABaseDeProjetos` (`:116`) — и тот же файл **письменно запрещает**
(`:421-438`) правилу базы входить в `caminhoDeWorkspaceLocalValido`,
потому что этот предикат выполняется при **каждом чтении**, и устаревший смонтированный проект вне
базы взорвался бы при чтении. База — это правило **создания и преобразования**.

**Есть точный прецедент родственной защиты.** `apps/runner/src/espelho-guard.ts`
родился, повторно используя три helper из `guard.ts` (`:51`), и реализует отказ от
петли по **сегменту** — `dentroDoEscopo(destino, workspace)` и
`dentroDoEscopo(workspace, destino)` (`:214`, `:223`), — никогда не голым
`startsWith`, с причиной, записанной в `:152-154`: *«`/base-outra` NÃO está dentro de
`/base`»*.

**И есть инвариант, который этот ADR не может нарушить.** Со времён
[ADR 0130](0130-broker-de-container.md) ни один абсолютный путь не пересекает
сеть: корнем владеет тот, кто выполняет, а передаётся **относительный сегмент**
плюс дискриминатор того, относительно какого корня он действует
([ADR 0144](0144-a-segunda-raiz-do-broker.md)).

## Решение {#decision}

### 1. Runner рождается с базой, согласованной в установщике {#1-o-runner-nasce-com-uma-base-consentida-no-instalador}

`install.sh` ([ADR 0150](0150-instalador-de-uma-linha.md)) согласует **одну**
базу и записывает её в локальную конфигурацию runner. Каждый проект — **подпапка**
её. `--dir` продолжает существовать и продолжает означать то, что всегда
означал, — это устаревший бинарник RN-514, и сломать его было бы `breaking/` без
выигрыша.

База **локальна**, никогда не получается по сети. Это тот же дизайн, что у broker
(ADR 0144): корень принадлежит тому, кто выполняет; сервер присылает **сегмент**.

### 2. Защита повторно использует линейку, а не копирует её {#2-a-guarda-reusa-a-régua-não-a-copia}

Проверка базы и подпапки повторно использует `semBarraFinal`, `dentroDoEscopo` и
`realpathMaisProximo` из `guard.ts` — которые экспортируются именно поэтому
(`guard.ts:33-43`, когда родился `espelho-guard.ts`), — и отказ от петли
по сегменту из `espelho-guard.ts:208-233`. **Четвёртая копия
линейки не рождается**: RN-515 уже установила это на стороне api, когда
`validarDestinoDeEspelho` повторно использовала `caminhoDeWorkspaceLocalValido`
(`apps/api/src/application/services/workspace-location.ts:132-136`) вместо того, чтобы
переписать её.

Письменно наследует ту же оговорку о TOCTOU из `guard.ts:9-31` и
`espelho-guard.ts:30-39`: это best-effort, а не граница безопасности,
которой по-прежнему являются аутентификация плюс pipeline одобрения.

### 3. Новое сообщение запрашивает создание, а подтверждение повторно использует существующее {#3-a-mensagem-nova-pede-a-criação-e-a-confirmação-reusa-o-que-já-existe}

Новая пара в канале по шаблону **запрос с ответом** (`exec`/`exec_result`,
`terminal_channel.ex:563-567` и `:737-749`), потому что запрашивающему нужно знать,
получилось ли:

- `workspace_create` — engine → runner: `projectId` и **сегмент относительно
  базы**. Никогда не абсолютный путь.
- `workspace_create_result` — runner → engine: успех с итоговым путём или
  **названная** ошибка.

Runner делает `mkdir -p`, а затем `git init` или clone. При успехе он
отправляет **уже существующий `workspace_confirm`** (`channel.ts:577-582`), и именно он
записывает — по уже построенному и протестированному пути: канал → engine → внутренний HTTP
→ `ConfirmProjectWorkspaceUseCase`, который перепроверяет лексику
(`confirm-project-workspace.use-case.ts:83`), идемпотентен (`:93-95`) и записывает
`workspaceVerifiedAt`.

Это намеренно и экономит целое направление работы: **новый маршрут записи
не рождается**, engine по-прежнему **не пишет в таблицу**, а единственный путь,
ставящий отметку `workspace_verified_at`, остаётся одним.

Запись для точности, потому что название ходило по рукам: **`workspace.verified` не
существует** в репозитории — ни события, ни сообщения, ни маршрута. Существует
событие `project.workspace_verified` (`confirm-project-workspace.use-case.ts:107`)
и столбец `workspace_verified_at`. А `workspace_confirm` — **однонаправленный**:
`terminal_channel.ex:356-373` отвечает `{:noreply, socket}` и ничего не отправляет
обратно — поэтому новую пару нельзя смоделировать на нём.

### 4. Capability объявляется, только когда реализована {#4-capacidade-declarada-só-quando-implementada}

`workspace` входит в словарь `Engine.Runners.Capacidades`
(`capacidades.ex:72`) **в той сессии, в которой входит код**, никогда раньше — урок
RN-514, где объявить `espelho`, не реализовав его, было бы ровно тем
тихим дефектом, который согласование существует, чтобы предотвратить. Неизвестное имя
по-прежнему игнорируется; требуемая и необъявленная capability по-прежнему приводит к отказу
в join с именем недостающего.

### 5. Собственный предикат, а `RunnerReadiness` остаётся байт в байт {#5-predicado-próprio-e-runnerreadiness-fica-byte-a-byte}

Два предусловия — runner подключён, база согласована — в **собственном** модуле,
по шаблону `Engine.Runners.Espelho` (`espelho.ex:82-99`). **Не** требует
контейнера: создание папки — это операция файловой системы на машине пользователя,
без контейнера, откуда можно было бы выпасть.

Соблазн и отказ записаны, и этот ADR принимает их дословно
(`espelho.ex:19-24`):

> A tentação óbvia seria `RunnerReadiness.verificar(project_id, pular_container:
> true)`. O ADR 0147 recusa isso por escrito, e a razão é mecânica: uma função
> compartilhada com flag "pula container" é precisamente o caminho pelo qual a
> terceira pré-condição cai POR ACIDENTE para o `exec` numa refatoração futura
> — e o ADR 0145 existe para ela não cair.

### 6. Это не `proposed_action` {#6-não-é-proposed_action}

Создание папки проекта, который пользователь только что запросил, — это **согласованная
конфигурация**, а не агент, просящий разрешения действовать. Ничто из этого не становится
`proposed_action`, и ни один потолок политики не получает исключения — та же линия, которую
зеркало уже установило (RN-516).

### 7. Web читает базу через runner {#7-a-web-lê-a-base-pelo-runner}

Picker создания в режиме `runner` использует `fs_list_dir`, который существует с обеих
сторон (`apps/runner/src/fs-browser.ts:53`,
`terminal_channel.ex:489`) и чей транспорт в web
(`apps/web/src/lib/fs-browser-channel.ts:66`) остался **без реального вызывающего**
со времён RN-504 — сохранён по объявленному решению в
`apps/web/src/routes/NewProjectWizard.tsx:880-882`. Он снова получает вызывающего.
Путь режима `mounted`, проходящий через api
(`GET /workspaces/:workspaceId/project-folders`), остаётся **нетронутым**.

## Что этот ADR явно отвергает {#o-que-este-adr-recusa-explicitamente}

- **Runner на машину в этой фазе.** См. Consequences: это пять независимых
  связей, и атаковать их вместе с установщиком сосредоточило бы два больших
  риска в одной фазе.
- **`RunnerReadiness` с флагом.** По цитате из решения 5.
- **Четвёртую копию линейки пути.**
- **Абсолютный путь, пересекающий сеть.** Инвариант ADR 0130.
- **Слияние этого с зеркалом.** Это разные сообщения, с разными направлениями и
  триггерами; зеркало копирует за пределы базы, а это создаёт внутри неё.

## Последствия {#consequences}

- Пользователь выбирает проект в web, и папка появляется — без терминала, без
  ручного `git init`.
- **Runner по-прежнему спарен по проекту.** Пять измеренных связей, которые
  ФАЗЕ 30 придётся преодолеть: топик `terminal:<projectId>`
  (`channel.ts:422`, `terminal_channel.ex:172`), socket id
  `runner_socket:<kind>:<project_id>:<user_id>` (`runner_socket.ex:71-73`),
  тикет, ограниченный проектом (`socket_ticket.ex:10-13`), столбец
  `runner_device_keys.project_id NOT NULL`
  (`apps/api/src/db/schema/auth.ts:325`) и имя unit
  (`servico.ts:263-265`, `:392-394`). Одна из них — migration; другая —
  `breaking/`.
- **Отзыв по-прежнему достигает `{projeto, usuário}`** (RN-520), что
  в этой фазе сохраняет текущую стоимость. Когда ФАЗА 30 объединит runner на
  машину, отзыв начнёт обрушивать **все** проекты этой машины —
  объявлено здесь, чтобы не быть обнаруженным там.
- Учётные данные git, отбрасываемые в `docker exec` в режиме `runner`
  (ADR 0130/0145), **не затрагиваются**: начальный clone этого сообщения выполняется на
  **ХОСТЕ**, по пути, несущему учётные данные. Пробел остаётся там, где был.
