defmodule Engine.Gates.QaAutomacaoAgentGoldenTest do
  @moduledoc """
  Golden-set de regressão do julgamento SEMÂNTICO do QA de Automação (ADR
  0123) — o item que `docs/adr/0020-destravar-gates-qa-secops.md` já deixou
  documentado como aberto: com modelo local, o passo de cruzar regra de
  negócio com teste fechou só na 10ª de 11 rodadas.

  Diferente de `qa_automacao_agent_test.exs`, este módulo NÃO troca
  `:engine_api_client` por `FakeEngineApiClient` — usa o cliente REAL
  (`Engine.Sessions.EngineApiClient.Live`, o default de
  `Application.get_env(:engine, :engine_api_client, ...)` fora de teste com
  override), contra uma api de verdade. Por isso ele:

    * NÃO roda em `mix test` normal — só em `mix test --only golden_set_qa`
      (ou `mix golden_set.qa`). A exclusão é PERMANENTE em `test_helper.exs`,
      nunca por detecção de binário/serviço disponível: esta máquina já tem
      Ollama de pé o tempo todo, e inclusão automática faria este módulo
      disparar dentro de QUALQUER `mix test`, gastando tokens sem aviso e
      introduzindo flake real numa suíte que hoje é 100% determinística.
    * Pula (não falha) quando a api não está alcançável em `API_URL` — é
      pré-requisito de AMBIENTE, não defeito de código.
    * NÃO é determinístico — o que ele mede é justamente o quão
      confiável é o julgamento do modelo, não uma verdade fixa. Por isso a
      asserção final é contra um PISO (`floor.json`, ratchet — ver o
      comentário lá), nunca 6/6.

  ## Por que o seed vem de um script TS externo (`System.cmd`)

  A engine não tem como criar projeto/sessão/binding de modelo reais sem
  duplicar a lógica de negócio que mora nos casos de uso da api — e mesmo se
  duplicasse, este módulo usa `Engine.DataCase` (banco `engine_test`,
  isolado), enquanto a api de verdade grava no banco de DEV
  (`DATABASE_URL`). São bancos DIFERENTES: nada que `Engine.Repo` leia aqui
  seria visível para a api, e vice-versa. `apps/api/scripts/seed-golden-set-qa.ts`
  roda DENTRO do processo da api (mesmo banco, mesmos casos de uso reais) e
  devolve, pronto, tudo que este teste precisa — inclusive o CAMINHO do
  worktree já materializado em disco (o script faz o próprio `git clone` do
  bare repo; ver o comentário no topo dele). Este teste só consome o JSON.

  ## Um teste só, não seis

  Os seis casos rodam dentro de UM `test`, não em seis blocos separados: a
  asserção final é sobre o PISO agregado (quantos dos seis fecharam), e
  `mix test` não garante ordem entre `test`s do mesmo módulo — separar em
  seis arriscaria o piso ler um subconjunto incompleto se um caso rodasse
  antes do seed terminar de gravar contexto para outro. Coletar tudo aqui e
  agregar no fim também é o que permite reportar os seis resultados juntos,
  para depuração humana.
  """

  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.QaAutomacaoAgent

  @moduletag :golden_set_qa
  @moduletag timeout: :infinity
  # Ver o comentário de `Engine.DataCase.setup_sandbox/1`: LLM real, modelo
  # grande carregando pela primeira vez pode passar minutos sem tocar o
  # Postgres — o default de 60s do sandbox reclamaria a conexão no meio da
  # chamada.
  @moduletag ownership_timeout: :infinity

  # apps/engine/test/engine/gates/ -> raiz do monorepo.
  @repo_root Path.expand("../../../../..", __DIR__)
  @floor_path Path.expand("../../fixtures/golden_set_qa/floor.json", __DIR__)

  setup_all do
    api_url = api_url()

    cond do
      not api_reachable?(api_url) ->
        %{
          skip_reason:
            "api inalcançável em #{api_url} — suba a api E o engine de verdade " <>
              "(ver docs/adr/0123-golden-set-regressao-qa-automacao.md) antes de " <>
              "`mix golden_set.qa`"
        }

      true ->
        case run_seed() do
          {:ok, %{"model" => model, "cases" => cases}} ->
            %{model: model, cases: cases}

          {:error, motivo} ->
            %{skip_reason: "seed do golden-set falhou: #{motivo}"}
        end
    end
  end

  test "julgamento semântico do QA de Automação sobre os seis casos do golden-set",
       context do
    case context[:skip_reason] do
      reason when is_binary(reason) -> {:skip, reason}
      _ -> avaliar_golden_set(context)
    end
  end

  defp avaliar_golden_set(%{model: model, cases: cases}) do
    resultados = Enum.map(cases, &rodar_caso/1)

    IO.puts("\n--- golden-set QA (modelo: #{model}) ---")

    for r <- resultados do
      marca = if r.passou?, do: "✓", else: "✗"
      IO.puts("  #{marca} #{r.id}: esperado=#{r.esperado} obtido=#{r.obtido}")
    end

    passou = Enum.count(resultados, & &1.passou?)
    total = length(resultados)
    IO.puts("  #{passou}/#{total} casos bateram o veredito esperado\n")

    piso = ler_piso(model, total)

    assert piso != nil,
           "sem entrada de piso para o modelo #{inspect(model)} (com #{total} " <>
             "casos) em #{@floor_path} — taxa observada agora: #{passou}/#{total}. " <>
             "Piso nunca é escrito sozinho (mesma disciplina do " <>
             "coverage-floor.ts): adicione a entrada à mão depois de avaliar " <>
             "se #{passou} é um piso razoável para este modelo, no formato " <>
             "{\"passRate\": #{passou}, \"of\": #{total}}."

    assert passou >= piso,
           "golden-set QA (#{model}): #{passou}/#{total} bateu o esperado, " <>
             "abaixo do piso gravado (#{piso}) em #{@floor_path} — regressão " <>
             "de julgamento do modelo, não bloqueio artificial."
  end

  defp rodar_caso(%{
         "id" => id,
         "projectId" => project_id,
         "sessionId" => session_id,
         "worktreePath" => worktree_path,
         "story" => story,
         "task" => task,
         "expectedVerdict" => esperado
       }) do
    dev_state = %DevAgentState{
      project_id: project_id,
      agent_id: "qa-automacao",
      session_id: session_id,
      task_id: task["id"],
      worktree_path: worktree_path,
      task_budget_micros: 2_000_000,
      max_gate_corrections: 3
    }

    dev_context = %{
      task: task,
      story: story,
      business_rules_units: [],
      task_state_units: []
    }

    obtido =
      case QaAutomacaoAgent.run(project_id, session_id, task["id"], dev_state, dev_context) do
        {:ok, %{veredito: veredito}} -> veredito
        {:blocked, info} -> "blocked(#{info.origin})"
        {:awaiting, _} -> "awaiting_approval"
      end

    %{id: id, esperado: esperado, obtido: obtido, passou?: obtido == esperado}
  end

  # `passRate`/`of` (contagem, não porcentagem — ver o comentário no topo do
  # próprio floor.json) em vez de só um número: `of` documenta contra QUANTOS
  # casos aquele piso foi medido, então um golden-set que cresce de 6 para 8
  # casos não deixa um piso antigo mentir sobre o que ele quis dizer.
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
      {"GOLDEN_SET_QA_MODEL", System.get_env("GOLDEN_SET_QA_MODEL")},
      {"DATABASE_URL", System.get_env("DATABASE_URL")}
    ]

    case System.cmd("pnpm", ["--filter", "api", "golden-set:qa-seed"],
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
