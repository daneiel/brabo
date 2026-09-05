defmodule Engine.Dev.WorktreeCleanupTest do
  @moduledoc """
  A regressão de multi-réplica da Fase 5.

  Enquanto o engine era uma réplica só, "vivo no `Engine.Dev.Registry`" e
  "vivo" eram sinônimos. Com o HPA deixaram de ser: o volume de workspaces é
  compartilhado, então a réplica A varre worktrees de agentes da réplica B —
  que nunca estiveram no Registry local de A — e os apagaria como órfãos, com o
  dev agent ainda escrevendo neles.

  Estes testes simulam a réplica B pela única via que existe entre nós: a linha
  em `dev_agent_states`, sem processo correspondente neste nó.
  """

  # async: false — mexe em Application env global (:project_workspaces_root) e
  # no filesystem, além do banco.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, WorktreeCleanup, WorktreeManager}

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-wtc-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    project_id = Ecto.UUID.generate()
    work_dir = Path.join(root, project_id)
    File.mkdir_p!(work_dir)

    # RN-109: `WorktreeCleanup.run/0` não trata mais nome de pasta como
    # project_id — ele resolve `{id, workspace_dir_name}` de TODOS os
    # projetos numa consulta (`Project.all_workspace_dirs/0`). Sem esta linha
    # o projeto deste teste não apareceria na consulta e a pasta acima nunca
    # seria varrida — o cenário que estes testes existem pra provar
    # simplesmente não rodaria.
    Engine.Repo.insert_all("projects", [
      %{
        id: Ecto.UUID.dump!(project_id),
        name: "cobaia-wtc",
        slug: "cobaia-wtc-#{System.unique_integer([:positive])}",
        workspace_dir_name: project_id,
        created_at: DateTime.utc_now() |> DateTime.truncate(:second),
        updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])

    git(work_dir, ["init"])
    git(work_dir, ["config", "user.email", "t@brabo.dev"])
    git(work_dir, ["config", "user.name", "t"])
    File.write!(Path.join(work_dir, "README.md"), "x")
    git(work_dir, ["add", "-A"])
    git(work_dir, ["commit", "-m", "init"])

    Application.put_env(:engine, :project_workspaces_root, root)

    on_exit(fn ->
      Application.delete_env(:engine, :project_workspaces_root)
      File.rm_rf!(root)
    end)

    %{root: root, project_id: project_id, work_dir: work_dir}
  end

  defp git(cd, args) do
    {_, 0} = System.cmd("git", args, cd: cd, stderr_to_stdout: true)
  end

  # Agente vivo em OUTRA réplica: linha no banco, nada no Registry deste nó.
  defp agent_on_another_replica!(project_id, agent_id) do
    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: agent_id,
      module: "api",
      session_id: Ecto.UUID.generate(),
      worktree_path: "/data/project-workspaces/#{project_id}/.worktrees/#{agent_id}",
      status: "working",
      task_budget_micros: 500_000,
      max_gate_corrections: 2,
      impl: "noop"
    })
  end

  test "NÃO apaga o worktree de um agente vivo em outra réplica", ctx do
    {:ok, _} = WorktreeManager.add_worktree(ctx.work_dir, "dev-api", "task-a")
    agent_on_another_replica!(ctx.project_id, "dev-api")

    refute Registry.lookup(Engine.Dev.Registry, {ctx.project_id, "dev-api"}) != [],
           "pré-condição: o agente não pode estar no Registry DESTE nó"

    :ok = WorktreeCleanup.run()

    assert WorktreeManager.list(ctx.project_id) == ["dev-api"],
           "worktree de agente vivo em outra réplica foi apagado — trabalho em andamento perdido"
  end

  test "continua apagando o worktree de agente que não existe em réplica nenhuma", ctx do
    {:ok, _} = WorktreeManager.add_worktree(ctx.work_dir, "dev-api", "task-a")
    {:ok, _} = WorktreeManager.add_worktree(ctx.work_dir, "dev-web", "task-b")
    agent_on_another_replica!(ctx.project_id, "dev-api")

    :ok = WorktreeCleanup.run()

    assert WorktreeManager.list(ctx.project_id) == ["dev-api"],
           "o órfão de verdade sobreviveu: a poda parou de podar"
  end

  test "live_agents/1 enxerga o agente de outra réplica", ctx do
    agent_on_another_replica!(ctx.project_id, "dev-api")

    assert WorktreeCleanup.live_agents(ctx.project_id) == ["dev-api"]
    assert WorktreeCleanup.live_agents(Ecto.UUID.generate()) == []
  end

  # RN-507/ADR 0145 — a poda ganhou um SEGUNDO caminho, pro modo `runner`, e
  # ele precisa DEGRADAR: sem runner conectado (ou sem container `running`)
  # AGORA, o projeto é pulado nesta rodada — nunca um erro, e nunca uma
  # exceção que derrube `Enum.each/2` antes de chegar nos projetos seguintes.
  test "projeto runner sem runner conectado é pulado em silêncio — o job continua pros outros",
       ctx do
    {:ok, _} = WorktreeManager.add_worktree(ctx.work_dir, "dev-api", "task-a")
    agent_on_another_replica!(ctx.project_id, "dev-api")

    runner_project_id = Ecto.UUID.generate()

    Engine.Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, execution_mode, workspace_path, workspace_verified_at) " <>
        "VALUES ($1, 'proj-runner', 'proj-runner-x', 'runner', '/home/nao/existe', now())",
      [Ecto.UUID.dump!(runner_project_id)]
    )

    assert :ok = WorktreeCleanup.run()

    # O projeto `container` do fixture continua sendo podado normalmente —
    # o projeto `runner`, sem runner conectado nem container `running`, não
    # derrubou o job pros demais.
    assert WorktreeManager.list(ctx.project_id) == ["dev-api"]
  end
end
