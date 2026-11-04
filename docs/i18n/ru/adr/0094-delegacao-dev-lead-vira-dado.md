---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0094 — Делегирование Dev Lead → dev становится данными, с переопределённым `parecerArtifactId`

- **Статус:** Принят
- **Дата:** 2026-08-17
- **Контекст:** аудит fluxo.yml × код (Волна 2, пункт B1,
  `docs/explanation/auditoria-fluxo-vs-codigo.md`, раздел D)
- **Отменяет отсечение из:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (пункт 5, «Внутреннее делегирование», объявленное прямым следствием существования Dev
  Lead, но явно **не реализованное** в то время — см. также
  CLAUDE.md, «O que NÃO fazer» / ФАЗА 14d)
- **Расширяет:** [ADR 0038](0038-hierarquia-de-agentes.md) (владелец исходного
  дизайна `delegations`/`RecordDelegationUseCase` — таблица, `area` как
  TEXT и шаблон `completed`/`failed`/`dispensed`, который уже используют QA и Infra)

## Контекст {#contexto}

ADR 0053 (ФАЗА 14d) создал Dev Lead и в том же тексте уже предусмотрел, что
включение `dev-<modulo>` будет «делегированием области, приватным, в таблице
`delegations` с `area = "dev"` — тем же путём, что у QA и Infra». Но
объявил это **вне рамок той поставки**, вместе с тем, что кнопка «Ativar
execução» сменит владельца, — обе вещи перечислены в CLAUDE.md как обратимые
отсечения, «выполнение продолжает идти текущим путём».

Аудит только для чтения `docs/fluxo.yml` × код (находка B1) подтвердил,
что пробел оставался открытым: у `dev_lead_server.ex` есть только два инструмента
(`propose_execution_plan`, `assess_implementability`), и он НИКОГДА не записывает
`delegations` — записывают только QA (`qa_lead_server.ex`) и Infra (`infra_lead_server.ex`),
и оба на стороне ENGINE, через `EngineApiClient.record_delegation/1`
→ `POST /internal/sessions/:sessionId/delegations` →
`RecordDelegationUseCase`.

### Почему Dev Lead не может просто подражать QA/Infra {#por-que-o-dev-lead-não-pode-simplesmente-imitar-qainfra}

QA и Infra записывают делегирование на стороне ENGINE, потому что именно там работает
субагент и производит **заключение** — вердикт одного раунда
(`record_gate_verdict`, `open_infra_pr`), который оправдывает `parecerArtifactId`,
указывающий на артефакт, произведённый этим заключением.

У Dev Lead такого шаблона нет. Включение `dev-<modulo>` происходит на
стороне **API**, в `AcceptParallelizationUseCase.execute`
(`apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`),
вызываемом как по прямому пути (ниже потолка,
`RequestParallelizationUseCase`), так и по одобренному пути (выше
потолка, `ExecuteParallelizationUseCase` после того, как пользователь одобряет
`proposed_action` типа `parallelize`). Никакого «заключения» нет: dev
agent не выдаёт вердикт при запуске, он просто начинает работать.

## Решение {#decisão}

**Запись выполняется внутри `AcceptParallelizationUseCase.execute`, на
стороне API — не трогая Elixir/engine.** Это бесплатно покрывает оба пути (прямой и
одобренный), потому что оба уже сходятся в этом методе.

### `status: 'completed'` переопределяется для этой области {#status-completed-é-redefinido-para-esta-área}

В QA и Infra `completed` означает «субагент завершил работу и выдал
заключение». Для dev `completed` начинает означать **«делегирование было
ОСУЩЕСТВЛЕНО»** — агент `dev-<modulo>` действительно запустился. Это СОЗНАТЕЛЬНОЕ
переопределение того же поля для третьей области, без изменения схемы:
тип (`DelegationStatus`) и constraint базы
(`delegations_completed_tem_parecer`) по-прежнему требуют
ненулевого `parecerArtifactId` в `completed`, но то, что этот id
ОПРАВДЫВАЕТ, меняется по области.

`parecerArtifactId` указывает на `id` самого свежего действующего события `artifact.module_map`
проекта — того же артефакта, который
`QaEstrategiaContext.fetch/3` и `AppSecContextBuilder` уже ищут на стороне
engine, здесь получаемого через `SessionEventRepository.listByTypeForProject
(projectId, 'artifact.module_map')` (уже существующий общий метод, используемый
`computeCoverage` для `artifact.business_rule`, — ни одного нового запроса
не написано, лишь ещё один его вызов), с выбором ПОСЛЕДНЕГО элемента (функция
сортирует по `createdAt` ASC). Это артефакт, который **оправдал решение
делегировать**: Dev Lead решает, сколько агентов на модуль, глядя на
`module_map`, и именно это чтение — а не заключение субагента — придаёт
смысл делегированию.

### Без module_map: никогда не фальшивый id {#sem-module_map-nunca-um-id-falso}

Если в проекте нет ни одного `artifact.module_map` — чего не должно
происходить, поскольку Arquiteto всегда поставляет module_map до того, как Dev Lead
начинает работать (его обязательный вход в `docs/fluxo.yml`), — делегирование НЕ
записывается с выдуманным id. `AcceptParallelizationUseCase` логирует
неожиданное состояние через `Logger.error` и возвращается, по тому же уроку
[RN-059](../business-rules/custo.md#rn-059): никогда не тихий сбой, но и
никогда не изображение оправдания, которого нет.

### Сбой записи не обрушивает включение {#falha-ao-registrar-não-derruba-a-ativação}

Включение dev agent уже является успехом, когда происходит попытка записать
делегирование, — она идёт ПОСЛЕ `engineClient.acceptParallelization`
и события `execution.parallelization_accepted`. Если
`RecordDelegationUseCase.execute` бросит исключение (напр.: нарушение constraint,
база недоступна), ошибка перехватывается и логируется, никогда не распространяется:
`AcceptParallelizationUseCase.execute` всегда разрешается `{ ok: true }`, когда
дошёл до этой точки. Сбоить/пропускаться может только ЗАПИСЬ делегирования —
само включение нет.

### `area`/`lead_agent`/`subagent` {#arealead_agentsubagent}

`area: 'dev'`, `lead_agent: 'dev-lead'` (строковый литерал, тот же шаблон, что
`'qa-lead'`/`'infra-lead'`), `subagent`: точный id только что включённого агента
`dev-<modulo>` — `extraDevAgentId(module)`, ТА ЖЕ функция,
которую `AcceptParallelizationUseCase` уже использует для именования агента (включает
суффикс `-2` дополнительного экземпляра, тот же шаблон, который RN-195..201 документирует
в другом контексте). Никакого нового формата не придумано.

`taskId` остаётся `null` (значение по умолчанию `RecordDelegationUseCase`) — тот же
выбор, что у Infra: делегирование касается СЕССИИ/модуля, а не конкретной задачи
backlog.

## Последствия {#consequências}

**За**

- Закрывает расхождение между `docs/fluxo.yml` (который уже объявлял
  `delegacao`/`dev` реальной поставкой со времён ADR 0053) и кодом —
  исправление того же класса, что в ADR 0086.
- `delegations` начинает получать записи всех ТРЁХ областей (`qa`, `infra`, `dev`)
  одним и тем же механизмом, и панель команды и любое будущее чтение
  «кому lead делегировал» покрывают dev без особого случая.
- Ноль новой схемы, ноль migration: таблица и constraint уже поддерживали
  этот случай, не хватало лишь вызывающего на стороне dev.

**Против**

- `parecerArtifactId` перестаёт означать одну вещь в `delegations`:
  тот, кто читает таблицу без контекста области, может предположить «это всегда заключение
  субагента», что ложно для `area = 'dev'`. Смягчено тем, что этот ADR
  и новая RN остаются единственной ссылкой на переопределение, — ни один
  экран сегодня не интерпретирует `parecerArtifactId` так, чтобы это зависело от этого
  различия (это непрозрачное поле, отображаемое как id).
- Запись делегирования может МОЛЧА не произойти (module_map
  отсутствует или `RecordDelegationUseCase` сбоит) без того, чтобы пользователь увидел
  это на экране, — только в логе процесса. Принято по той же причине, что и исходный
  пункт 5 ADR 0053: для продолжения выполнения важно включение агента, а
  блокировать уже состоявшийся успех из-за вспомогательной
  записи было бы хуже.

## Рассмотренные альтернативы {#alternativas-consideradas}

**Записывать делегирование на стороне ENGINE, в `dev_lead_server.ex`, подражая
QA/Infra буквально.** Отвергнуто: потребовался бы новый HTTP-вызов
engine→api только ради этого, тогда как включение и так происходит целиком на
стороне API. Также пришлось бы выдумывать «заключение», которое Dev Lead не
производит, — план параллелизма (ADR 0086) уже является отдельным `proposed_action`,
и повторное использование этого события как заключения делегирования смешало бы два
разных исхода (разрешение параллелизма vs. осуществление включения).

**`status: 'completed'` только после того, как dev agent что-то произведёт (напр.: откроет
первый PR).** Отвергнуто: нет естественного триггера или единого события, которое
отметило бы это, а откладывание записи до тех пор оставило бы делегирования «ожидающими»
на неопределённое время — у схемы намеренно нет `status: 'pending'`
(примечание в `record-delegation.use-case.ts`: «o lead resolve cada delegação
síncrona, numa rodada só»).

**Блокировать включение, если делегирование не удаётся записать.** Отвергнуто:
это поставило бы приоритеты с ног на голову — включение dev agent является реальной ценностью,
поставляемой пользователю; делегирование — это аудит факта, который уже
произошёл. Провалить включение из-за аудита было бы хуже, чем
пробел, который закрывает этот ADR.

## Ссылки {#referências}

- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`)
- `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`
- `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`
- [RN-404](../business-rules.md#rn-404) (делегирование Dev Lead → dev)
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — пункт 5,
  отсечение, отменённое здесь
- [ADR 0038](0038-hierarquia-de-agentes.md) — исходный дизайн
  `delegations`/`RecordDelegationUseCase`
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — другое
  закрытие расхождения между объявленным `docs/fluxo.yml` и кодом
  Dev Lead
- `docs/fluxo.yml` — запись `delegacao`/`dev` (перестаёт упоминать
  `status: lacuna`)
