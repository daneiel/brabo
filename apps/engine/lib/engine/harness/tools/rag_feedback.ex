defmodule Engine.Harness.Tools.RagFeedback do
  @moduledoc """
  Diz se um trecho que o `rag_search` devolveu SERVIU (RN-480) — contra a rota
  `POST /internal/rag/feedback`.

  ## Por que um agente vota

  Os quatro números da busca híbrida (dois pesos, limiar, candidatos) são
  chute inicial declarado no próprio código da api (`rag-search-limits.ts`), e
  não havia como calibrá-los porque a busca não deixava rastro. A telemetria
  (RN-479) grava o que a busca devolveu e em que RANK; o voto é o que diz se
  aquilo era o certo. Latência e taxa de degradação dizem se a busca RODOU;
  só o voto diz se ela ACERTOU.

  E o rank do que foi votado ÚTIL é o que separa dois diagnósticos que se
  parecem: índice pobre não devolve o trecho certo em posição nenhuma; peso
  errado devolve o trecho certo em rank 7.

  `:direct` — dar nota a um trecho NÃO é efeito externo (mesma régua de
  `rag_search`/`read_file`): não escreve no repositório, não gasta, não sai
  da máquina. Não passa pelo `ActionPipeline` e não vira `proposed_action` —
  fazer disso uma ação a aprovar encheria a fila de ruído até ninguém mais ler
  as de verdade.

  ## A referência vem da busca, e a recusa é ENTRADA do laço

  `search_id` e `chunk_id` só existem porque `rag_search` os devolve. Id que a
  api não reconhece volta como tool-result de ERRO — nomeando o que ela
  recusou — para o modelo corrigir na próxima iteração (RN-061/RN-163), nunca
  como crash: uma nota mal endereçada não é motivo para derrubar um turno.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @verdicts ["util", "irrelevante"]

  @impl true
  def spec do
    %{
      name: "rag_feedback",
      description:
        "Diz se um trecho devolvido por `rag_search` serviu para responder o " <>
          "que você procurava. Use DEPOIS de ler o trecho, com o `id` que veio " <>
          "junto dele e o id da busca. Dois valores: \"util\" quando o trecho " <>
          "respondeu (mesmo em parte) e \"irrelevante\" quando não tinha nada a " <>
          "ver. Isto não muda nada no projeto — é o que permite calibrar a busca.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "search_id" => %{
            "type" => "string",
            "description" => "o id da busca, que veio no cabeçalho do resultado do `rag_search`"
          },
          "chunk_id" => %{
            "type" => "string",
            "description" => "o `id` do trecho específico que você está julgando"
          },
          "verdict" => %{
            "type" => "string",
            "enum" => @verdicts,
            "description" => "\"util\" ou \"irrelevante\""
          }
        },
        "required" => ["search_id", "chunk_id", "verdict"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(
        %{"search_id" => search_id, "chunk_id" => chunk_id, "verdict" => verdict},
        ctx
      )
      when is_binary(search_id) and search_id != "" and is_binary(chunk_id) and
             chunk_id != "" and verdict in @verdicts do
    agente = Map.get(ctx, :agent) || "desconhecido"

    case EngineApiClient.rag_feedback(ctx.project_id, search_id, chunk_id, verdict, agente) do
      {:ok, resp} when is_map(resp) ->
        {:ok, confirmacao(verdict, chunk_id, Map.get(resp, "rank"))}

      # A recusa por id desconhecido é 400, e ela ENSINA — a api manda a
      # mensagem inteira. Repassá-la é o que dá ao modelo com o que corrigir;
      # trocá-la por um "falhou" genérico o deixaria adivinhando.
      {:error, {400, corpo}} ->
        {:error, "rag_feedback recusado: #{motivo_da_api(corpo)}"}

      {:error, reason} ->
        {:error, "falha ao registrar o feedback do RAG: #{inspect(reason)}"}
    end
  end

  def run(%{"verdict" => verdict}, _ctx) when is_binary(verdict) and verdict not in @verdicts do
    {:error, "rag_feedback aceita `verdict` \"util\" ou \"irrelevante\" — recebi \"#{verdict}\""}
  end

  def run(_args, _ctx) do
    {:error,
     "rag_feedback exige `search_id`, `chunk_id` (os dois vindos do resultado do " <>
       "`rag_search`) e `verdict` (\"util\" ou \"irrelevante\")"}
  end

  # --- Renderização ---

  # O rank volta de propósito: é a informação que o MODELO não tinha e o
  # servidor tinha. Sem ele a confirmação diria só "ok", que não ensina nada.
  defp confirmacao(verdict, chunk_id, rank) when is_integer(rank),
    do: "registrado: trecho #{chunk_id} marcado como #{verdict} (ele veio em #{rank}º na busca)."

  defp confirmacao(verdict, chunk_id, _rank),
    do: "registrado: trecho #{chunk_id} marcado como #{verdict}."

  defp motivo_da_api(%{"message" => msg}) when is_binary(msg), do: msg
  defp motivo_da_api(%{"message" => msgs}) when is_list(msgs), do: Enum.join(msgs, "; ")
  defp motivo_da_api(outro), do: inspect(outro)
end
