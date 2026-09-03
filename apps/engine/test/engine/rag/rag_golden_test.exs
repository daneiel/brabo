defmodule Engine.Rag.RagGoldenTest do
  @moduledoc """
  Golden-set de ACERTO da busca híbrida do RAG (ADR 0132, RN-490) — o
  equivalente, para busca, do golden-set do julgamento SEMÂNTICO do QA de
  Automação (`Engine.Gates.QaAutomacaoAgentGoldenTest`, ADR 0123). Mesma
  estrutura (exclusão permanente por tag, piso ratchet, seed via
  `System.cmd`) — este módulo copia a forma, não reinventa o raciocínio.

  ## Por que este teste não RODA a busca — ele só INVOCA quem rodou

  O golden-set do QA chama `Engine.Gates.QaAutomacaoAgent.run/5` diretamente
  — o julgamento mora no engine. A busca híbrida do RAG NÃO mora aqui: é
  `HybridSearchUseCase`, dentro da api (embedding + `ts_rank` + fusão por
  peso + corte por limiar). Reimplementar a busca em Elixir só para este
  teste testaria uma SEGUNDA implementação, nunca a real — o mesmo erro que
  o ADR 0123 evitou usando o cliente LLM real em vez de simular o
  julgamento. Por isso `apps/api/scripts/seed-golden-set-rag.ts` faz as DUAS
  coisas — provisiona o projeto/corpus E roda a busca para as 17 perguntas —
  e devolve o resultado já pronto; este módulo só invoca o script (mesmo
  mecanismo `System.cmd` do lado QA) e aplica o piso sobre o JSON que volta.

  ## Exclusão permanente, nunca detecção de disponibilidade

    * NÃO roda em `mix test` normal — só em `mix test --only golden_set_rag`
      (ou `mix golden_set.rag`). Ver o comentário em `test_helper.exs`: esta
      máquina já tem Ollama de pé o tempo todo, e inclusão automática faria
      este módulo disparar dentro de QUALQUER `mix test`.
    * Pula (não falha) quando a api não está alcançável em `API_URL` — é
      pré-requisito de AMBIENTE, não defeito de código.
    * Pula (não falha) quando o embedding não estava disponível durante a
      indexação (`vectorAvailable: false` no JSON de saída) — sem índice
      denso, o que rodaria não seria a busca híbrida, seria a metade léxica
      dela (mesmo critério de reprovação de `medir-rag.ts`), e um golden-set
      que medisse isso mediria contra um sistema que não é o que roda.

  ## Um teste só, não dezessete

  Os 17 casos rodam dentro de UM `test`: a asserção final é sobre o PISO
  agregado, e `mix test` não garante ordem entre `test`s do mesmo módulo.
  """

  use Engine.DataCase, async: false

  @moduletag :golden_set_rag
  @moduletag timeout: :infinity
  @moduletag ownership_timeout: :infinity

  # apps/engine/test/engine/rag/ -> raiz do monorepo.
  @repo_root Path.expand("../../../../..", __DIR__)
  @floor_path Path.expand("../../fixtures/golden_set_rag/floor.json", __DIR__)

  setup_all do
    api_url = api_url()

    cond do
      not api_reachable?(api_url) ->
        %{
          skip_reason:
            "api inalcançável em #{api_url} — suba a api de verdade " <>
              "(ver docs/adr/0132-golden-set-de-acerto-do-rag.md) antes de " <>
              "`mix golden_set.rag`"
        }

      true ->
        case run_seed() do
          {:ok, %{"embeddingModel" => modelo, "cases" => casos} = saida} ->
            index_report = Map.get(saida, "indexReport", %{})
            embedding = Map.get(index_report, "embedding", %{})

            if embedding["available"] == false do
              %{
                skip_reason:
                  "embedding indisponível durante a indexação do corpus " <>
                    "(#{Map.get(embedding, "reason", "motivo não informado")}) — " <>
                    "sem índice denso, o golden-set mediria a metade léxica da " <>
                    "busca, não a busca híbrida. Confirme `ollama list` no host " <>
                    "e que `nomic-embed-text` está puxado."
              }
            else
              %{model: modelo, cases: casos}
            end

          {:error, motivo} ->
            %{skip_reason: "seed do golden-set falhou: #{motivo}"}
        end
    end
  end

  test "acerto da busca híbrida do RAG sobre as 17 perguntas do golden-set",
       context do
    case context[:skip_reason] do
      reason when is_binary(reason) -> {:skip, reason}
      _ -> avaliar_golden_set(context)
    end
  end

  defp avaliar_golden_set(%{model: model, cases: cases}) do
    IO.puts("\n--- golden-set RAG (modelo de embedding: #{model}) ---")

    for caso <- cases do
      marca = if caso["passou"], do: "✓", else: "✗"
      rank = caso["rank"] || "—"
      IO.puts("  #{marca} #{caso["id"]}: esperado=#{caso["expectedPath"]} rank=#{rank}")
    end

    passou = Enum.count(cases, & &1["passou"])
    total = length(cases)
    IO.puts("  #{passou}/#{total} casos acertaram o caminho esperado no top-5\n")

    piso = ler_piso(model, total)

    assert piso != nil,
           "sem entrada de piso para o modelo de embedding #{inspect(model)} " <>
             "(com #{total} casos) em #{@floor_path} — taxa observada agora: " <>
             "#{passou}/#{total}. Piso nunca é escrito sozinho (mesma " <>
             "disciplina do coverage-floor.ts): adicione a entrada à mão " <>
             "depois de avaliar se #{passou} é um piso razoável, no formato " <>
             "{\"passRate\": #{passou}, \"of\": #{total}}."

    assert passou >= piso,
           "golden-set RAG (#{model}): #{passou}/#{total} bateu o esperado, " <>
             "abaixo do piso gravado (#{piso}) em #{@floor_path} — regressão " <>
             "de acerto da busca, não bloqueio artificial."
  end

  # `passRate`/`of` (contagem, não porcentagem) em vez de só um número: `of`
  # documenta contra QUANTOS casos aquele piso foi medido, então um
  # golden-set que cresce de 17 para N casos não deixa um piso antigo mentir
  # sobre o que ele quis dizer.
  defp ler_piso(model, total_casos) do
    with true <- File.exists?(@floor_path),
         {:ok, conteudo} <- File.read(@floor_path),
         {:ok, mapa} <- Jason.decode(conteudo),
         %{"passRate" => taxa, "of" => ^total_casos} <- Map.get(mapa, model) do
      taxa
    else
      _ -> nil
    end
  end

  defp run_seed do
    env = [
      {"DATABASE_URL", System.get_env("DATABASE_URL")}
    ]

    case System.cmd("pnpm", ["--filter", "api", "golden-set:rag-seed"],
           cd: @repo_root,
           env: env,
           stderr_to_stdout: false
         ) do
      {stdout, 0} ->
        case Jason.decode(stdout) do
          {:ok, parsed} -> {:ok, parsed}
          {:error, _} -> {:error, "stdout do seed não é JSON válido: #{inspect(stdout)}"}
        end

      {saida, codigo} ->
        {:error, "seed saiu com código #{codigo}: #{saida}"}
    end
  end

  defp api_reachable?(api_url) do
    case Req.get(api_url <> "/health", receive_timeout: 3_000) do
      {:ok, %Req.Response{status: status}} when status in 200..299 -> true
      _ -> false
    end
  rescue
    _ -> false
  end

  defp api_url, do: Application.fetch_env!(:engine, :api_url)
end
