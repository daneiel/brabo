defmodule Engine.Containers.ProjectContainerLifecycle do
  @moduledoc """
  Leitura read-only de `project_containers` (tabela da api, Drizzle, schema
  "public", ADR 0081) — mesmo padrão de `Engine.Projects.Project`: o engine lê
  a coluna diretamente, sem duplicar a derivação em outro lugar.

  A ÚNICA pergunta que o engine faz aqui é "há um container REGISTRADO como
  `running` para este projeto?" (ADR 0134, RN-492) — é o que
  `Engine.Actions.TerminalExecutor` consulta para decidir se um comando de
  terminal de dev agent deve atravessar para dentro do container real, via
  broker, em vez do caminho de sempre.

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
  degrada pro caminho de sempre, nunca propaga).
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
