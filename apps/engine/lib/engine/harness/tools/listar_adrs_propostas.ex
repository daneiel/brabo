defmodule Engine.Harness.Tools.ListarAdrsPropostas do
  @moduledoc """
  Ferramenta de LEITURA do Arquiteto (RN-772, AT-454): o status ATUAL das ADRs
  que ele propôs (`open_adr_pr`) neste projeto.

  Sem ela o Arquiteto só conhecia a própria proposta pelo `tool.result` do
  `propose_adr` ("aguardando aprovação"), que é um retrato do instante da
  proposta — e no TP-01 de 09/10 ele disse "as 3 ADRs seguem pendentes" depois
  de o usuário aprovar as três. A aprovação acontece FORA da conversa dele.

  Lida localmente do mesmo Postgres (`proposed_actions`, tabela da api), no
  molde de `Engine.Projects.ProjectRepository`: sem HTTP no laço do agente.
  Contida (ADR 0060, RN-164): sem parâmetro, escopo fechado no projeto do
  contexto, uma consulta por chamada, teto de `@max_linhas` com o total real
  declarado quando corta.
  """

  @behaviour Engine.Harness.Tool

  import Ecto.Query

  @max_linhas 20

  @impl true
  def spec do
    %{
      name: "listar_adrs_propostas",
      description: descricao(),
      parameters: %{"type" => "object", "properties" => %{}, "required" => []}
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, ctx) do
    {:ok, renderizar(ler(ctx.project_id))}
  rescue
    e -> {:error, "falha ao ler as ADRs propostas: #{Exception.message(e)}"}
  end

  @doc false
  def max_linhas, do: @max_linhas

  defp ler(project_id) do
    base =
      from(a in "proposed_actions",
        where: a.project_id == type(^project_id, :binary_id) and a.action_type == "open_adr_pr"
      )

    total = Engine.Repo.aggregate(base, :count)

    linhas =
      base
      |> order_by([a], desc: a.seq)
      |> limit(@max_linhas)
      |> select([a], %{
        id: a.id,
        status: fragment("?::text", a.status),
        payload: a.payload,
        resultado: a.execution_result,
        motivo: a.rejection_reason
      })
      |> Engine.Repo.all()

    {total, cruzar_com_merges(project_id, linhas)}
  end

  # RN-845 (AT-514): o status da AÇÃO `open_adr_pr` diz só que a PR foi aberta.
  # O estado da PR vem do `git_merge` EXECUTADO no mesmo projeto com o mesmo
  # `pullRequestId` — a mesma fonte que move a PR para "mergeada" na aba PRs, e
  # o único caminho de merge do produto (RN-418). Uma consulta, só sobre os ids
  # listados. Falha aqui não vira "aberta": a linha diz que não leu.
  defp cruzar_com_merges(project_id, linhas) do
    ids =
      for %{status: "executed", resultado: %{"pullRequestId" => id}} <- linhas,
          is_binary(id) and id != "",
          do: id

    merges = merges_por_pr(project_id, ids)
    Enum.map(linhas, &Map.put(&1, :merges, merges))
  end

  defp merges_por_pr(_project_id, []), do: %{}

  defp merges_por_pr(project_id, ids) do
    from(m in "proposed_actions",
      where:
        m.project_id == type(^project_id, :binary_id) and m.action_type == "git_merge" and
          m.status == "executed" and
          fragment("?->>'pullRequestId'", m.payload) in ^ids,
      select: {fragment("?->>'pullRequestId'", m.payload), m.decided_at, m.created_at}
    )
    |> Engine.Repo.all()
    |> Map.new(fn {id, decidido, criado} -> {id, decidido || criado} end)
  rescue
    _ -> :ilegivel
  end

  defp renderizar({0, _}) do
    "Nenhuma ADR proposta neste projeto (nenhuma ação `open_adr_pr`)."
  end

  defp renderizar({total, linhas}) do
    corte =
      case total - length(linhas) do
        0 -> ""
        n -> "\n(+ #{n} ADR(s) mais antiga(s) não listada(s) — o total acima é o real)"
      end

    "#{total} ADR(s) proposta(s), das mais recentes para as mais antigas " <>
      "(status lido agora, não o da hora da proposta):\n" <>
      Enum.map_join(linhas, "\n", &linha/1) <> corte
  end

  defp linha(a) do
    titulo = Map.get(a.payload || %{}, "title", "(sem título)")

    "- ação #{Ecto.UUID.cast!(a.id)} | #{titulo} | #{status_legivel(a.status)}" <>
      detalhe(a)
  end

  defp status_legivel("pending"), do: "PENDENTE de aprovação"
  defp status_legivel("approved"), do: "APROVADA (PR ainda não aberta)"
  defp status_legivel("auto_approved"), do: "APROVADA automaticamente (PR ainda não aberta)"
  defp status_legivel("executed"), do: "APROVADA e EXECUTADA"
  defp status_legivel("denied"), do: "RECUSADA"
  defp status_legivel("failed"), do: "APROVADA, mas a execução FALHOU"
  defp status_legivel(outro), do: "status=#{outro}"

  defp detalhe(%{status: "executed"} = a) do
    url = get_in(a, [:resultado, "pullRequestUrl"])
    estado_da_pr(a) <> if(is_binary(url) and url != "", do: " | PR: #{url}", else: "")
  end

  defp detalhe(%{status: "denied", motivo: m}) when is_binary(m), do: " | motivo: #{m}"
  defp detalhe(_), do: ""

  defp estado_da_pr(%{merges: :ilegivel}),
    do: " | estado da PR: NÃO CONSEGUI LER (não afirme que está aberta nem mergeada)"

  defp estado_da_pr(%{resultado: %{"pullRequestId" => id}, merges: merges})
       when is_binary(id) and id != "" do
    case Map.fetch(merges, id) do
      {:ok, quando} -> " | PR MERGEADA em #{data(quando)}"
      :error -> " | PR aberta (nenhum merge dela registrado no Brabo)"
    end
  end

  defp estado_da_pr(_),
    do: " | estado da PR: NÃO CONSEGUI LER (resultado sem id de PR)"

  defp data(%NaiveDateTime{} = d),
    do: NaiveDateTime.to_iso8601(NaiveDateTime.truncate(d, :second)) <> "Z"

  defp data(%DateTime{} = d), do: DateTime.to_iso8601(DateTime.truncate(d, :second))
  defp data(outro), do: to_string(outro)

  defp descricao do
    """
    Lista as ADRs que você propôs neste projeto (`propose_adr`) com o status
    ATUAL de cada uma: pendente, aprovada, recusada (com o motivo), executada
    (com a URL da PR e se ela está aberta ou já mergeada) ou falhada. Não recebe parâmetro nenhum.

    A aprovação acontece fora desta conversa: antes de afirmar se uma ADR está
    pendente ou aprovada, consulte esta ferramenta.
    """
  end
end
