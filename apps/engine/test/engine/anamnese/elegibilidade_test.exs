defmodule Engine.Anamnese.ElegibilidadeTest do
  @moduledoc """
  RN-680 (ADR 0196): a Anamnese não roda sem SUJEITO elegível — membro
  efetivo, fora do opt-out, com interação PRÓPRIA no que a rodada mostra ao
  modelo (evento de `actor_kind: "user"` ou decisão).
  """

  # async: false — o piso de interações (RN-722) é config global.
  use ExUnit.Case, async: false

  alias Engine.Anamnese.Elegibilidade

  @dani %{"userId" => "user-1", "name" => "Dani", "email" => "d@x", "role" => "owner"}
  @calada %{"userId" => "user-2", "name" => "Calada", "email" => "c@x", "role" => "viewer"}

  # Os testes da régua de SUJEITO (RN-680) usam UMA interação; o piso de 5
  # da RN-722 tem os testes dele no fim.
  setup do
    Application.put_env(:engine, :anamnese_min_interacoes_proprias, 1)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_min_interacoes_proprias) end)
    :ok
  end

  defp evento(actor_kind, actor_id, type \\ "chat.message"),
    do: %{actor_kind: actor_kind, actor_id: actor_id, type: type}

  defp recusa(quem),
    do: %{"decidedBy" => quem, "status" => "rejected", "rejectionReason" => "use JWT curto"}

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
               decisions: [recusa("user-2")]
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

  describe "piso de 5 interações próprias novas (RN-722)" do
    setup do
      Application.delete_env(:engine, :anamnese_min_interacoes_proprias)
      :ok
    end

    test "cinco (eventos e decisões somados) fazem sujeito" do
      assert {:ok, [@dani]} =
               Elegibilidade.avaliar(%{
                 members: [@dani],
                 events: List.duplicate(evento("user", "user-1"), 3),
                 decisions: List.duplicate(recusa("user-1"), 2)
               })
    end

    test "falha: quatro não fazem, e o motivo diz o piso" do
      assert {:sem_sujeito, :nenhuma_interacao_propria, detalhe} =
               Elegibilidade.avaliar(%{
                 members: [@dani],
                 events: List.duplicate(evento("user", "user-1"), 4),
                 decisions: []
               })

      assert detalhe =~ "5+"
    end
  end

  describe "só interação com conteúdo técnico conta (RN-756, AT-439)" do
    test "caminho feliz: mensagem escrita e resposta estruturada contam" do
      assert {:ok, [@dani]} =
               Elegibilidade.avaliar(%{
                 members: [@dani],
                 events: [
                   evento("user", "user-1", "chat.message"),
                   evento("user", "user-1", "chat.structured_question_answered")
                 ],
                 decisions: []
               })
    end

    test "falha: só aprovações, handoff e recusa sem motivo — sem sujeito, sem gasto" do
      assert {:sem_sujeito, :nenhuma_interacao_propria, detalhe} =
               Elegibilidade.avaliar(%{
                 members: [@dani],
                 events: [
                   evento("user", "user-1", "handoff.accepted"),
                   evento("user", "user-1", "proposed_action.approved")
                 ],
                 decisions: [
                   %{"decidedBy" => "user-1", "status" => "approved"},
                   %{"decidedBy" => "user-1", "status" => "rejected", "rejectionReason" => " "}
                 ]
               })

      assert detalhe =~ "RN-756"
    end
  end
end
