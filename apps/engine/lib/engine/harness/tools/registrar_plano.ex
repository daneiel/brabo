defmodule Engine.Harness.Tools.RegistrarPlano do
  @moduledoc """
  O agente escreve o PRÓPRIO plano (AT-582, ADR 0226): objetivo e passos com
  estado. É o que o diário (`Engine.Agents.Diario`) lê para dizer, depois de uma
  queda, onde o agente parou e o que faltava.

  `:direct` — escrever o próprio plano NÃO é efeito externo: não é
  `proposed_action`, não passa por `decide()` e não tem frase em
  `aprovacoes.ts` (mesma régua de `RagFeedback`: anotar não vira fila de
  aprovação). Não é artefato do projeto: fica fora de `ferramentas_de_artefato/0`.

  ## Contrato

  Argumentos (chaves string; `passos` pode chegar como string JSON e é
  normalizado por `ArgumentosDeFerramenta.executar/4`, RN-719):

      %{"objetivo" => string (1..200),
        "passos" => [%{"texto" => string (1..160),
                       "estado" => "pendente" | "em_curso" | "feito" | "descartado"}]}  # 1..12

  Cada chamada manda o plano INTEIRO e substitui o anterior: o vigente é o
  último `agent.plan` do agente (a ordem é o `seq`; sem versão gravada). Acima
  do teto a ferramenta RECUSA nomeando o limite — nunca corta calada. Grava
  `agent.plan` (`actorKind: agent`, `actorId` = o agente, payload
  `%{objetivo, passos}`) e devolve "plano registrado (N passos)".

  A descrição não nomeia idioma (RN-667). Quem a oferece ao modelo
  (conversacionais, dev, subagentes de gate) põe este módulo no próprio
  registro de ferramentas; ele NÃO está no registro padrão de
  `Engine.Harness.Tools`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @estados ["pendente", "em_curso", "feito", "descartado"]
  @max_objetivo 200
  @max_passos 12
  @max_texto 160

  def teto_do_objetivo, do: @max_objetivo
  def teto_de_passos, do: @max_passos
  def teto_do_texto, do: @max_texto

  @impl true
  def spec do
    %{
      name: "registrar_plano",
      description:
        "Registra o seu plano de trabalho: o objetivo e os passos, cada um com o estado " <>
          "(pendente, em_curso, feito, descartado). Mande o plano INTEIRO a cada chamada " <>
          "(ele substitui o anterior) e atualize os estados conforme avança. Se o " <>
          "trabalho for interrompido, é por ele que você retoma do passo seguinte. " <>
          "Isto não muda nada no projeto. Limites: objetivo até #{@max_objetivo} " <>
          "caracteres, até #{@max_passos} passos de até #{@max_texto} caracteres.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "objetivo" => %{"type" => "string", "maxLength" => @max_objetivo},
          "passos" => %{
            "type" => "array",
            "minItems" => 1,
            "maxItems" => @max_passos,
            "items" => %{
              "type" => "object",
              "properties" => %{
                "texto" => %{"type" => "string", "maxLength" => @max_texto},
                "estado" => %{"type" => "string", "enum" => @estados}
              },
              "required" => ["texto", "estado"]
            }
          }
        },
        "required" => ["objetivo", "passos"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"objetivo" => objetivo, "passos" => passos}, ctx)
      when is_binary(objetivo) and is_list(passos) do
    with :ok <- validar_objetivo(objetivo),
         :ok <- validar_passos(passos) do
      payload = %{
        objetivo: objetivo,
        passos: Enum.map(passos, &%{texto: &1["texto"], estado: &1["estado"]})
      }

      case EngineApiClient.append_event(ctx.project_id, ctx.session_id, %{
             type: "agent.plan",
             actorKind: "agent",
             actorId: Map.get(ctx, :agent) || "desconhecido",
             payload: payload
           }) do
        :ok -> {:ok, "plano registrado (#{length(passos)} passos)"}
        {:error, reason} -> {:error, "falha ao registrar o plano: #{inspect(reason)}"}
      end
    end
  end

  def run(_args, _ctx) do
    {:error,
     "registrar_plano exige `objetivo` (texto) e `passos` (lista de " <>
       "{texto, estado}, estado em #{Enum.join(@estados, ", ")})"}
  end

  defp validar_objetivo(o) do
    cond do
      String.trim(o) == "" ->
        {:error, "registrar_plano recusado: `objetivo` não pode ser vazio"}

      String.length(o) > @max_objetivo ->
        {:error,
         "registrar_plano recusado: `objetivo` passa do limite de #{@max_objetivo} " <>
           "caracteres (recebi #{String.length(o)})"}

      true ->
        :ok
    end
  end

  defp validar_passos([]),
    do: {:error, "registrar_plano recusado: `passos` precisa de pelo menos 1 passo"}

  defp validar_passos(passos) when length(passos) > @max_passos,
    do:
      {:error,
       "registrar_plano recusado: `passos` passa do limite de #{@max_passos} passos " <>
         "(recebi #{length(passos)})"}

  defp validar_passos(passos) do
    Enum.find_value(Enum.with_index(passos, 1), :ok, fn {p, i} -> erro_do_passo(p, i) end)
  end

  defp erro_do_passo(%{"texto" => t, "estado" => e}, i) when is_binary(t) and is_binary(e) do
    cond do
      e not in @estados ->
        {:error,
         "registrar_plano recusado: passo #{i} com estado \"#{e}\" " <>
           "(use #{Enum.join(@estados, ", ")})"}

      String.trim(t) == "" ->
        {:error, "registrar_plano recusado: passo #{i} sem texto"}

      String.length(t) > @max_texto ->
        {:error,
         "registrar_plano recusado: o texto do passo #{i} passa do limite de " <>
           "#{@max_texto} caracteres (recebi #{String.length(t)})"}

      true ->
        nil
    end
  end

  defp erro_do_passo(_, i),
    do: {:error, "registrar_plano recusado: o passo #{i} precisa de `texto` e `estado`"}
end
