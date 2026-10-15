---
traducao_de: 108d81cc745edfc5d09ee2d41c473e37736f3186
---

# ADR 0137 — `brabo-runner` поднимает контейнер проекта на машине пользователя

## Контекст {#context}

Затвор образа (RN-105) начал действовать в ТРЁХ режимах исполнения начиная с
RN-494 (ADR 0135): `mounted`/`runner` нуждаются в решённом
`artifact.project_image`, чтобы открылась вкладка Code, ровно как `container`.
То, что RN-494 оставила объявленным, прямым текстом: «не поднимается сам
контейнер — у `mounted`/`runner` по-прежнему нет собственного контейнера на
сервере». Это PR, закрывающий ту половину, но не со стороны СЕРВЕРА — со
стороны ПОЛЬЗОВАТЕЛЯ.

Сегодня проект в режиме `runner`/`mounted` выполняет КАЖДУЮ команду терминала
прямо на машине пользователя (`child_process`, без какой-либо изоляции) — тот
же `brabo-runner`, который уже держит канал Phoenix `terminal:<projectId>`
(ADR 0103/0104) и уже умеет ГОВОРИТЬ с СВОИМ Docker (`@brabo/docker-port`,
доказано `--self-test-docker` начиная с ADR 0128, до сих пор без реального
потребителя). Broker (`apps/broker`, ADR 0130) уже даёт эту изоляцию режиму
`container`, поднимая контейнер на СЕРВЕРЕ, — но он НИКОГДА не поднимет
контейнер для `mounted`/`runner`: их код живёт в папке ПОЛЬЗОВАТЕЛЯ, которую
сервер не видит (`ModoDeExecucaoNaoSuportadoError`,
`apps/broker/src/operacoes.ts`). Единственный процесс, видящий эту папку, —
сам runner, на машине того, у кого эта папка.

## Решение {#decision}

**`container_start`/`container_stop`/`container_remove` получают ВТОРОЙ путь
исполнения, ветвящийся по `executionMode` проекта, — `container` по-прежнему
идёт через broker, `mounted`/`runner` начинают просить ПОДКЛЮЧЁННЫЙ runner,
через ТОТ ЖЕ уже существующий канал Phoenix.**

### Переиспользование пары exec/exec_result, трижды {#reuso-do-par-execexec_result-três-vezes}

`apps/runner/src/channel.ts` уже имел точный образец для «сервер просит что-то
у runner, runner отвечает, корреляция по `ref`, с таймаутом»:
`exec`/`exec_result` со стороны runner; `Engine.Runners.RunnerRouter.exec/4` +
`EngineWeb.TerminalChannel` (`handle_info({:dispatch_exec, ...})` +
`handle_in("exec_result", ...)`) со стороны engine. Этот PR ПОВТОРЯЕТ этот
образец трижды — никогда не изобретает новый:

- `container_start`/`container_start_result`
- `container_stop`/`container_stop_result`
- `container_remove`/`container_remove_result`

Со стороны engine `RunnerRouter` получает `start_container/3`,
`stop_container/3` и `remove_container/3`, вынесенные поверх общего приватного
`dispatch/5` (три различались лишь атомом события и атомом результата —
`exec/4` сохраняет собственный код, не трогается). `TerminalChannel` получает
четыре `handle_info({:dispatch_container_*, ...})` (`despachar_pedido/6`,
общий шаблон с `dispatch_exec`) и три `handle_in("container_*_result", ...)`
(`responder_pedido_pendente/3`, который также начинает обслуживать
`exec_result` — тот же `pending_execs`, обобщённое отображение ref→from,
которое не знает и не должно знать, КАКОЙ запрос ожидает).

Со стороны runner `channel.ts` получает три типа сообщений +
`enviarContainerStartResult`/`Stop`/`Remove`; `RunnerChannelHandlers`
получает `onContainerStart`/`onContainerStop`/`onContainerRemove`;
`index.ts` получает `tratarContainerStart`/`Stop`/`Remove`, которые вызывают
`DockerViaCli` — ТОТ ЖЕ порт, что использует broker со стороны сервера
(`packages/docker-port`, ADR 0130), с Docker ПОЛЬЗОВАТЕЛЯ.

### Новый HTTP-путь: api → engine → runner {#o-caminho-http-novo-api--engine--runner}

`ApiToEngineClient` (порт, который api уже использует для
`executeTerminalAction`, синхронно) получает
`startContainerViaRunner`/`stopContainerViaRunner`/`removeContainerViaRunner`.
`EngineWeb.ContainerCommandController`
(`POST internal/projects/:projectId/containers/{start,stop,remove}`) —
единственный вызывающий со стороны engine: он передаёт в `RunnerRouter` и
никогда не пишет `project_containers` (пишет по-прежнему
`RegistrarTransicaoDeContainerUseCase`, со стороны api, после того как вызов
вернулся).

**Ответ engine ВСЕГДА 200** — та же дисциплина, что у
`ActionCommandController`/`ExecutarComandoNoContainerUseCase` (ADR 0134):
`sucesso: false` в ТЕЛЕ, никогда HTTP-статус ошибки, для двух причин, которые
являются НОРМАЛЬНЫМ отказом, — нет подключённого runner/таймаут
(`motivoCodigo`) и runner попытался и отказал (Docker недоступен на машине
пользователя, неверная спецификация). `HttpApiToEngineClient` бросает
`RunnerNaoConectadoError` только в первом случае и
`RunnerRecusouContainerError` во втором — три use case ловят ОБА вместе (то же
рассуждение, что `BrokerRecusouError`/`BrokerIndisponivelError`) и записывают
`failed` с причиной, никогда не позволяя распространиться.

### Образ: ЧИТАЕТСЯ, никогда не ВЫБИРАЕТСЯ заново {#a-imagem-lida-nunca-eleita-de-novo}

`ExecuteContainerStartUseCase` (ADR 0133) выбирает образ-кандидат из
маршрутизации Arquiteto и выпускает новую версию `artifact.project_image`
(`DecidirImagemDoProjetoUseCase`, `decidedBy: 'infra-lead'`) ДО того, как
попросить broker поднять, — это специфично для пути `container`, и путь
`mounted`/`runner` НЕ повторяет этот шаг. Он лишь ЧИТАЕТ ДЕЙСТВУЮЩЕЕ решение
через `ObterSpecDeContainerUseCase` — ТОТ ЖЕ use case, который уже составляет
`GET .../container-spec` для broker (ADR 0130), вызываемый НАПРЯМУЮ, без HTTP,
потому что `ExecuteContainerStartUseCase` и `ObterSpecDeContainerUseCase`
работают в одном процессе api. Без решённого образа (RN-105) падает ДО того,
как спросить engine, — тот же затвор, что уже действует для трёх других частей
продукта.

Payload, едущий к runner (`EspecificacaoDeContainerParaRunner`), — ТЕ ЖЕ поля
`EntradaDeEspecificacao` (`packages/docker-port`) МИНУС `raizDoProjeto` —
runner заполняет это поле сам, через `estado.dir`. Это не экономия трафика:
это решение, что НИ ОДИН путь хоста не едет от сервера к runner, по той же
причине, по которой ни один не едет от сервера к broker (`apps/broker`,
ADR 0130), — НАСТОЯЩИЙ путь знает тот, кто находится на машине.

### `Engine.Actions.TerminalExecutor` НЕ получил нового выхода {#engineactionsterminalexecutor-não-ganhou-saída-nova}

Находка, подтверждённая чтением кода: `decisao_de_execucao/1` уже
БЕЗУСЛОВНО маршрутизирует каждую команду ПРОВЕРЕННОГО и ПОДКЛЮЧЁННОГО проекта
`runner` в `RunnerRouter.exec/4` (RN-423, ADR 0104) — он не спрашивает «есть
контейнер?», только «есть runner?». Решение «выполнить на хосте или внутри
поднятого мной контейнера» ВНУТРЕННЕЕ для runner, а не для engine, и поэтому
engine не нужно знать о его существовании.

Меняется только `apps/runner/src/index.ts`: `EstadoDoRunner` получает
`containerAtivo: string | null` (ИМЯ контейнера, который поднял ЭТОТ runner, —
`brabo-<workspaceDirName>` — или `null`); `tratarExec` начинает проверять это
поле — с активным контейнером выполняет через `DockerViaCli.exec(nome, {
comando, cwd })`; без него — по привычному пути (`executarComando` прямо на
хосте). `cwd` (уже проверенный `validarCwdDentroDaRaiz` против корня проекта)
переводится внутрь `/work` заменой ПРЕФИКСА
(`cwdParaContainer(raiz, cwd, pontoDeMontagem)`, `guard.ts`) — то же
рассуждение, что `cwd_para_container/2` со стороны engine (RN-492, ADR 0134):
корень становится точкой монтирования, остаток пути тот же.

`containerAtivo` переживает переподключения канала (он часть `estado`,
сохраняемого через `while` в `main()`) — сам Docker-контейнер не падает, когда
падает WebSocket, и runner не должен «забывать» о нём из-за переподключения.

### `guard.ts`/RN-434 уже покрывает монтирование, без нового кода {#guardtsrn-434-já-cobre-o-mount-sem-código-novo}

Исходный план зафиксировал вопрос: нужна ли bind-mount контейнера вторая
проверка «валидного пути монтирования»? **Подтверждено, что нет, чтением всего
`guard.ts`.** `estado.dir` УЖЕ является подтверждённым корнем — проверенным
`validarDirDentroDoHomeNoLinux` (RN-434, отклоняет `--dir` вне `$HOME` в
Linux) и `garantirDiretorio` (RN-435), обе при ЗАПУСКЕ CLI, ДО того как
подключится какой-либо канал или поднимется какой-либо контейнер.
Монтирование контейнера ЕСТЬ `estado.dir`, и точка — не существует (и не
должно существовать) второй проверки вроде `caminhoDeWorkspaceLocalValido` со
стороны runner. RN-434 «начинает покрывать и смонтированный путь» лишь потому,
что монтирование использует ТУ ЖЕ переменную, которую она уже проверила, а не
потому, что написано что-то новое.

## Последствия {#consequences}

**`packages/docker-port` получает РЕАЛЬНОЕ использование со стороны runner** —
раньше только доказанное `--self-test-docker` (ADR 0112/0128); теперь
`DockerViaCli.start/stop/exec` действительно вызываются, с Docker
пользователя.

**ПЯТЬ операций `DockerPort` остаются без шестой** — `start`/`stop`/
`remove`/`inspect`/`exec` остаются теми же пятью; этот PR лишь даёт им ВТОРОГО
потребителя (runner, помимо broker), никогда новое поле в спецификации.

**`mounted` получает ТОТ ЖЕ путь, что `runner`** — ветвление в трёх use case
идёт по `executionMode !== 'container'`, а не по `executionMode === 'runner'`;
`mounted` тоже начинает мочь поднимать собственный контейнер, при условии, что
есть подключённый runner (`brabo-runner` работает одинаково в обоих режимах,
RN-169/RN-421/RN-422).

**Структурная изоляция `join` (broker, ADR 0055) остаётся отсутствующей для
`mounted`/`runner`** — вектор symlink, который ADR 0055 уже фиксировал,
остаётся открытым; то, что закрывает этот PR, — ОТСУТСТВИЕ какой-либо
изоляции, а не граница столь же сильная, как на сервере. `guard.ts`
по-прежнему best-effort, по инварианту, — не пробел этого PR.

**Исключительность по `{project_id, machine_id}` остаётся отложенной**
(пробел, уже объявленный в CLAUDE.md, ADR 0104) — два runner, подключённых к
одному проекту, остаются невозможными из-за исключительности `Registry`
(`:global`), а не из-за проверки контейнера.

**Рассмотренная и отброшенная альтернатива: заново выбирать образ и на пути
`mounted`/`runner`, вызывая `DecidirImagemDoProjetoUseCase`.** Сделала бы два
пути внешне симметричными, но заставила бы payload `container_start` нести
`network`/`resources`/`rationale`, даже когда их никто не использует (runner
они не нужны: он лишь читает действующее решение). Отброшено: у пути
`mounted`/`runner` уже есть решение об образе — кто-то решил РАНЕЕ, Arquiteto
или Infra, обычным образом, — и повторный выбор здесь продублировал бы уже
существующее решение, без какого-либо нового кандидата для выбора.
