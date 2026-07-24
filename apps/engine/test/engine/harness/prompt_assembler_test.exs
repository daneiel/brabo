defmodule Engine.Harness.PromptAssemblerTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.PromptAssembler
  alias Engine.Harness.PromptAssembler.Default

  # Tokenizer é bytes/4 (teto): 40 bytes = 10 tokens; separador "\n\n" = 2 bytes.
  defp u(id, char), do: %{id: id, content: String.duplicate(char, 40)}

  defp layer_report(report, id) do
    Enum.find(report.layers, &(&1.id == id))
  end

  test "sem estouro: nenhuma camada é cortada (caminho feliz)" do
    layers = [
      %{id: :identidade, kind: :blob, cut: :keep_or_drop, content: "oi", budget: 100},
      %{
        id: :regras_negocio,
        kind: :units,
        cut: :drop_whole_units,
        units: [u(:u1, "a"), u(:u2, "b")],
        budget: 100
      }
    ]

    report = PromptAssembler.assemble(layers)

    assert layer_report(report, :identidade).cut_applied == :none
    assert layer_report(report, :regras_negocio).cut_applied == :none
    assert report.estimated == true
    assert Enum.all?(report.layers, & &1.estimated)
  end

  test "orçamento por camada respeitado: tokens finais <= budget de cada camada" do
    layers = [
      %{
        id: :regras_negocio,
        kind: :units,
        cut: :drop_whole_units,
        units: [u(:u1, "a"), u(:u2, "b"), u(:u3, "c")],
        budget: 22
      }
    ]

    report = PromptAssembler.assemble(layers)
    camada = layer_report(report, :regras_negocio)

    assert camada.tokens <= 22
  end

  test "corte por unidade inteira: nunca parte uma unidade, descarta as da cabeça" do
    u1 = u(:u1, "a")
    u2 = u(:u2, "b")
    u3 = u(:u3, "c")

    layers = [
      %{
        id: :regras_negocio,
        kind: :units,
        cut: :drop_whole_units,
        units: [u1, u2, u3],
        budget: 22
      }
    ]

    camada = PromptAssembler.assemble(layers) |> layer_report(:regras_negocio)

    # Descartou a mais antiga (cabeça) e manteve as duas seguintes INTEIRAS.
    assert camada.cut_applied == :dropped_units
    assert camada.dropped == [:u1]
    assert camada.rendered == u2.content <> "\n\n" <> u3.content
  end

  test "unidade única maior que o orçamento é descartada inteira (camada vazia, sem crash)" do
    layers = [
      %{
        id: :regras_negocio,
        kind: :units,
        cut: :drop_whole_units,
        units: [%{id: :big, content: String.duplicate("z", 400)}],
        budget: 10
      }
    ]

    camada = PromptAssembler.assemble(layers) |> layer_report(:regras_negocio)

    assert camada.rendered == ""
    assert camada.tokens == 0
    assert camada.dropped == [:big]
    assert camada.cut_applied == :dropped_units
  end

  test "truncate_tail: blob grande vira prefixo + marcador, dentro do orçamento" do
    layers = [
      %{
        id: :contexto_projeto,
        kind: :blob,
        cut: :truncate_tail,
        content: String.duplicate("x", 400),
        budget: 20
      }
    ]

    camada = PromptAssembler.assemble(layers) |> layer_report(:contexto_projeto)

    assert camada.cut_applied == :truncated
    assert camada.tokens <= 20
    assert String.starts_with?(camada.rendered, "x")
    assert String.ends_with?(camada.rendered, "truncado …]")
  end

  test "keep_or_drop: blob que não cabe é descartado inteiro" do
    layers = [
      %{
        id: :identidade,
        kind: :blob,
        cut: :keep_or_drop,
        content: String.duplicate("y", 400),
        budget: 20
      }
    ]

    camada = PromptAssembler.assemble(layers) |> layer_report(:identidade)

    assert camada.cut_applied == :dropped_layer
    assert camada.rendered == ""
    assert camada.tokens == 0
  end

  test "budget resolve de default do módulo e de opts[:budgets]" do
    # Sem budget explícito na camada -> usa o default do módulo.
    layers = [%{id: :regras_negocio, kind: :units, cut: :drop_whole_units, units: []}]

    default_report = PromptAssembler.assemble(layers)

    assert layer_report(default_report, :regras_negocio).budget ==
             Default.default_budget(:regras_negocio)

    # opts[:budgets] sobrescreve.
    override_report = PromptAssembler.assemble(layers, budgets: %{regras_negocio: 42})
    assert layer_report(override_report, :regras_negocio).budget == 42
  end

  test "render/1 concatena só as camadas renderizadas não-vazias" do
    layers = [
      %{id: :identidade, kind: :blob, cut: :keep_or_drop, content: "IDENT", budget: 100},
      %{id: :regras_negocio, kind: :units, cut: :drop_whole_units, units: [], budget: 100},
      %{id: :contexto_projeto, kind: :blob, cut: :truncate_tail, content: "CTX", budget: 100}
    ]

    report = PromptAssembler.assemble(layers)
    assert Default.render(report) == "IDENT\n\nCTX"
  end
end
