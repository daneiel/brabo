defmodule Engine.Gates.Dispatcher do
  @moduledoc """
  Indireção pra disparar os gates (QA/SecOps) a partir do
  `Engine.Dev.DevAgentServer`/`Engine.Gates.QaAgentServer` — trocável em
  teste (evita subir GenServers reais que tocam o banco fora do sandbox
  Ecto do processo de teste), mesmo padrão de `worktree_manager()` em
  `DevAgentServer`.
  """

  @callback run_qa(project_id :: String.t(), task_id :: String.t()) :: :ok
  @callback run_secops(project_id :: String.t(), task_id :: String.t()) :: :ok

  @doc """
  Gates de PR de infra (Fase 4a — InfraAgent): mesma indireção, mas
  DETERMINÍSTICOS de ponta a ponta (sem GenServer próprio nem LLM) —
  `Engine.Infra.InfraGateRunner` roda em `Task.start` (fire-and-forget,
  mesmo espírito assíncrono de um `GenServer.cast`).
  """
  @callback run_infra_qa(
              project_id :: String.t(),
              session_id :: String.t(),
              pr_action_id :: String.t()
            ) ::
              :ok
  @callback run_infra_secops(
              project_id :: String.t(),
              session_id :: String.t(),
              pr_action_id :: String.t()
            ) :: :ok

  def run_qa(project_id, task_id), do: impl().run_qa(project_id, task_id)
  def run_secops(project_id, task_id), do: impl().run_secops(project_id, task_id)

  def run_infra_qa(project_id, session_id, pr_action_id),
    do: impl().run_infra_qa(project_id, session_id, pr_action_id)

  def run_infra_secops(project_id, session_id, pr_action_id),
    do: impl().run_infra_secops(project_id, session_id, pr_action_id)

  defp impl, do: Application.get_env(:engine, :gate_dispatcher, Engine.Gates.Dispatcher.Live)
end

defmodule Engine.Gates.Dispatcher.Live do
  @moduledoc "Sobe (se preciso) e dispara o QAAgent/SecOpsAgent de verdade."

  @behaviour Engine.Gates.Dispatcher

  alias Engine.Gates.{QaAgentServer, QaAgentSupervisor, SecOpsAgentServer, SecOpsAgentSupervisor}

  @impl true
  def run_qa(project_id, task_id) do
    {:ok, _pid, _origin} = QaAgentSupervisor.start_agent(project_id)
    QaAgentServer.run(project_id, task_id)
    :ok
  end

  @impl true
  def run_secops(project_id, task_id) do
    {:ok, _pid, _origin} = SecOpsAgentSupervisor.start_agent(project_id)
    SecOpsAgentServer.run(project_id, task_id)
    :ok
  end

  @impl true
  def run_infra_qa(project_id, session_id, pr_action_id) do
    Task.start(fn ->
      Engine.Infra.InfraGateRunner.run_qa(project_id, session_id, pr_action_id)
    end)

    :ok
  end

  @impl true
  def run_infra_secops(project_id, session_id, pr_action_id) do
    Task.start(fn ->
      Engine.Infra.InfraGateRunner.run_secops(project_id, session_id, pr_action_id)
    end)

    :ok
  end
end
