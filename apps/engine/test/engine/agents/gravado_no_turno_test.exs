defmodule Engine.Agents.GravadoNoTurnoTest do
  # RN-731 (AT-414): o número do que foi gravado no turno é fato do servidor.
  use ExUnit.Case, async: true

  alias Engine.Agents.{GravadoNoTurno, TextoDoTurno}
  alias Engine.Harness.IdiomaDaResposta

  defp regra, do: %{"type" => "business_rule"}

  test "seis regras gravadas: o fecho do modelo fica intacto e ganha o fato ao lado (pt-BR)" do
    for _ <- 1..6, do: GravadoNoTurno.anotar("emit_artifact", regra(), {:ok, "ok"})
    GravadoNoTurno.anotar("emit_artifact", %{"type" => "decision_record"}, {:ok, "ok"})
    # recusada não conta como gravada; é dita à parte (RN-746)
    GravadoNoTurno.anotar("emit_artifact", regra(), {:error, "schema"})
    # leitura não conta
    GravadoNoTurno.anotar("listar_regras_de_negocio", %{}, {:ok, "..."})

    fecho = "Registrei as 8 regras de negócio e a decisão técnica."

    payload =
      IdiomaDaResposta.com_idioma_do_autor("pt-BR", fn ->
        TextoDoTurno.payload_do_turno(fecho, "m")
      end)

    assert payload.content ==
             fecho <>
               "\n\nGravado neste turno: 6 regras de negócio, 1 decisão; " <>
               "1 chamada de escrita recusada."

    # a contagem é do turno: o próximo começa zerado
    assert GravadoNoTurno.descarregar() == nil
  end

  test "turno sem escrita: nada é acrescentado" do
    GravadoNoTurno.anotar("listar_backlog", %{}, {:ok, "..."})
    assert TextoDoTurno.payload_do_turno("Tudo certo.", nil).content == "Tudo certo."
  end

  test "en, singular e plural" do
    GravadoNoTurno.anotar("emit_artifact", regra(), {:ok, "ok"})
    GravadoNoTurno.anotar("create_story", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("create_story", %{}, {:ok, "id"})

    linha = IdiomaDaResposta.com_idioma_do_autor("en", fn -> GravadoNoTurno.descarregar() end)
    assert linha == "Recorded this turn: 1 business rule, 2 stories."
  end

  test "pt-BR singular; idioma fora de pt/en e sem idioma caem em en" do
    GravadoNoTurno.anotar("emit_artifact", regra(), {:ok, "ok"})
    assert GravadoNoTurno.descarregar("pt-BR") == "Gravado neste turno: 1 regra de negócio."

    GravadoNoTurno.anotar("create_task", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("create_task", %{}, {:ok, "id"})
    assert GravadoNoTurno.descarregar("es") == "Recorded this turn: 2 tasks."

    GravadoNoTurno.anotar("create_task", %{}, {:ok, "id"})
    assert GravadoNoTurno.descarregar() == "Recorded this turn: 1 task."
  end

  test "PO: história criada, corrigida e arquivada são contadas à parte" do
    GravadoNoTurno.anotar("create_story", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("update_story", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("archive_story", %{}, {:ok, "id"})

    assert GravadoNoTurno.descarregar("pt-BR") ==
             "Gravado neste turno: 1 história, 1 história corrigida, 1 história arquivada."
  end

  test "RN-746: Arquiteto com as cinco propose_adr recusadas fecha com nada gravado" do
    for _ <- 1..5,
        do: GravadoNoTurno.anotar("propose_adr", %{}, {:error, "cortada"})

    fecho = "✅ ADRs Propostas (5 decisões críticas)"

    payload =
      IdiomaDaResposta.com_idioma_do_autor("pt-BR", fn ->
        TextoDoTurno.payload_do_turno(fecho, "m")
      end)

    assert payload.content ==
             fecho <> "\n\nGravado neste turno: nada; 5 chamadas de escrita recusadas."
  end

  test "RN-746: escritas do Arquiteto contadas, leitura e ferramenta desconhecida não" do
    GravadoNoTurno.anotar("propose_adr", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("propose_adr", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("create_c4_diagram", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("declare_module_contracts", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("choose_project_image", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("route_modules_to_infra", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("ler_algo", %{}, {:error, "x"})

    assert GravadoNoTurno.descarregar("pt-BR") ==
             "Gravado neste turno: 2 ADRs propostos, 1 imagem decidida, 1 diagrama C4, " <>
               "1 roteamento para a infra, 1 contrato de módulos."

    GravadoNoTurno.anotar("propose_adr", %{}, {:error, "x"})

    assert GravadoNoTurno.descarregar("en") ==
             "Recorded this turn: nothing; 1 write call refused."
  end
end
