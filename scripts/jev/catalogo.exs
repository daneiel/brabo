# Gera `scripts/jev/catalogo.json` — o cardápio de ferramentas que cada agente
# vê por passo, com nome e descrição TIRADOS DO CÓDIGO do engine (o `spec/0` de
# cada módulo de ferramenta), e a identidade de cada agente
# (`Engine.Harness.Agents.identity/1`). É a entrada do replay da AT-237.
#
# Rodar (dentro do container do engine de DEV, sem compilar e sem subir a app):
#
#   docker cp scripts/jev/catalogo.exs brabo-dev-engine-1:/tmp/catalogo.exs
#   docker exec brabo-dev-engine-1 mix run --no-start --no-compile --no-deps-check /tmp/catalogo.exs \
#     > scripts/jev/catalogo.json
#
# Onde a lista de um agente é um REGISTRO do código, ela é lida dele. Os sete
# conversacionais montam a lista inline no `init/1` do servidor, e ali a lista
# abaixo é CÓPIA, com o arquivo:linha de onde foi copiada (linha do `tool_specs:`, dev `d48f99f8ec`).

registros = %{
  # Registros de código — lidos, não copiados.
  "dev-*" => Engine.Dev.Tools.registry(),
  "qa-automacao" => Engine.Gates.QaTools.registry(),
  "appsec" => Engine.Gates.AppSecAgent.tools(),
  "qa-estrategia" => Engine.Gates.QaEstrategiaAgent.tools(),
  "qa-performance-seguranca" => Engine.Gates.QaPerformanceSegurancaAgent.tools(),
  "anamnese" => Engine.Anamnese.Tools.registry(),
  "infra-workflows" => Engine.Infra.WorkflowsAgent.tools(),
  "psicologo" => Engine.Psychologist.Tools.registry(),
  "psicologo-leve" => Engine.Psychologist.Tools.registry()
}

alias Engine.Harness.Tools, as: H

inline = %{
  # apps/engine/lib/engine/agents/criativo_server.ex:111
  "criativo" => [{H.EmitArtifact, :spec}, {H.AskStructuredQuestions, :spec}],
  # apps/engine/lib/engine/agents/po_server.ex:116
  "po" =>
    Enum.map(
      [
        H.ListarRegrasDeNegocio,
        H.ListarBacklog,
        H.ListarMetricasDeProduto,
        H.CreateEpic,
        H.CreateStory,
        H.CreateTask,
        H.AskStructuredQuestions,
        H.OfferHandoff,
        H.EmitArtifact
      ],
      &{&1, :spec}
    ),
  # apps/engine/lib/engine/agents/arquiteto_server.ex:108
  "arquiteto" =>
    Enum.map(
      [
        H.CreateModuleMap,
        H.AssignStoryModules,
        H.ChooseProjectImage,
        H.CreateC4Diagram,
        H.RouteModulesToInfra,
        H.ProposeAdr,
        H.EmitInsight,
        H.EmitArtifact
      ],
      &{&1, :spec}
    ),
  # apps/engine/lib/engine/agents/dev_lead_server.ex:171
  "dev-lead" => [
    {Engine.Agents.DevLeadTools, :spec},
    {Engine.Agents.DevLeadTools, :spec_assess_implementability},
    {H.EmitArtifact, :spec}
  ],
  # apps/engine/lib/engine/agents/ux_designer_server.ex:112
  "ux-designer" => [{Engine.Agents.UxDesignerTools, :spec}, {H.EmitArtifact, :spec}],
  # apps/engine/lib/engine/agents/staff_server.ex:112
  "staff" => [{Engine.Agents.StaffTools, :spec}, {H.EmitArtifact, :spec}],
  # apps/engine/lib/engine/infra/infra_lead_server.ex:179 (o ator gravado é "infra")
  "infra" =>
    Enum.map(
      [
        Engine.Infra.Tools.ValidateInfraFile,
        Engine.Infra.Tools.ProposeInfraPr,
        Engine.Infra.Tools.ProposeContainerStart,
        Engine.Infra.Tools.ProposeContainerStartViaRunner
      ],
      &{&1, :spec}
    )
}

especificar = fn {mod, fun} ->
  s = apply(mod, fun, [])
  {Map.get(s, :name) || Map.get(s, "name"), Map.get(s, :description) || Map.get(s, "description"),
   byte_size(Jason.encode!(s))}
end

agentes =
  Map.merge(
    Map.new(registros, fn {a, mods} -> {a, Enum.map(mods, &especificar.({&1, :spec}))} end),
    Map.new(inline, fn {a, pares} -> {a, Enum.map(pares, especificar)} end)
  )

ferramentas =
  agentes |> Map.values() |> List.flatten() |> Map.new(fn {n, d, _} -> {n, d} end)

# O tamanho, em bytes, da definição COMPLETA (`spec/0` serializado: nome,
# descrição e o schema dos parâmetros) — é o que o modelo do agente recebe por
# ferramenta em cada chamada. Serve à conta de economia do menu restrito (AT-236).
definicoes =
  agentes |> Map.values() |> List.flatten() |> Map.new(fn {n, _, b} -> {n, b} end)

identidades =
  Map.new(Map.keys(agentes), fn
    # A do ux-designer vem do grafo (chamada à api), fora do alcance de um
    # `mix run --no-start`; sem passo gravado dele, fica um marcador.
    "ux-designer" = a -> {a, "(identidade do grafo, não lida)"}
    "dev-*" -> {"dev-*", "Você é o agente dev-<modulo>."}
    a -> {a, Engine.Harness.Agents.identity(a)}
  end)

IO.puts(
  Jason.encode!(
    %{
      fonte: "apps/engine (spec/0 de cada ferramenta; Engine.Harness.Agents.identity/1)",
      agentes: Map.new(agentes, fn {a, l} -> {a, Enum.map(l, &elem(&1, 0))} end),
      ferramentas: ferramentas,
      definicoes: definicoes,
      identidades: identidades
    },
    pretty: true
  )
)
