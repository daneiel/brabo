defmodule Engine.Harness.Tools.RagSearch do
  @moduledoc """
  Busca no RAG do projeto (pgvector, busca híbrida vetor+léxico — ADR
  0080/0082) e devolve trechos CITÁVEIS: cada hit vem com o `path` de
  origem, então o modelo pode referenciar de onde tirou a informação em vez
  de afirmar sem fonte.

  Hoje NENHUM agente consome o RAG — só a aba web "Chat RAG" (ADR 0082). Esta
  ferramenta é o primeiro consumidor do lado do harness, contra a rota
  `POST /internal/rag/search` (contrato fechado por uma frente PARALELA em
  `apps/api`, N2 — o roundtrip real depende dela terminar; a lógica aqui é
  testada contra `EngineApiClient` mockado).

  `:direct` — buscar não é efeito externo (mesma régua de `search_workspace`/
  `read_file`), não passa pelo `ActionPipeline`.

  ## Degradação nunca escondida

  A api pode responder `degraded: true` quando o embedding não estava
  disponível e a busca caiu para léxico-only (ADR 0080). Esconder isso do
  modelo seria deixar ele confiar num resultado que pode ter perdido
  correspondência semântica — o aviso vai SEMPRE no início do texto, nunca
  como rodapé que um teto de bytes possa cortar.

  ## Dois tetos independentes, disciplina da RN-150

  Mesma classe de estouro de `search_workspace` (que tem
  `SEARCH_WORKSPACE_MAX_HITS`/`SEARCH_WORKSPACE_MAX_BYTES`, duas variáveis
  PRÓPRIAS): `top_k` do parâmetro é clampado num teto PRÓPRIO desta
  ferramenta (`@max_top_k`, nunca `SEARCH_WORKSPACE_MAX_HITS` nem qualquer
  outro teto de outra tool — divergir um não deve exigir tocar o outro), e o
  texto final formatado tem teto PRÓPRIO de bytes
  (`:rag_search_max_bytes`, menor que o de `search_workspace`/`read_file` de
  propósito: um hit de RAG já é chunk+excerpt inteiros, não uma linha de
  caminho — acumula bytes mais rápido por hit).

  ## O par de ids, e por que ele pode não vir (RN-479/480)

  O resultado carrega o `searchId` da busca e o `id` de cada trecho — é a
  referência que `rag_feedback` exige para votar. Quando a api não devolve
  `searchId` (a telemetria não foi gravada, e a busca respondeu assim mesmo),
  o convite e os ids somem INTEIROS: oferecer ao modelo uma referência que a
  api vai recusar é pior que não oferecer nenhuma.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @default_top_k 5
  @max_top_k 10

  @impl true
  def spec do
    %{
      name: "rag_search",
      description:
        "Busca no RAG do projeto (docs/, ADRs e sessões já indexados — busca " <>
          "híbrida vetor+léxico) e devolve trechos citáveis, cada um com o " <>
          "caminho de origem. Use para fundamentar uma resposta em algo que " <>
          "já existe no projeto, em vez de inventar. Se a busca vier " <>
          "degradada (léxico-only, sem embedding), isso aparece no texto — " <>
          "trate o resultado como menos preciso nesse caso.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "query" => %{"type" => "string", "description" => "o que procurar"},
          "top_k" => %{
            "type" => "integer",
            "description" =>
              "quantos trechos no máximo (padrão #{@default_top_k}, teto #{@max_top_k})"
          }
        },
        "required" => ["query"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"query" => query} = args, ctx) when is_binary(query) and query != "" do
    top_k = clamp_top_k(Map.get(args, "top_k"))

    # Sessão e agente vão para a api porque ela não tem como deduzi-los: são
    # o ator e a sessão da TELEMETRIA (RN-479), e é a presença da sessão que
    # decide se a busca também vira narração na timeline (RN-481).
    opts = [session_id: Map.get(ctx, :session_id), agent: Map.get(ctx, :agent)]

    case EngineApiClient.rag_search(ctx.project_id, query, top_k, opts) do
      {:ok, %{"hits" => hits} = resp} when is_list(hits) ->
        {:ok,
         montar_resposta(
           query,
           hits,
           Map.get(resp, "degraded", false),
           Map.get(resp, "searchId")
         )}

      {:ok, outro} ->
        {:error, "resposta inesperada do rag_search: #{inspect(outro)}"}

      {:error, reason} ->
        # Erro de ferramenta é ENTRADA do laço, não fim de linha (RN-163): o
        # ToolLoop recebe isto como tool-result de erro, nunca como crash —
        # a api do RAG fora do ar não derruba o agente.
        {:error, "falha ao buscar no RAG: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "rag_search exige o argumento `query` (string não vazia)"}

  defp clamp_top_k(n) when is_integer(n) and n > 0, do: min(n, @max_top_k)
  defp clamp_top_k(_), do: @default_top_k

  # --- Renderização ---

  defp montar_resposta(query, [], degraded?, _search_id) do
    aviso_degradado(degraded?) <>
      "nenhum resultado no RAG para \"#{query}\" — refine o termo ou " <>
      "considere que o índice pode não cobrir o que você procura ainda."
  end

  defp montar_resposta(_query, hits, degraded?, search_id) do
    corpo =
      hits
      |> Enum.with_index(1)
      |> Enum.map_join("\n\n", fn {hit, i} -> formatar_hit(hit, i, search_id) end)

    cabecalho = "#{length(hits)} trecho(s) encontrado(s)#{convite_de_voto(search_id)}:"

    truncate(aviso_degradado(degraded?) <> cabecalho <> "\n\n" <> corpo, length(hits))
  end

  # O par `search_id`/`chunk_id` é a REFERÊNCIA que `rag_feedback` exige
  # (RN-480). Quando a api não devolve `searchId` — a telemetria não foi
  # gravada, e a busca respondeu assim mesmo —, o convite e os ids somem
  # inteiros: oferecer ao modelo uma referência que a api vai recusar é pior
  # que não oferecer nenhuma.
  defp convite_de_voto(nil), do: ""

  defp convite_de_voto(search_id),
    do:
      " (busca #{search_id} — depois de usar um trecho, diga se ele serviu " <>
        "com `rag_feedback`, usando o `id` dele)"

  defp formatar_hit(hit, i, search_id) do
    path = Map.get(hit, "path", "?")
    trecho = Map.get(hit, "excerpt") || Map.get(hit, "chunk") || ""

    "[#{i}] fonte: #{path}#{score_txt(Map.get(hit, "score"))}" <>
      id_txt(search_id, Map.get(hit, "chunkId")) <> "\n" <> trecho
  end

  defp id_txt(nil, _chunk_id), do: ""
  defp id_txt(_search_id, nil), do: ""
  defp id_txt(_search_id, chunk_id), do: " id: #{chunk_id}"

  defp score_txt(score) when is_number(score), do: " (score #{score})"
  defp score_txt(_), do: ""

  # A DEGRADAÇÃO vai no INÍCIO do texto, de propósito — nunca no rodapé, onde
  # um teto de bytes (abaixo) poderia cortá-la fora e o modelo nunca saberia
  # que o resultado era léxico-only.
  defp aviso_degradado(true),
    do:
      "[AVISO: busca DEGRADADA — embedding indisponível no momento da busca, " <>
        "resultado é só léxico (sem similaridade semântica). Trate como " <>
        "menos preciso.]\n\n"

  defp aviso_degradado(false), do: ""

  @doc false
  # Teto PRÓPRIO de bytes do texto FORMATADO (RN-150) — ver moduledoc. Quando
  # estoura, corta e marca de forma dirigida ao MODELO ("refine a busca"),
  # nunca inventa quantos hits "realmente" existiam além do que já foi
  # mostrado.
  def truncate(texto, hits_mostrados) do
    max = max_bytes()
    raw_bytes = byte_size(texto)

    if raw_bytes <= max do
      texto
    else
      texto
      |> binary_part(0, max)
      |> cortar_utf8_incompleto()
      |> Kernel.<>(marca_de_truncagem(hits_mostrados, max, raw_bytes))
    end
  end

  defp marca_de_truncagem(hits_mostrados, max, raw_bytes) do
    "\n\n[resultado truncado: mostrando #{hits_mostrados} trecho(s) de RAG, " <>
      "cortado em #{max} de #{raw_bytes} bytes. Resultado truncado — refine " <>
      "a busca com um termo mais específico ou um `top_k` menor.]"
  end

  # Mesma lógica de TerminalExecutor.cortar_utf8_incompleto/1 (e das outras
  # duas tools de leitura): binary_part/3 corta por BYTE e pode partir um
  # caractere multibyte ao meio.
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
    do: Application.get_env(:engine, :rag_search_max_bytes, 16_384)
end
