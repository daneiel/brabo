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
    {hits, hits_truncated?} = WorkspaceFiles.search(root(ctx), query, max_hits: max_hits())

    if hits == [] do
      {:ok, nada_encontrado(root(ctx), query)}
    else
      {:ok, montar_resposta(hits, hits_truncated?)}
    end
  end

  def run(_args, _ctx), do: {:error, "search_workspace exige o argumento `query`"}

  defp montar_resposta(hits, hits_truncated?) do
    corpo = Enum.map_join(hits, "\n", fn h -> "- #{h.path}" end)
    cabecalho = "#{length(hits)} resultado(s):"

    truncate("#{cabecalho}\n#{corpo}", length(hits), hits_truncated?)
  end

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

  @doc false
  # Dois tetos independentes, mesma classe do achado S (ver
  # Engine.Actions.TerminalExecutor.truncate/2 e
  # Engine.Harness.Tools.ReadFile.truncate/2), porque a busca pode estourar de
  # DUAS formas diferentes e cada uma pede a sua defesa:
  #
  # 1. QUANTIDADE de hits — uma árvore com milhares de arquivos batendo o
  #    termo produz milhares de linhas "- caminho" mesmo que nenhum arquivo
  #    individual seja grande. Truncar só por bytes no fim ainda pagaria o
  #    custo de ESCANEAR e LER O CONTEÚDO de cada um desses arquivos antes de
  #    cortar a string — por isso o teto de quantidade vive em
  #    `WorkspaceFiles.search/3` (`max_hits`), que já para de consumir a
  #    fonte assim que encontra hit suficiente, em vez de aqui, que só veria
  #    a lista depois de pronta.
  # 2. BYTES do texto final — mesmo com hits limitados, caminhos muito
  #    longos (monorepo com diretórios profundos) podem produzir uma string
  #    grande. Teto de bytes, mesmo padrão dos outros dois módulos.
  #
  # Quando os hits foram truncados por quantidade, NÃO sabemos o total exato
  # (foi exatamente esse conhecimento que o teto evitou pagar) — a marca diz
  # "mostrando os primeiros N" em vez de fingir saber "de quantos no total":
  # um número inventado seria pior que nenhum número.
  #
  # Constante PRÓPRIA (SEARCH_WORKSPACE_MAX_BYTES), não reaproveita
  # read_file_max_bytes nem terminal_output_max_bytes: mesma classe de
  # estouro, variável independente — divergir uma não deve exigir tocar as
  # outras.
  def truncate(texto, hits_mostrados, hits_truncated?) do
    max = max_bytes()
    raw_bytes = byte_size(texto)
    bytes_truncados? = raw_bytes > max

    base =
      if bytes_truncados? do
        texto |> binary_part(0, max) |> cortar_utf8_incompleto()
      else
        texto
      end

    if bytes_truncados? or hits_truncated? do
      base <>
        marca_de_truncagem(hits_mostrados, hits_truncated?, bytes_truncados?, max, raw_bytes)
    else
      base
    end
  end

  # A marca é endereçada ao modelo, não ao humano: diz o que sumiu E o que
  # fazer a respeito (mesmo padrão de TerminalExecutor.marca_de_truncagem/2 e
  # ReadFile.marca_de_truncagem/3).
  defp marca_de_truncagem(hits_mostrados, hits_truncated?, bytes_truncados?, max, raw_bytes) do
    hits_parte =
      if hits_truncated? do
        "mostrando os #{hits_mostrados} primeiro(s) resultado(s) — pode haver mais"
      else
        "mostrando #{hits_mostrados} resultado(s)"
      end

    bytes_parte =
      if bytes_truncados?, do: ", texto cortado em #{max} de #{raw_bytes} bytes", else: ""

    "\n\n[busca truncada: #{hits_parte}#{bytes_parte}. " <>
      "Refine a busca com um termo mais específico.]"
  end

  # Mesma lógica de TerminalExecutor.cortar_utf8_incompleto/1: binary_part/3
  # corta por BYTE e pode partir um caractere multibyte ao meio.
  defp cortar_utf8_incompleto(bin), do: cortar_utf8_incompleto(bin, 3)

  defp cortar_utf8_incompleto(bin, 0), do: bin

  defp cortar_utf8_incompleto(bin, tentativas) do
    if String.valid?(bin) do
      bin
    else
      bin
      |> binary_part(0, byte_size(bin) - 1)
      |> cortar_utf8_incompleto(tentativas - 1)
    end
  end

  defp max_bytes,
    do: Application.get_env(:engine, :search_workspace_max_bytes, 32_768)

  defp max_hits,
    do: Application.get_env(:engine, :search_workspace_max_hits, 500)
end
