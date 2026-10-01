defmodule Engine.Anamnese.ElegibilidadeTest do
  @moduledoc """
  RN-680 (ADR 0196): a Anamnese não roda sem SUJEITO elegível — membro
  efetivo, fora do opt-out, com interação PRÓPRIA no que a rodada mostra ao
  modelo (evento de `actor_kind: "user"` ou decisão).
  """

  use ExUnit.Case, async: true

  alias Engine.Anamnese.Elegibilidade

  @dani %{"userId" => "user-1", "name" => "Dani", "email" => "d@x", "role" => "owner"}
  @calada %{"userId" => "user-2", "name" => "Calada", "email" => "c@x", "role" => "viewer"}

  defp evento(actor_kind, actor_id), do: %{actor_kind: actor_kind, actor_id: actor_id}

  test "caminho feliz: membro com evento próprio na janela é sujeito, o calado não" do
    assert {:ok, [@dani]} =
             Elegibilidade.avaliar(%{
               members: [@dani, @calada],
               events: [evento("user", "user-1"), evento("agent", "po")],
               decisions: []
             })
  end

  test "decisão na janela também faz sujeito" do
    assert {:ok, [@calada]} =
             Elegibilidade.avaliar(%{
               members: [@dani, @calada],
               events: [],
               decisions: [%{"decidedBy" => "user-2"}]
             })
  end

  test "falha: sem membro nenhum — o caso do uso real de 29/09" do
    assert {:sem_sujeito, :nenhum_membro, detalhe} =
             Elegibilidade.avaliar(%{
               members: [],
               events: [evento("user", "user-1")],
               decisions: []
             })

    assert detalhe =~ "nenhum membro"
  end

  test "falha: membro sem interação própria — só agentes e outra pessoa falaram" do
    assert {:sem_sujeito, :nenhuma_interacao_propria, detalhe} =
             Elegibilidade.avaliar(%{
               members: [@dani],
               # Um agente com o mesmo id não conta: só `actor_kind: "user"`.
               events: [evento("agent", "user-1"), evento("user", "estranho")],
               decisions: [%{"decidedBy" => nil}]
             })

    assert detalhe =~ "1 membro(s)"
    assert detalhe =~ "2 evento(s)"
  end
end
