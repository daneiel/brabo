defmodule Engine.Harness.Tools.ListarMetricasDeProduto do
  @moduledoc """
  Ferramenta de LEITURA do PO (RN-407): o funil de entrega e DORA parcial do
  PROJETO — sessão → commit → PR → merge, lead time real e deployment
  frequency real.

  É a TERCEIRA leitura do PO, no mesmo padrão de `ListarRegrasDeNegocio` e
  `ListarBacklog` (RN-164): escopada ao projeto, sem parâmetro, `:direct`
  porque ler não é efeito externo. `docs/fluxo.yml` (papel `po`, entrada
  `metricas-de-produto`) declarava `status: lacuna` desde o ADR 0089 — o
  DADO já existia (o script `analise:funil` mede o mesmo fato), só faltava o
  PO conseguir LER esse relatório dentro do turno. Fecha o item B4 da
  auditoria fluxo.yml × código — a última pendência da tabela "Backlog do
  modelo de time" (docs/explanation/auditoria-fluxo-vs-codigo.md).

  O corpo que a api devolve é o MESMO shape do `Relatorio` de
  `analise-funil.ts`, e NÃO tem campo para as três ausências permanentes que
  o script declara no texto ("Não medido, de propósito"). Esta ferramenta
  cita as três pelo NOME no texto que devolve ao modelo — nunca deixa o PO
  concluir por omissão dos números que não há lacuna nenhuma.

  `:direct` — mesmo desenho das duas irmãs: escopo fechado no projeto pelo
  caminho da rota, nenhum parâmetro, teto de linhas no texto que volta pro
  modelo.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  # Teto de linhas nas duas listas que podem crescer com o tempo de vida do
  # projeto (lead time por sessão, deployment por dia). O total real
  # continua na primeira linha da seção — truncar nunca finge que a lista
  # inteira coube.
  @max_lead_times 30
  @max_dias_deployment 30

  @impl true
  def spec do
    %{
      name: "listar_metricas_de_produto",
      description: descricao(),
      parameters: %{"type" => "object", "properties" => %{}, "required" => []}
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, ctx) do
    case EngineApiClient.list_product_metrics(ctx.project_id) do
      {:ok, relatorio} when is_map(relatorio) ->
        {:ok, renderizar(relatorio)}

      {:ok, outro} ->
        {:error, "resposta inesperada ao listar métricas de produto: #{inspect(outro)}"}

      {:error, reason} ->
        {:error, "falha ao listar métricas de produto: #{inspect(reason)}"}
    end
  end

  # --- Renderização ---

  defp renderizar(relatorio) do
    projeto = Map.get(relatorio, "project", %{})
    total = Map.get(relatorio, "totalActionsConsidered", 0)
    nome = Map.get(projeto, "name", "(projeto)")

    """
    Funil de entrega e DORA parcial — #{nome}
    Ações git consideradas (git_commit/pr_open/git_merge, qualquer status): #{total}

    #{secao_funil(Map.get(relatorio, "funnel", %{}))}
    #{secao_lead_time(Map.get(relatorio, "leadTimes", %{}))}
    #{secao_deployment(Map.get(relatorio, "deploymentFrequency", []))}
    #{secao_nao_medido()}
    """
  end

  defp secao_funil(funil) do
    etapas = Map.get(funil, "etapas", [])

    """
    ## Funil (sessão → commit → PR → merge)
    #{Enum.map_join(etapas, "\n", &linha_etapa/1)}
    """
  end

  defp linha_etapa(etapa) do
    taxa =
      case Map.get(etapa, "taxaDaEtapaAnterior") do
        nil -> "—"
        t -> "#{round(t * 100)}%"
      end

    "- #{Map.get(etapa, "etapa")}: #{Map.get(etapa, "sessoes")} sessão(ões) " <>
      "(conversão da etapa anterior: #{taxa})"
  end

  defp secao_lead_time(lead_times) do
    por_sessao = Map.get(lead_times, "perSession", [])
    media = Map.get(lead_times, "averageMs")

    media_texto =
      case media do
        nil -> "— (nenhuma sessão com commit E merge)"
        ms -> formatar_duracao(ms)
      end

    mostradas = Enum.take(por_sessao, @max_lead_times)

    """
    ## Lead time real (primeiro commit → primeiro merge)
    média: #{media_texto}
    #{Enum.map_join(mostradas, "\n", &linha_lead_time/1)}#{corte(por_sessao, mostradas, "sessão(ões)")}
    """
  end

  defp linha_lead_time(item) do
    "- #{Map.get(item, "sessionId")}: #{formatar_duracao(Map.get(item, "leadTimeMs"))}"
  end

  defp secao_deployment([]) do
    """
    ## Deployment frequency real (merge em branch protegida, por dia)
    nenhum merge em branch protegida.
    """
  end

  defp secao_deployment(dias) do
    mostrados = Enum.take(dias, @max_dias_deployment)

    """
    ## Deployment frequency real (merge em branch protegida, por dia)
    #{Enum.map_join(mostrados, "\n", &linha_deployment/1)}#{corte(dias, mostrados, "dia(s)")}
    """
  end

  defp linha_deployment(dia) do
    "- #{Map.get(dia, "dia")}: #{Map.get(dia, "merges")} merge(s)"
  end

  defp corte(todos, mostrados, unidade) do
    case length(todos) - length(mostrados) do
      0 -> ""
      n -> "\n(+ #{n} #{unidade} não listado(s) — o total acima é o real)"
    end
  end

  # Mesma lógica de `formatarDuracao` em `apps/api/scripts/medir-execucao.ts`
  # — não reusada de lá de propósito: um src/ da api não importa scripts/,
  # e replicar um formatador de 6 linhas é mais barato que abrir rota nova
  # só para isso.
  defp formatar_duracao(ms) when is_number(ms) do
    s = round(ms / 1000)

    cond do
      s < 60 ->
        "#{s}s"

      div(s, 60) < 60 ->
        m = div(s, 60)
        "#{m}m#{String.pad_leading(Integer.to_string(rem(s, 60)), 2, "0")}s"

      true ->
        m = div(s, 60)
        h = div(m, 60)
        "#{h}h#{String.pad_leading(Integer.to_string(rem(m, 60)), 2, "0")}m"
    end
  end

  defp formatar_duracao(_), do: "—"

  # As três ausências permanentes que o corpo JSON não tem como expressar
  # (o shape do `Relatorio` não reserva campo nenhum para elas) — sem esta
  # seção o PO leria só números e concluiria por omissão que não há lacuna.
  # Mesma frase/motivo do script CLI (`analise-funil.ts#imprimir/1`).
  defp secao_nao_medido do
    """
    ## Não medido, de propósito
    - Funil de produto completo (ideação → commit): `sessions` não tem `storyId` — RN-230 já declara a lacuna na aba Criativo. Fechá-la exige schema novo.
    - Evidência de adoção por feature: o Brabo não instrumenta os projetos que ele CONSTRÓI. Não é dado que falta coletar — é capacidade que o produto não tem caminho nenhum para ter hoje.
    - MTTR e change failure rate: exigem sinal de incidente de produção real, a mesma dependência declarada em docs/fluxo.yml para secops-runtime/platform (ativação junto de DEPLOY_ENABLED).
    """
  end

  defp descricao do
    """
    Lê o funil de entrega e DORA parcial do PROJETO inteiro: quantas sessões
    produziram commit / PR aberta / PR mergeada, o lead time real (primeiro
    commit ao primeiro merge) e a deployment frequency real (merge em branch
    protegida, por dia). Não recebe parâmetro nenhum — é o MESMO relatório
    do script `analise:funil` (ADR 0089).

    Use para saber se o produto está de fato SAINDO, não só sendo
    especificado: regra e história capturadas não bastam se nada chega a
    commit/PR/merge. Três métricas NÃO aparecem aqui, de propósito — funil
    de produto completo (ideação → commit), evidência de adoção por feature
    e MTTR/change failure rate — o relatório sempre diz isso explicitamente;
    não invente esses números por conta própria.
    """
  end
end
