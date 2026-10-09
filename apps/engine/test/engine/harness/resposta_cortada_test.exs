defmodule Engine.Harness.RespostaCortadaTest do
  # RN-737 (AT-423): a resposta cortada pelo teto de saída não executa
  # ferramenta e é dita no fecho, sem reescrever o texto do modelo.
  use ExUnit.Case, async: true

  alias Engine.Agents.TextoDoTurno
  alias Engine.Harness.{ArgumentosDeFerramenta, RespostaCortada}

  setup do
    Process.delete({RespostaCortada, :cortada})
    :ok
  end

  defp resposta(extra), do: {:ok, Map.merge(%{"message" => %{"content" => "oi"}}, extra)}

  test "registrar devolve o resultado intacto e anota só truncated: true" do
    cortada = resposta(%{"truncated" => true})
    assert RespostaCortada.registrar(cortada, nil) == cortada
    assert RespostaCortada.cortada?()

    normal = resposta(%{})
    assert RespostaCortada.registrar(normal, nil) == normal
    refute RespostaCortada.cortada?()

    RespostaCortada.registrar(cortada, nil)
    RespostaCortada.registrar({:error, :timeout}, nil)
    refute RespostaCortada.cortada?()
  end

  test "ferramenta de resposta cortada NÃO executa e volta erro nomeado ao laço" do
    RespostaCortada.registrar(resposta(%{"truncated" => true}), nil)

    assert {:error, motivo} =
             ArgumentosDeFerramenta.executar("emit_artifact", %{"x" => 1}, [], fn _ ->
               flunk("a ferramenta não podia ter rodado")
             end)

    assert motivo =~ "emit_artifact"
    assert motivo =~ "cortada pelo limite de tokens"
    assert motivo =~ "partes menores"
  end

  test "RN-745: só a última chamada da resposta cortada é recusada; as completas executam" do
    chamadas = [
      %{"id" => "1", "name" => "propose_adr", "arguments" => %{"title" => "A"}},
      %{"id" => "2", "name" => "propose_adr", "arguments" => %{"title" => "B"}},
      %{"id" => "3", "name" => "propose_adr", "arguments" => %{}}
    ]

    RespostaCortada.registrar(
      resposta(%{"truncated" => true, "message" => %{"toolCalls" => chamadas}}),
      nil
    )

    assert {:ok, "A"} =
             ArgumentosDeFerramenta.executar("propose_adr", %{"title" => "A"}, [], fn a ->
               {:ok, a["title"]}
             end)

    assert {:ok, "B"} =
             ArgumentosDeFerramenta.executar("propose_adr", %{"title" => "B"}, [], fn a ->
               {:ok, a["title"]}
             end)

    assert {:error, motivo} =
             ArgumentosDeFerramenta.executar("propose_adr", %{}, [], fn _ ->
               flunk("a chamada incompleta não podia ter rodado")
             end)

    assert motivo =~ "propose_adr"
    assert motivo =~ "a última da resposta"
    assert motivo =~ "uma por chamada"
  end

  test "resposta normal executa a ferramenta como sempre" do
    RespostaCortada.registrar(resposta(%{}), nil)

    assert {:ok, "feito"} =
             ArgumentosDeFerramenta.executar("emit_artifact", %{}, [], fn _ -> {:ok, "feito"} end)
  end

  test "fecho cortado ganha a linha no idioma, sem reescrever o texto" do
    RespostaCortada.registrar(resposta(%{"truncated" => true}), nil)

    Engine.Harness.IdiomaDaResposta.com_idioma_do_autor("pt-BR", fn ->
      assert %{content: "Texto do modelo pela met\n\nResposta cortada pelo limite de tamanho."} =
               TextoDoTurno.payload_do_turno("Texto do modelo pela met", "m")
    end)

    refute RespostaCortada.cortada?()
  end

  test "fecho normal fica intacto" do
    RespostaCortada.registrar(resposta(%{}), nil)
    assert %{content: "Tudo certo."} = TextoDoTurno.payload_do_turno("Tudo certo.", "m")
  end

  test "linha: pt em português, qualquer outro idioma ou nenhum em inglês" do
    assert RespostaCortada.linha("pt-BR") == "Resposta cortada pelo limite de tamanho."
    assert RespostaCortada.linha("en") == "Response cut off by the length limit."
    assert RespostaCortada.linha(nil) == "Response cut off by the length limit."
  end
end
