defmodule Engine.Harness.Tools.SearchWorkspace do
  @moduledoc "Busca por substring nos nomes e conteúdos dos arquivos do workspace."

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Actions.Workspace

  @impl true
  def spec do
    %{
      name: "search_workspace",
      description: "Busca uma substring nos arquivos do workspace do projeto.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "query" => %{"type" => "string", "description" => "texto a procurar"}
        },
        "required" => ["query"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"query" => query}, ctx) do
    hits = WorkspaceFiles.search(root(ctx), query)

    if hits == [] do
      {:ok, nada_encontrado(root(ctx), query)}
    else
      body = Enum.map_join(hits, "\n", fn h -> "- #{h.path}" end)
      {:ok, "#{length(hits)} resultado(s):\n#{body}"}
    end
  end

  def run(_args, _ctx), do: {:error, "search_workspace exige o argumento `query`"}

  # "Não achei" e "não há o que achar" são situações DIFERENTES, e diziam a
  # mesma frase.
  #
  # O achado X da FASE 13b: numa task sobre repositório recém-provisionado —
  # só o template do Gitflow, sem código —, o dev agent leu `nenhum resultado`
  # como "refine a busca". Repetiu cinco buscas, gastou as oito iterações
  # procurando "onde está o projeto", e foi bloqueado sem NUNCA rodar um
  # comando nem escrever um arquivo. O diagnóstico gravado foi
  # `(nenhum terminal rodado)`.
  #
  # A correção é a frase, não o teto: o agente não precisava de mais
  # iterações, precisava saber que não havia nada para procurar. Por isso a
  # mensagem do caso vazio termina em INSTRUÇÃO — é ela que quebra o laço.
  defp nada_encontrado(root, query) do
    case WorkspaceFiles.count(root) do
      0 ->
        "o workspace está VAZIO: nenhum arquivo para buscar. " <>
          "Este é um projeto novo — CRIE os arquivos necessários " <>
          "(write_file) em vez de continuar procurando."

      total ->
        "nenhum resultado para \"#{query}\" — o workspace tem #{total} " <>
          "arquivo(s), então a busca funcionou e o termo é que não aparece."
    end
  end

  defp root(ctx), do: ctx[:workspace_root] || Workspace.workspace_dir(ctx.project_id)
end
