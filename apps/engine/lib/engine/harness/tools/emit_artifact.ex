defmodule Engine.Harness.Tools.EmitArtifact do
  @moduledoc """
  Emite um artefato TIPADO no event log — um `session_event`
  `"artifact.<tipo>"` com payload validado por `ArtifactSchemas` (não há
  tabela de artefatos; validação por tipo é feita aqui). Grava via
  `EngineApiClient.append_event/3` (o engine nunca escreve session_events
  direto).

  `business_rule` passa antes por uma checagem de duplicata EXATA no
  projeto (`Engine.Harness.ArtifactDedupe`) — o evento é imutável, então
  o único momento em que dá para recusar é a entrada. Duplicata
  SEMÂNTICA continua passando — não é recusada —, mas desde a RN-681
  (ADR 0198) é AVISADA: depois de gravar, a api compara o título com os das
  regras do projeto por embedding e a frase dela volta ao modelo junto com o
  "emitido". Checagem que não pôde rodar diz por quê; falha DELA nunca vira
  falha da emissão.
  """

  require Logger

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.{ArtifactDedupe, ArtifactSchemas}
  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "emit_artifact",
      # A descrição NOMEIA os campos de cada tipo, em inglês e com exemplo. A
      # versão anterior dizia só "emite um artefato tipado" e listava os tipos:
      # o modelo tinha de adivinhar as chaves, e adivinhou no idioma da
      # conversa (`titulo`/`descricao`). O payload era recusado em silêncio.
      description: descricao(),
      parameters: %{
        "type" => "object",
        "properties" => %{
          "type" => %{"type" => "string"},
          "payload" => %{"type" => "object"}
        },
        "required" => ["type", "payload"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"type" => type, "payload" => payload}, ctx) when is_map(payload) do
    cond do
      # Guardrail: tipos system-emitted (ex.: product_brief) NUNCA saem por
      # tool call do modelo — só pelo servidor do agente no momento certo.
      type not in ArtifactSchemas.known() ->
        {:error, "artefato #{type} não pode ser emitido por ferramenta (system-emitted)"}

      true ->
        case regra_ja_existente(type, payload, ctx) do
          nil ->
            emit(type, payload, ctx)

          existente ->
            # Recusa em vez de gravar: o evento é imutável, então deixar
            # entrar significa conviver com a duplicata para sempre. E o
            # erro não é fim de linha — volta ao modelo pelo mesmo caminho
            # de um payload inválido, e ele segue para a próxima regra.
            {:error,
             "regra de negócio \"#{existente}\" já foi registrada neste projeto — " <>
               "não reemita o que já existe; siga para a próxima ou refine a existente"}
        end
    end
  end

  def run(_args, _ctx), do: {:error, "emit_artifact exige `type` e `payload` (objeto)"}

  # Só `business_rule` é deduplicada. O outro tipo emissível por
  # ferramenta é `note`, anotação livre onde repetir um título é
  # legítimo; o resto é server-emitted e nem chega aqui.
  defp regra_ja_existente("business_rule", payload, ctx) do
    titulo = Map.get(payload, "title")

    if is_binary(titulo) do
      ArtifactDedupe.duplicata(
        titulo,
        Engine.SessionEvents.Event.titulos_de_regras(ctx.project_id)
      )
    else
      # Sem título válido não há o que comparar — quem reprova isso é o
      # schema, logo abaixo, com uma mensagem melhor que a daqui.
      nil
    end
  end

  defp regra_ja_existente(_type, _payload, _ctx), do: nil

  defp descricao do
    tipos =
      Enum.map_join(ArtifactSchemas.known(), "\n", fn tipo ->
        campos = Enum.map_join(ArtifactSchemas.required(tipo), ", ", &"`#{&1}`")
        "- `#{tipo}` — payload EXIGE: #{campos}"
      end)

    """
    Emite um artefato tipado no event log.

    As chaves do payload são estas, em INGLÊS e exatamente como escritas —
    payload com chave diferente é RECUSADO:

    #{tipos}

    Exemplo de chamada válida:
    {"type": "business_rule", "payload": {"title": "Saudação com nome",
    "description": "Quem chama pode se identificar e recebe a saudação com o
    próprio nome.", "origin": [2, 6]}}

    `origin` é a rastreabilidade da regra até a conversa: uma LISTA NÃO-VAZIA
    com os números (`seq`) das mensagens desta sessão que originaram a regra.
    Texto livre é RECUSADO — precisa ser lista.

    `business_rule` com título já registrado NESTE PROJETO é recusada, mesmo
    que tenha sido em outra conversa. Dizer isso aqui poupa o turno perdido:
    o modelo não descobre a regra pelo erro.
    """
  end

  defp emit(type, payload, ctx) do
    case ArtifactSchemas.validate(type, payload) do
      :ok ->
        event = %{
          type: "artifact.#{type}",
          actorKind: "agent",
          actorId: ctx.agent,
          payload: payload
        }

        case EngineApiClient.append_event(ctx.project_id, ctx.session_id, event) do
          :ok -> {:ok, "artefato #{type} emitido" <> aviso_semantico(type, payload, ctx)}
          {:error, reason} -> {:error, "falha ao emitir artefato: #{inspect(reason)}"}
        end

      {:error, {:missing_keys, faltam}} ->
        {:error,
         "artefato inválido: payload exige " <>
           Enum.map_join(faltam, ", ", &"`#{&1}`") <>
           " — " <> Engine.Harness.ArgumentosDeFerramenta.chaves_recebidas(payload)}

      {:error, reason} ->
        {:error, "artefato inválido: #{inspect(reason)}"}
    end
  end

  # RN-681: a duplicata SEMÂNTICA, só para `business_rule` (a mesma fronteira
  # da RN-080). Roda DEPOIS do append — a regra já existe, e o aviso é sobre
  # ela, nunca uma recusa. Tudo o que der errado aqui vira TEXTO no resultado
  # e linha de log, e a emissão continua `{:ok, _}`.
  defp aviso_semantico("business_rule", %{"title" => titulo}, ctx) when is_binary(titulo) do
    case EngineApiClient.check_semantic_duplicate(ctx.project_id, ctx.session_id, %{
           kind: "business_rule",
           title: titulo
         }) do
      {:ok, %{"status" => "warned", "message" => mensagem} = resposta}
      when is_binary(mensagem) and mensagem != "" ->
        "\n" <> mensagem <> pergunte_antes(ctx, resposta)

      {:ok, %{"message" => mensagem}} when is_binary(mensagem) and mensagem != "" ->
        "\n" <> mensagem

      {:ok, _sem_frase} ->
        ""

      {:error, motivo} ->
        Logger.warning(
          "[infra] checagem de duplicata semântica não respondeu " <>
            "(sessão #{ctx.session_id}): #{inspect(motivo)}"
        )

        "\nA checagem de duplicata semântica não respondeu (#{inspect(motivo)}); " <>
          "a regra foi registrada sem ela."
    end
  end

  defp aviso_semantico(_type, _payload, _ctx), do: ""

  # RN-720 (AT-389): no PO, regra parecida com uma existente costuma ser a
  # regra do usuário REESCRITA com outro valor ("R$ 10 por pedido" virou
  # "R$ 10 por torrefador"). A regra já foi gravada — o aviso não a desfaz —,
  # mas o PO não decide sozinho que a do usuário mudou: pergunta antes.
  defp pergunte_antes(%{agent: "po"}, _resposta) do
    "\nEsta regra parece ALTERAR uma regra que já existe. Não trate a sua versão como " <>
      "a vigente: antes de escrever histórias com ela, pergunte ao usuário com " <>
      "`ask_structured_questions` qual das duas vale."
  end

  defp pergunte_antes(_ctx, _resposta), do: ""
end
