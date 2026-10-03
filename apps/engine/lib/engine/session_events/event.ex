defmodule Engine.SessionEvents.Event do
  @moduledoc """
  Leitura read-only do event log de domínio (session_events, tabela da
  api, gerenciada por Drizzle) — nunca changeset/insert aqui. Escrever
  novos eventos exige o contrato atômico de seq (lock de linha) que só
  AppendSessionEventUseCase sabe fazer corretamente do lado da api; ver
  Engine.Sessions.EngineApiClient.append_event/3 pra isso.
  """

  use Ecto.Schema
  import Ecto.Query

  alias Engine.Repo

  # Agentes que ANALISAM a sessão em vez de participar dela. Ver
  # `count_analisaveis/1`: o rastro que eles deixam é sobre a sessão, não
  # dela.
  @analistas ~w(psicologo psicologo-leve anamnese)

  @primary_key {:id, :string, autogenerate: false}
  @schema_prefix "public"
  schema "session_events" do
    field :session_id, :binary_id
    field :seq, :integer
    field :type, :string
    field :actor_kind, :string
    field :actor_id, :string
    field :payload, :map, default: %{}
    # `:utc_datetime_usec`, não `:utc_datetime`: a coluna é timestamptz(6) e a
    # api grava com microssegundos. Declarando precisão de SEGUNDO, o Ecto
    # truncava o parâmetro nas comparações de janela — então
    # `created_at < window_to` descartava tudo que aconteceu no segundo
    # corrente. Numa rodada disparada logo após a atividade, isso esvaziava a
    # janela inteira e a Anamnese era pulada em silêncio.
    field :created_at, :utc_datetime_usec
  end

  @doc """
  Quantos eventos a sessão tem. COUNT no banco em vez de
  `length(list(session_id))` — quem só precisa do número (a triagem do
  Psicólogo) não carrega o log inteiro pra memória.
  """
  def count(session_id) do
    Repo.aggregate(from(e in __MODULE__, where: e.session_id == ^session_id), :count, :id)
  end

  @doc """
  Quantos eventos da sessão têm SINAL a analisar.

  Duas famílias não contam, por motivos diferentes:

    * **o que os analistas escrevem sobre a sessão não é a sessão.** O
      Psicólogo grava o próprio turno no log (`agent.response`,
      `tool.call`, `tool.result`, a hipótese). Contá-lo faz uma sessão
      vazia parecer povoada a partir da PRIMEIRA análise — e cada
      retentativa a enche mais, então o critério nunca mais reprova.
      Vale igual para a Anamnese, que também narra rodada em sessão
      alheia;
    * **`bootstrap.*` é provisionamento rodando sozinho.** Nove passos
      de máquina do `git-bootstrap` não dizem nada sobre a pessoa.

  Tudo o mais conta — inclusive `proposed_action.*`, que é o usuário
  decidindo sem escrever mensagem nenhuma (a mesma lição que a Anamnese
  aprendeu ao descartar como vazia uma janela só de decisões).

  `count/1` continua existindo e continua sendo quem DIMENSIONA a
  análise — quanto log há para ler. Este responde outra pergunta: há
  alguma coisa para ler.
  """
  def count_analisaveis(session_id) do
    Repo.aggregate(
      from(e in __MODULE__,
        where: e.session_id == ^session_id,
        where: not like(e.type, "bootstrap.%"),
        # `actor_id` é NOT NULL na tabela, então o `not in` não tem o
        # buraco de três-valores que descartaria linha silenciosamente.
        where: e.actor_kind != "agent" or e.actor_id not in @analistas
      ),
      :count,
      :id
    )
  end

  @doc """
  Títulos das regras de negócio já emitidas no PROJETO.

  Escopo de projeto, não de sessão, porque é entre sessões que a
  duplicata aparece: rodar o Criativo de novo e ele reemitir tudo (achado
  K). Uma consulta por sessão nunca veria a primeira rodada.

  Não há tabela de regra — o artefato é o evento `artifact.business_rule`,
  imutável como todo evento de domínio. Por isso a deduplicação só pode
  acontecer na ENTRADA: aqui se lê o que existe, e quem recusa é
  `Engine.Harness.Tools.EmitArtifact`.
  """
  def titulos_de_regras(project_id) do
    Repo.all(
      from(e in __MODULE__,
        join: s in Engine.Sessions.ProjectSession,
        on: e.session_id == s.id,
        where: s.project_id == type(^project_id, :binary_id),
        where: e.type == "artifact.business_rule",
        select: fragment("? ->> 'title'", e.payload)
      )
    )
    |> Enum.reject(&is_nil/1)
  end

  @doc """
  O projeto tem imagem de container DECIDIDA? (RN-610)

  O predicado é o MESMO da api (`ObterContainerDoProjetoUseCase`, que
  `ObterSpecDeContainerUseCase` consome): existe ao menos um evento
  `artifact.project_image` em QUALQUER sessão do projeto. A api degrada um
  payload ilegível para o default em vez de tratá-lo como ausência, então a
  pergunta aqui é só EXISTÊNCIA — nunca validade do payload —, senão a recusa
  local e a execução divergiriam. Join por `sessions.project_id` explícito,
  como em `titulos_de_regras/1`: o evento não carrega o projeto.
  """
  def imagem_decidida?(project_id) do
    Repo.exists?(
      from(e in __MODULE__,
        join: s in Engine.Sessions.ProjectSession,
        on: e.session_id == s.id,
        where: s.project_id == type(^project_id, :binary_id),
        where: e.type == "artifact.project_image"
      )
    )
  end

  @doc """
  A rede que o ARQUITETO declarou para o projeto (RN-723, ADR 0208): o
  `network` da `artifact.project_image` mais recente emitida por ele
  (`actor_id: "arquiteto"`), em qualquer sessão do projeto. A eleição da
  Infra herda esse valor em vez de rebaixá-lo para `none`. `nil` quando o
  Arquiteto nunca decidiu ou o valor não é um dos dois que a api aceita —
  quem chama cai no `none` de sempre.
  """
  def rede_do_arquiteto(project_id) do
    from(e in __MODULE__,
      join: s in Engine.Sessions.ProjectSession,
      on: e.session_id == s.id,
      where: s.project_id == type(^project_id, :binary_id),
      where: e.type == "artifact.project_image" and e.actor_id == "arquiteto",
      order_by: [desc: e.created_at],
      limit: 1,
      select: e.payload
    )
    |> Repo.one()
    |> case do
      %{"network" => rede} when rede in ~w(none egress) -> rede
      _ -> nil
    end
  end

  @doc """
  Os `limit` eventos mais recentes da sessão, devolvidos em ordem de seq
  CRESCENTE (a query desce por seq pra pegar a cauda, o resultado volta
  cronológico pra ser lido como log).
  """
  def list_recent(session_id, limit) do
    from(e in __MODULE__,
      where: e.session_id == ^session_id,
      order_by: [desc: e.seq],
      limit: ^limit
    )
    |> Repo.all()
    |> Enum.reverse()
  end

  @doc """
  Janela de tempo do PROJETO inteiro (Fase 4b — a Anamnese analisa
  "janelas do event log"). Junta em sessions pra filtrar por projeto, já
  que session_events não carrega project_id. `limit` protege contra
  janelas patológicas.
  """
  def list_for_project_window(project_id, from_time, to_time, limit \\ 500) do
    Repo.all(
      from(e in project_window_query(project_id, from_time, to_time),
        order_by: [desc: e.created_at],
        limit: ^limit
      )
    )
    |> Enum.reverse()
  end

  @doc """
  Quantos eventos a janela do projeto tem, sem carregar linha — o número REAL,
  que pode ser maior que o recorte que entra no prompt (ver
  `Engine.Anamnese.Triage.max_prompt_events/0`).
  """
  def count_for_project_window(project_id, from_time, to_time) do
    Repo.aggregate(project_window_query(project_id, from_time, to_time), :count, :id)
  end

  @doc """
  Quantas rodadas PAGAS da Anamnese o projeto teve desde `since` (RN-722): o
  desfecho que toda rodada que chegou ao LLM grava — `anamnese.run_completed`,
  `anamnese.run_failed` e o `anamnese.run_skipped` escrito pelo MODELO (o da
  rodada sem sujeito leva `causa` e não gastou nada).
  """
  def count_anamnese_rounds_since(project_id, since) do
    Repo.aggregate(
      from(e in __MODULE__,
        join: s in Engine.Sessions.ProjectSession,
        on: e.session_id == s.id,
        where:
          s.project_id == type(^project_id, :binary_id) and e.created_at >= ^since and
            e.actor_id == "anamnese" and
            (e.type in ["anamnese.run_completed", "anamnese.run_failed"] or
               (e.type == "anamnese.run_skipped" and
                  is_nil(fragment("?->>'causa'", e.payload))))
      ),
      :count,
      :id
    )
  end

  defp project_window_query(project_id, from_time, to_time) do
    from(e in __MODULE__,
      join: s in Engine.Sessions.ProjectSession,
      on: e.session_id == s.id,
      where:
        s.project_id == type(^project_id, :binary_id) and
          e.created_at >= ^from_time and e.created_at < ^to_time,
      # RN-722: a janela é sobre a PESSOA. O que a própria Anamnese escreve
      # (`anamnese.*`, e o `tool.call`/`tool.result`/`agent.*` do ator
      # `anamnese`) e os eventos de sistema não são interação de ninguém —
      # contá-los fazia cada rodada fabricar material para a seguinte.
      where:
        e.actor_kind != "system" and
          not (e.actor_kind == "agent" and e.actor_id == "anamnese") and
          not like(e.type, "anamnese.%")
    )
  end
end
