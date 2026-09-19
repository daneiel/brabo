defmodule Engine.Agents.TurnoOrfao do
  @moduledoc """
  O turno que o reinício do engine deixou pela metade fecha com desfecho
  DURÁVEL (RN-586, AT-156).

  Desde o ADR 0163 (RN-578) o `agent.status: working` é gravado ANTES do aceite
  e o fim do turno (`idle`, `agent.done`) só sai de `TurnoAssincrono.finalizar/1`,
  dentro do processo do agente. Se o engine cai no meio, o processo e a Task
  morrem juntos e ninguém grava o fim: o último `agent.status` do agente fica
  `working` PARA SEMPRE. Os dois leitores desse sinal enxergam isso como turno
  em curso — a tela (`turnoTerminouNoLog`) mantém a faixa de atividade, e o
  `GetSessionPendingWorkUseCase` conta trabalho pendente sem teto, então a
  sessão não fecha por heartbeat.

  ## O que faz

  Para cada um dos seis agentes que compartilham `TurnoAssincrono` cujo ÚLTIMO
  `agent.status` é `working` e que não tem turno vivo, ACRESCENTA (evento é
  imutável; o `working` gravado não é reescrito):

    1. `agent.error` com origem `infra` e `reason: turno_interrompido_por_reinicio`
       — a RN-059: falha nunca vira resposta vazia, e a frase diz o que houve;
    2. `agent.status: idle`, persistido.

  E avisa o canal (`agent.error` e `agent.done`) para a faixa de quem está com a
  tela aberta sair sem recarregar.

  NUNCA reexecuta o turno. Reexecutar seria gastar token em nome de uma mensagem
  que o usuário talvez já tenha esquecido, com o histórico reconstruído pela
  metade; a decisão de tentar de novo é dele — a mensagem diz isso.

  ## Onde roda

    * `varrer/2`, no boot, pelo `Engine.Sessions.Rehydrator`, para cada sessão
      não terminal — é o que fecha o turno mesmo que ninguém mande mensagem;
    * `fechar/3` no `init/1` de cada um dos seis servidores — a rede de
      segurança para quando o boot não conseguiu (api ainda de pé nenhum
      segundo) e o agente só é acordado depois pela próxima mensagem.

  Os dois passam pela MESMA função. "Sem turno vivo" é: neste nó o processo do
  agente não existe (ou é quem está subindo), e nos OUTROS nós do cluster
  também não — o registro é local, e num rollout o pod antigo pode ainda estar
  rodando o turno; fechá-lo dali seria matar um turno saudável. Nó que não
  responde conta como VIVO (na dúvida, não fecha).

  Nunca lança e nunca atrasa a subida além das leituras: falha de leitura ou de
  escrita é logada e o agente sobe.
  """

  require Logger

  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  # Os seis que rodam pelo `TurnoAssincrono`. O Infra Lead roda o turno dentro
  # do `handle_call` e fica de fora — declarado na RN-586.
  @agentes ~w(criativo po arquiteto dev-lead ux-designer staff)

  @espera_do_cluster_ms 2_000

  # Bem acima do que uma conversa gera de `agent.status` por sessão em
  # janela recente; o último de cada agente é o que importa.
  @janela 200

  def agentes, do: @agentes

  @doc """
  Varredura de boot: fecha o turno órfão de todo agente da sessão que não tem
  processo vivo em nó nenhum. Devolve os agentes fechados.
  """
  @spec varrer(String.t(), String.t()) :: [String.t()]
  def varrer(project_id, session_id) do
    candidatos = Enum.reject(@agentes, &vivo?(&1, session_id, :todos))
    fechar(project_id, session_id, candidatos)
  end

  @doc """
  Fecha o turno órfão de `agente` — chamado do `init/1` dele, então o processo
  local (o que está subindo) não conta como turno vivo; só os OUTROS nós.
  """
  @spec fechar_ao_subir(String.t(), String.t(), String.t()) :: [String.t()]
  def fechar_ao_subir(project_id, session_id, agente) do
    if vivo?(agente, session_id, :outros_nos),
      do: [],
      else: fechar(project_id, session_id, [agente])
  end

  @doc "Fecha o turno órfão dos `agentes` (os que tiverem `working` como último status)."
  @spec fechar(String.t(), String.t(), [String.t()]) :: [String.t()]
  def fechar(_project_id, _session_id, []), do: []

  def fechar(project_id, session_id, agentes) do
    case EngineApiClient.list_events(project_id, session_id,
           types: ["agent.status"],
           latest: true,
           limit: @janela
         ) do
      {:ok, eventos} ->
        fechados = orfaos(eventos, agentes)
        Enum.each(fechados, &encerrar(project_id, session_id, &1))
        fechados

      {:error, motivo} ->
        Logger.warning(
          "turno órfão: não consegui ler os status da sessão #{session_id} " <>
            "(#{inspect(motivo)}); nada foi fechado"
        )

        []
    end
  rescue
    erro ->
      Logger.warning("turno órfão: falha inesperada na sessão #{session_id}: #{inspect(erro)}")
      []
  end

  # Os `agentes` cujo status mais recente (maior `seq`) é `working`.
  defp orfaos(eventos, agentes) do
    ultimo_por_ator =
      eventos
      |> Enum.filter(&(&1["type"] == "agent.status"))
      |> Enum.reduce(%{}, fn e, acc ->
        ator = get_in(e, ["actor", "id"]) || e["actorId"]
        Map.update(acc, ator, e, fn atual -> if seq(e) >= seq(atual), do: e, else: atual end)
      end)

    for agente <- agentes,
        %{"payload" => %{"status" => "working"}} <- [Map.get(ultimo_por_ator, agente)],
        do: agente
  end

  defp seq(%{"seq" => s}) when is_integer(s), do: s
  defp seq(_), do: 0

  defp encerrar(project_id, session_id, agente) do
    origem = "infra"

    mensagem =
      "O engine foi reiniciado no meio do meu turno e ele não foi concluído — " <>
        "não vou retomá-lo sozinho. Nada foi refeito nem gasto agora; se ainda " <>
        "quiser, mande a mensagem de novo."

    _ =
      EngineApiClient.append_event(project_id, session_id, %{
        type: "agent.error",
        actorKind: "agent",
        actorId: agente,
        payload: %{
          origem: origem,
          mensagem: mensagem,
          reason: "turno_interrompido_por_reinicio"
        }
      })

    EngineWeb.Endpoint.broadcast("session:" <> session_id, "agent.error", %{
      origem: origem,
      mensagem: mensagem
    })

    EngineWeb.Endpoint.broadcast("session:" <> session_id, "agent.done", %{})
    LiveBroadcast.agent_status(project_id, session_id, agente, "idle")

    Logger.info("turno órfão: #{agente} da sessão #{session_id} fechado (reinício do engine)")
  end

  # `:todos` inclui este nó; `:outros_nos` é o caso do `init/1`, onde o processo
  # local é o que está subindo. Erro de multicall = VIVO (não fecha na dúvida).
  defp vivo?(agente, session_id, onde) do
    chave = agente <> ":" <> session_id

    local? =
      onde == :todos and Registry.lookup(Engine.Sessions.Registry, chave) != []

    local? or vivo_em_outro_no?(chave)
  end

  defp vivo_em_outro_no?(chave) do
    case Node.list() do
      [] ->
        false

      nos ->
        nos
        |> :erpc.multicall(
          Registry,
          :lookup,
          [Engine.Sessions.Registry, chave],
          @espera_do_cluster_ms
        )
        |> Enum.any?(fn
          {:ok, []} -> false
          _ -> true
        end)
    end
  end
end
