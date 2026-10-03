defmodule Engine.Harness.ArgumentosDeFerramenta do
  @moduledoc """
  O ponto comum por onde TODA ferramenta de agente é executada (RN-719,
  AT-387): os sete conversacionais e o `ToolLoop` chamam `executar/4` em vez
  de chamar a ferramenta direto.

  Faz duas coisas, e só elas:

    1. Normaliza argumentos. Modelo de verdade (Haiku via OpenRouter, medido
       em 02/10) manda lista/objeto como STRING JSON —
       `"business_rule_ids": "[\\"01M…\\"]"`. Para cada argumento cujo schema
       declara `array` ou `object`, string que é JSON válido do tipo certo vira
       o valor; string que não é recusa NOMEADA ("o campo X precisa ser uma
       lista"), antes de a ferramenta rodar. Campo declarado `string` nunca é
       tocado.
    2. Exceção levantada pela ferramenta vira `{:error, motivo}` com o prefixo
       de `falha_interna?/1` — o `tool.result` sai `ok: false` com origem
       `codigo` e o erro ENTRA no laço (RN-163), em vez de derrubar o turno.
  """

  @prefixo_falha "falha interna da ferramenta"

  @doc "Executa `fun.(args_normalizados)` com a spec da ferramenta `name` em `specs`."
  @spec executar(String.t(), term(), [map()] | map() | nil, (map() -> term())) ::
          {:ok, term()} | {:error, term()}
  def executar(name, args, specs, fun) do
    spec = achar_spec(name, specs)

    case normalizar(args, spec) do
      {:ok, normalizados} ->
        try do
          normalizados |> fun.() |> com_chaves_recebidas(args)
        rescue
          e -> {:error, "#{@prefixo_falha} #{name}: #{curto(Exception.message(e))}"}
        catch
          kind, valor -> {:error, "#{@prefixo_falha} #{name}: #{kind} #{curto(inspect(valor))}"}
        end

      {:error, _} = erro ->
        erro
    end
  end

  @doc "O motivo veio de exceção dentro da ferramenta (origem `codigo`)?"
  @spec falha_interna?(term()) :: boolean()
  def falha_interna?(motivo) when is_binary(motivo),
    do: String.starts_with?(motivo, @prefixo_falha)

  def falha_interna?(_), do: false

  @doc "Normaliza `args` contra a spec (map com `:parameters`). Sem spec, devolve como veio."
  @spec normalizar(term(), map() | nil) :: {:ok, term()} | {:error, String.t()}
  def normalizar(args, spec) when is_map(args) and is_map(spec) do
    props =
      spec
      |> Map.get(:parameters, Map.get(spec, "parameters", %{}))
      |> Kernel.||(%{})
      |> Map.get("properties", %{})

    Enum.reduce_while(args, {:ok, args}, fn {campo, valor}, {:ok, acc} ->
      tipo = props |> Map.get(to_string(campo), %{}) |> Map.get("type")

      case coagir(campo, tipo, valor) do
        {:ok, ^valor} -> {:cont, {:ok, acc}}
        {:ok, novo} -> {:cont, {:ok, Map.put(acc, campo, novo)}}
        {:error, _} = erro -> {:halt, erro}
      end
    end)
  end

  def normalizar(args, _spec), do: {:ok, args}

  defp coagir(campo, tipo, valor) when tipo in ["array", "object"] and is_binary(valor) do
    case Jason.decode(valor) do
      {:ok, lista} when tipo == "array" and is_list(lista) -> {:ok, lista}
      {:ok, mapa} when tipo == "object" and is_map(mapa) -> {:ok, mapa}
      _ -> {:error, "o campo #{campo} precisa ser #{nome_do_tipo(tipo)}"}
    end
  end

  defp coagir(_campo, _tipo, valor) when is_binary(valor), do: {:ok, decodificar_escapes(valor)}
  defp coagir(_campo, _tipo, valor), do: {:ok, valor}

  @doc """
  Decodifica escape LITERAL que o modelo mandou dentro de TEXTO (RN-725,
  AT-405): `\\u00f3` vira `ó` (par surrogate incluído). Só age quando há um
  `\\uXXXX` na string — é o sintoma medido — e aí decodifica também `\\n`,
  `\\t`, `\\"` e `\\\\` da MESMA string. Texto sem `\\u` volta byte a byte,
  de propósito: código num `content` com `"\\n"` literal não pode mudar.
  """
  @spec decodificar_escapes(term()) :: term()
  def decodificar_escapes(texto) when is_binary(texto) do
    if Regex.match?(~r/\\u[0-9a-fA-F]{4}/, texto) do
      Regex.replace(
        ~r/\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\([nt"\\])/,
        texto,
        &escape/5
      )
    else
      texto
    end
  end

  def decodificar_escapes(outro), do: outro

  defp escape(original, alto, baixo, "", ""), do: par(original, alto, baixo)
  defp escape(_original, "", "", unidade, ""), do: unidade_para_texto(unidade)
  defp escape(_o, _a, _b, _u, "n"), do: "\n"
  defp escape(_o, _a, _b, _u, "t"), do: "\t"
  defp escape(_o, _a, _b, _u, outro), do: outro

  defp par(original, alto, baixo) do
    a = String.to_integer(alto, 16)
    b = String.to_integer(baixo, 16)
    <<0x10000 + (a - 0xD800) * 0x400 + (b - 0xDC00)::utf8>>
  rescue
    _ -> original
  end

  defp unidade_para_texto(hex) do
    case String.to_integer(hex, 16) do
      cp when cp in 0xD800..0xDFFF -> "\\u" <> hex
      cp -> <<cp::utf8>>
    end
  end

  @doc """
  As CHAVES que chegaram, sem valores (RN-725, AT-408), para a recusa "exige
  X" dizer o que veio. String no lugar de mapa é dito como tal.
  """
  @spec chaves_recebidas(term()) :: String.t()
  def chaves_recebidas(args) when is_map(args) and map_size(args) == 0,
    do: "chegou um objeto sem chaves"

  def chaves_recebidas(args) when is_map(args),
    do:
      "chaves recebidas: " <>
        (args |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort() |> Enum.join(", "))

  def chaves_recebidas(args) when is_binary(args), do: "chegou uma string, não um objeto"
  def chaves_recebidas(args) when is_list(args), do: "chegou uma lista, não um objeto"
  def chaves_recebidas(nil), do: "não chegou argumento nenhum"
  def chaves_recebidas(_), do: "chegou um valor que não é objeto"

  defp com_chaves_recebidas({:error, msg}, args) when is_binary(msg) do
    if String.contains?(msg, " exige `") and not String.contains?(msg, "chegou") and
         not String.contains?(msg, "chaves recebidas") do
      {:error, msg <> " (" <> chaves_recebidas(args) <> ")"}
    else
      {:error, msg}
    end
  end

  defp com_chaves_recebidas(resultado, _args), do: resultado

  defp nome_do_tipo("array"), do: "uma lista"
  defp nome_do_tipo("object"), do: "um objeto"

  defp achar_spec(_name, nil), do: nil
  defp achar_spec(_name, %{} = spec), do: spec

  defp achar_spec(name, specs) when is_list(specs) do
    Enum.find(specs, fn s -> is_map(s) and Map.get(s, :name, Map.get(s, "name")) == name end)
  end

  defp curto(texto), do: String.slice(to_string(texto), 0, 300)
end
