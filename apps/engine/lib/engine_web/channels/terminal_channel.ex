defmodule EngineWeb.TerminalChannel do
  @moduledoc """
  Canal `terminal:<projectId>` — dois PAPÉIS entram no mesmo tópico:
  `:runner` (o CLI na máquina do usuário, no máximo UM por projeto — ver
  `Engine.Runners.Registry`) e `:web` (a aba Terminal da web, vários
  simultâneos, é quem VÊ o terminal). O papel vem do `kind` do ticket
  consumido no join (`"runner"` → `:runner`, `"terminal"` → `:web`).

  ## Duas responsabilidades, dois mecanismos

  1. **`exec`/`exec_result`** — comando de agente já APROVADO (o roteamento
     em `Engine.Actions.TerminalExecutor` só chama isto DEPOIS do pipeline
     de aprovação de sempre) que o engine quer rodar no runner em vez do
     container. Correlacionado por `ref` e respondido de volta a quem
     pediu — ver `Engine.Runners.RunnerRouter`, que é quem dispara
     `handle_info({:dispatch_exec, ...})` aqui.
  1b. **`container_start`/`_result`, `container_stop`/`_result`,
     `container_remove`/`_result`** (ADR 0137) — MESMO mecanismo do item 1,
     três vezes: `Engine.Runners.RunnerRouter.start_container/stop_container/
     remove_container` disparam `handle_info({:dispatch_container_*, ...})`
     aqui, que empurra o evento pro runner e guarda `{ref, from}` no MESMO
     `pending_execs` (o mapa é genérico — ref -> quem pediu, não importa QUE
     pedido); `handle_in("container_*_result", ...)` responde de volta. Só a
     api chama isto, e só para projeto `mounted`/`runner` (`container` sobe
     pelo broker, `apps/broker`, que nunca fala com este canal).
  2. **PTY interativo** (`pty_*`) — RELAY puro entre `:web` e `:runner`; o
     engine NUNCA interpreta os bytes do PTY (`data` é base64 opaco pra
     ele). Eventos que o `:runner` origina (`pty_data`, `pty_opened`,
     `pty_error`) vão de broadcast pro tópico com `intercept/1` +
     `handle_out/3` filtrando só pra sockets `:web` (nunca ecoando pro
     próprio runner nem — se um dia houver mais de um — pra outro runner).
     Eventos que a `:web` origina (`pty_open`, `pty_close`, `pty_input`)
     vão por `send/2` DIRETO pro pid do runner registrado — nunca broadcast
     geral, que acordaria toda outra aba `:web` assistindo o mesmo projeto
     à toa. `pty_resize` é o único bidirecional ("qualquer lado"), e por
     isso usa os dois mecanismos dependendo de quem mandou.
  3. **`fs_list_dir`/`fs_home_dir`** (navegação de pasta local, ADR sobre
     navegação de pasta via o Runner) — MESMO desenho do PTY: relay puro,
     correlacionado por `ref` que o cliente já carrega (nunca um `from`
     rastreado no servidor). `:web` pede (`fs_list_dir`/`fs_home_dir`),
     relay DIRETO pro pid do runner (mesmo mecanismo de `pty_input`); sem
     runner conectado, a resposta de erro é devolvida na hora — nunca fica
     esperando um `_reply` que nunca chega. `:runner` responde
     (`fs_list_dir_reply`/`fs_home_dir_reply`), broadcast filtrado só pra
     `:web` (mesmo mecanismo de `pty_data`) — o cliente já sabe filtrar
     pelo `ref` da própria requisição, exatamente como faz com `sessionRef`
     do PTY. Leitura pura, sem evento de auditoria: não é sessão com
     duração (like PTY), é um request/reply único.

  É a `:web` quem inicia um PTY (a aba manda `pty_open`); o
  "Servidor → runner: pty_open" do contrato descreve a direção do relay
  DEPOIS que o engine recebe o pedido da web, não uma origem própria do
  servidor — o engine não abre PTY por conta própria.

  ## Capacidades declaradas no `join` (ADR 0147 ponto 1, RN-514)

  O `join` deixou de ser mudo: o runner DECLARA nos params o que sabe fazer
  (`%{"capacidades" => ["exec", "pty"]}`) e este canal CONCEDE, em
  `autorizar_por_papel/3`, a interseção daquilo com o vocabulário que o
  servidor conhece (`Engine.Runners.Capacidades`). O conjunto concedido vive
  em `socket.assigns.capacidades` e em lugar NENHUM além dele — nunca em
  tabela: capacidade é propriedade DAQUELA conexão, e uma tabela poderia
  afirmar que um runner sabe algo que o processo conectado agora não sabe (é
  o mesmo raciocínio que faz a entrada `:global` do `Registry` morrer junto
  com o pid).

  Só o papel `:runner` recebe conjunto. O socket `:web` NÃO ganha
  `:capacidades` e NENHUMA checagem de capacidade se aplica a ele — a aba não
  executa nada, ela pede; quem precisa saber fazer é o binário do outro lado,
  e é o socket dele que carrega a resposta.

  Capacidade EXIGIDA e não declarada recusa o `join` nomeando a que falta (o
  runner trata a recusa como fatal, sem retry). Capacidade declarada que este
  servidor não conhece é IGNORADA — runner mais novo que o engine tem que
  conseguir conectar.

  E a metade que entrega valor hoje: mensagem cuja capacidade não foi
  concedida é RECUSADA com resposta NOMEADA, nunca engolida — ver
  `handle_info({:dispatch_exec, ...})` (capacidade `exec`) e
  `handle_info({:relay, "pty_" <> _, ...})` (capacidade `pty`).

  ## O DESTINO do espelho viaja na concessão do join (ADR 0147 ponto 4, RN-516)

  A resposta do `join` do `:runner` deixou de ser vazia: quando o projeto tem
  destino declarado (`projects.mirror_path`, RN-515) E a capacidade `espelho`
  foi concedida, ela carrega `%{espelho: %{destino: "<caminho>"}}`. É o ÚNICO
  lugar por onde o destino chega ao runner — nunca configuração global dele,
  nunca variável de ambiente: um destino global faria o artefato do projeto B
  aterrissar na pasta do projeto A, e o usuário descobriria isso pelo
  conteúdo, não por um erro. O runner recusa `mirror_sync` para destino que
  não lhe foi concedido NAQUELA conexão.

  Consequência direta, declarada no ADR: destino declarado passa a EXIGIR a
  capacidade, e um binário anterior a essa versão deixa de conectar naquele
  projeto — recusa explícita e nomeada, nunca degradação silenciosa. É o
  primeiro caso REAL do mecanismo que a RN-514 deixou implementado e sem
  nenhum disparo. Trocar o destino com o runner conectado também exige
  reconectá-lo, pela mesma razão: a concessão é do join.

  `mirror_sync` (`handle_info({:dispatch_mirror_sync, ...})`) é o único
  dispatch FIRE-AND-FORGET do canal — sem `from`, sem `pending_execs`, sem
  evento de resultado. A telemetria da sincronização é o ponto 7 do ADR, de
  outra sessão.

  ## Auditoria (PTY é ação do usuário, não passa por `proposed_action`)

  `pty_open`/`pty_close` vindos de `:web` emitem
  `terminal.session.started`/`terminal.session.ended` no event log —
  reusa `Engine.Sessions.ProjectSession.latest_id/1` (mesmo mecanismo já
  usado pela Anamnese pra narrar algo project-scoped: todo evento de
  domínio é, por schema, escopado a uma SESSÃO, e "a sessão mais recente do
  projeto" é o endereço). PTY que fica aberto quando a aba cai (crash,
  queda de rede, sem `pty_close` explícito) também fecha o rastro, em
  `terminate/2`, com o motivo marcado — nunca fica "iniciado" pra sempre no
  log.

  ## `workspace_confirm` (RN-423, ADR 0104)

  Só o `:runner` pode originar — logo depois do `join` resolver `ok`, ele
  manda o `--dir` que recebeu na linha de comando. O engine repassa pra api
  (`Engine.Sessions.EngineApiClient.confirm_workspace/4`), que revalida
  LEXICAMENTE e SOBRESCREVE `workspacePath` (o runner é a fonte da
  verdade). Mesmo mecanismo de sessão do PTY: sem sessão no projeto ainda,
  a api atualiza o banco mesmo assim e só pula o evento de auditoria — o
  `UPDATE` nunca fica bloqueado por essa lacuna.
  """

  use EngineWeb, :channel

  require Logger

  alias Engine.Projects.Project
  alias Engine.Runners.{Capacidades, Registry, SocketTicket}
  alias Engine.Sessions.{EngineApiClient, ProjectSession}

  # Saída de um `exec` que nunca chegou ao runner por falta da capacidade
  # `exec` (RN-514). 126 é o código POSIX de "comando encontrado, mas não
  # executável" — é literalmente o caso: o binário existe do outro lado e não
  # sabe executar isto.
  @exit_code_sem_capacidade 126

  # Eventos que só o :runner pode originar — vão de broadcast pro tópico e
  # só chegam a sockets :web (handle_out/3 filtra).
  @eventos_do_runner ~w(pty_data pty_opened pty_error fs_list_dir_reply fs_home_dir_reply)

  intercept([
    "pty_data",
    "pty_opened",
    "pty_error",
    "pty_resize",
    "fs_list_dir_reply",
    "fs_home_dir_reply"
  ])

  @impl true
  def join("terminal:" <> project_id, params, socket) do
    if project_id != socket.assigns.project_id do
      {:error, %{reason: "unauthorized"}}
    else
      case SocketTicket.consumir(socket.assigns.ticket, project_id) do
        {:ok, _linha} -> autorizar_por_papel(project_id, params, socket)
        {:error, :invalid} -> {:error, %{reason: "unauthorized"}}
      end
    end
  end

  defp autorizar_por_papel(project_id, params, socket) do
    papel = papel_do_kind(socket.assigns.kind)

    socket =
      socket
      |> assign(:project_id, project_id)
      |> assign(:role, papel)
      # ref -> pid de quem pediu um "exec" e está esperando o
      # "exec_result" correspondente (só relevante pro socket :runner).
      |> assign(:pending_execs, %{})
      # sessionRef dos PTYs abertos por ESTE socket web — usado só pra
      # fechar o rastro de auditoria se o socket cair sem pty_close
      # explícito (só relevante pro socket :web).
      |> assign(:open_pty_refs, MapSet.new())

    case papel do
      :runner ->
        entrar_como_runner(project_id, params, socket)

      # O socket :web NÃO ganha `:capacidades` — nenhuma checagem de
      # capacidade se aplica a ele (ver moduledoc). Ele não declara nada
      # porque não executa nada.
      :web ->
        {:ok, socket}
    end
  end

  # ADR 0147 ponto 1 (RN-514): a capacidade EXIGIDA que o runner não declarou
  # recusa o join ANTES de registrar a presença — registrar e recusar em
  # seguida deixaria o `Registry` momentaneamente afirmando um runner que não
  # entrou. A ordem inversa (registrar depois de conceder) mantém a recusa por
  # exclusividade que já existia como a ÚLTIMA palavra.
  defp entrar_como_runner(project_id, params, socket) do
    {modo, destino_do_espelho} = exigencias_do_projeto(project_id)

    case Capacidades.conceder(params, modo, destino_do_espelho) do
      {:ok, concedidas} ->
        socket = assign(socket, :capacidades, concedidas)

        case Registry.register(project_id, self()) do
          :ok ->
            {:ok, resposta_do_join(concedidas, destino_do_espelho), socket}

          {:error, :already_connected} ->
            {:error, %{reason: "já existe um runner conectado a este projeto"}}
        end

      {:error, faltando} ->
        {:error, %{reason: Capacidades.mensagem_de_recusa(faltando)}}
    end
  end

  # ADR 0147 ponto 4 (RN-516): o DESTINO do espelho viaja ao runner DENTRO da
  # concessão do join, e em lugar nenhum além — nunca configuração global no
  # runner, nunca variável de ambiente. Um destino global faria o artefato do
  # projeto B aterrissar na pasta do projeto A, e o usuário descobriria isso
  # pelo CONTEÚDO, não por um erro.
  #
  # Só entra na resposta quando as DUAS coisas valem: há destino declarado E a
  # capacidade `espelho` foi concedida. Mandar destino para quem não a declarou
  # seria o servidor pedindo o que aquele binário não sabe fazer — e nem chega
  # a acontecer hoje (destino declarado EXIGE a capacidade, então quem não a
  # tem foi recusado acima); a checagem é o que mantém as duas coisas atadas se
  # a exigência mudar.
  #
  # Resposta VAZIA no caso normal (projeto sem espelho), e o runner trata
  # "não veio destino" e "não há destino" como a mesma coisa — as duas
  # terminam em `mirror_sync` recusado, nunca numa cópia às cegas.
  defp resposta_do_join(concedidas, destino) do
    if is_binary(destino) and MapSet.member?(concedidas, "espelho") do
      %{espelho: %{destino: destino}}
    else
      %{}
    end
  end

  # `{nil, nil}` quando não dá pra saber (projeto inexistente, id malformado,
  # consulta que falhou) — e `Capacidades.exigidas/2` trata os dois `nil` como
  # "não exige nada". Recusar um join por uma pré-condição que não se conseguiu
  # CONFIRMAR seria colapsar "não sei" com "não tem" (RN-088). O `rescue` é o
  # mesmo de `Engine.Projects.Project.workspace_dir_name/1`, e pelo mesmo
  # motivo: id fora de forma de UUID levanta `Ecto.Query.CastError`.
  #
  # UMA consulta para as DUAS perguntas: o modo (que decide `exec`) e o destino
  # do espelho (que decide `espelho`). Duas leituras do mesmo projeto no mesmo
  # join seriam duas chances de divergir.
  defp exigencias_do_projeto(project_id) do
    case Project.get(project_id) do
      %{execution_mode: modo, mirror_path: destino} ->
        {modo, if(Capacidades.destino?(destino), do: String.trim(destino), else: nil)}

      _ ->
        {nil, nil}
    end
  rescue
    _ -> {nil, nil}
  catch
    _, _ -> {nil, nil}
  end

  defp papel_do_kind("runner"), do: :runner
  defp papel_do_kind(_terminal_ou_outro), do: :web

  @impl true
  def terminate(_reason, socket) do
    case socket.assigns[:role] do
      :runner ->
        Registry.unregister(socket.assigns.project_id)

      :web ->
        # RN de auditoria: PTY que ficou aberto quando a aba caiu (crash,
        # queda de rede) também fecha o rastro — nunca fica "iniciado" pra
        # sempre no event log.
        Enum.each(socket.assigns[:open_pty_refs] || MapSet.new(), fn ref ->
          registrar_evento_terminal(socket, "terminal.session.ended", %{
            sessionRef: ref,
            motivo: "desconectado"
          })
        end)

      _ ->
        :ok
    end

    :ok
  end

  # --- handle_in — TODOS os clientes → servidor, agrupados (Elixir avisa
  # se clauses do mesmo nome/aridade ficam espalhadas pelo módulo) ---

  # exec/exec_result: resposta ao comando já aprovado que o servidor
  # despachou via handle_info({:dispatch_exec, ...}) — ver mais abaixo.
  @impl true
  def handle_in("exec_result", payload, socket) do
    responder_pedido_pendente(socket, payload, :runner_exec_result)
  end

  # container_start_result/container_stop_result/container_remove_result:
  # MESMO mecanismo de exec_result (item 1b do moduledoc) — só o átomo de
  # resultado muda, porque é ele que `Engine.Runners.RunnerRouter` está
  # bloqueado esperando em `receive`.
  @impl true
  def handle_in("container_start_result", payload, socket) do
    responder_pedido_pendente(socket, payload, :runner_container_start_result)
  end

  @impl true
  def handle_in("container_stop_result", payload, socket) do
    responder_pedido_pendente(socket, payload, :runner_container_stop_result)
  end

  @impl true
  def handle_in("container_remove_result", payload, socket) do
    responder_pedido_pendente(socket, payload, :runner_container_remove_result)
  end

  # workspace_confirm: só o :runner pode originar — o caminho que ele
  # recebeu por `--dir`, confirmado no HOST de verdade (RN-423). Empurrado
  # UMA vez, logo depois do join, pelo próprio `apps/runner/src/index.ts`.
  @impl true
  def handle_in("workspace_confirm", %{"path" => path}, socket) do
    if socket.assigns.role == :runner do
      project_id = socket.assigns.project_id
      session_id = ProjectSession.latest_id(project_id)

      case EngineApiClient.confirm_workspace(project_id, session_id, path, socket.assigns.user_id) do
        {:ok, _resp} ->
          :ok

        {:error, reason} ->
          Logger.warning(
            "terminal: workspace_confirm recusado (#{project_id}): " <> inspect(reason)
          )
      end
    end

    {:noreply, socket}
  end

  @impl true
  def handle_in("pty_open", %{"sessionRef" => ref} = payload, socket) do
    if socket.assigns.role == :web do
      # Achado na consolidação: sem runner conectado, `relay_para_runner/3`
      # só logava e retornava — a web nunca recebia `pty_opened` NEM
      # `pty_error`, ficava presa em "carregando" pra sempre (o estado
      # "sem runner" da RN-088 nunca era alcançável por este caminho). O
      # `whereis` aqui, ANTES de relayar e ANTES de gravar auditoria, é o
      # que garante que "sem runner" é um resultado explícito, não um
      # timeout silencioso.
      case Registry.whereis(socket.assigns.project_id) do
        nil ->
          push(socket, "pty_error", %{
            sessionRef: ref,
            message:
              "Nenhum runner conectado a este projeto. Rode `brabo-runner " <>
                "--project #{socket.assigns.project_id} --dir <pasta>` na sua máquina."
          })

          {:noreply, socket}

        _pid ->
          relay_para_runner(socket, "pty_open", payload)

          registrar_evento_terminal(socket, "terminal.session.started", %{
            sessionRef: ref,
            cols: Map.get(payload, "cols"),
            rows: Map.get(payload, "rows")
          })

          {:noreply,
           assign(socket, :open_pty_refs, MapSet.put(socket.assigns.open_pty_refs, ref))}
      end
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_in("pty_close", %{"sessionRef" => ref} = payload, socket) do
    if socket.assigns.role == :web do
      relay_para_runner(socket, "pty_close", payload)

      registrar_evento_terminal(socket, "terminal.session.ended", %{
        sessionRef: ref,
        motivo: "fechado_pelo_usuario"
      })

      {:noreply, assign(socket, :open_pty_refs, MapSet.delete(socket.assigns.open_pty_refs, ref))}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_in("pty_input", payload, socket) do
    if socket.assigns.role == :web do
      relay_para_runner(socket, "pty_input", payload)
    end

    {:noreply, socket}
  end

  # pty_resize é bidirecional: relay pro papel OPOSTO de quem mandou — direto
  # pro runner quando vem da web, broadcast (filtrado em handle_out/3) quando
  # vem do runner.
  @impl true
  def handle_in("pty_resize", payload, socket) do
    case socket.assigns.role do
      :web -> relay_para_runner(socket, "pty_resize", payload)
      :runner -> broadcast_from(socket, "pty_resize", payload)
    end

    {:noreply, socket}
  end

  # fs_list_dir/fs_home_dir: navegação de pasta local, sempre iniciada pela
  # :web. Mesmo desenho de pty_open — confere runner conectado ANTES de
  # relayar, e responde erro na hora quando não há (nunca deixa o pedido
  # sem resposta). Leitura pura: sem evento de auditoria, diferente do PTY.
  @impl true
  def handle_in("fs_list_dir", %{"ref" => ref} = payload, socket) do
    if socket.assigns.role == :web do
      case Registry.whereis(socket.assigns.project_id) do
        nil ->
          push(socket, "fs_list_dir_reply", %{
            ref: ref,
            path: Map.get(payload, "path"),
            entradas: [],
            erro:
              "Nenhum runner conectado a este projeto. Rode `brabo-runner " <>
                "--project #{socket.assigns.project_id} --dir <pasta>` na sua máquina."
          })

        _pid ->
          relay_para_runner(socket, "fs_list_dir", payload)
      end
    end

    {:noreply, socket}
  end

  @impl true
  def handle_in("fs_home_dir", %{"ref" => ref} = payload, socket) do
    if socket.assigns.role == :web do
      case Registry.whereis(socket.assigns.project_id) do
        nil ->
          push(socket, "fs_home_dir_reply", %{
            ref: ref,
            erro:
              "Nenhum runner conectado a este projeto. Rode `brabo-runner " <>
                "--project #{socket.assigns.project_id} --dir <pasta>` na sua máquina."
          })

        _pid ->
          relay_para_runner(socket, "fs_home_dir", payload)
      end
    end

    {:noreply, socket}
  end

  for evento <- @eventos_do_runner do
    @impl true
    def handle_in(unquote(evento), payload, socket) do
      if socket.assigns.role == :runner do
        broadcast_from(socket, unquote(evento), payload)
      end

      {:noreply, socket}
    end
  end

  # --- handle_out — broadcast interceptado, só entregue a sockets :web ---

  @impl true
  def handle_out(event, payload, socket) do
    if socket.assigns.role == :web do
      push(socket, event, payload)
    end

    {:noreply, socket}
  end

  # --- handle_info — mensagens internas do próprio node/cluster, agrupadas ---

  # Dispatch de comando aprovado: Engine.Runners.RunnerRouter manda isto pro
  # pid do canal :runner (achado via Registry) e fica bloqueado em `receive`
  # esperando {:runner_exec_result, ref, payload} — ver handle_in("exec_result", ...).
  #
  # `env` (RN-507/ADR 0145) só entra no payload empurrado quando não é `nil` —
  # a credencial de git (ADR 0056) nunca deve aparecer como `null` gratuito
  # nem em log nenhum daqui pra frente; ver `apps/runner/src/index.ts`, que
  # audita explicitamente que este campo nunca é logado do lado dele.
  @impl true
  def handle_info({:dispatch_exec, ref, command, cwd, env, from, timeout_ms}, socket) do
    if tem_capacidade?(socket, "exec") do
      payload = %{command: command, cwd: cwd}
      payload = if env, do: Map.put(payload, :env, env), else: payload
      despachar_pedido(socket, ref, from, timeout_ms, "exec", payload)
    else
      # RN-514: empurrar "exec" pra um runner que não declarou `exec` seria a
      # mensagem sumindo — o `RunnerRouter` ficaria bloqueado até o `receive
      # ... after` dele, e o usuário veria um TIMEOUT no lugar da causa. Aqui
      # o `from` recebe o MESMO formato de `exec_result` que o runner mandaria
      # (é o que `TerminalExecutor` e `RunnerGit` já sabem ler), com a causa
      # no `output` — nada de átomo de erro novo, que obrigaria a mexer nos
      # dois chamadores para dizer o que este payload já diz.
      send(
        from,
        {:runner_exec_result, ref,
         %{
           "ref" => ref,
           "exitCode" => @exit_code_sem_capacidade,
           "output" => Capacidades.mensagem_de_capacidade_ausente("exec", "exec"),
           "timedOut" => false
         }}
      )

      {:noreply, socket}
    end
  end

  # container_start/container_stop/container_remove: MESMO mecanismo de
  # dispatch_exec acima (item 1b do moduledoc) — `RunnerRouter.start_container/
  # stop_container/remove_container` mandam isto pro pid do canal :runner.
  @impl true
  def handle_info({:dispatch_container_start, ref, spec, from, timeout_ms}, socket) do
    despachar_pedido(socket, ref, from, timeout_ms, "container_start", %{spec: spec})
  end

  @impl true
  def handle_info(
        {:dispatch_container_stop, ref, workspace_dir_name, from, timeout_ms},
        socket
      ) do
    despachar_pedido(socket, ref, from, timeout_ms, "container_stop", %{
      workspaceDirName: workspace_dir_name
    })
  end

  @impl true
  def handle_info(
        {:dispatch_container_remove, ref, workspace_dir_name, from, timeout_ms},
        socket
      ) do
    despachar_pedido(socket, ref, from, timeout_ms, "container_remove", %{
      workspaceDirName: workspace_dir_name
    })
  end

  # mirror_sync (ADR 0147 pontos 4 e 8, RN-516) — `Engine.Runners.Espelho`
  # manda isto pro pid do canal :runner num MOMENTO NOMEADO (hoje: o commit).
  #
  # FIRE-AND-FORGET, ao contrário dos quatro dispatch acima: não há `from`
  # esperando, nada entra em `pending_execs` e nenhum `mirror_sync_result`
  # existe no protocolo. Quem disparou está no meio de outra coisa (um commit
  # que já terminou), e o resultado da sincronização é telemetria de conexão —
  # o ponto 7 do ADR, de outra sessão. Inventar o formato dela aqui seria
  # escolhê-lo sem a decisão que ela precisa.
  #
  # A checagem de capacidade é a mesma dos outros dois casos, e aqui ela é
  # dupla-guarda: destino declarado EXIGE `espelho` no join (RN-516), então um
  # runner sem a capacidade já foi recusado na entrada. Ela existe para o caso
  # em que o destino é declarado DEPOIS do join — aí a mensagem seria empurrada
  # a um binário que talvez não a entenda, e o defeito seria o do Context do
  # ADR 0147: a mensagem chega, o handler não existe, nada acontece.
  @impl true
  def handle_info({:dispatch_mirror_sync, ref, destino, momento}, socket) do
    if tem_capacidade?(socket, "espelho") do
      push(socket, "mirror_sync", %{ref: ref, destino: destino, momento: momento})
    else
      Logger.warning(
        "terminal (#{socket.assigns.project_id}): " <>
          Capacidades.mensagem_de_capacidade_ausente("espelho", "mirror_sync")
      )
    end

    {:noreply, socket}
  end

  @impl true
  def handle_info({:expire_pending_exec, ref}, socket) do
    {:noreply, assign(socket, :pending_execs, Map.delete(socket.assigns.pending_execs, ref))}
  end

  # Relay direto web -> runner (pty_open/pty_close/pty_input/pty_resize da
  # web): relay_para_runner/3 manda isto pro pid do canal :runner, que só
  # precisa empurrar pro cliente dele.
  #
  # RN-514: os `pty_*` são a capacidade `pty`. Runner que não a declarou não
  # recebe a mensagem — e a `:web` que a originou recebe `pty_error` NOMEADO,
  # pelo mesmo broadcast filtrado que o próprio runner usaria pra reportar
  # erro de PTY. Sem isto o pedido morreria aqui e a aba ficaria em
  # "carregando" pra sempre, que é exatamente o defeito da RN-088 que o
  # `whereis` de `handle_in("pty_open", ...)` já fechou pro caso "sem runner".
  @impl true
  def handle_info({:relay, "pty_" <> _ = event, payload}, socket) do
    if tem_capacidade?(socket, "pty") do
      push(socket, event, payload)
    else
      broadcast_from(socket, "pty_error", %{
        sessionRef: Map.get(payload, "sessionRef"),
        message: Capacidades.mensagem_de_capacidade_ausente("pty", event)
      })
    end

    {:noreply, socket}
  end

  @impl true
  def handle_info({:relay, event, payload}, socket) do
    push(socket, event, payload)
    {:noreply, socket}
  end

  # --- privadas ---

  # Molde comum dos QUATRO `handle_info` de dispatch acima (`dispatch_exec` e
  # os três `dispatch_container_*`): empurra `evento` pro cliente runner com
  # `ref` embutido, guarda `{ref, from}` em `pending_execs` para
  # `responder_pedido_pendente/3` achar depois, e agenda a autolimpeza — se o
  # runner nunca responder, o CHAMADOR (`RunnerRouter`) já desiste sozinho
  # depois de `timeout_ms` (o `receive ... after` dele); isto só evita que
  # `pending_execs` cresça sem teto num socket de vida longa.
  defp despachar_pedido(socket, ref, from, timeout_ms, evento, payload_extra) do
    push(socket, evento, Map.put(payload_extra, :ref, ref))
    Process.send_after(self(), {:expire_pending_exec, ref}, timeout_ms + 1_000)
    {:noreply, assign(socket, :pending_execs, Map.put(socket.assigns.pending_execs, ref, from))}
  end

  # Pop no `pending_execs` pelo `ref` e responde pro `from` que estava
  # esperando, com a tag de resultado que o CHAMADOR (`RunnerRouter`) sabe
  # casar no próprio `receive`. Usado pelos QUATRO `handle_in("*_result", ...)`
  # acima (`exec_result` e os três `container_*_result`). Sem `from` pendente
  # pra este ref — resposta atrasada (já expirou, ver
  # `handle_info({:expire_pending_exec, ...})`) ou runner respondendo a um
  # ref que não é dele: descarta, não é erro do protocolo.
  defp responder_pedido_pendente(socket, payload, resultado_tag) do
    ref = Map.get(payload, "ref")

    case Map.pop(socket.assigns.pending_execs, ref) do
      {nil, _} ->
        {:noreply, socket}

      {from, restante} ->
        send(from, {resultado_tag, ref, payload})
        {:noreply, assign(socket, :pending_execs, restante)}
    end
  end

  # `socket.assigns.capacidades` só existe no socket :runner (ver moduledoc).
  # `nil` -> `false`: as mensagens que consultam isto (`:dispatch_exec` e
  # `{:relay, "pty_" <> _}`) só são enviadas ao pid que o `Registry` devolve,
  # que é sempre o do runner — um `:web` nunca chega aqui.
  defp tem_capacidade?(socket, capacidade) do
    case socket.assigns[:capacidades] do
      nil -> false
      concedidas -> MapSet.member?(concedidas, capacidade)
    end
  end

  defp relay_para_runner(socket, event, payload) do
    case Registry.whereis(socket.assigns.project_id) do
      nil ->
        Logger.warning(
          "terminal: #{event} descartado — sem runner conectado no projeto " <>
            socket.assigns.project_id
        )

      pid ->
        send(pid, {:relay, event, payload})
    end
  end

  defp registrar_evento_terminal(socket, tipo, payload_extra) do
    project_id = socket.assigns.project_id

    case ProjectSession.latest_id(project_id) do
      nil ->
        Logger.warning(
          "terminal: sem sessão no projeto #{project_id} para narrar #{tipo} — " <>
            "auditoria não gravada"
        )

      session_id ->
        EngineApiClient.append_event(project_id, session_id, %{
          type: tipo,
          actorKind: "user",
          actorId: socket.assigns.user_id,
          payload: payload_extra
        })
    end
  catch
    kind, reason ->
      Logger.warning(
        "terminal: falha ao emitir #{tipo} (#{socket.assigns.project_id}): " <>
          inspect({kind, reason})
      )
  end
end
