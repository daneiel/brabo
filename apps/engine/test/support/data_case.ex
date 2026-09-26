defmodule Engine.DataCase do
  @moduledoc """
  This module defines the setup for tests requiring
  access to the application's data layer.

  You may define functions here to be used as helpers in
  your tests.

  Finally, if the test case interacts with the database,
  we enable the SQL sandbox, so changes done to the database
  are reverted at the end of every test. If you are using
  PostgreSQL, you can even run database tests asynchronously
  by setting `use Engine.DataCase, async: true`, although
  this option is not recommended for other databases.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      alias Engine.Repo

      import Ecto
      import Ecto.Changeset
      import Ecto.Query
      import Engine.DataCase
    end
  end

  setup tags do
    Engine.DataCase.setup_sandbox(tags)
    :ok
  end

  @doc """
  Sets up the sandbox based on the test tags.

  `tags[:ownership_timeout]` é opcional — sem ele, o default do próprio
  `Ecto.Adapters.SQL.Sandbox` vale (60s). O golden-set de QA (ADR 0123,
  `qa_automacao_agent_golden_test.exs`) precisa de um valor bem maior: ele
  chama um LLM real, e uma chamada de ~150s (modelo grande, carregando peso
  pela primeira vez) ficava mais tempo sem tocar o Postgres do que o padrão
  tolera — a conexão emprestada era reclamada NO MEIO da chamada, e a
  consulta seguinte (instruction files, dentro do ToolLoop) via `Engine.Repo`
  morria com "owner process exited", mascarando uma variância de modelo como
  falha de infraestrutura.
  """
  def setup_sandbox(tags) do
    opts = [shared: not tags[:async]]

    opts =
      case tags[:ownership_timeout] do
        nil -> opts
        timeout -> Keyword.put(opts, :ownership_timeout, timeout)
      end

    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Engine.Repo, opts)
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
  end

  @doc """
  Registra um container `running` para `project_id` em `project_containers`
  (tabela da api, ADR 0081 — o engine só a LÊ).

  Existe porque `Engine.Dev.AgentIo.try_claim/2` passou a exigir essa linha
  antes de reivindicar task nenhuma (RN-502, ADR 0143): sem ela o agente cai
  em `:idle` com `dev.blocked_by_container`, que é o comportamento CERTO e
  o que quase toda spec de dev agent anterior a esta guarda não esperava.

  SQL cru e não um schema Ecto pelo mesmo motivo que o fixture de
  `test_helper.exs`: a tabela é gerenciada pela api (Drizzle), e o engine
  não tem changeset para ela em lugar nenhum. Os quatro `NOT NULL` que a
  api tem (`image_version`/`cpus`/`memory_mb`/`pids_limit`) recebem valores
  plausíveis — o engine nunca lê nenhum deles, só `status`.
  """
  def container_running!(project_id) do
    Engine.Repo.query!(
      "INSERT INTO public.project_containers " <>
        "(id, project_id, status, image_version, cpus, memory_mb, pids_limit) " <>
        "VALUES ($1, $2, 'running', 1, 1.0, 512, 128) " <>
        "ON CONFLICT (project_id) DO UPDATE SET status = 'running'",
      [Ecto.UUID.dump!(Ecto.UUID.generate()), Ecto.UUID.dump!(project_id)]
    )

    project_id
  end

  @doc """
  Cria uma pasta temporária PRÓPRIA e VAZIA para o teste que a chama, e a
  apaga no `on_exit` — o `worktree_path`/`workspace_root` de spec que não
  precisa de arquivo nenhum.

  Existe porque `System.tmp_dir!()` cru como `worktree_path` fazia
  `Engine.Harness.InstructionFiles.Live` percorrer o `/tmp` INTEIRO da
  máquina procurando `AGENTS.md` (walk recursivo sob a raiz): o teste
  passava a medir o `/tmp` de quem roda, e numa máquina com o `/tmp` cheio
  o agente estourava o `assert_receive` antes de chegar ao desfecho
  (AT-204). Fica sob `System.tmp_dir!()` e NÃO sob a pasta do checkout (o
  `@tag :tmp_dir` do ExUnit): o agente pode rodar `git` no worktree, e
  dentro do checkout ele acharia o repositório do Brabo.
  """
  def pasta_temporaria_propria!(prefixo \\ "brabo-teste") do
    pasta =
      Path.join(
        System.tmp_dir!(),
        "#{prefixo}-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(pasta)
    ExUnit.Callbacks.on_exit(fn -> File.rm_rf!(pasta) end)
    pasta
  end

  @doc """
  Encerra os dev agents e os agentes de gate (QA Lead, SecOps) do projeto —
  o `on_exit` de spec que sobe agente REAL (AT-204, mesma classe da AT-180).

  Esses processos são filhos dos supervisores da APLICAÇÃO, não do teste:
  sem isto eles seguem vivos depois do fim. Um dev agent que reivindica a
  próxima task depois do fim do teste grava no banco com o dono da sandbox
  já morto (`owner #PID<…> exited`, em `AgentIo.claim_e_rodar`), e o que ele
  notifica pelo `:test_pid` cai no mailbox do teste SEGUINTE — era o
  `{:task_blocked, …, "dev-api"}` de `QaLeadServerTest`,
  `QaAutomacaoAgentTest` e `QaPerformanceSegurancaAgentTest`.

  Chame DENTRO do `on_exit` e ANTES de soltar o `Application.put_env`: com o
  env solto, o agente que sobra passa a falar com o cliente `Live`.
  """
  def encerrar_agentes_do_projeto(project_id) do
    registros = [
      {Engine.Dev.Registry, [Engine.Dev.DevAgentSupervisor]},
      {Engine.Gates.Registry, [Engine.Gates.QaLeadSupervisor, Engine.Gates.SecOpsAgentSupervisor]}
    ]

    for {registro, supervisores} <- registros,
        pid <-
          Registry.select(registro, [
            {{{:"$1", :_}, :"$2", :_}, [{:==, :"$1", project_id}], [:"$2"]}
          ]),
        supervisor <- supervisores do
      # `{:error, :not_found}` quando o pid é filho do OUTRO supervisor do
      # mesmo registro (ou já saiu) — nos dois casos não há o que encerrar.
      DynamicSupervisor.terminate_child(supervisor, pid)
    end

    :ok
  end

  @doc """
  A helper that transforms changeset errors into a map of messages.

      assert {:error, changeset} = Accounts.create_user(%{password: "short"})
      assert "password is too short" in errors_on(changeset).password
      assert %{password: ["password is too short"]} = errors_on(changeset)

  """
  def errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Regex.replace(~r"%{(\w+)}", message, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
