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

  É a `:web` quem inicia um PTY (a aba manda `pty_open`); o
  "Servidor → runner: pty_open" do contrato descreve a direção do relay
  DEPOIS que o engine recebe o pedido da web, não uma origem própria do
  servidor — o engine não abre PTY por conta própria.

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

  alias Engine.Runners.{Registry, SocketTicket}
  alias Engine.Sessions.{EngineApiClient, ProjectSession}

  # Eventos que só o :runner pode originar — vão de broadcast pro tópico e
  # só chegam a sockets :web (handle_out/3 filtra).
  @eventos_do_runner ~w(pty_data pty_opened pty_error)

  intercept(["pty_data", "pty_opened", "pty_error", "pty_resize"])

  @impl true
  def join("terminal:" <> project_id, _params, socket) do
    if project_id != socket.assigns.project_id do
      {:error, %{reason: "unauthorized"}}
    else
      case SocketTicket.consumir(socket.assigns.ticket, project_id) do
        {:ok, _linha} -> autorizar_por_papel(project_id, socket)
        {:error, :invalid} -> {:error, %{reason: "unauthorized"}}
      end
    end
  end

  defp autorizar_por_papel(project_id, socket) do
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
        case Registry.register(project_id, self()) do
          :ok ->
            {:ok, socket}

          {:error, :already_connected} ->
            {:error, %{reason: "já existe um runner conectado a este projeto"}}
        end

      :web ->
        {:ok, socket}
    end
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
    ref = Map.get(payload, "ref")

    case Map.pop(socket.assigns.pending_execs, ref) do
      {nil, _} ->
        # Sem `from` pendente pra este ref — resposta atrasada (já expirou,
        # ver `handle_info({:expire_pending_exec, ...})`) ou runner
        # respondendo a um ref que não é dele. Descarta, não é erro do
        # protocolo.
        {:noreply, socket}

      {from, restante} ->
        send(from, {:runner_exec_result, ref, payload})
        {:noreply, assign(socket, :pending_execs, restante)}
    end
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
  @impl true
  def handle_info({:dispatch_exec, ref, command, cwd, from, timeout_ms}, socket) do
    push(socket, "exec", %{ref: ref, command: command, cwd: cwd})
    # Autolimpeza: se o runner nunca responder, `Engine.Runners.RunnerRouter`
    # já desiste depois de `timeout_ms` (o `receive ... after` dele) — isto
    # só evita que `pending_execs` cresça sem teto num socket de vida longa.
    Process.send_after(self(), {:expire_pending_exec, ref}, timeout_ms + 1_000)
    {:noreply, assign(socket, :pending_execs, Map.put(socket.assigns.pending_execs, ref, from))}
  end

  @impl true
  def handle_info({:expire_pending_exec, ref}, socket) do
    {:noreply, assign(socket, :pending_execs, Map.delete(socket.assigns.pending_execs, ref))}
  end

  # Relay direto web -> runner (pty_open/pty_close/pty_input/pty_resize da
  # web): relay_para_runner/3 manda isto pro pid do canal :runner, que só
  # precisa empurrar pro cliente dele.
  @impl true
  def handle_info({:relay, event, payload}, socket) do
    push(socket, event, payload)
    {:noreply, socket}
  end

  # --- privadas ---

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
