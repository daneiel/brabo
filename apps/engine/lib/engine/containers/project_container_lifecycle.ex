defmodule Engine.Containers.ProjectContainerLifecycle do
  @moduledoc """
  Leitura read-only de `project_containers` (tabela da api, Drizzle, schema
  "public", ADR 0081) — mesmo padrão de `Engine.Projects.Project`: o engine lê
  a coluna diretamente, sem duplicar a derivação em outro lugar.

  A ÚNICA pergunta que o engine faz aqui é "há um container REGISTRADO como
  `running` para este projeto?" (ADR 0134, RN-492) — uma pergunta só, com
  DOIS chamadores desde a RN-502 (ADR 0143), respondendo coisas diferentes:

  - `Engine.Actions.TerminalExecutor` decide ONDE o comando roda — `true`
    atravessa pro container real via broker; `false` RECUSA
    (`:recusar_container_ausente`). Até a RN-502, `false` caía no
    `System.cmd` local, e era essa a degradação calada que ela eliminou;
  - `Engine.Dev.AgentIo.try_claim/2` decide se o dev agent PODE COMEÇAR —
    `false` para o claim antes de ele acontecer, em `:idle`, com
    `dev.blocked_by_container`.

  Não são duas derivações: é esta função, com dois consumidores.

  `true` aqui NUNCA confirma que o container está de pé DE VERDADE agora
  (RN-486: registrado e observado nunca se fundem — só quem responde por
  isso é o broker, e ele é consultado depois, na hora de EXECUTAR). Uma
  linha `running` cujo container morreu ou foi removido por fora ainda
  passa por este filtro; a falha real aparece só quando o `broker.exec`
  responde, e vira `failed_result` normal (nunca crash, nunca fallback
  silencioso para fora do container).

  Quem ESCREVE nesta tabela continua sendo só a api
  (`RegistrarTransicaoDeContainerUseCase`) — este módulo não tem changeset
  nem insert, só a leitura de uma coluna.
  """

  use Ecto.Schema
  import Ecto.Query

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "project_containers" do
    field :project_id, :binary_id
    field :status, :string
  end

  @doc """
  `true` só quando existe uma linha para `project_id` com `status ==
  "running"`. `false` para qualquer outro caso — sem linha, `provisioning`/
  `stopped`/`failed`/`removed`, `project_id` malformado ou erro de consulta
  (mesmas duas guardas de `Engine.Projects.Project.workspace_dir_name/1`:
  nunca propaga a falha pra quem só queria uma resposta).

  O que `false` PRODUZ mudou com a RN-502, e é o que importa saber aqui: em
  vez de degradar pro `System.cmd` local, ele agora RECUSA — o comando não
  roda, e o dev agent não claima. Erro de consulta cai no mesmo lugar que
  "não há container", de propósito: nos dois casos o engine não pode
  afirmar que existe ambiente de execução, e afirmar é o que custaria caro.
  """
  def running?(project_id) do
    Repo.exists?(
      from(c in __MODULE__,
        where: c.project_id == ^project_id and c.status == "running"
      )
    )
  rescue
    _ -> false
  catch
    :exit, _ -> false
  end
end
