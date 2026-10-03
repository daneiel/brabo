defmodule Engine.Agents.GravadoNoTurnoTest do
  # RN-731 (AT-414): o número do que foi gravado no turno é fato do servidor.
  use ExUnit.Case, async: true

  alias Engine.Agents.{GravadoNoTurno, TextoDoTurno}
  alias Engine.Harness.IdiomaDaResposta

  defp regra, do: %{"type" => "business_rule"}

  test "seis regras gravadas: o fecho do modelo fica intacto e ganha o fato ao lado (pt-BR)" do
    for _ <- 1..6, do: GravadoNoTurno.anotar("emit_artifact", regra(), {:ok, "ok"})
    GravadoNoTurno.anotar("emit_artifact", %{"type" => "decision_record"}, {:ok, "ok"})
    # recusada não conta
    GravadoNoTurno.anotar("emit_artifact", regra(), {:error, "schema"})
    # leitura não conta
    GravadoNoTurno.anotar("listar_regras_de_negocio", %{}, {:ok, "..."})

    fecho = "Registrei as 8 regras de negócio e a decisão técnica."

    payload =
      IdiomaDaResposta.com_idioma_do_autor("pt-BR", fn ->
        TextoDoTurno.payload_do_turno(fecho, "m")
      end)

    assert payload.content ==
             fecho <> "\n\nGravado neste turno: 6 regras de negócio, 1 decisão."

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
end
