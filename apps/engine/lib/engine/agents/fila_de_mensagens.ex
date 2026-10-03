defmodule Engine.Agents.FilaDeMensagens do
  @moduledoc """
  A fila das mensagens que chegam a um agente conversacional com um turno em
  curso (RN-673, ADR 0191 — que revisa a recusa do ADR 0163 só para MENSAGEM).

  Até aqui a mensagem que chegava no meio de um turno era recusada com 409
  `turno_em_andamento`, mas já estava gravada como `chat.message` (a api grava
  ANTES de falar com o engine) e nunca era lida: medido no uso real de
  2026-09-29, três mensagens numa sessão só (PO, Infra Lead e Dev Lead).

  ## A decisão do dono (01/10)

    * a mensagem entra numa fila PERSISTIDA, que sobrevive a restart;
    * **N mensagens = 1 turno**: no fim do turno em curso as pendentes são
      lidas JUNTAS, na ordem de chegada, num turno só (`texto_do_turno/1`);
    * cada uma pode ser CANCELADA enquanto pendente, por quem a enviou;
    * **teto de 10** pendentes por agente e sessão (`teto/0`) — acima disso,
      recusa nomeada (409 `fila_de_mensagens_cheia`).

  ## Onde mora o estado

  No EVENT LOG, nunca numa tabela: três eventos imutáveis, todos com o id do
  `chat.message` (`mensagemId`) que eles qualificam.

    * `chat.message_queued` — gravado pelo AGENTE quando a mensagem entra na
      fila (`payload`: `mensagemId`, `texto`, `idioma`, `posicao`). O texto vai
      junto porque é ele que a fila precisa reler depois de um restart, e o
      `chat.message` pode já ter saído da janela de leitura;
    * `chat.message_delivered` — gravado pelo AGENTE ao abrir o turno que lê as
      pendentes (`payload`: `mensagemIds`, na ordem);
    * `chat.message_cancelled` — gravado em nome de quem CANCELOU (ator
      `user`), `payload`: `mensagemId`, `agente`.

  Pendente = enfileirada e nem entregue nem cancelada (`pendentes/2`). É a
  mesma derivação que a tela faz para mostrar "na fila".

  O processo do agente guarda a fila em memória (`:fila_de_mensagens` no
  state) — é ela que decide na hora; o log é o que a reconstrói quando o
  processo sobe de novo (`ler_ao_subir/3`).
  """

  require Logger

  alias Engine.Agents.Reidratacao

  @teto 10

  @enfileirada "chat.message_queued"
  @entregue "chat.message_delivered"
  @cancelada "chat.message_cancelled"

  @typedoc "Uma mensagem na fila do agente."
  @type mensagem :: %{id: String.t() | nil, texto: String.t(), idioma: String.t() | nil}

  @doc "Quantas mensagens podem esperar, por agente e sessão (decisão do dono, 01/10)."
  def teto, do: @teto

  @doc "Os três tipos de evento da fila."
  def tipos, do: [@enfileirada, @entregue, @cancelada]

  def tipo_enfileirada, do: @enfileirada
  def tipo_entregue, do: @entregue
  def tipo_cancelada, do: @cancelada

  @doc """
  As mensagens pendentes de `agent`, na ordem em que foram enfileiradas,
  derivadas dos eventos da fila (qualquer ordem de entrada; a ordem vale pelo
  `seq`). Puro — público para teste e para a reidratação.
  """
  @spec pendentes([map()], String.t()) :: [mensagem()]
  def pendentes(eventos, agent) do
    ordenados = Enum.sort_by(eventos, &seq/1)

    fechadas =
      ordenados
      |> Enum.flat_map(fn
        %{"type" => @entregue, "payload" => %{"mensagemIds" => ids}} when is_list(ids) -> ids
        %{"type" => @cancelada, "payload" => %{"mensagemId" => id}} -> [id]
        _ -> []
      end)
      |> MapSet.new()

    for %{"type" => @enfileirada, "payload" => %{"mensagemId" => id} = p} = e <- ordenados,
        ator(e) == agent,
        is_binary(id),
        not MapSet.member?(fechadas, id),
        do: %{id: id, texto: texto(p["texto"]), idioma: idioma(p["idioma"])}
  end

  @doc """
  Os ids de `chat.message` que a REIDRATAÇÃO de `agent` deve pular: os
  cancelados (nunca foram ditos a agente nenhum) e os que seguem pendentes
  para ESTE agente (a fila os entregará num turno próprio — reidratá-los
  também os poria duas vezes no histórico).
  """
  @spec fora_do_historico([map()], String.t()) :: MapSet.t()
  def fora_do_historico(eventos, agent) do
    canceladas =
      for %{"type" => @cancelada, "payload" => %{"mensagemId" => id}} <- eventos,
          is_binary(id),
          do: id

    pendentes = for %{id: id} <- pendentes(eventos, agent), do: id

    MapSet.new(canceladas ++ pendentes)
  end

  @doc """
  A fila de `agent` reconstruída do log quando o processo sobe. Nunca lança:
  leitura que falha vira fila vazia e log — o agente sobe do mesmo jeito, e a
  mensagem segue "na fila" no log até a próxima subida.
  """
  @spec ler_ao_subir(String.t(), String.t(), String.t()) :: [mensagem()]
  def ler_ao_subir(project_id, session_id, agent) do
    case Reidratacao.eventos_do_tipo(project_id, session_id, tipos()) do
      {:ok, eventos, _truncado?} ->
        pendentes(eventos, agent)

      {:error, motivo} ->
        Logger.warning(
          "fila de mensagens: não consegui ler a fila de #{agent} na sessão " <>
            "#{session_id} (#{inspect(motivo)}); ela segue no log"
        )

        []
    end
  rescue
    erro ->
      Logger.warning(
        "fila de mensagens: falha inesperada na sessão #{session_id}: #{inspect(erro)}"
      )

      []
  end

  @doc """
  O texto do turno que lê a fila. UMA mensagem é ela mesma, sem moldura — é o
  caso mais comum e o agente não precisa saber que ela esperou. Várias viram UM
  texto, numeradas na ordem de chegada, com uma linha dizendo que são várias e
  que devem ser respondidas juntas (N mensagens = 1 turno).
  """
  @spec texto_do_turno([mensagem()]) :: String.t()
  def texto_do_turno([%{texto: texto}]), do: texto

  def texto_do_turno(fila) when is_list(fila) and length(fila) > 1 do
    corpo =
      fila
      |> Enum.with_index(1)
      |> Enum.map_join("\n\n", fn {%{texto: texto}, i} -> "[#{i}] #{texto}" end)

    "(Enquanto você trabalhava no turno anterior chegaram #{length(fila)} mensagens. " <>
      "Leia todas, na ordem, e responda a elas juntas.)\n\n" <> corpo
  end

  @doc """
  Na varredura de BOOT (`Engine.Sessions.Rehydrator`): acorda o agente que tem
  mensagem pendente na fila e não está de pé. O processo dos conversacionais
  não é reidratado no boot (sobe com a próxima mensagem); sem isto, a fila de
  quem estava no meio de um turno quando o engine caiu esperaria até alguém
  escrever de novo. O `init/1` do agente reconstrói a fila e a entrega.
  Devolve os agentes acordados. Nunca lança.
  """
  @spec acordar_pendentes(String.t(), String.t()) :: [String.t()]
  def acordar_pendentes(project_id, session_id) do
    case Reidratacao.eventos_do_tipo(project_id, session_id, tipos()) do
      {:ok, eventos, _} ->
        for agente <- Map.keys(supervisores()),
            pendentes(eventos, agente) != [],
            acordar(agente, session_id, project_id),
            do: agente

      {:error, motivo} ->
        Logger.warning("fila de mensagens: varredura de boot falhou (#{inspect(motivo)})")
        []
    end
  rescue
    erro ->
      Logger.warning("fila de mensagens: varredura de boot falhou: #{inspect(erro)}")
      []
  end

  defp acordar(agente, session_id, project_id) do
    supervisor = Map.fetch!(supervisores(), agente)

    # Os supervisores devolvem só `{:ok, _}`: a falha de subir o processo
    # LANÇA (`CaseClauseError` sobre o `start_child`). Ela é contida aqui,
    # por agente, para não abortar a varredura dos outros seis.
    case supervisor.start_agent(session_id, project_id) do
      {:ok, _pid} -> true
      {:ok, _pid, _origem} -> true
    end
  rescue
    erro ->
      Logger.warning("fila de mensagens: não consegui acordar #{agente}: #{inspect(erro)}")
      false
  catch
    :exit, motivo ->
      Logger.warning("fila de mensagens: não consegui acordar #{agente}: #{inspect(motivo)}")
      false
  end

  # Os sete conversacionais e o supervisor que os sobe — os mesmos do
  # `AgentCommandController.message/2`. Nenhum kickoff: acordar não é começar.
  defp supervisores do
    %{
      "criativo" => Engine.Agents.CriativoSupervisor,
      "po" => Engine.Agents.PoSupervisor,
      "arquiteto" => Engine.Agents.ArquitetoSupervisor,
      "dev-lead" => Engine.Agents.DevLeadSupervisor,
      "ux-designer" => Engine.Agents.UxDesignerSupervisor,
      "staff" => Engine.Agents.StaffSupervisor,
      "infra" => Engine.Infra.InfraLeadSupervisor
    }
  end

  defp ator(evento), do: get_in(evento, ["actor", "id"]) || evento["actorId"]

  defp seq(%{"seq" => s}) when is_integer(s), do: s
  defp seq(_), do: 0

  defp texto(t) when is_binary(t), do: t
  defp texto(_), do: ""

  defp idioma(i) when is_binary(i) and i != "", do: i
  defp idioma(_), do: nil
end
