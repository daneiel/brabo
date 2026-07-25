defmodule Engine.Harness.ArtifactEmitter do
  @moduledoc """
  Emissão de artefato SERVER-EMITTED: valida o payload contra
  `Engine.Harness.ArtifactSchemas` e, só então, grava o `session_event`
  `"artifact.<tipo>"` e transmite no canal da sessão.

  Existe porque há três emissores server-side de artefato — `Engine.Dev.AgentIo`
  (`task_blocked`), os dois gates de PR (`Engine.Gates.QaAgentServer`/
  `SecOpsAgentServer`) e o `Engine.Infra.InfraGateRunner` — e os dois últimos
  gravavam o evento CRU, sem passar por schema nenhum (ADR 0020). Um parecer é
  o registro durável que o usuário lê pra decidir sobre a PR: precisa da mesma
  validação que o resto dos artefatos.

  Payload inválido NÃO derruba o agente e NÃO engole o problema: emite um
  evento de erro no lugar. Vale o mesmo raciocínio do `AgentIo.emit_artifact/3`
  — o efeito que importa (a decisão do gate, o bloqueio da task) já aconteceu
  ou vai acontecer de qualquer jeito, e perder o artefato não pode virar um
  crash que deixa a task sem dono.
  """

  alias Engine.Harness.ArtifactSchemas
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @doc """
  Emite `artifact.<type>` como `actor_id`. Devolve `:ok` mesmo quando o
  payload é recusado (aí emite `<actor_id>.error` no lugar).
  """
  def emit(project_id, session_id, actor_id, type, payload) do
    case ArtifactSchemas.validate(type, stringify_keys(payload)) do
      :ok ->
        append(project_id, session_id, actor_id, "artifact.#{type}", payload)

      {:error, reason} ->
        append(project_id, session_id, actor_id, "#{actor_id}.error", %{
          agentId: actor_id,
          reason: "artefato #{type} inválido: #{inspect(reason)}"
        })
    end

    :ok
  end

  @doc "Grava o evento e transmite no canal, sem validação de artefato."
  def append(project_id, session_id, actor_id, type, payload) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: type,
      actorKind: "agent",
      actorId: actor_id,
      payload: payload
    })

    LiveBroadcast.event_appended(session_id, type, actor_id, payload)
  end

  # ArtifactSchemas valida chaves string; os emissores montam payload com
  # chaves atom.
  defp stringify_keys(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end
end
