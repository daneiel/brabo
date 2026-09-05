defmodule Engine.Actions.WorkspaceRunnerTest do
  @moduledoc """
  `Engine.Actions.Workspace.ensure!/4` para projeto `execution_mode: runner`
  (RN-507, ADR 0145).

  Até esta entrega, a lacuna era ABERTA de propósito (RN-478): `ensure!/4`
  tentava `File.mkdir_p!`/`git init` LOCAL contra o caminho do HOST, e a
  única coisa que se corrigia era a MENSAGEM de uma falha inevitável — o
  working tree do dev agent não tinha onde nascer. Este arquivo deixou de
  testar essa mensagem (o defeito que ela explicava não existe mais: `runner`
  não tenta MAIS nenhum I/O local) e passou a testar a PRÉ-CONDIÇÃO nova:
  sem workspace verificado, sem runner conectado, ou sem container
  `running`, `ensure_remoto/2` recusa ANTES de qualquer tentativa — nunca um
  `File.mkdir_p!` fadado a falhar.

  Precisa do banco (`DataCase`) porque a distinção é feita por `Project.get/1`
  e pela leitura de `project_containers`.
  """
  use Engine.DataCase, async: false

  alias Engine.Actions.Workspace
  alias Engine.Runners.Registry

  defp insert_project!(id, attrs) do
    verificado_em = if Map.get(attrs, :verified, false), do: "now()", else: "NULL"

    Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path, workspace_verified_at) " <>
        "VALUES ($1, 'proj', 'proj', $2, $3, $4, #{verificado_em})",
      [
        Ecto.UUID.dump!(id),
        Map.get(attrs, :workspace_dir_name),
        Map.get(attrs, :execution_mode),
        Map.get(attrs, :workspace_path)
      ]
    )
  end

  defp insert_container_lifecycle!(project_id, status) do
    Repo.query!(
      "INSERT INTO public.project_containers " <>
        "(id, project_id, status, image_version, cpus, memory_mb, pids_limit) " <>
        "VALUES ($1, $2, #{status}, 1, 1.0, 512, 128)",
      [Ecto.UUID.dump!(Ecto.UUID.generate()), Ecto.UUID.dump!(project_id)]
    )
  end

  defp remoto, do: %{origin: "/tmp/nao-existe.git", default_branch: "main"}

  defp caminho_impossivel do
    Path.join(
      System.tmp_dir!(),
      "brabo-pasta-do-host-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
    )
  end

  # Fake runner GENÉRICO: responde a QUALQUER `exec` recebido, sempre no
  # mesmo processo (a materialização é uma cadeia SÍNCRONA de comandos, um de
  # cada vez). `test -f`/`test -d` (as checagens de "já pronto?"/"já é repo?"
  # de `RunnerGit`) precisam responder NEGATIVO (status 1) — sem isso, a
  # primeira checagem de idempotência "acharia" a marca antes de ela existir
  # e o teste nunca veria os comandos de init de verdade.
  defp start_fake_runner_loop!(project_id) do
    parent = self()

    pid =
      spawn(fn ->
        Ecto.Adapters.SQL.Sandbox.allow(Engine.Repo, parent, self())
        :ok = Registry.register(project_id, self())
        send(parent, :fake_runner_ready)
        fake_runner_loop(parent)
      end)

    assert_receive :fake_runner_ready, 1_000
    on_exit(fn -> Process.exit(pid, :kill) end)
    pid
  end

  defp fake_runner_loop(parent) do
    receive do
      {:dispatch_exec, ref, command, _cwd, _env, from, _timeout_ms} ->
        send(parent, {:comando_recebido, command})
        exit_code = if String.starts_with?(command, "test "), do: 1, else: 0

        send(
          from,
          {:runner_exec_result, ref,
           %{"exitCode" => exit_code, "output" => "", "timedOut" => false}}
        )

        fake_runner_loop(parent)
    end
  end

  defp coletar_comandos(acc \\ []) do
    receive do
      {:comando_recebido, c} -> coletar_comandos([c | acc])
    after
      100 -> Enum.reverse(acc)
    end
  end

  # Variante que também captura `env` — usada só pelo teste de credencial
  # (RN-507), que precisa provar que `env` viaja SÓ no `git fetch`, nunca nos
  # outros comandos da mesma cadeia.
  defp start_fake_runner_loop_capturando_env!(project_id) do
    parent = self()

    pid =
      spawn(fn ->
        Ecto.Adapters.SQL.Sandbox.allow(Engine.Repo, parent, self())
        :ok = Registry.register(project_id, self())
        send(parent, :fake_runner_ready)
        fake_runner_loop_com_env(parent)
      end)

    assert_receive :fake_runner_ready, 1_000
    on_exit(fn -> Process.exit(pid, :kill) end)
    pid
  end

  defp fake_runner_loop_com_env(parent) do
    receive do
      {:dispatch_exec, ref, command, _cwd, env, from, _timeout_ms} ->
        send(parent, {:comando_com_env, command, env})
        exit_code = if String.starts_with?(command, "test "), do: 1, else: 0

        send(
          from,
          {:runner_exec_result, ref,
           %{"exitCode" => exit_code, "output" => "", "timedOut" => false}}
        )

        fake_runner_loop_com_env(parent)
    end
  end

  defp coletar_comandos_com_env(acc \\ []) do
    receive do
      {:comando_com_env, c, env} -> coletar_comandos_com_env([{c, env} | acc])
    after
      100 -> Enum.reverse(acc)
    end
  end

  test "runner sem workspace verificado: recusa nomeada, sem tentar I/O nenhum" do
    id = Ecto.UUID.generate()
    pasta = caminho_impossivel()

    insert_project!(id, %{
      execution_mode: "runner",
      workspace_dir_name: "exp002-f52be111",
      workspace_path: pasta,
      verified: false
    })

    assert {:error, mensagem} = Workspace.ensure_remoto(id, remoto())
    assert mensagem =~ "ainda não teve o workspace confirmado"
    refute mensagem =~ "Falha original:"
    refute File.exists?(pasta)
  end

  test "runner verificado mas sem runner conectado: recusa nomeada" do
    id = Ecto.UUID.generate()
    pasta = caminho_impossivel()

    insert_project!(id, %{
      execution_mode: "runner",
      workspace_dir_name: "exp002-f52be111",
      workspace_path: pasta,
      verified: true
    })

    assert {:error, mensagem} = Workspace.ensure_remoto(id, remoto())
    assert mensagem =~ "nenhum runner está conectado"
    refute File.exists?(pasta)
  end

  test "runner verificado e conectado, mas SEM container running: recusa nomeada (RN-507)" do
    id = Ecto.UUID.generate()
    pasta = caminho_impossivel()

    insert_project!(id, %{
      execution_mode: "runner",
      workspace_dir_name: "exp002-f52be111",
      workspace_path: pasta,
      verified: true
    })

    :ok = Registry.register(id, self())
    on_exit(fn -> Registry.unregister(id) end)

    assert {:error, mensagem} = Workspace.ensure_remoto(id, remoto())
    assert mensagem =~ "não tem container REGISTRADO como `running`"
    assert mensagem =~ "RN-507"
    refute File.exists?(pasta)
  end

  test "runner PRONTO (verificado+conectado+container running): materializa via canal, sem I/O local" do
    id = Ecto.UUID.generate()
    pasta = caminho_impossivel()

    insert_project!(id, %{
      execution_mode: "runner",
      workspace_dir_name: "exp-abc12345",
      workspace_path: pasta,
      verified: true
    })

    insert_container_lifecycle!(id, "'running'")
    start_fake_runner_loop!(id)

    assert {:ok, dir} = Workspace.ensure_remoto(id, remoto())
    assert dir == pasta
    # A prova de que NADA rodou local: a pasta nunca chegou a existir no
    # filesystem do engine — o `mkdir -p` foi um comando ENTREGUE ao runner,
    # não uma chamada real a `File.mkdir_p!`.
    refute File.exists?(pasta)

    comandos = coletar_comandos()
    assert Enum.any?(comandos, &(&1 == "git init"))
    assert Enum.any?(comandos, &String.starts_with?(&1, "git remote add origin"))
    assert Enum.any?(comandos, &(&1 == "git fetch origin"))
    assert Enum.any?(comandos, &String.starts_with?(&1, "git checkout -B"))
    assert Enum.any?(comandos, &String.starts_with?(&1, "touch "))
  end

  test "runner PRONTO com credencial (ADR 0056): env chega SÓ no git fetch, nunca nos outros comandos" do
    id = Ecto.UUID.generate()
    pasta = caminho_impossivel()

    insert_project!(id, %{
      execution_mode: "runner",
      workspace_dir_name: "exp-cred12345",
      workspace_path: pasta,
      verified: true
    })

    insert_container_lifecycle!(id, "'running'")
    start_fake_runner_loop_capturando_env!(id)

    remoto_com_token = %{
      origin: "/tmp/nao-existe.git",
      default_branch: "main",
      token: "fake-nao-e-segredo-de-verdade",
      username: "x-access-token"
    }

    assert {:ok, _dir} = Workspace.ensure_remoto(id, remoto_com_token)

    comandos = coletar_comandos_com_env()

    {_fetch_cmd, env_do_fetch} =
      Enum.find(comandos, fn {c, _env} -> String.contains?(c, "fetch origin") end)

    assert env_do_fetch == %{
             "BRABO_GIT_USERNAME" => "x-access-token",
             "BRABO_GIT_TOKEN" => "fake-nao-e-segredo-de-verdade"
           }

    # NENHUM outro comando da cadeia (mkdir/init/remote add/checkout/touch)
    # carrega a credencial — ela é do `fetch`, e só dele.
    outros = Enum.reject(comandos, fn {c, _env} -> String.contains?(c, "fetch origin") end)
    assert outros != []
    assert Enum.all?(outros, fn {_c, env} -> env == nil end)
  end

  test "projeto no modo de sempre: mensagem original passa intacta, sem menção a runner nem RN-507" do
    id = Ecto.UUID.generate()

    insert_project!(id, %{execution_mode: "container", workspace_dir_name: "loja-abcdefgh"})

    Application.put_env(:engine, :project_workspaces_root, caminho_impossivel())

    on_exit(fn ->
      Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())
    end)

    assert {:error, mensagem} = Workspace.ensure_remoto(id, remoto())

    refute mensagem =~ "runner"
    refute mensagem =~ "RN-507"
  end
end
