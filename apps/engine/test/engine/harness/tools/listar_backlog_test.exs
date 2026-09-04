defmodule Engine.Harness.Tools.ListarBacklogTest do
  @moduledoc """
  RN-164: a metade "o que eu já escrevi". A asserção que importa mais é a do
  épico ÓRFÃO: é o estado que trava a execução inteira (sem história não há
  tarefa), e o relatório precisa dizê-lo antes da árvore, não depois.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.ListarBacklog

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  defp backlog do
    [
      %{
        "id" => "ep-1",
        "title" => "Cadastro",
        "stories" => [
          %{
            "id" => "st-1",
            "title" => "Cadastrar usuário",
            "status" => "ready",
            "businessRuleIds" => ["evt-1"],
            "tasks" => [%{"id" => "tk-1"}]
          }
        ]
      },
      %{"id" => "ep-2", "title" => "Pagamento", "stories" => []}
    ]
  end

  test "renderiza a árvore com épico, história, status e regras", %{ctx: ctx} do
    Process.put(:fake_backlog, backlog())

    assert {:ok, texto} = ListarBacklog.run(%{}, ctx)

    assert_received {:backlog_listed, "p1"}

    assert texto =~ "2 épico(s), 1 história(s), 1 história(s) com tarefa."
    assert texto =~ "ÉPICO id=ep-1 | Cadastro (1 história(s))"
    assert texto =~ "id=st-1 | Cadastrar usuário [status=ready, 1 tarefa(s), regras=evt-1]"
  end

  test "épico sem história aparece como ATENÇÃO, antes da árvore", %{ctx: ctx} do
    Process.put(:fake_backlog, backlog())

    assert {:ok, texto} = ListarBacklog.run(%{}, ctx)

    assert texto =~ "ATENÇÃO: 1 épico(s) SEM NENHUMA HISTÓRIA"
    assert texto =~ "\"Pagamento\" (id=ep-2)"
    assert texto =~ "trava a execução"

    aviso = :binary.match(texto, "ATENÇÃO") |> elem(0)
    arvore = :binary.match(texto, "ÉPICO id=ep-1") |> elem(0)
    assert aviso < arvore
  end

  test "backlog inteiro coberto não gera aviso nenhum", %{ctx: ctx} do
    Process.put(:fake_backlog, [Enum.at(backlog(), 0)])

    assert {:ok, texto} = ListarBacklog.run(%{}, ctx)
    refute texto =~ "ATENÇÃO"
  end

  test "backlog vazio é resposta legítima e diz por onde começar", %{ctx: ctx} do
    Process.put(:fake_backlog, [])

    assert {:ok, texto} = ListarBacklog.run(%{}, ctx)
    assert texto =~ "está VAZIO"
    assert texto =~ "listar_regras_de_negocio"
  end

  test "falha da api vira tool-result de erro", %{ctx: ctx} do
    Process.put(:fake_backlog, {:error, :timeout})

    assert {:error, texto} = ListarBacklog.run(%{}, ctx)
    assert texto =~ "falha ao listar o backlog"
  end
end
