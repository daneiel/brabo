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

  test "AT-395: turno de 3 voltas grava o fecho em content e as 2 anteriores em passos" do
    TextoDoTurno.acumular("Vou criar.", "m/a")
    TextoDoTurno.acumular("Criei duas.", "m/a")

    assert TextoDoTurno.payload_do_turno("Resumo final.", "m/b") == %{
             content: "Resumo final.",
             passos: ["Vou criar.", "Criei duas."],
             modelName: "m/b"
           }

    assert TextoDoTurno.payload_do_turno("", nil) == nil
  end

  test "AT-395: turno de 1 volta não tem passos" do
    assert TextoDoTurno.payload_do_turno("Oi.", "m/a") == %{content: "Oi.", modelName: "m/a"}
  end

  test "AT-395: turno que termina em formulário fica com a última volta que teve texto" do
    TextoDoTurno.acumular("Primeiro.", "m/a")
    TextoDoTurno.acumular("Preciso de dados:", "m/a")

    assert TextoDoTurno.payload_do_turno("", nil) == %{
             content: "Preciso de dados:",
             passos: ["Primeiro."],
             modelName: "m/a"
           }
  end

  describe "RN-732: escape unicode literal no texto do turno" do
    test "decodifica os cinco escapes medidos no TP-01, no fecho e nos passos" do
      TextoDoTurno.acumular("Sem colis\\u00e3o de nomes.")

      payload =
        TextoDoTurno.payload_do_turno(
          "O usu\\u00e1rio v\\u00ea os c\\u00f3digos e o hist\\u00f3rico; est\\u00e3o salvos.",
          "m"
        )

      assert payload.content == "O usuário vê os códigos e o histórico; estão salvos."
      assert payload.passos == ["Sem colisão de nomes."]
    end

    test "texto sem escape volta intacto" do
      assert %{content: "Tudo certo, usuário."} =
               TextoDoTurno.payload_do_turno("Tudo certo, usuário.", "m")
    end

    test "bloco de código com \\n literal e sem \\u fica intacto" do
      texto = "Veja:\n```\nIO.puts(\"a\\nb\")\n```"
      assert %{content: ^texto} = TextoDoTurno.payload_do_turno(texto, "m")
    end
  end
end
