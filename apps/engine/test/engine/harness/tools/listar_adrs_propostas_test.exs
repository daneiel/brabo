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
    assert texto =~ "ADR fila | APROVADA e EXECUTADA | estado da PR: NÃO CONSEGUI LER"
    assert texto =~ "ADR cache | RECUSADA | motivo: não precisa"
    refute texto =~ "outro projeto"
    refute texto =~ "PENDENTE"
  end

  # RN-845 (AT-514): o Arquiteto disse "aberta como PR" 30 s depois do merge.
  test "PR mergeada aparece como mergeada, com a data; a sem merge, aberta", %{project_id: p} do
    adr!(p, "ADR banco", "executed", %{
      execution_result: %{"pullRequestUrl" => "local://x/pull/1", "pullRequestId" => "1"}
    })

    adr!(p, "ADR fila", "executed", %{
      execution_result: %{"pullRequestUrl" => "local://x/pull/2", "pullRequestId" => "2"}
    })

    adr!(p, "merge", "executed", %{
      action_type: "git_merge",
      payload: %{"pullRequestId" => "1"},
      decided_at: ~U[2026-10-11 00:37:52.000000Z]
    })

    {:ok, texto} = ListarAdrsPropostas.run(%{}, %{project_id: p})

    assert texto =~ "ADR banco | APROVADA e EXECUTADA | PR MERGEADA em 2026-10-11T00:37:52Z"
    assert texto =~ "ADR fila | APROVADA e EXECUTADA | PR aberta (nenhum merge dela"
  end

  test "estado da PR ilegível diz que não leu, nunca aberta", %{project_id: p} do
    adr!(p, "ADR sem id", "executed", %{execution_result: %{"pullRequestUrl" => "http://pr/9"}})

    {:ok, texto} = ListarAdrsPropostas.run(%{}, %{project_id: p})

    assert texto =~ "NÃO CONSEGUI LER"
    refute texto =~ "PR aberta"
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

  describe "contexto_de_prontidao/2 (RN-849)" do
    test "ADR mergeada aparece MERGEADA", %{project_id: p} do
      adr!(p, "ADR banco", "executed", %{
        execution_result: %{"pullRequestUrl" => "local://x/pull/1", "pullRequestId" => "1"}
      })

      adr!(p, "merge", "executed", %{
        action_type: "git_merge",
        payload: %{"pullRequestId" => "1"},
        decided_at: ~U[2026-10-11 00:37:52.000000Z]
      })

      texto = ListarAdrsPropostas.contexto_de_prontidao(%{project_id: p})
      assert texto =~ "PR MERGEADA em"
      assert texto =~ "Não afirme estado de ADR diferente"
    end

    test "ADR pendente aparece pendente", %{project_id: p} do
      adr!(p, "ADR fila", "pending")

      assert ListarAdrsPropostas.contexto_de_prontidao(%{project_id: p}) =~
               "PENDENTE de aprovação"
    end

    test "leitura que falha diz que não leu, nunca pendente", %{project_id: p} do
      texto =
        ListarAdrsPropostas.contexto_de_prontidao(%{project_id: p}, fn _, _ ->
          {:error, "boom"}
        end)

      assert texto =~ "NÃO CONSEGUI LER"
      refute texto =~ "PENDENTE"
    end
  end
end
