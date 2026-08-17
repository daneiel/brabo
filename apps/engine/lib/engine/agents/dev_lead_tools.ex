defmodule Engine.Agents.DevLeadTools do
  @moduledoc """
  As ferramentas do Dev Lead: propor o PLANO de execução (FASE 14d item 5,
  ADR 0053) e avaliar a IMPLEMENTABILIDADE de uma story (ADR 0090).

  Ele não escreve código — distribui trabalho e responde por ele. O plano diz
  quantos agentes por módulo e **por quê**, e é isso que o usuário aceita ao
  ativar a execução.

  ## O plano é `proposed_action` (ADR 0086, RN-284) — revisão da decisão original

  Até aqui o plano virava EVENTO simples no log
  (`execution.plan_proposed`), sem pipeline de aprovação: o argumento era que
  propor um plano não tem efeito externo nenhum — o gasto acontece quando os
  agentes sobem, e era lá que o teto da RN-083 cobrava autorização.
  Transformar a proposta em ação a decidir faria o usuário decidir duas vezes
  a mesma coisa.

  A auditoria de `docs/fluxo.yml` × código (achado A2) encontrou que
  `fluxo.yml` já declarava esta saída como `via: proposed_action` desde a
  ADR 0085, e o código nunca foi ajustado para bater. O dono do produto
  decidiu que o código erra: o plano é a PRIMEIRA decisão real de quanto a
  sessão vai gastar com paralelismo (RN-083 nasce aqui, não só na
  ultrapassagem de teto) — o usuário decide ativar a execução tendo VISTO o
  plano numa aprovação de verdade, não só lido uma linha no fio. A lição
  antiga ("decidir duas vezes") não desapareceu: ela é o motivo pelo qual
  `propose_execution_plan` NÃO entrou no bloco de tetos absolutos de
  `decide.ts` — pode ser configurado para auto-aprovar, ao contrário de
  `parallelize`/`raise_max_parallel`, que nunca podem.

  `run/2` agora chama `EngineApiClient.propose_action/5` em vez de
  `append_event/3`, e o chamador (`Engine.Agents.DevLeadServer`) SUSPENDE o
  turno até a decisão — ver o moduledoc de lá para o mecanismo.

  ## `assess_implementability` (ADR 0090) — o gate `implementavel` ativo

  `docs/gates.yml` declarava o gate `implementavel` como `status: planned`
  desde a FASE 14d (dono `dev-lead`, entrada `[story-ready, plano-de-teste]`,
  entregável `parecer-implementabilidade`) — nunca ativado. Esta ferramenta
  ativa: `run_assessment/2` monta o parecer e chama
  `EngineApiClient.propose_action/5` com `"assess_implementability"`, MESMO
  padrão de `run/2`/`propose_execution_plan` acima (contrato de três
  desfechos, `{:ok, texto} | {:pending, action_id} | {:error, texto}`).

  ### O plano de teste é um PRÉ-REQUISITO, não um argumento da ferramenta

  O parecer de implementabilidade lê o `artifact.plano_de_teste` mais
  recente da story (emitido por `Engine.Gates.QaEstrategiaAgent`,
  segundo momento do `qa-lead` — ver `docs/fluxo.yml`, papel
  `qa-estrategia`) do HISTÓRICO da própria sessão do Dev Lead. Duas
  chamadas possíveis:

    1. **Sem plano ainda** — `run_assessment/2` DISPARA a avaliação por
       `Engine.Gates.Dispatcher.run_qa_estrategia/3` (mesma indireção
       trocável em teste que `run_qa/2`/`run_secops/2` já usam — sobe o
       `QaLeadServer` do projeto se preciso e chama `run_design/3`, `cast`
       assíncrono, mesmo estilo do resto da área de QA) e devolve
       `{:error, texto}`
       explicando que ainda não há plano e que o modelo deve chamar de
       novo em instantes. Erro de ferramenta é ENTRADA do laço, não fim de
       linha (RN-163): o Dev Lead tem teto de 14 iterações para tentar de
       novo depois que o plano existir. A janela de espera é aceita e
       declarada — o `QaEstrategiaAgent` roda em processo separado
       (`qa-lead`), então não há como este `run/2` síncrono bloquear
       esperando o resultado sem acoplar os dois processos.
    2. **Com plano** — monta o parecer (`storyId`/`parecer`/
       `justificativa`/o plano de teste embutido no payload, para o
       usuário decidir sem precisar abrir dois eventos) e propõe a ação.
  """

  alias Engine.Gates.Dispatcher
  alias Engine.Sessions.EngineApiClient

  @spec spec() :: map()
  def spec do
    %{
      name: "propose_execution_plan",
      description:
        "Propõe o plano de execução: quantos agentes por módulo e por quê. " <>
          "Use UMA vez, depois de avaliar o module_map e o backlog pegável. " <>
          "É uma decisão real, que o usuário aprova ou recusa em Aprovações — " <>
          "não sobe agente nenhum sozinho, e a conversa espera a decisão " <>
          "antes de continuar.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "modulos" => %{
            "type" => "array",
            "description" => "um item por módulo que você quer trabalhar agora",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "modulo" => %{"type" => "string"},
                "agentes" => %{
                  "type" => "integer",
                  "minimum" => 1,
                  "description" => "quantos agentes neste módulo"
                },
                "porque" => %{
                  "type" => "string",
                  "description" => "o que no backlog justifica esse número"
                }
              },
              "required" => ["modulo", "agentes", "porque"]
            }
          },
          "resumo" => %{
            "type" => "string",
            "description" => "o plano em uma frase, para o usuário decidir sem ler a lista"
          }
        },
        "required" => ["modulos", "resumo"]
      }
    }
  end

  @spec run(map(), map()) :: {:ok, String.t()} | {:pending, String.t()} | {:error, String.t()}
  def run(%{"modulos" => modulos, "resumo" => resumo}, state) when is_list(modulos) do
    case validar(modulos) do
      {:error, motivo} ->
        {:error, motivo}

      {:ok, normalizados} ->
        total = Enum.reduce(normalizados, 0, &(&1.agentes + &2))
        actor = %{kind: "agent", id: "dev-lead"}

        payload = %{modulos: normalizados, resumo: resumo, totalAgentes: total}

        case EngineApiClient.propose_action(
               state.project_id,
               state.session_id,
               "propose_execution_plan",
               actor,
               payload
             ) do
          {:ok, action} ->
            classificar(Map.get(action, "status"), Map.get(action, "id"), total, normalizados)

          {:error, reason} ->
            {:error, "não consegui propor o plano de execução: #{inspect(reason)}"}
        end
    end
  end

  def run(_args, _state),
    do: {:error, "propose_execution_plan exige `modulos` (lista) e `resumo`"}

  # `propose_execution_plan` não tem execute-* pipeline (não há efeito a
  # aplicar na aprovação — a criação dos agentes acontece depois, num ato
  # SEPARADO, quando o usuário ativa a execução). Por isso a aprovação
  # manual nunca sai de `"approved"` — a máquina de estados
  # (`action-state-machine.ts`) modela `approved -> executed | failed` como
  # aberto, mas nada aqui chama essa transição, e não deveria: não há o que
  # executar. `"auto_approved"` é o caminho da aprovação automática (o
  # usuário configurou `permissions.json`/`agent_autonomy`); `"executed"`
  # entraria aqui se um dia este tipo ganhar pipeline própria. Os três
  # contam como sucesso — o plano foi aceito.
  defp classificar(status, _action_id, total, normalizados)
       when status in ["executed", "auto_approved", "approved"] do
    {:ok,
     "plano aprovado: #{total} agente(s) em #{length(normalizados)} módulo(s). " <>
       "O usuário ativa a execução quando quiser."}
  end

  defp classificar("pending", action_id, _total, _normalizados) when is_binary(action_id) do
    {:pending, action_id}
  end

  defp classificar(status, _action_id, _total, _normalizados) do
    {:error, "o plano não foi registrado (status inesperado: #{inspect(status)})"}
  end

  # Plano vazio, ou com zero agente num módulo, não é plano — e chegaria ao
  # usuário como uma decisão sem conteúdo.
  defp validar([]), do: {:error, "o plano precisa de ao menos um módulo"}

  defp validar(modulos) do
    Enum.reduce_while(modulos, {:ok, []}, fn item, {:ok, acc} ->
      modulo = Map.get(item, "modulo")
      agentes = Map.get(item, "agentes")
      porque = Map.get(item, "porque", "")

      cond do
        not is_binary(modulo) or modulo == "" ->
          {:halt, {:error, "cada item precisa de `modulo` não vazio"}}

        not is_integer(agentes) or agentes < 1 ->
          {:halt,
           {:error,
            "módulo #{modulo}: `agentes` precisa ser inteiro >= 1 (recebido: #{inspect(agentes)})"}}

        true ->
          {:cont, {:ok, acc ++ [%{modulo: modulo, agentes: agentes, porque: porque}]}}
      end
    end)
  end

  # --- assess_implementability (ADR 0090) --------------------------------

  @spec spec_assess_implementability() :: map()
  def spec_assess_implementability do
    %{
      name: "assess_implementability",
      description:
        "Avalia se uma story do backlog é IMPLEMENTÁVEL, a partir do plano de " <>
          "teste da QA-estratégia (docs/fluxo.yml). Se a story ainda não tem " <>
          "plano de teste, esta chamada DISPARA a avaliação e devolve erro " <>
          "pedindo para tentar de novo em instantes — não propõe decisão " <>
          "nenhuma nesse caso. Com o plano em mãos, propõe o parecer de " <>
          "implementabilidade: é uma decisão real, que o usuário aprova ou " <>
          "recusa em Aprovações (gate `implementavel`).",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "storyId" => %{"type" => "string"},
          "parecer" => %{
            "type" => "string",
            "enum" => ["implementavel", "inviavel"]
          },
          "justificativa" => %{
            "type" => "string",
            "description" => "o que no plano de teste (ou na story) sustenta o parecer"
          }
        },
        "required" => ["storyId", "parecer", "justificativa"]
      }
    }
  end

  @spec run_assessment(map(), map()) ::
          {:ok, String.t()} | {:pending, String.t()} | {:error, String.t()}
  def run_assessment(
        %{"storyId" => story_id, "parecer" => parecer, "justificativa" => justificativa},
        state
      )
      when parecer in ["implementavel", "inviavel"] do
    case buscar_plano_de_teste(state, story_id) do
      {:ok, plano} ->
        propor_parecer(state, story_id, parecer, justificativa, plano)

      :sem_plano ->
        Dispatcher.run_qa_estrategia(state.project_id, state.session_id, story_id)

        {:error,
         "ainda não há plano de teste para essa story — pedi a avaliação de " <>
           "QA-estratégia agora. Chame assess_implementability de novo em " <>
           "instantes (o parecer só sai depois que o plano existir)."}

      {:error, reason} ->
        {:error, "não consegui ler o histórico da sessão: #{inspect(reason)}"}
    end
  end

  def run_assessment(_args, _state),
    do:
      {:error,
       "assess_implementability exige storyId, parecer (implementavel|inviavel) e justificativa"}

  # O plano de teste vive no event log da PRÓPRIA sessão do Dev Lead — é lá
  # que `Engine.Gates.QaEstrategiaAgent.run/4` emite `artifact.plano_de_teste`
  # (ver `qa_estrategia_agent.ex`, chamado com o mesmo `session_id`). O MAIS
  # RECENTE vence: o histórico é imutável, uma story pode ser reavaliada.
  defp buscar_plano_de_teste(state, story_id) do
    case EngineApiClient.list_events(state.project_id, state.session_id) do
      {:ok, events} ->
        events
        |> Enum.filter(&plano_da_story?(&1, story_id))
        |> List.last()
        |> case do
          nil -> :sem_plano
          evento -> {:ok, Map.get(evento, "payload", %{})}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp plano_da_story?(%{"type" => "artifact.plano_de_teste", "payload" => payload}, story_id),
    do: Map.get(payload, "storyId") == story_id

  defp plano_da_story?(_evento, _story_id), do: false

  defp propor_parecer(state, story_id, parecer, justificativa, plano) do
    actor = %{kind: "agent", id: "dev-lead"}

    payload = %{
      storyId: story_id,
      parecer: parecer,
      justificativa: justificativa,
      planoDeTeste: Map.get(plano, "planoDeTeste"),
      criteriosExecutaveis: Map.get(plano, "criteriosExecutaveis", [])
    }

    case EngineApiClient.propose_action(
           state.project_id,
           state.session_id,
           "assess_implementability",
           actor,
           payload
         ) do
      {:ok, action} ->
        classificar_parecer(Map.get(action, "status"), Map.get(action, "id"), parecer, story_id)

      {:error, reason} ->
        {:error, "não consegui propor o parecer de implementabilidade: #{inspect(reason)}"}
    end
  end

  # Mesmo raciocínio de `classificar/4`, acima: `assess_implementability`
  # também não tem execute-* pipeline própria (não há efeito a aplicar —
  # o parecer é registro para o usuário decidir). Os três contam sucesso.
  defp classificar_parecer(status, _action_id, parecer, story_id)
       when status in ["executed", "auto_approved", "approved"] do
    {:ok,
     "parecer (#{parecer}) registrado para a story #{story_id}. " <>
       "O usuário decide em Aprovações."}
  end

  defp classificar_parecer("pending", action_id, _parecer, _story_id)
       when is_binary(action_id) do
    {:pending, action_id}
  end

  defp classificar_parecer(status, _action_id, _parecer, _story_id) do
    {:error, "o parecer não foi registrado (status inesperado: #{inspect(status)})"}
  end
end
