defmodule Engine.Harness.Tools.ListarBacklog do
  @moduledoc """
  Ferramenta de LEITURA do PO (RN-164): o backlog do projeto em árvore
  (épico → história → tarefa), do jeito que a aba Backlog o mostra.

  É a metade que responde "o que eu já escrevi". Sem ela o PO recriava o que
  já existia, ou parava achando que tinha terminado — e o defeito que originou
  esta ferramenta foi o oposto: épico criado, NENHUMA história, e a execução
  travada sem erro nenhum, porque história é o que gera tarefa.

  `:direct` — ler não é efeito externo. Contida pelo mesmo desenho da
  `ListarRegrasDeNegocio`: sem parâmetro, escopo fechado no projeto, teto de
  linhas no texto que volta pro modelo.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @max_epicos 30
  @max_historias_por_epico 20

  @impl true
  def spec do
    %{
      name: "listar_backlog",
      description: descricao(),
      parameters: %{"type" => "object", "properties" => %{}, "required" => []}
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, ctx) do
    case EngineApiClient.list_backlog(ctx.project_id) do
      {:ok, epicos} when is_list(epicos) ->
        {:ok, renderizar(epicos)}

      {:ok, outro} ->
        {:error, "resposta inesperada ao listar o backlog: #{inspect(outro)}"}

      {:error, reason} ->
        {:error, "falha ao listar o backlog: #{inspect(reason)}"}
    end
  end

  # --- Renderização ---

  defp renderizar([]) do
    """
    O backlog deste projeto está VAZIO: nenhum épico, nenhuma história.

    Comece por `listar_regras_de_negocio` para saber o que precisa ser coberto.
    """
  end

  defp renderizar(epicos) do
    mostrados = Enum.take(epicos, @max_epicos)
    historias = Enum.flat_map(epicos, &Map.get(&1, "stories", []))
    orfaos = Enum.filter(epicos, &(Map.get(&1, "stories", []) == []))

    """
    #{length(epicos)} épico(s), #{length(historias)} história(s), #{Enum.count(historias, &(Map.get(&1, "tasks", []) != []))} história(s) com tarefa.
    #{aviso_de_orfaos(orfaos)}
    #{Enum.map_join(mostrados, "\n\n", &bloco_do_epico/1)}#{corte(epicos, mostrados, "épico(s)")}
    """
  end

  # A frase mais importante do relatório, e por isso ela vem ANTES da árvore:
  # épico sem história é o defeito que trava a execução inteira (sem história
  # não há tarefa, e sem tarefa o dev agent não tem o que pegar).
  defp aviso_de_orfaos([]), do: ""

  defp aviso_de_orfaos(orfaos) do
    titulos =
      Enum.map_join(orfaos, ", ", &"\"#{Map.get(&1, "title")}\" (id=#{Map.get(&1, "id")})")

    "\nATENÇÃO: #{length(orfaos)} épico(s) SEM NENHUMA HISTÓRIA — #{titulos}. " <>
      "Épico sozinho não gera tarefa e trava a execução: escreva as histórias " <>
      "deles, ou pergunte ao usuário o que falta para escrevê-las.\n"
  end

  defp bloco_do_epico(epico) do
    stories = Map.get(epico, "stories", [])
    mostradas = Enum.take(stories, @max_historias_por_epico)

    cabecalho =
      "ÉPICO id=#{Map.get(epico, "id")} | #{Map.get(epico, "title")} " <>
        "(#{length(stories)} história(s))"

    linhas =
      case mostradas do
        [] -> "  (nenhuma história)"
        _ -> Enum.map_join(mostradas, "\n", &linha_da_historia/1)
      end

    cabecalho <> "\n" <> linhas <> corte(stories, mostradas, "história(s)")
  end

  defp linha_da_historia(historia) do
    tarefas = Map.get(historia, "tasks", [])

    "  - id=#{Map.get(historia, "id")} | #{Map.get(historia, "title")} " <>
      "[status=#{Map.get(historia, "status")}, #{length(tarefas)} tarefa(s), " <>
      "regras=#{Enum.join(Map.get(historia, "businessRuleIds", []), ",")}]"
  end

  defp corte(todos, mostrados, unidade) do
    case length(todos) - length(mostrados) do
      0 -> ""
      n -> "\n  (+ #{n} #{unidade} não listada(s) — o total acima é o real)"
    end
  end

  defp descricao do
    """
    Lista o backlog do projeto em árvore: épicos, as histórias de cada um (com
    status, quantas tarefas e quais regras de negócio elas citam) e o total de
    tarefas. Não recebe parâmetro nenhum.

    Use para saber o que você JÁ escreveu antes de escrever mais — e para
    achar épico sem história, que é o estado que trava a execução: história é
    o que gera tarefa, e tarefa é o que o dev agent pega.
    """
  end
end
