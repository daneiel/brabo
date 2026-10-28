defmodule Engine.Agents.Diario do
  @moduledoc """
  O diário vivo de um agente (AT-582, ADR 0226): o PLANO que ele escreveu
  (`registrar_plano`, evento `agent.plan`) mais uma PROJEÇÃO do event log — sem
  tabela nova, sem segunda fonte de verdade. Lê a cauda (teto ADR 0060, a mesma
  de `Engine.Agents.Reidratacao`) e responde "onde o agente parou".

  ## Escopo

  Do `agent.status: working` que abriu o turno interrompido em diante. Se o
  último marco do agente é um `agent.turn_resumed` (retomada gravada, turno
  novo ainda não aberto), o escopo é o do `working` que ele retoma.

  ## O mapa devolvido (`t:t/0`)

    * `:plano` — payload do ÚLTIMO `agent.plan` do agente no escopo, ou `nil`;
    * `:efeitos` — textos dos efeitos CONFIRMADOS: `tool.result ok` do agente
      (menos `registrar_plano`), `proposed_action.executed`, `artifact.*` do
      agente e `dev.awaiting_gate`;
    * `:sem_desfecho` — ferramentas do agente com `tool.call` e sem
      `tool.result` (a régua de `Reidratacao.resolver/3`): conferir o estado
      antes de repetir;
    * `:pendentes` — ações do agente (`proposed_action.created` com
      `status: pending`) sem `approved`/`denied`/`executed`/`failed`;
    * `:ultima_atividade` — `DateTime` do evento mais recente do agente na
      cauda (`createdAt`), ou `nil` quando o log não traz horário;
    * `:retomar_de` — `seq` do `working` do turno interrompido;
    * `:retomada_usada` — já existe `agent.turn_resumed` do agente imediatamente
      antes desse `working` (teto 1× automática durável, sem coluna);
    * `:retomada_pendente` / `:retomada_em` — o último marco é um
      `agent.turn_resumed` e o turno novo ainda não abriu.

  ## Janela de "recente"

  `janela_segundos/0`: 900 s (15 min, o mesmo de `gate_rescue_stale_after_seconds`),
  configurável pelo app env `:retomada_automatica_janela_segundos`. Mede-se a
  partir da ÚLTIMA ATIVIDADE do agente, nunca do instante do `working`.
  Sem horário no log, não é "recente": vale o fechamento de sempre.
  """

  alias Engine.Agents.Reidratacao
  alias Engine.Sessions.EngineApiClient

  @tipo_plano "agent.plan"
  @tipo_retomada "agent.turn_resumed"
  @ferramenta_do_plano "registrar_plano"

  @type t :: %{
          plano: map() | nil,
          efeitos: [String.t()],
          sem_desfecho: [String.t()],
          pendentes: [String.t()],
          ultima_atividade: DateTime.t() | nil,
          retomar_de: integer() | nil,
          retomada_usada: boolean(),
          retomada_pendente: boolean(),
          retomada_em: DateTime.t() | nil
        }

  def tipo_plano, do: @tipo_plano
  def tipo_retomada, do: @tipo_retomada

  @doc "A janela de 'recente', em segundos."
  def janela_segundos,
    do: Application.get_env(:engine, :retomada_automatica_janela_segundos, 900)

  @doc "Lê a cauda da sessão e projeta o diário de `agente`."
  @spec ler(String.t(), String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def ler(project_id, session_id, agente) do
    case EngineApiClient.list_events(project_id, session_id,
           latest: true,
           limit: Reidratacao.teto()
         ) do
      {:ok, eventos} -> {:ok, de_eventos(eventos, agente)}
      {:error, motivo} -> {:error, motivo}
    end
  end

  @doc "Projeção PURA dos `eventos` (envelope da api) para `agente`."
  @spec de_eventos([map()], String.t()) :: t()
  def de_eventos(eventos, agente) do
    eventos = Enum.sort_by(eventos, &seq/1)
    meus = Enum.filter(eventos, &(ator(&1) == agente))
    marcos = Enum.filter(meus, &marco?/1)

    {desde, usada, pendente} = escopo(marcos)
    no_escopo = if desde, do: Enum.filter(eventos, &(seq(&1) >= desde)), else: []
    meus_no_escopo = Enum.filter(no_escopo, &(ator(&1) == agente))

    %{
      plano: plano(meus_no_escopo),
      efeitos: efeitos(no_escopo, agente),
      sem_desfecho: sem_desfecho(meus_no_escopo),
      pendentes: pendentes(no_escopo, agente),
      ultima_atividade: meus |> Enum.map(&instante/1) |> Enum.reject(&is_nil/1) |> maximo(),
      retomar_de: desde,
      retomada_usada: usada or pendente != nil,
      retomada_pendente: pendente != nil,
      retomada_em: pendente && instante(pendente)
    }
  end

  @doc """
  O turno órfão (último status `working`) pode ser retomado sozinho no boot:
  ainda não foi retomado e a última atividade cabe na janela.
  """
  @spec retomavel_no_boot?(t(), DateTime.t()) :: boolean()
  def retomavel_no_boot?(%{retomada_usada: false, ultima_atividade: %DateTime{} = em}, agora),
    do: recente?(em, agora)

  def retomavel_no_boot?(_, _), do: false

  @doc """
  Há uma retomada gravada (`agent.turn_resumed`) cujo turno ainda não abriu e
  que cabe na janela — é o que o `init/1` do agente confere para se retomar.
  """
  @spec retomada_pendente?(t(), DateTime.t()) :: boolean()
  def retomada_pendente?(%{retomada_pendente: true, retomada_em: %DateTime{} = em}, agora),
    do: recente?(em, agora)

  def retomada_pendente?(_, _), do: false

  defp recente?(em, agora), do: DateTime.diff(agora, em, :second) <= janela_segundos()

  # --- Escopo ---

  # {seq do working interrompido, retomada já usada?, evento `turn_resumed` pendente}
  defp escopo(marcos) do
    case List.last(marcos) do
      nil ->
        {nil, false, nil}

      %{"type" => @tipo_retomada} = r ->
        anteriores = Enum.reject(marcos, &(&1 == r))
        w = anteriores |> Enum.filter(&working?/1) |> List.last()
        {w && seq(w), true, r}

      w ->
        anterior = marcos |> Enum.take(length(marcos) - 1) |> List.last()
        {seq(w), match?(%{"type" => @tipo_retomada}, anterior), nil}
    end
  end

  defp marco?(%{"type" => @tipo_retomada}), do: true
  defp marco?(e), do: working?(e)

  defp working?(%{"type" => "agent.status", "payload" => %{"status" => "working"}}), do: true
  defp working?(_), do: false

  # --- Projeções ---

  defp plano(meus) do
    meus
    |> Enum.filter(&(&1["type"] == @tipo_plano))
    |> List.last()
    |> case do
      %{"payload" => %{} = p} -> p
      _ -> nil
    end
  end

  defp efeitos(eventos, agente) do
    Enum.flat_map(eventos, fn
      %{"type" => "tool.result", "payload" => %{"ok" => true, "tool" => t}} = e
      when t != @ferramenta_do_plano ->
        if ator(e) == agente, do: ["ferramenta `#{t}`: ok"], else: []

      %{"type" => "proposed_action.executed", "payload" => p} ->
        ["ação #{p["actionId"] || "?"} executada"]

      %{"type" => "artifact." <> resto} = e ->
        if ator(e) == agente, do: ["artefato #{resto} gravado"], else: []

      %{"type" => "dev.awaiting_gate"} = e ->
        if ator(e) == agente, do: ["PR aberta, esperando o gate"], else: []

      _ ->
        []
    end)
  end

  defp sem_desfecho(meus) do
    Enum.reduce(meus, [], fn
      %{"type" => "tool.call", "payload" => %{"tool" => t}}, acc when t != @ferramenta_do_plano ->
        acc ++ [t]

      %{"type" => "tool.result", "payload" => %{"tool" => t}}, acc ->
        case acc |> Enum.reverse() |> Enum.find_index(&(&1 == t)) do
          nil -> acc
          i -> List.delete_at(acc, length(acc) - 1 - i)
        end

      _, acc ->
        acc
    end)
  end

  @liquidam ~w(proposed_action.approved proposed_action.denied proposed_action.executed proposed_action.failed)

  defp pendentes(eventos, agente) do
    liquidadas =
      for %{"type" => t, "payload" => %{"actionId" => id}} <- eventos, t in @liquidam, do: id

    for %{"type" => "proposed_action.created", "payload" => %{"status" => "pending"} = p} = e <-
          eventos,
        ator(e) == agente,
        p["actionId"] not in liquidadas,
        do: "#{p["actionType"] || "ação"} #{p["actionId"]}"
  end

  # --- Formas ---

  defp ator(e), do: get_in(e, ["actor", "id"]) || e["actorId"]

  defp seq(%{"seq" => s}) when is_integer(s), do: s
  defp seq(_), do: 0

  defp instante(%{"createdAt" => s}) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> dt
      _ -> nil
    end
  end

  defp instante(_), do: nil

  defp maximo([]), do: nil
  defp maximo(l), do: Enum.max(l, DateTime)
end
