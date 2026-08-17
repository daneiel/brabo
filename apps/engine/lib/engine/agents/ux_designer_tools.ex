defmodule Engine.Agents.UxDesignerTools do
  @moduledoc """
  A ferramenta do UX Designer (ADR 0087): propor UM protótipo navegável
  (personas, jornadas, telas + anotações) a partir da necessidade de negócio
  do Criativo.

  ## Sem tabela, e sem caso de uso dedicado na api

  `artifact.prototipo_navegavel` é um artefato SEM tabela, como
  `artifact.project_image`/`artifact.c4_diagram` (ADR 0065/RN-149) — o
  event log é o registro. A diferença é ONDE a validação mora: aqueles dois
  precisam de um caso de uso na api porque têm conteúdo DERIVADO de outro
  artefato (o Container level vem do `module_map` vigente) ou recusa de
  domínio compartilhada por mais de um consumidor (teto de recursos da
  imagem). O protótipo não tem nenhum dos dois — é conteúdo AUTOCONTIDO que
  só o próprio UX Designer escreve e só ele lê de volta —, então a validação
  de FORMA mora no engine (`Engine.Harness.ArtifactSchemas`, o mesmo
  mecanismo de `business_rule`/`product_brief`) e a gravação usa o caminho
  genérico que a api já expõe para qualquer tipo de evento
  (`EngineApiClient.append_event_returning/3`). Abrir um
  `CreatePrototipoUseCase` replicaria a decisão de `CreateC4DiagramUseCase`
  sem nenhum dos dois motivos que a justificam ali.

  ## Um artefato, dois handoffs

  Depois de gravar, a ferramenta oferece DOIS handoffs sobre o MESMO
  artefato — nunca um segundo artefato para "spec-visual"
  (`docs/fluxo.yml`): o PO lê `resumo`/`prototipo` para desenhar o backlog, o
  Dev Lead lê as MESMAS `telas`/`anotacoes` como referência visual de
  implementação. Duplicar o conteúdo em dois artefatos arriscaria as duas
  cópias divergirem na revisão seguinte — o mesmo argumento por trás do C4
  não redigitar o `module_map` (RN-149).

  Falha ao criar UM dos dois handoffs não desfaz o outro nem o artefato já
  gravado (RN-116, mesma régua de `CriativoServer`/`ArquitetoServer`): o
  motivo volta como texto do tool-result, o modelo lê e pode reportar ao
  usuário na resposta seguinte.
  """

  alias Engine.Harness.ArtifactSchemas
  alias Engine.Sessions.EngineApiClient

  @spec spec() :: map()
  def spec do
    %{
      name: "propose_prototype",
      description:
        "Registra o protótipo navegável: personas, jornadas, as telas do " <>
          "protótipo e um resumo. Use UMA vez, depois de ler a necessidade " <>
          "de negócio — a chamada já oferece o protótipo como handoff ao " <>
          "PO e ao Dev Lead.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "personas" => %{
            "type" => "array",
            "description" => "Quem usa isto e o que busca. Ao menos uma.",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "nome" => %{"type" => "string"},
                "objetivo" => %{"type" => "string"},
                "frustracao" => %{"type" => "string"}
              },
              "required" => ["nome", "objetivo"]
            }
          },
          "jornadas" => %{
            "type" => "array",
            "description" => "O passo a passo de cada persona até o objetivo. Ao menos uma.",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "titulo" => %{"type" => "string"},
                "passos" => %{"type" => "array", "items" => %{"type" => "string"}}
              },
              "required" => ["titulo", "passos"]
            }
          },
          "prototipo" => %{
            "type" => "object",
            "description" => "O protótipo navegável: uma tela por passo relevante da jornada.",
            "properties" => %{
              "telas" => %{
                "type" => "array",
                "description" =>
                  "Ao menos uma. Descreva com os tokens do sistema de " <>
                    "design da sua identidade — nunca cor ou medida inventada.",
                "items" => %{
                  "type" => "object",
                  "properties" => %{
                    "nome" => %{"type" => "string"},
                    "descricao" => %{"type" => "string"}
                  },
                  "required" => ["nome", "descricao"]
                }
              },
              "anotacoes" => %{
                "type" => "string",
                "description" =>
                  "Notas de comportamento, estado e transição entre telas — " <>
                    "a spec visual que o Dev Lead consome para implementar."
              }
            },
            "required" => ["telas"]
          },
          "resumo" => %{
            "type" => "string",
            "description" =>
              "O protótipo em um parágrafo, para o PO e o Dev Lead decidirem " <>
                "sem abrir a lista inteira."
          }
        },
        "required" => ["personas", "jornadas", "prototipo", "resumo"]
      }
    }
  end

  @spec run(map(), map()) :: {:ok, String.t()} | {:error, String.t()}
  def run(
        %{
          "personas" => personas,
          "jornadas" => jornadas,
          "prototipo" => prototipo,
          "resumo" => resumo
        },
        state
      ) do
    payload = %{
      "personas" => personas,
      "jornadas" => jornadas,
      "prototipo" => prototipo,
      "resumo" => resumo
    }

    case ArtifactSchemas.validate("prototipo_navegavel", payload) do
      :ok -> gravar_e_ofertar_handoffs(payload, state)
      {:error, reason} -> {:error, "protótipo inválido: #{inspect(reason)}"}
    end
  end

  def run(_args, _state),
    do:
      {:error,
       "propose_prototype exige `personas`, `jornadas`, `prototipo` (com `telas`) e `resumo`"}

  defp gravar_e_ofertar_handoffs(payload, state) do
    event = %{
      type: "artifact.prototipo_navegavel",
      actorKind: "agent",
      actorId: "ux-designer",
      payload: payload
    }

    case EngineApiClient.append_event_returning(state.project_id, state.session_id, event) do
      {:ok, %{"id" => artifact_id}} ->
        telas = length(get_in(payload, ["prototipo", "telas"]) || [])

        resultado_handoffs =
          for to_agent <- ["po", "dev-lead"] do
            {to_agent, ofertar_handoff(state, to_agent, artifact_id)}
          end

        falhas =
          for {to_agent, {:error, motivo}} <- resultado_handoffs,
              do: "#{to_agent} (#{inspect(motivo)})"

        base = "protótipo registrado (#{telas} tela(s)) e oferecido ao PO e ao Dev Lead."

        if falhas == [] do
          {:ok, base}
        else
          # O artefato JÁ ESTÁ gravado — não é fim de linha (RN-163): o
          # motivo volta como texto pro modelo decidir se tenta ofertar de
          # novo ou avisa o usuário.
          {:error,
           "protótipo registrado (#{telas} tela(s)), mas falha ao oferecer handoff para: " <>
             Enum.join(falhas, "; ")}
        end

      {:error, reason} ->
        {:error, "falha ao registrar protótipo: #{inspect(reason)}"}
    end
  end

  defp ofertar_handoff(state, to_agent, artifact_id) do
    case EngineApiClient.create_handoff(
           state.project_id,
           state.session_id,
           "ux-designer",
           to_agent,
           artifact_id
         ) do
      {:ok, _handoff} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end
