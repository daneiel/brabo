defmodule Engine.Shutdown do
  @moduledoc """
  Drenagem de sessões no desligamento da réplica (Fase 5, item 4).

  ## Por que isto é um comando chamado de fora, e não `terminate/2`

  O `SessionServer` não trapa exits e não tem `terminate/2`. Quando o
  `SessionSupervisor` desce, cada sessão recebe `exit(:shutdown)` e morre
  **instantaneamente**, sem executar nada. Acrescentar `trap_exit` em cada
  sessão resolveria pela metade: o supervisor concede 5 s por filho, e o drain
  precisa de rede (evento na api, handoff para outro nó) — 5 s não bastam, e
  estourá-los vira `brutal_kill`.

  Então o drain é **proativo**: o hook `preStop` do Kubernetes chama
  `drain/0` ANTES do SIGTERM, com o BEAM inteiro ainda de pé — Repo, cliente
  HTTP e cluster Erlang disponíveis. Só depois o SIGTERM derruba a árvore, e aí
  já não há sessão local para perder.

  ## O que acontece com cada sessão

  1. `Readiness.begin_shutdown/0` — `/ready` passa a 503, o pod sai dos
     Endpoints do Service e nenhuma sessão nova chega
     (`SessionCommandController` também recusa com 503).
  2. Para cada sessão **deste nó** (`:global` filtrado por `node(pid)`):
     emite `session.draining` no log da sessão (evento normal, visível ao
     usuário), para o processo local e tenta o **handoff** para um par vivo.
  3. Espera as adoções até `SHUTDOWN_DRAIN_TIMEOUT_MS`.
  4. Quem não foi adotado é encerrado com causa `node_shutdown`:
     `active → closing → closed_abnormally`. O Psicólogo então o analisa como
     término anormal de causa conhecida (`TerminationClassifier`).

  Sessão adotada continua `active` na api e nunca vira `closing` — a máquina de
  estados não permite voltar de `closing` para `active`, então anunciar
  `closing` para tudo tornaria a adoção impossível.
  """

  require Logger

  alias Engine.Readiness
  alias Engine.Sessions.{SessionServer, SessionState, SessionSupervisor}

  # Por par, por sessão. Curto de propósito: se um par não responde rápido, é
  # melhor encerrar a sessão com causa conhecida do que arriscar o SIGKILL.
  @handoff_timeout_ms 5_000

  @doc """
  Ponto de entrada do `preStop`.

  Devolve um resumo (`%{total:, adopted:, terminated:}`) em vez de `:ok` porque
  o `preStop` é um dos poucos lugares do sistema onde o log do processo é
  difícil de capturar: ele roda enquanto o pod está sendo removido, e quem
  investiga depois costuma ter só o stdout do hook. Com o resumo no valor de
  retorno, `bin/engine rpc "…drain()"` imprime o que aconteceu.

  Nunca levanta: um drain que falhasse faria o Kubernetes seguir para o
  SIGTERM do mesmo jeito, só que sem nenhum registro.
  """
  def drain(opts \\ []) do
    Readiness.begin_shutdown()

    sessions = local_sessions()
    Logger.info("shutdown: drenando #{length(sessions)} sessão(ões) locais")

    # Cada sessão é isolada: uma que falhe (par que sumiu no meio do handoff,
    # processo que já morreu, banco lento) não pode abortar a drenagem das
    # outras. Sem esse isolamento, a primeira exceção deixava as demais
    # sessões para o SIGTERM — e elas terminavam como `killed`, não como
    # `node_shutdown`.
    Enum.each(sessions, &safe_release/1)

    not_adopted = await_adoption(sessions, drain_timeout_ms(opts))
    Enum.each(not_adopted, &terminate_unadopted/1)

    summary = %{
      node: to_string(node()),
      peers: length(Node.list()),
      total: length(sessions),
      adopted: length(sessions) - length(not_adopted),
      terminated: length(not_adopted)
    }

    Logger.info("shutdown: drain concluído — #{inspect(summary)}")
    summary
  rescue
    e ->
      Logger.error("shutdown: drain falhou: #{Exception.message(e)}")
      %{error: Exception.message(e)}
  catch
    kind, reason ->
      Logger.error("shutdown: drain falhou: #{inspect(kind)} #{inspect(reason)}")
      %{error: inspect({kind, reason})}
  end

  @doc """
  Sessões cujo dono `:global` é um processo DESTE nó.

  O filtro por `node/1` é o ponto todo: num cluster, `session_states` lista as
  sessões de todas as réplicas, e drenar as dos outros seria encerrar sessão
  saudável de um pod que não está desligando.
  """
  def local_sessions do
    SessionState.list_non_terminal()
    |> Enum.filter(fn s ->
      case SessionServer.whereis(s.session_id) do
        pid when is_pid(pid) -> node(pid) == node()
        nil -> false
      end
    end)
  end

  defp safe_release(state) do
    release(state)
  rescue
    e ->
      Logger.warning("shutdown: falha ao soltar #{state.session_id}: #{Exception.message(e)}")
      :ok
  catch
    kind, reason ->
      Logger.warning(
        "shutdown: falha ao soltar #{state.session_id}: #{inspect(kind)} #{inspect(reason)}"
      )

      :ok
  end

  # Emite o evento e solta o nome global, para que outro nó possa assumir.
  defp release(state) do
    emit_draining_event(state)

    if pid = SessionServer.whereis(state.session_id) do
      # `expect_stop` evita que o Monitor reporte este stop como término: quem
      # decide o desfecho é o drain, depois de saber se houve adoção.
      Engine.Sessions.Monitor.expect_stop(state.session_id)
      SessionServer.stop(pid)
    end

    handoff(state)
  end

  defp emit_draining_event(state) do
    client().append_event(state.project_id, state.session_id, %{
      type: "session.draining",
      actorKind: "system",
      actorId: "engine",
      payload: %{cause: "node_shutdown", node: to_string(node())}
    })
  catch
    kind, reason ->
      Logger.warning(
        "shutdown: falha ao emitir session.draining de #{state.session_id}: " <>
          "#{inspect(kind)} #{inspect(reason)}"
      )
  end

  # Pede a um par vivo que assuma a sessão. Sem par (réplica única, scale-down
  # para zero), não há adoção possível e a sessão será encerrada adiante.
  defp handoff(state) do
    case Node.list() do
      [] ->
        :ok

      peers ->
        Enum.find_value(peers, fn peer ->
          # Timeout OBRIGATÓRIO: `:erpc.call/4` usa `:infinity` por default, e
          # um par que trave (ou que esteja ele próprio drenando) prenderia o
          # preStop até o fim do terminationGracePeriodSeconds — aí o kubelet
          # manda SIGKILL no meio da drenagem e o resultado é pior do que não
          # ter drenado: parte das sessões avisada, parte morta como `killed`.
          case :erpc.call(
                 peer,
                 SessionSupervisor,
                 :start_session,
                 [
                   state.session_id,
                   state.project_id
                 ],
                 @handoff_timeout_ms
               ) do
            {:ok, _pid} -> peer
            _ -> nil
          end
        end)

        :ok
    end
  rescue
    _ -> :ok
  catch
    _, _ -> :ok
  end

  # Espera até o timeout que as sessões passem a ter dono em OUTRO nó.
  defp await_adoption(sessions, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_await(sessions, deadline)
  end

  defp do_await(sessions, deadline) do
    pending = Enum.reject(sessions, &adopted?/1)

    cond do
      pending == [] -> []
      System.monotonic_time(:millisecond) >= deadline -> pending
      true -> Process.sleep(250) && do_await(pending, deadline)
    end
  end

  defp adopted?(state) do
    case SessionServer.whereis(state.session_id) do
      pid when is_pid(pid) -> node(pid) != node()
      nil -> false
    end
  end

  # `active → closing` (causa) e em seguida `closing → closed_abnormally`. Os
  # dois passos são explícitos porque a máquina de estados da api não aceita
  # `active → closed_abnormally` com a causa preservada em `closing`, e é o
  # `closing` com causa que documenta POR QUE a sessão parou.
  defp terminate_unadopted(state) do
    client().report_termination(state.project_id, state.session_id, "node_shutdown", "closing")

    client().report_termination(
      state.project_id,
      state.session_id,
      "node_shutdown",
      "closed_abnormally"
    )

    SessionState.delete(state.session_id)
  catch
    kind, reason ->
      Logger.warning(
        "shutdown: falha ao encerrar #{state.session_id}: #{inspect(kind)} #{inspect(reason)}"
      )
  end

  defp drain_timeout_ms(opts) do
    Keyword.get_lazy(opts, :timeout_ms, fn ->
      Application.get_env(:engine, :shutdown_drain_timeout_ms, 45_000)
    end)
  end

  defp client do
    Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
  end
end
