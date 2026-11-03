defmodule Engine.Harness.CitacaoDasFontesTest do
  # RN-985 (AT-716): citação inline validada contra as fontes do turno.
  use ExUnit.Case, async: true

  alias Engine.Agents.{FontesDoTurno, TextoDoTurno}
  alias Engine.Harness.CitacaoDasFontes

  defp ler(n), do: FontesDoTurno.anotar("read_file", %{"path" => "f#{n}.ex"}, {:ok, "x"})

  test "a mensagem efêmera só aparece com fonte e lista na ordem" do
    assert CitacaoDasFontes.anexar([%{"role" => "user"}]) == [%{"role" => "user"}]
    ler(1)
    ler(2)
    [_, %{"role" => "system", "content" => c}] = CitacaoDasFontes.anexar([%{"role" => "user"}])
    assert c =~ "[1] f1.ex\n[2] f2.ex"
    FontesDoTurno.descarregar()
  end

  test "custo com 10 fontes cabe no teto declarado" do
    for n <- 1..10, do: ler(n)
    texto = CitacaoDasFontes.texto(FontesDoTurno.ver())
    FontesDoTurno.descarregar()
    IO.puts("citacao 10 fontes: #{String.length(texto)} caracteres")
    assert div(String.length(texto), 4) <= CitacaoDasFontes.teto_de_tokens()
  end

  test "índice inventado não entra, repetido não duplica, content intacto" do
    ler(1)
    ler(2)
    texto = "A [1] e B [3] e C [1][2]."
    p = TextoDoTurno.payload_do_turno(texto, "m")
    assert p.content == texto
    assert p.citacoes == [1, 2]
  end

  test "sem marcador o campo fica ausente" do
    ler(1)
    refute Map.has_key?(TextoDoTurno.payload_do_turno("sem citar", "m"), :citacoes)
  end

  test "sem fontes o campo fica ausente" do
    refute Map.has_key?(TextoDoTurno.payload_do_turno("tem [1]", "m"), :citacoes)
  end
end
