defmodule EngineWeb.CredencialNoRunnerTest do
  @moduledoc """
  AT-111 — a CORRENTE da RN-558, do `git fetch` autenticado ao desfecho durável,
  atravessando o canal de verdade.

  `workspace_runner_test.exs` prova o elo `RunnerGit` -> `CredencialDeGit` com um
  runner dublê que FABRICA a recusa a partir de `CredencialDeGit.marca()` — ou
  seja, com a marca do próprio engine, sem canal e sem o texto que o runner
  escreve. Aqui a resposta do runner é a saída REAL de `tratarExec`
  (`apps/runner/fixtures/exec-result-recusa-de-credencial.json`, que o spec do
  runner compara byte a byte contra o que o código dele produz), e ela entra
  pelo `TerminalChannel` de verdade: `RunnerGit` -> `RunnerRouter` ->
  `TerminalChannel` (push `exec` com `env`) -> `exec_result` -> `RunnerGit` ->
  `CredencialDeGit` -> `DevAgentServer` (`dev.blocked` com origem `politica`).

  ## O que isto NÃO prova

  Não executa o runner TypeScript: nenhum processo `node` sobe aqui (o job do
  engine não instala o workspace pnpm). O elo `runner -> saída` é provado no
  spec do runner, contra o MESMO arquivo, e o par é o que fecha a corrente: os
  dois lados dependem de uma fixture que só muda se alguém a editar de
  propósito. Também não prova o `docker exec` real nem o `git fetch` real.
  """
  use EngineWeb.ChannelCase, async: false

  alias Engine.Actions.Workspace
  alias Engine.Dev.{DevAgentServer, FakeWorktreeManager}
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Runners.{CredencialDeGit, Registry, SocketTicket}
  alias Engine.Sessions.FakeEngineApiClient

  @fixture Path.expand(
             "../../../../runner/fixtures/exec-result-recusa-de-credencial.json",
             __DIR__
           )

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
    end)

    id = Ecto.UUID.generate()

    Engine.Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path, workspace_verified_at) " <>
        "VALUES ($1, 'proj', 'proj', $2, 'runner', $3, now())",
      [
        Ecto.UUID.dump!(id),
        "at111-#{System.unique_integer([:positive])}",
        Path.join(System.tmp_dir!(), "brabo-at111-#{System.unique_integer([:positive])}")
      ]
    )

    Engine.DataCase.container_running!(id)

    {:ok, %{ticket: bruto}} = SocketTicket.emitir(id, Ecto.UUID.generate(), "runner")

    socket =
      Phoenix.ChannelTest.socket(EngineWeb.RunnerSocket, nil, %{
        ticket: bruto,
        project_id: id,
        user_id: nil,
        kind: "runner"
      })

    {:ok, _reply, canal} =
      Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{id}", %{
        "capacidades" => ["exec", "pty"]
      })

    on_exit(fn -> Registry.unregister(id) end)

    %{project_id: id, canal: canal}
  end

  # Token GERADO em runtime, nunca literal: fixture de segredo em disco é o
  # que o varredor da esteira pega.
  defp remoto_com_token do
    %{
      origin: "/tmp/nao-existe.git",
      default_branch: "main",
      token: "tok-" <> Base.encode16(:crypto.strong_rand_bytes(8), case: :lower),
      username: "x-access-token"
    }
  end

  defp resposta_gravada_do_runner(ref) do
    @fixture |> File.read!() |> Jason.decode!() |> Map.put("ref", ref)
  end

  # O runner do teste: recebe cada `exec` empurrado pelo CANAL REAL, registra o
  # que chegou (comando, env) e responde por `exec_result` no mesmo canal.
  # `fetch_com_env` diz o que responder ao `git fetch` que carrega credencial.
  defp rodar_ate_o_fim(canal, tarefa, fetch_com_env, vistos \\ []) do
    receive do
      %Phoenix.Socket.Message{event: "exec", payload: %{ref: ref, command: comando} = p} ->
        resposta =
          cond do
            Map.has_key?(p, :env) and String.contains?(comando, "fetch origin") ->
              fetch_com_env.(ref)

            String.starts_with?(comando, "test ") ->
              %{"ref" => ref, "exitCode" => 1, "output" => "", "timedOut" => false}

            true ->
              %{"ref" => ref, "exitCode" => 0, "output" => "", "timedOut" => false}
          end

        Phoenix.ChannelTest.push(canal, "exec_result", resposta)
        rodar_ate_o_fim(canal, tarefa, fetch_com_env, [{comando, Map.get(p, :env)} | vistos])

      {ref, resultado} when ref == tarefa.ref ->
        Process.demonitor(ref, [:flush])
        {resultado, Enum.reverse(vistos)}
    after
      5_000 -> flunk("a corrente não terminou: vistos=#{inspect(Enum.reverse(vistos))}")
    end
  end

  test "container ativo: a recusa REAL do runner atravessa o canal e vira desfecho `politica`",
       %{project_id: id, canal: canal} do
    remoto = remoto_com_token()
    tarefa = Task.async(fn -> Workspace.ensure_remoto(id, remoto) end)

    {resultado, vistos} =
      rodar_ate_o_fim(canal, tarefa, &resposta_gravada_do_runner/1)

    # Elo 1 — a credencial saiu do engine e CHEGOU ao canal, só no fetch.
    [{_, env}] = Enum.filter(vistos, fn {c, _} -> String.contains?(c, "fetch origin") end)
    assert env == %{"BRABO_GIT_USERNAME" => remoto.username, "BRABO_GIT_TOKEN" => remoto.token}
    # E só nele: os outros comandos da cadeia nunca carregam credencial.
    assert Enum.all?(vistos, fn {c, e} -> String.contains?(c, "fetch origin") or e == nil end)

    # Elo 2 — a saída gravada do runner carrega a marca que o engine procura.
    assert CredencialDeGit.recusada?(resposta_gravada_do_runner("x")["output"])

    # Elo 3 — RunnerGit devolve a mensagem NOMEADA, com a saída do runner.
    assert {:error, mensagem} = resultado
    assert mensagem =~ "credencial de git"
    assert mensagem =~ "NADA foi executado"
    refute mensagem =~ "git fetch falhou"
    assert CredencialDeGit.recusada?(mensagem)
    refute mensagem =~ remoto.token

    # Elo 4 — o desfecho do dev agent: motivo próprio, origem `politica`, e o
    # registro é o evento durável `dev.blocked` + a task devolvida.
    assert {"credencial de git não atravessa o container do runner", "politica"} =
             CredencialDeGit.desfecho(mensagem)

    assert_dev_agent_bloqueia_por_politica(id, mensagem)
  end

  test "sem container ativo no runner (reiniciado): o fetch responde 0 e a corrente segue",
       %{project_id: id, canal: canal} do
    remoto = remoto_com_token()
    tarefa = Task.async(fn -> Workspace.ensure_remoto(id, remoto) end)

    {resultado, vistos} =
      rodar_ate_o_fim(canal, tarefa, fn ref ->
        %{"ref" => ref, "exitCode" => 0, "output" => "", "timedOut" => false}
      end)

    assert {:ok, _dir} = resultado
    [{_, env}] = Enum.filter(vistos, fn {c, _} -> String.contains?(c, "fetch origin") end)
    assert env["BRABO_GIT_TOKEN"] == remoto.token
  end

  test "falha REAL do fetch pelo canal (sem a marca) segue `codigo`, nunca `politica`",
       %{project_id: id, canal: canal} do
    tarefa = Task.async(fn -> Workspace.ensure_remoto(id, remoto_com_token()) end)

    {{:error, mensagem}, _} =
      rodar_ate_o_fim(canal, tarefa, fn ref ->
        %{
          "ref" => ref,
          "exitCode" => 128,
          "output" => "fatal: Authentication failed",
          "timedOut" => false
        }
      end)

    assert mensagem =~ "git fetch falhou"
    refute CredencialDeGit.recusada?(mensagem)
    assert {_motivo, "codigo"} = CredencialDeGit.desfecho(mensagem)
  end

  defp assert_dev_agent_bloqueia_por_politica(project_id, mensagem) do
    session_id = Ecto.UUID.generate()

    {:ok, state} =
      DevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, nil, nil})

    Process.put(:fake_tasks, [%{"id" => "task-at111", "title" => "Qualquer"}])
    Process.put(:fake_worktree_error, mensagem)

    assert {:noreply, _} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _,
                     %{
                       type: "dev.blocked",
                       payload: %{
                         reason: "credencial de git não atravessa o container do runner",
                         origem: "politica"
                       }
                     }}

    assert_received {:task_blocked, "task-at111",
                     "credencial de git não atravessa o container do runner", _, "dev-api"}
  end
end
