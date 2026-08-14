defmodule Engine.Harness.Tools.ListarRegrasDeNegocio do
  @moduledoc """
  Ferramenta de LEITURA do PO (RN-164): as regras de negócio do PROJETO, com o
  estado de cobertura de cada uma.

  Por que ela existe: o PO tinha quatro ferramentas e **todas de escrita**. O
  contexto dele era lido uma vez só, no kickoff, a partir dos 200 últimos
  eventos da SESSÃO — dali em diante ele não sabia quais regras existiam nem
  quais já tinha coberto. Numa sessão longa, ou numa retomada, ele escrevia no
  escuro, e o sintoma que apareceu no uso real foi backlog sem história
  nenhuma.

  `:direct` — LER não é efeito externo e não vira `proposed_action` (encheria a
  fila de ruído). O que a leitura deve é ser CONTIDA, e é: escopo fechado no
  projeto pelo caminho da rota, nenhum parâmetro, e teto de linhas no texto que
  volta pro modelo.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  # Teto de linhas renderizadas. Não é o mesmo que "quantas existem": o total
  # continua sendo dito na primeira linha, então truncar nunca faz o modelo
  # achar que viu tudo. As NÃO cobertas vêm primeiro, porque são elas que
  # geram trabalho — truncar as cobertas custa pouco.
  @max_regras 80

  @impl true
  def spec do
    %{
      name: "listar_regras_de_negocio",
      description: descricao(),
      parameters: %{"type" => "object", "properties" => %{}, "required" => []}
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, ctx) do
    case EngineApiClient.list_business_rules(ctx.project_id) do
      {:ok, %{"rules" => regras} = corpo} when is_list(regras) ->
        {:ok, renderizar(regras, Map.get(corpo, "uncoveredCount", 0))}

      {:ok, outro} ->
        {:error, "resposta inesperada ao listar regras de negócio: #{inspect(outro)}"}

      {:error, reason} ->
        {:error, "falha ao listar regras de negócio: #{inspect(reason)}"}
    end
  end

  # --- Renderização ---

  # Vazio é resposta LEGÍTIMA, e a frase diz o que fazer com ela: sem regra
  # capturada não há como escrever história rastreável, e o caminho certo é
  # perguntar — não inventar regra nem criar história solta.
  defp renderizar([], _sem_cobertura) do
    """
    Nenhuma regra de negócio capturada neste projeto ainda.

    Sem regra não há `business_rule_ids`, e sem `business_rule_ids` a história
    não é promovível. Pergunte ao usuário (use `ask_structured_questions`) o
    que o produto precisa fazer, em vez de inventar regras ou criar história
    sem rastreabilidade.
    """
  end

  defp renderizar(regras, sem_cobertura) do
    {descobertas, cobertas} = Enum.split_with(regras, &(not coberta?(&1)))
    ordenadas = descobertas ++ cobertas
    mostradas = Enum.take(ordenadas, @max_regras)

    corte =
      case length(ordenadas) - length(mostradas) do
        0 -> ""
        n -> "\n(+ #{n} regra(s) já coberta(s) não listada(s) — o total acima é o real)"
      end

    """
    #{length(regras)} regra(s) de negócio no projeto; #{sem_cobertura} SEM cobertura.

    `[ ]` = nenhuma história cobre — é o seu trabalho pendente.
    `[x]` = já coberta pelas histórias entre parênteses.

    #{Enum.map_join(mostradas, "\n", &linha/1)}#{corte}
    """
  end

  defp linha(regra) do
    marca = if coberta?(regra), do: "[x]", else: "[ ]"

    cobertura =
      case Map.get(regra, "coveredByStoryIds", []) do
        [] -> ""
        ids -> " (coberta por: #{Enum.join(ids, ", ")})"
      end

    descricao =
      case Map.get(regra, "description") do
        d when is_binary(d) and d != "" -> ": #{d}"
        _ -> ""
      end

    "#{marca} id=#{Map.get(regra, "id")} | #{Map.get(regra, "title")}#{descricao}#{cobertura}"
  end

  defp coberta?(regra), do: Map.get(regra, "covered") == true

  defp descricao do
    """
    Lista TODAS as regras de negócio já capturadas no projeto, com o id de cada
    uma e se alguma história já a cobre. Não recebe parâmetro nenhum.

    Use ANTES de criar histórias e sempre que precisar saber o que ainda falta:
    o id que volta aqui é exatamente o que vai em `business_rule_ids` no
    `create_story`, e as marcadas `[ ]` são as que ainda não viraram história.

    A lista é do PROJETO inteiro, não só desta conversa — regra capturada numa
    sessão anterior aparece aqui.
    """
  end
end
