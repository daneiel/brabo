defmodule Engine.Agents.TextoDoTurnoTest do
  use ExUnit.Case, async: true

  alias Engine.Agents.TextoDoTurno

  test "continuação da frase (pedaço com espaço) entra como veio" do
    TextoDoTurno.acumular("Vou criar")

    assert TextoDoTurno.descarregar(" histórias e tarefas que cubram tudo.") ==
             "Vou criar histórias e tarefas que cubram tudo."
  end

  test "pedaços colados viram parágrafos, nunca uma palavra inventada" do
    TextoDoTurno.acumular("Registrei a regra.")

    assert TextoDoTurno.descarregar("Agora as histórias.") ==
             "Registrei a regra.\n\nAgora as histórias."
  end

  test "sem texto nenhum, devolve vazio e esvazia o acúmulo" do
    TextoDoTurno.acumular("")
    TextoDoTurno.acumular(nil)
    assert TextoDoTurno.descarregar() == ""
    TextoDoTurno.acumular("a")
    assert TextoDoTurno.descarregar() == "a"
    assert TextoDoTurno.descarregar() == ""
  end

  test "AT-384: o modelo da volta acumulada acompanha o texto quando o fecho não traz modelo" do
    TextoDoTurno.acumular("Preciso entender.", "m/a")
    assert TextoDoTurno.descarregar_com_modelo("", nil) == {"Preciso entender.", "m/a"}
    # o modelo também esvazia com o acúmulo
    assert TextoDoTurno.descarregar_com_modelo("", nil) == {"", nil}
  end

  test "AT-384: o modelo do fecho vence o acumulado; sem chamada nenhuma, nil" do
    TextoDoTurno.acumular("a", "m/a")
    assert TextoDoTurno.descarregar_com_modelo("b", "m/b") == {"a\n\nb", "m/b"}
    TextoDoTurno.acumular("x", nil)
    assert TextoDoTurno.descarregar_com_modelo("", nil) == {"x", nil}
  end
end
