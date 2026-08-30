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
