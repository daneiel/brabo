defmodule Engine.Agents.DevLeadTools do
  @moduledoc """
  A ferramenta do Dev Lead (FASE 14d item 5, ADR 0053): propor o PLANO de
  execução.

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
  """

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
end
