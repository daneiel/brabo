defmodule Engine.Harness.RotasDoContrato do
  @moduledoc """
  Confere as ROTAS que o contrato do Arquiteto declara contra as que as
  histórias do backlog citam (RN-792, AT-468).

  No TP-01 de 2026-10-09 a história pedia `GET /painel` e o contrato declarou
  `GET /panel`; ninguém acusou na arquitetura, e a divergência só apareceu no
  julgamento do QA. Esta conferência roda no resultado de
  `declare_module_contracts`, que é entrada do laço do Arquiteto (RN-163):
  ele corrige o contrato ou registra a escolha.

  Determinística e contida (ADR 0060): só o padrão `MÉTODO /caminho` em
  título, descrição, RF e DoD das histórias não arquivadas, sem LLM, com teto
  de linhas. A comparação é contra a UNIÃO das rotas do contrato (a história
  do front cita a rota do back), normalizando parâmetro (`:id`, `{id}`),
  barra final e query string.
  """

  @padrao ~r/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s"'`,;()\[\]<>]*)/
  @teto 10

  @doc "Rotas `{MÉTODO, caminho normalizado}` citadas num texto."
  def extrair(texto) when is_binary(texto) do
    @padrao
    |> Regex.scan(texto)
    |> Enum.map(fn [_, metodo, caminho] -> {metodo, normalizar(caminho)} end)
    |> Enum.uniq()
  end

  def extrair(_), do: []

  @doc """
  Linhas de divergência: rota citada por história e ausente do contrato.
  `contratos` é a lista normalizada que a ferramenta mandou (chaves átomo);
  `backlog` é a árvore épico → história de `list_backlog/1`.
  """
  def divergencias(contratos, backlog) do
    declaradas =
      contratos
      |> Enum.flat_map(fn c -> Map.get(c, :expoe, []) end)
      |> Enum.flat_map(fn i -> extrair(Map.get(i, :assinatura, "")) end)
      |> MapSet.new()

    backlog
    |> List.wrap()
    |> Enum.flat_map(fn epico -> lista(Map.get(epico, "stories")) end)
    |> Enum.filter(&(is_map(&1) and is_nil(Map.get(&1, "archivedAt"))))
    |> Enum.flat_map(fn historia ->
      historia
      |> texto_da_historia()
      |> extrair()
      |> Enum.reject(&MapSet.member?(declaradas, &1))
      |> Enum.map(fn {m, c} ->
        "- história \"#{Map.get(historia, "title", "?")}\" cita `#{m} #{c}`, ausente do contrato" <>
          sugestao(declaradas, m, c)
      end)
    end)
    |> Enum.uniq()
  end

  @doc "O trecho a acrescentar ao resultado da ferramenta (vazio sem divergência)."
  def texto(contratos, backlog) do
    case divergencias(contratos, backlog) do
      [] ->
        ""

      linhas ->
        {mostradas, resto} = Enum.split(linhas, @teto)

        "\n\nDIVERGÊNCIA entre o contrato e as histórias (#{length(linhas)}):\n" <>
          Enum.join(mostradas, "\n") <>
          if(resto == [], do: "", else: "\n- (+#{length(resto)} não mostradas)") <>
          "\nCorrija o contrato (declare_module_contracts de novo, lista inteira) ou, se a " <>
          "rota da história é que está errada, registre a decisão com emit_artifact."
    end
  end

  defp sugestao(declaradas, metodo, _caminho) do
    mesmas = for {^metodo, c} <- declaradas, do: c

    case mesmas do
      [] -> ""
      cs -> " (o contrato declara #{metodo} " <> Enum.join(Enum.sort(cs), ", ") <> ")"
    end
  end

  defp texto_da_historia(h) do
    [
      Map.get(h, "title"),
      Map.get(h, "description") | lista(Map.get(h, "rf")) ++ lista(Map.get(h, "dod"))
    ]
    |> Enum.filter(&is_binary/1)
    |> Enum.join("\n")
  end

  defp normalizar(caminho) do
    caminho
    |> String.split(["?", "#"], parts: 2)
    |> hd()
    |> String.trim_trailing(".")
    |> String.split("/")
    |> Enum.map(fn
      ":" <> _ -> ":p"
      "{" <> _ -> ":p"
      seg -> seg
    end)
    |> Enum.join("/")
    |> then(fn
      "/" -> "/"
      c -> String.trim_trailing(c, "/")
    end)
  end

  defp lista(v) when is_list(v), do: v
  defp lista(_), do: []
end
