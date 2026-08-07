defmodule Engine.SessionEvents.EventAnalisaveisTest do
  @moduledoc """
  `count_analisaveis/1` — a contagem que responde "há o que analisar",
  distinta da crua, que responde "quanto há para ler".

  O caso que a motivou é real e está no banco de dogfooding: uma sessão de
  14 eventos onde NENHUM era da pessoa — nove passos do `git-bootstrap` e
  cinco linhas escritas pelo próprio Psicólogo enquanto analisava.
  """

  use Engine.DataCase, async: false

  alias Engine.SessionEvents.Event

  setup do
    %{session_id: Ecto.UUID.generate()}
  end

  defp seed!(session_id, type, actor_kind, actor_id) do
    Engine.Repo.insert_all("session_events", [
      %{
        id: "evt-#{System.unique_integer([:positive])}",
        session_id: Ecto.UUID.dump!(session_id),
        seq: System.unique_integer([:positive, :monotonic]),
        type: type,
        actor_kind: actor_kind,
        actor_id: actor_id,
        payload: %{},
        created_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])
  end

  test "sessão vazia: zero nas duas contagens", %{session_id: session_id} do
    assert Event.count(session_id) == 0
    assert Event.count_analisaveis(session_id) == 0
  end

  test "passos de bootstrap contam no cru e não no analisável", %{session_id: session_id} do
    for tipo <- ~w(bootstrap.step_started bootstrap.step_completed bootstrap.step_degraded),
        do: seed!(session_id, tipo, "system", "git-bootstrap")

    assert Event.count(session_id) == 3
    assert Event.count_analisaveis(session_id) == 0
  end

  test "rastro dos analistas não conta — nem o do próprio Psicólogo", %{session_id: session_id} do
    # Um `agent.response` do Psicólogo e um do dev são o MESMO tipo: o que
    # separa os dois é o autor. Filtrar por tipo deixaria passar o rastro
    # da análise anterior, e a sessão nunca mais pareceria vazia.
    seed!(session_id, "agent.response", "agent", "psicologo")
    seed!(session_id, "agent.response", "agent", "psicologo-leve")
    seed!(session_id, "tool.call", "agent", "psicologo-leve")
    seed!(session_id, "psychologist.analysis_completed", "agent", "psicologo-leve")
    seed!(session_id, "anamnese.run_skipped", "agent", "anamnese")

    assert Event.count(session_id) == 5
    assert Event.count_analisaveis(session_id) == 0
  end

  test "o MESMO tipo conta quando o autor participa da sessão", %{session_id: session_id} do
    seed!(session_id, "agent.response", "agent", "psicologo")
    seed!(session_id, "agent.response", "agent", "dev-api")

    assert Event.count_analisaveis(session_id) == 1
  end

  test "decisão do usuário é material", %{session_id: session_id} do
    seed!(session_id, "proposed_action.approved", "user", "u-1")
    seed!(session_id, "proposed_action.denied", "user", "u-1")

    assert Event.count_analisaveis(session_id) == 2
  end

  test "tipo desconhecido conta — o default é analisar, não pular", %{session_id: session_id} do
    # Errar pulando perde a análise em silêncio; errar rodando custa alguns
    # centavos. A lista é de EXCLUSÃO por isso: tipo novo entra contando.
    seed!(session_id, "familia.que.nao.existe.ainda", "agent", "algum-agente")

    assert Event.count_analisaveis(session_id) == 1
  end

  test "a contagem é por sessão, não global", %{session_id: session_id} do
    outra = Ecto.UUID.generate()
    seed!(session_id, "chat.message", "user", "u-1")
    seed!(outra, "chat.message", "user", "u-1")

    assert Event.count_analisaveis(session_id) == 1
    assert Event.count_analisaveis(outra) == 1
  end

  test "reproduz a sessão do achado: 14 eventos, nenhum analisável", %{session_id: session_id} do
    for _ <- 1..4 do
      seed!(session_id, "bootstrap.step_started", "system", "git-bootstrap")
      seed!(session_id, "bootstrap.step_completed", "system", "git-bootstrap")
    end

    seed!(session_id, "bootstrap.step_degraded", "system", "git-bootstrap")
    seed!(session_id, "agent.response", "agent", "psicologo-leve")
    seed!(session_id, "tool.call", "agent", "psicologo-leve")
    seed!(session_id, "psychologist.hypothesis_proposed", "agent", "psicologo-leve")
    seed!(session_id, "psychologist.analysis_completed", "agent", "psicologo-leve")
    seed!(session_id, "tool.result", "agent", "psicologo-leve")

    assert Event.count(session_id) == 14
    assert Event.count_analisaveis(session_id) == 0
  end
end
