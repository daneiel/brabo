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
          fun.(normalizados)
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

  defp coagir(_campo, _tipo, valor), do: {:ok, valor}

  defp nome_do_tipo("array"), do: "uma lista"
  defp nome_do_tipo("object"), do: "um objeto"

  defp achar_spec(_name, nil), do: nil
  defp achar_spec(_name, %{} = spec), do: spec

  defp achar_spec(name, specs) when is_list(specs) do
    Enum.find(specs, fn s -> is_map(s) and Map.get(s, :name, Map.get(s, "name")) == name end)
  end

  defp curto(texto), do: String.slice(to_string(texto), 0, 300)
end
