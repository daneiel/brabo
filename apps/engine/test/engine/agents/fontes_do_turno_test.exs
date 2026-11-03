defmodule Engine.Agents.FontesDoTurnoTest do
  # RN-982 (AT-716): as fontes são as leituras `ok` do turno, do servidor.
  use ExUnit.Case, async: true

  alias Engine.Agents.{FontesDoTurno, TextoDoTurno}

  test "leitura ok gera fontes no payload, fora do content" do
    FontesDoTurno.anotar("listar_regras_de_negocio", %{}, {:ok, "..."})
    FontesDoTurno.anotar("read_file", %{"path" => "lib/a.ex"}, {:ok, "x"})

    payload = TextoDoTurno.payload_do_turno("Pronto.", "m")

    assert payload.content == "Pronto."

    assert payload.fontes == [
             %{tipo: "regra", rotulo: "listar_regras_de_negocio"},
             %{tipo: "arquivo", rotulo: "lib/a.ex", ref: "lib/a.ex"}
           ]

    refute Map.has_key?(payload, :fontesTotal)
  end

  test "leitura com falha e escrita não entram; turno sem leitura não grava o campo" do
    FontesDoTurno.anotar("listar_backlog", %{}, {:error, "boom"})
    FontesDoTurno.anotar("emit_artifact", %{"type" => "note"}, {:ok, "ok"})

    refute Map.has_key?(TextoDoTurno.payload_do_turno("Oi.", "m"), :fontes)
  end

  test "teto de 10 com fontesTotal" do
    for i <- 1..12, do: FontesDoTurno.anotar("read_file", %{"path" => "f#{i}"}, {:ok, "x"})

    payload = TextoDoTurno.payload_do_turno("Oi.", "m")
    assert length(payload.fontes) == 10
    assert payload.fontesTotal == 12
    assert FontesDoTurno.descarregar() == %{}
  end

  test "rag_search gera fonte rag com searchId e chunkId" do
    FontesDoTurno.guardar_hits_rag("s1", [%{"path" => "docs/a.md", "chunkId" => "c1"}])
    FontesDoTurno.anotar("rag_search", %{}, {:ok, "texto"})

    assert %{fontes: [f]} = FontesDoTurno.descarregar()

    assert f == %{
             tipo: "rag",
             rotulo: "docs/a.md",
             ref: "docs/a.md",
             searchId: "s1",
             chunkId: "c1"
           }
  end

  test "rag_search com falha descarta os hits guardados" do
    FontesDoTurno.guardar_hits_rag("s1", [%{"path" => "x"}])
    FontesDoTurno.anotar("rag_search", %{}, {:error, "f"})
    assert FontesDoTurno.descarregar() == %{}
  end
end
