defmodule Engine.Harness.Tools.ListarAdrsPropostasTest do
  @moduledoc """
  RN-772 (AT-454): o Arquiteto dizia "as 3 ADRs seguem pendentes" depois de o
  usuário aprovar as três, porque só conhecia o `tool.result` da proposta. A
  leitura devolve o status ATUAL, escopado ao projeto, com teto declarado.
  """

  use Engine.DataCase, async: false

  alias Engine.Harness.Tools.ListarAdrsPropostas

  defp adr!(project_id, titulo, status, extra \\ %{}) do
    Repo.insert_all("proposed_actions", [
      Map.merge(
        %{
          id: Ecto.UUID.dump!(Ecto.UUID.generate()),
          project_id: Ecto.UUID.dump!(project_id),
          session_id: Ecto.UUID.dump!(Ecto.UUID.generate()),
          action_type: "open_adr_pr",
          status: status,
          resolved_policy: "require_approval",
          actor_kind: "agent",
          actor_id: "arquiteto",
          payload: %{"title" => titulo}
        },
        extra
      )
    ])
  end

  setup do
    %{project_id: Ecto.UUID.generate()}
  end

  test "proposta aprovada aparece como aprovada, e só as do projeto", %{project_id: p} do
    adr!(p, "ADR banco", "approved")
    adr!(p, "ADR fila", "executed", %{execution_result: %{"pullRequestUrl" => "http://pr/1"}})
    adr!(p, "ADR cache", "denied", %{rejection_reason: "não precisa"})
    adr!(Ecto.UUID.generate(), "ADR de outro projeto", "pending")

    {:ok, texto} = ListarAdrsPropostas.run(%{}, %{project_id: p})

    assert texto =~ "3 ADR(s) proposta(s)"
    assert texto =~ "ADR banco | APROVADA"
    assert texto =~ "ADR fila | APROVADA e EXECUTADA (PR aberta) | PR: http://pr/1"
    assert texto =~ "ADR cache | RECUSADA | motivo: não precisa"
    refute texto =~ "outro projeto"
    refute texto =~ "PENDENTE"
  end

  test "corta no teto e declara o total real", %{project_id: p} do
    n = ListarAdrsPropostas.max_linhas() + 3
    for i <- 1..n, do: adr!(p, "ADR #{i}", "pending")

    {:ok, texto} = ListarAdrsPropostas.run(%{}, %{project_id: p})

    assert texto =~ "#{n} ADR(s) proposta(s)"
    assert texto =~ "(+ 3 ADR(s) mais antiga(s) não listada(s)"
  end

  test "sem proposta diz que não há", %{project_id: p} do
    assert {:ok, "Nenhuma ADR proposta" <> _} = ListarAdrsPropostas.run(%{}, %{project_id: p})
  end

  test "falha de leitura vira erro nomeado, nunca silêncio" do
    assert {:error, "falha ao ler as ADRs propostas: " <> _} =
             ListarAdrsPropostas.run(%{}, %{project_id: "nao-e-uuid"})
  end
end
