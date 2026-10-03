defmodule Engine.Agents.GravadoNoTurnoTest do
  # RN-731 (AT-414): o número do que foi gravado no turno é fato do servidor.
  use ExUnit.Case, async: true

  alias Engine.Agents.{GravadoNoTurno, TextoDoTurno}

  test "seis regras gravadas: o fecho do modelo fica intacto e ganha o fato ao lado" do
    for _ <- 1..6,
        do: GravadoNoTurno.anotar("emit_artifact", %{"type" => "business_rule"}, {:ok, "ok"})

    GravadoNoTurno.anotar("emit_artifact", %{"type" => "decision_record"}, {:ok, "ok"})
    # recusada não conta
    GravadoNoTurno.anotar("emit_artifact", %{"type" => "business_rule"}, {:error, "schema"})
    # leitura não conta
    GravadoNoTurno.anotar("listar_regras_de_negocio", %{}, {:ok, "..."})

    fecho = "Registrei as 8 regras de negócio e a decisão técnica."
    payload = TextoDoTurno.payload_do_turno(fecho, "m")

    assert payload.content ==
             fecho <> "\n\nGravado neste turno: 6 regras de negócio, 1 decisão."

    # a contagem é do turno: o próximo começa zerado
    assert GravadoNoTurno.descarregar() == nil
  end

  test "turno sem escrita: nada é acrescentado" do
    GravadoNoTurno.anotar("listar_backlog", %{}, {:ok, "..."})
    assert TextoDoTurno.payload_do_turno("Tudo certo.", nil).content == "Tudo certo."
  end

  test "PO: história criada, corrigida e arquivada são contadas à parte" do
    GravadoNoTurno.anotar("create_story", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("update_story", %{}, {:ok, "id"})
    GravadoNoTurno.anotar("archive_story", %{}, {:ok, "id"})

    assert GravadoNoTurno.descarregar() ==
             "Gravado neste turno: 1 história, 1 história corrigida, 1 história arquivada."
  end
end
