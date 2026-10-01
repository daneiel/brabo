# Gera `scripts/jev/vivo/ferramentas-dev.json` — o `spec/0` COMPLETO (nome,
# descrição e esquema de parâmetros) de cada ferramenta do registro do dev
# agent (`Engine.Dev.Tools.registry/0`), lido do CÓDIGO do engine. É a entrada
# do teste ao vivo da AT-239 (`jev:vivo`): o modelo de chat recebe exatamente
# as definições que o produto manda.
#
# Diferente de `../catalogo.exs`, este NÃO precisa do engine compilado nem das
# dependências (o repo.hex.pm pode estar fora de alcance): roda com o `elixir`
# puro, LENDO a fonte. Cada `spec/0` é avaliado a partir da AST, com os
# atributos de módulo (`@verdicts`, `@max_top_k`…) e as funções privadas sem
# argumento (`descricao/0`) substituídos pelos seus valores literais. O que não
# for literal FALHA com o nome do arquivo — nunca um spec pela metade.
#
# Rodar, da raiz do repositório:
#
#   elixir scripts/jev/vivo/ferramentas-dev.exs > scripts/jev/vivo/ferramentas-dev.json

defmodule FerramentasDev do
  @raiz File.cwd!()
  @registro Path.join(@raiz, "apps/engine/lib/engine/dev/tools.ex")

  def run do
    fonte = File.read!(@registro)
    ast = Code.string_to_quoted!(fonte)
    aliases = aliases(ast)
    modulos = registro(ast)

    specs =
      Enum.map(modulos, fn curto ->
        completo = Map.fetch!(aliases, curto)
        arquivo = arquivo_do_modulo(completo)
        {arquivo, spec_de(arquivo)}
      end)

    IO.puts(json(%{
      "fonte" => "apps/engine/lib/engine/dev/tools.ex (@registry) + spec/0 de cada módulo",
      "ferramentas" => Enum.map(specs, fn {arquivo, s} -> Map.put(s, "arquivo", Path.relative_to(arquivo, @raiz)) end)
    }))
  end

  # `alias Engine.Harness.Tools.{ReadFile, ...}` → %{ReadFile: "Engine.Harness.Tools.ReadFile"}
  defp aliases(ast) do
    {_, acc} =
      Macro.prewalk(ast, %{}, fn
        {:alias, _, [{{:., _, [{:__aliases__, _, base}, :{}]}, _, filhos}]} = no, acc ->
          novos =
            for {:__aliases__, _, nome} <- filhos, into: %{} do
              {List.last(nome), Enum.join(base ++ nome, ".")}
            end

          {no, Map.merge(acc, novos)}

        no, acc ->
          {no, acc}
      end)

    acc
  end

  defp registro(ast) do
    {_, acc} =
      Macro.prewalk(ast, nil, fn
        {:@, _, [{:registry, _, [lista]}]} = no, nil when is_list(lista) ->
          {no, Enum.map(lista, fn {:__aliases__, _, nome} -> List.last(nome) end)}

        no, acc ->
          {no, acc}
      end)

    acc || raise "@registry não encontrado em #{@registro}"
  end

  defp arquivo_do_modulo(completo) do
    relativo =
      completo
      |> String.replace_prefix("Engine.", "")
      |> String.split(".")
      |> Enum.map(&Macro.underscore/1)
      |> Path.join()

    caminho = Path.join([@raiz, "apps/engine/lib/engine", relativo <> ".ex"])
    if File.exists?(caminho), do: caminho, else: raise("fonte de #{completo} não encontrada: #{caminho}")
  end

  defp spec_de(arquivo) do
    ast = arquivo |> File.read!() |> Code.string_to_quoted!()
    atributos = atributos(ast)
    privadas = privadas(ast)

    corpo =
      achar_funcao(ast, :def, :spec) ||
        raise "#{arquivo}: def spec/0 não encontrado"

    substituido =
      Macro.prewalk(corpo, fn
        {:@, _, [{nome, _, ctx}]} when is_atom(ctx) ->
          Macro.escape(Map.fetch!(atributos, nome))

        {nome, _, []} = no when is_atom(nome) ->
          case Map.fetch(privadas, nome) do
            {:ok, valor} -> Macro.escape(valor)
            :error -> no
          end

        no ->
          no
      end)

    {valor, _} =
      try do
        Code.eval_quoted(substituido)
      rescue
        e -> reraise "#{arquivo}: spec/0 não é literal (#{Exception.message(e)})", __STACKTRACE__
      end

    %{
      "name" => valor.name,
      "description" => valor.description,
      "parameters" => valor.parameters
    }
  end

  defp atributos(ast) do
    {_, acc} =
      Macro.prewalk(ast, %{}, fn
        {:@, _, [{nome, _, [valor]}]} = no, acc when nome not in [:moduledoc, :doc, :impl, :spec, :behaviour] ->
          case literal(valor) do
            {:ok, v} -> {no, Map.put(acc, nome, v)}
            :nao -> {no, acc}
          end

        no, acc ->
          {no, acc}
      end)

    acc
  end

  defp privadas(ast) do
    {_, acc} =
      Macro.prewalk(ast, %{}, fn
        {:defp, _, [{nome, _, args}, [do: corpo]]} = no, acc when args in [nil, []] ->
          case literal(corpo) do
            {:ok, v} -> {no, Map.put(acc, nome, v)}
            :nao -> {no, acc}
          end

        no, acc ->
          {no, acc}
      end)

    acc
  end

  defp achar_funcao(ast, tipo, nome) do
    {_, acc} =
      Macro.prewalk(ast, nil, fn
        {^tipo, _, [{^nome, _, args}, [do: corpo]]} = no, nil when args in [nil, []] -> {no, corpo}
        no, acc -> {no, acc}
      end)

    acc
  end

  defp literal(quoted) do
    if Macro.quoted_literal?(quoted) do
      {v, _} = Code.eval_quoted(quoted)
      {:ok, v}
    else
      :nao
    end
  end

  # JSON mínimo (o Elixir 1.14 não traz um, e este script não usa dependência).
  defp json(m) when is_map(m) do
    corpo =
      m
      |> Enum.map(fn {k, v} -> {to_string(k), v} end)
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.map_join(",", fn {k, v} -> json(k) <> ":" <> json(v) end)

    "{" <> corpo <> "}"
  end

  defp json(l) when is_list(l), do: "[" <> Enum.map_join(l, ",", &json/1) <> "]"
  defp json(true), do: "true"
  defp json(false), do: "false"
  defp json(nil), do: "null"
  defp json(n) when is_integer(n), do: Integer.to_string(n)
  defp json(a) when is_atom(a), do: json(Atom.to_string(a))

  defp json(s) when is_binary(s) do
    escapado =
      s
      |> String.replace("\\", "\\\\")
      |> String.replace("\"", "\\\"")
      |> String.replace("\n", "\\n")
      |> String.replace("\t", "\\t")

    "\"" <> escapado <> "\""
  end
end

FerramentasDev.run()
