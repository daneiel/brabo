defmodule Engine.Harness.Tools.DeclareModuleContracts do
  @moduledoc """
  Ferramenta do Arquiteto: declara o CONTRATO entre módulos — o que cada
  módulo do `module_map` vigente EXPÕE a quem depende dele (ADR 0200, RN-684).

  Existe porque o dev agent de um módulo precisava da interface de outro e só
  a achava no worktree do dev vizinho: no uso real de 2026-09-29,
  `dev-board-engine` gastou 5 dos seus 24 passos com ferramenta relendo
  worktree alheio. O `module_map` dizia QUEM depende de quem, nunca O QUÊ.

  O que um módulo CONSOME não é redigitado aqui — a leitura deriva do
  `dependsOn` do mapa vigente, o mesmo argumento do nível Container do C4.
  Cada chamada leva a lista INTEIRA e vira uma versão nova, que SUBSTITUI a
  anterior. A api valida (módulo no mapa vigente, `tipo` no enum, `assinatura`
  obrigatória e com teto) e a recusa volta pelo tool-result com o motivo
  inteiro (RN-061).

  `:direct`, fora do `@registry` global: declarar interface é decisão interna
  do Arquiteto, sem efeito externo, e não vira `proposed_action`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "declare_module_contracts",
      description:
        "Declara o CONTRATO entre os módulos do module_map vigente: para cada módulo " <>
          "que outro usa, o que ele EXPÕE (função, rota, evento ou forma de dado), com a " <>
          "assinatura exata. É o que os dev agents leem para usar o módulo vizinho sem " <>
          "abrir o código dele. Mande a lista INTEIRA: cada chamada é uma versão nova que " <>
          "substitui a anterior. Não liste o que o módulo consome — isso já é o " <>
          "depends_on do module_map. Exige create_module_map antes.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "contratos" => %{
            "type" => "array",
            "description" =>
              "Um item por módulo que expõe algo a outro. Módulo fora do mapa, módulo " <>
                "repetido, lista vazia ou módulo sem nada em `expoe` são recusados.",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "modulo" => %{
                  "type" => "string",
                  "description" => "Nome do módulo — precisa existir no module_map vigente."
                },
                "expoe" => %{
                  "type" => "array",
                  "description" =>
                    "O que OUTRO módulo usa deste (1 a 40 itens), não a documentação inteira.",
                  "items" => %{
                    "type" => "object",
                    "properties" => %{
                      "tipo" => %{
                        "type" => "string",
                        "enum" => ["funcao", "rota", "evento", "dado"]
                      },
                      "assinatura" => %{
                        "type" => "string",
                        "description" =>
                          "Como se usa, exata: \"placePiece(board, piece, pos): Board\", " <>
                            "\"GET /scores -> [{name, points}]\". Até 300 caracteres."
                      },
                      "descricao" => %{
                        "type" => "string",
                        "description" => "O que o item faz ou garante. Opcional."
                      }
                    },
                    "required" => ["tipo", "assinatura"]
                  }
                }
              },
              "required" => ["modulo", "expoe"]
            }
          }
        },
        "required" => ["contratos"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"contratos" => contratos}, ctx) when is_list(contratos) do
    normalizado = Enum.map(contratos, &normalize/1)

    case EngineApiClient.declare_module_contracts(ctx.project_id, ctx.session_id, normalizado) do
      {:ok, %{"version" => version, "contratos" => declarados}} ->
        modulos = Enum.map_join(declarados, ", ", &Map.get(&1, "modulo", "?"))

        {:ok,
         "contratos declarados (version #{version}): #{length(declarados)} módulo(s) — " <>
           "#{modulos}. Os dev agents leem esta versão com listar_contratos_de_modulos." <>
           conferencia_com_historias(normalizado, ctx)}

      {:ok, _outro} ->
        {:ok, "contratos declarados."}

      {:error, reason} ->
        {:error, "contratos recusados: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx),
    do:
      {:error,
       "declare_module_contracts exige `contratos` (lista de {modulo, expoe: [{tipo, assinatura, descricao}]})"}

  # RN-792 (AT-468): a conferência das rotas contra as histórias volta no
  # resultado, como entrada do laço. Falhar a leitura do backlog não recusa a
  # declaração (ela já foi gravada): o texto diz que não conferiu.
  defp conferencia_com_historias(normalizado, ctx) do
    case EngineApiClient.list_backlog(ctx.project_id) do
      {:ok, backlog} -> Engine.Harness.RotasDoContrato.texto(normalizado, backlog)
      _ -> "\n\n(Não conferi as rotas contra as histórias: a leitura do backlog falhou.)"
    end
  end

  # Explícito por campo, com default vazio, como `RouteModulesToInfra.normalize/1`
  # — a régua de verdade é a da api, que nomeia o item que faltou.
  defp normalize(item) when is_map(item) do
    %{
      modulo: Map.get(item, "modulo", ""),
      expoe: Enum.map(lista(Map.get(item, "expoe")), &normalize_item/1)
    }
  end

  defp normalize(_), do: %{modulo: "", expoe: []}

  defp normalize_item(item) when is_map(item) do
    %{
      tipo: Map.get(item, "tipo", ""),
      assinatura: Map.get(item, "assinatura", ""),
      descricao: Map.get(item, "descricao", "")
    }
  end

  defp normalize_item(_), do: %{tipo: "", assinatura: "", descricao: ""}

  defp lista(v) when is_list(v), do: v
  defp lista(_), do: []
end
