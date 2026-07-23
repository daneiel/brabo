# Spike: Session Engine (OTP puro)

Spike descartável para validar, antes do MVP, a tese central do motor de
sessões descrito em `CLAUDE.md`: **um processo por sessão, supervisionado,
e um observador (`PsychologistMonitor`) capaz de capturar — com causas
distintas — os três jeitos de um processo Elixir terminar.**

Sem Phoenix, sem Oban, sem banco. Só `GenServer` + `DynamicSupervisor` +
`Process.monitor`.

## Como rodar

```bash
cd spike/session-engine
mix deps.get   # não há deps externas, mas mantém o fluxo padrão
mix run demo.exs
```

`mix test` também roda um teste mínimo (`test/session_engine_test.exs`)
que só confirma que uma sessão é criada, monitorada e loga interações.

## O que existe

- `SessionEngine.SessionServer` — um `GenServer` por sessão, restart
  `:temporary` (não queremos que o supervisor reviva a sessão sozinho
  neste spike). Guarda o log de interações em memória e delega a
  auditoria pós-morte para o monitor.
- `SessionEngine.SessionSupervisor` — `DynamicSupervisor` que cria cada
  sessão (`start_session/1`) e já a registra no monitor.
- `SessionEngine.Agent` — processo "agente" mínimo (`spawn`, sem
  GenServer) que troca mensagens com um par e loga cada envio/recebimento
  no `SessionServer` da sessão.
- `SessionEngine.PsychologistMonitor` — um `GenServer` global que chama
  `Process.monitor/1` em toda sessão criada. Mantém uma **cópia
  espelhada** do log de cada sessão (atualizada a cada interação via
  `sync_log/3`) e, ao receber `:DOWN`, imprime a causa da morte e o
  último log conhecido.
- `demo.exs` — cria 3 sessões e mata cada uma de um jeito diferente.

## O que foi provado

### 1. Um monitor externo captura a morte de qualquer sessão, com a causa exata

`Process.monitor/1` — ao contrário de `Process.link/1` — **sempre** entrega
uma mensagem `:DOWN` com a razão real do término, mesmo quando essa razão
é `:normal`. Isso é o que permite ao `PsychologistMonitor` tratar os três
casos de forma uniforme, sem precisar de tratamento especial por tipo de
encerramento.

### 2. O log de uma sessão morta só existe porque foi espelhado em vida

Esse é o ponto mais importante do spike. Quando um processo morre, seu
estado (o log de interações, no caso) desaparece com ele — não há como
"perguntar" ao cadáver do processo o que aconteceu. Por isso o
`SessionServer` espelha cada nova entrada de log no `PsychologistMonitor`
(`sync_log/3`) no momento em que ela é registrada, e não apenas na hora
da morte. O monitor sempre tem a versão mais recente do log de uma sessão
viva, pronta para ser exibida caso ela morra no instante seguinte.

### 3. As três causas de término têm comportamentos radicalmente diferentes

O demo produz, na ordem, os três casos abaixo — reparem no que aparece
(ou não) no terminal:

| Término | Como foi provocado | `terminate/2` roda? | Razão vista pelo monitor | Observação |
|---|---|---|---|---|
| **Normal** | `GenServer.stop(pid, :normal)` | ✅ Sim | `:normal` | Encerramento intencional e limpo. |
| **Kill** | `Process.exit(pid, :kill)` | ❌ **Nunca** | `:killed` | Sinal não interceptável em nenhum nível — nem o próprio `GenServer` consegue rodar código antes de morrer. É por isso que a solução (2) é obrigatória, não um detalhe de implementação. |
| **Crash** | `raise` dentro de um `handle_cast` | ✅ Sim | `{%RuntimeError{...}, stacktrace}` | O `GenServer` intercepta a exceção, roda `terminate/2` com a razão real, gera o log de erro padrão do OTP ("GenServer terminating") e só então propaga o crash para quem monitora/linka. |

No output real do `mix run demo.exs`, a sessão 2 (`:kill`) é a única em
que a linha `[SessionServer ...] terminate/2 executado (...)` **não**
aparece — a prova, ao vivo, de que esse caminho de código nunca roda.

## Implicações para o motor real (fase 1, item 6 do MVP)

- O `PsychologistMonitor` (ou equivalente) do motor real precisa manter
  seu próprio espelho/projeção do estado de uma sessão — não pode
  depender de consultar o processo após um `:DOWN`, porque para `:kill`
  isso é fisicamente impossível.
- A máquina de estados do `CLAUDE.md`
  (`created → active → closing → closed | closed_abnormally`) mapeia
  direto para as razões observadas aqui: `:normal`/`:shutdown` →
  `closed`; `:killed` ou uma exceção → `closed_abnormally`. O evento de
  transição pode ser emitido a partir do `handle_info({:DOWN, ...})` do
  monitor, de forma uniforme para os três casos.
- Como o log de interações no MVP real é *event sourcing* (persistido em
  Postgres, não em memória), o "espelhamento em vida" deste spike deixa
  de ser necessário para o log em si — mas o princípio se mantém: o
  monitor não pode depender do processo estar vivo para saber o que
  aconteceu nele.

## O que este spike NÃO cobre (de propósito)

- Persistência (o log real é event-sourced em Postgres).
- Reconexão/retomada de sessão.
- Múltiplos nós / distribuição.
- Qualquer coisa de Phoenix, Oban ou banco — fora de escopo aqui.
