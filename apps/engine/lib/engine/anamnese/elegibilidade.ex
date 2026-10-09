defmodule Engine.Anamnese.Elegibilidade do
  @moduledoc """
  Quem pode ser SUJEITO de uma rodada da Anamnese (RN-680, ADR 0196) — e, sem
  ninguém, a rodada NÃO roda: nenhuma chamada ao LLM, motivo nomeado no log.

  ## O que o uso real mediu

  Em 2026-09-29 foram seis rodadas e seis `anamnese.run_skipped` com o mesmo
  texto, "nenhum membro elegível", escritos pelo MODELO depois de uma chamada
  paga (8 933 micros em 6 chamadas). O worker mandava ao LLM um prompt cujo
  bloco "MEMBROS ELEGÍVEIS" dizia "(nenhum membro elegível)" e esperava o
  modelo descobrir sozinho que não havia o que fazer. Duas causas, as duas
  fechadas:

  1. A api lia só `project_members`, e criar projeto não grava linha ali — o
     dono do workspace que criou e usou o projeto não era membro. Desde a
     RN-680 ela lê os membros EFETIVOS (`projectRole ?? workspaceRole`, a
     régua da RN-471).
  2. Mesmo com membro, a rodada era cara para quem não tinha interagido: a
     evidência de um perfil TEM de citar eventos da janela, então membro sem
     nenhum evento próprio não pode ser perfilado. Aqui ele não é sujeito.

  ## A régua

  Sujeito é o membro que a api devolveu (efetivo e fora do opt-out) com ao
  menos UMA interação PRÓPRIA no que a rodada vai mostrar ao modelo: um evento
  da janela com `actor_kind: "user"` e o id dele, ou uma decisão da janela
  (`decidedBy`). É a MESMA janela que o prompt leva — evento omitido pelo
  corte não conta, porque o modelo não poderia citá-lo.

  Desde a RN-722 (decisão do dono, 02/10) "ao menos UMA" virou ao menos
  `min_interacoes_proprias/0` (default 5) interações próprias NOVAS — e a
  janela já começa no fim da última tentativa (concluída ou encerrada sem
  perfil), então "na janela" é "desde a última tentativa". Abaixo disso,
  nenhuma chamada ao LLM nem ao RAG.

  Desde a RN-756 (AT-439) só conta interação com CONTEÚDO TÉCNICO do sujeito:
  evento `actor_kind: "user"` de um tipo em `tipos_de_evento_com_conteudo/0`
  (mensagem escrita por ele, resposta a pergunta estruturada) e decisão
  com motivo de recusa escrito (`rejectionReason` não vazio — é uma
  correção; o status não é lido).
  Aprovação, handoff, clique e qualquer outro evento de usuário NÃO contam:
  não são evidência de competência, e no TP-01 de 08/10 duas rodadas pagas só
  com eles terminaram em `skip_proficiency`.

  Hipótese aceita na fila NÃO cria sujeito: ela forçava a rodada, e a rodada
  sem sujeito foi exatamente o que gastou no uso real. O destino da hipótese
  aceita, desde a RN-680, é o FATO do perfil no grafo, que não depende de
  rodada nenhuma; a linha da fila espera a próxima rodada com sujeito.
  """

  @type motivo :: :nenhum_membro | :nenhuma_interacao_propria

  @doc """
  `{:ok, sujeitos}` — os membros (na forma em que a api os mandou) que podem
  ser perfilados nesta rodada — ou `{:sem_sujeito, motivo, detalhe}`, com o
  motivo como átomo estável e o detalhe em texto, com os números.
  """
  @spec avaliar(%{members: [map()], events: [map()], decisions: [map()]}) ::
          {:ok, [map()]} | {:sem_sujeito, motivo(), String.t()}
  def avaliar(%{members: members, events: events, decisions: decisions}) do
    if members == [] do
      {:sem_sujeito, :nenhum_membro,
       "nenhum membro efetivo do projeto fora do opt-out da Anamnese"}
    else
      contagem = interlocutores(events, decisions)
      minimo = min_interacoes_proprias()

      case Enum.filter(members, &(Map.get(contagem, Map.get(&1, "userId"), 0) >= minimo)) do
        [] ->
          {:sem_sujeito, :nenhuma_interacao_propria,
           "#{length(members)} membro(s) elegível(is), nenhum com #{minimo}+ interações " <>
             "próprias nos #{length(events)} evento(s) e #{length(decisions)} decisão(ões) " <>
             "da janela (RN-722); só mensagem escrita e recusa com motivo contam (RN-756)"}

        sujeitos ->
          {:ok, sujeitos}
      end
    end
  end

  defp interlocutores(events, decisions) do
    de_eventos =
      events
      |> Enum.filter(
        &(Map.get(&1, :actor_kind) == "user" and
            Map.get(&1, :type) in tipos_de_evento_com_conteudo())
      )
      |> Enum.map(&Map.get(&1, :actor_id))

    de_decisoes =
      decisions
      |> Enum.filter(&recusa_com_motivo?/1)
      |> Enum.map(&Map.get(&1, "decidedBy"))

    (de_eventos ++ de_decisoes)
    |> Enum.filter(&is_binary/1)
    |> Enum.frequencies()
  end

  # RN-756: só a recusa com motivo escrito é correção técnica; aprovar não é.
  defp recusa_com_motivo?(d) do
    motivo = Map.get(d, "rejectionReason")
    is_binary(motivo) and String.trim(motivo) != ""
  end

  @doc "Tipos de evento de usuário que trazem conteúdo técnico dele (RN-756)."
  def tipos_de_evento_com_conteudo,
    do: ["chat.message", "chat.structured_question_answered"]

  @doc "Mínimo de interações próprias novas para alguém ser sujeito (RN-722)."
  def min_interacoes_proprias,
    do: Application.get_env(:engine, :anamnese_min_interacoes_proprias, 5)
end
