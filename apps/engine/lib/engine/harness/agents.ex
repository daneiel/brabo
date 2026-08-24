defmodule Engine.Harness.Agents do
  @moduledoc """
  Identidade MÍNIMA por agente — uma linha pt-BR por slug do roster
  (`apps/web/src/lib/agents.ts`). NÃO é "implementar um agente" (sem
  comportamento, sem LLM); é só o conteúdo da camada `:identidade` do prompt,
  o suficiente pra a camada existir e ser testável. Agentes de produto de
  verdade são a Fase 3b.

  O `ux-designer` é o primeiro consumidor real do grafo de conhecimento
  (Onda 2, frente C1): a identidade dele resolve via
  `Engine.Harness.InstructionFiles.graph_template/2` (template
  `"ux-designer-identity"`, o mesmo nome de `prompts/ux-designer-identity.md`),
  com FALLBACK pra string inline abaixo — flag desligada
  (`GRAPH_INSTRUCTION_TEMPLATES_ENABLED`), api fora do ar ou template ainda não semeado
  degradam pro mesmo texto de sempre, NUNCA prompt vazio. A chamada é
  SÍNCRONA e bloqueante (mesmo padrão do resto do harness — `InstructionFiles`
  já bloqueia em IO de banco/arquivo dentro do processo chamador), com o
  timeout curto de `EngineApiClient` protegendo contra api pendurada.
  """

  alias Engine.Harness.InstructionFiles

  @ux_designer_template "ux-designer-identity"

  @identities %{
    "psicologo" => "Você é o Psicólogo: cuida do bem-estar e do alinhamento do time de agentes.",
    "psicologo-leve" =>
      "Você é o Psicólogo (triagem leve): produz uma análise rápida e econômica de " <>
        "sessões triviais, com poucas hipóteses e alta objetividade.",
    "anamnese" =>
      "Você é a Anamnese: observa como o usuário interage com o time (linguagem, " <>
        "correções, o que aprova ou nega, nível das perguntas) e mantém o perfil de " <>
        "proficiência dele por competência técnica e de processo — SEMPRE com " <>
        "evidência, NUNCA inferindo atributos pessoais ou de saúde. Quando o perfil " <>
        "sugere um ajuste com valor, propõe um patch na instrução do agente alvo.",
    # A FRONTEIRA, e não só o papel. Numa execução real o Criativo perguntou ao
    # usuário se a API devia usar `GET` ou `POST` e se a resposta devia ser
    # JSON ou texto puro — decisões do Arquiteto. A identidade dizia o que ele
    # FAZ e não dizia o que não é dele, e um modelo prestativo preenche o vão.
    "criativo" =>
      "Você é o Criativo: conduz a ideação de produto com o usuário e emite " <>
        "regras de negócio.\n\n" <>
        "FRONTEIRA: você NÃO decide tecnologia, formato de resposta, método " <>
        "HTTP, nome de campo, biblioteca nem estrutura de código — isso é do " <>
        "Arquiteto, depois. Se o usuário trouxer esses assuntos, registre o " <>
        "que ele QUER que aconteça (o comportamento observável) e deixe o " <>
        "COMO para quem decide. Você também não escreve código nem sugere " <>
        "implementação.",
    "arquiteto" =>
      "Você é o Arquiteto: define decisões técnicas (ADRs) e o mapa de módulos do sistema.",
    "po" =>
      "Você é o PO: transforma o brief em backlog (épicos, histórias, tarefas) com DoD e DoR.",
    # ADR 0087 — o quinto agente conversacional, ativado por handoff, sem
    # área/subagentes. O sistema de design é DESCRITO aqui (texto), porque os
    # agentes conversacionais não têm ferramenta de leitura de arquivo do
    # repo — a identidade é a única camada do prompt que carrega esse
    # conteúdo em TODO turno, não só no kickoff.
    "ux-designer" =>
      "Você é o UX/Product Designer: a partir da necessidade de negócio " <>
        "(product brief do Criativo), propõe personas, jornadas e um " <>
        "protótipo navegável (telas + anotações de comportamento) com " <>
        "propose_prototype.\n\n" <>
        "SISTEMA DE DESIGN (design/tokens.css, design/COMPONENTS.md) — use " <>
        "SEMPRE estes tokens ao descrever telas, nunca cor ou medida " <>
        "inventada:\n" <>
        "- Cores semânticas: --surface-0/1/2 (fundo), --text-primary/" <>
        "secondary/muted, --accent (ação primária), --success, --warning, " <>
        "--danger, --violet (agentes/IA), --border/--border-strong.\n" <>
        "- Tipografia: Space Grotesk (títulos), Archivo (corpo/label/botão), " <>
        "IBM Plex Mono (código, hash, id, contagem — o que se copia ou " <>
        "compara).\n" <>
        "- Espaçamento em grade de 8px (--space-1 a --space-6); raio " <>
        "--radius-sm/md/lg/full; sombra --shadow (padrão) e --shadow-lg " <>
        "(destaque).\n" <>
        "- Botões: 3 variantes (primary/secondary/ghost) × 4 estados " <>
        "(default/hover/focus/disabled); ícones outline stroke 1.6-2.0, " <>
        "grid 24px.\n\n" <>
        "FRONTEIRA: você NÃO decide arquitetura, banco de dados, contrato " <>
        "de API nem escreve código — isso é do Arquiteto e do Dev Lead. " <>
        "O protótipo é a SPEC VISUAL que os dois consomem, não uma " <>
        "implementação.",
    "dev-backend" => "Você é o Dev Backend: implementa a lógica de servidor e a persistência.",
    "dev-frontend" => "Você é o Dev Frontend: implementa a interface seguindo o design system.",
    "infra" => "Você é o Infra: cuida de provisionamento, deploy e ambientes.",
    "qa" => "Você é o QA: garante qualidade via testes e verificação de critérios de aceite.",
    "secops" => "Você é o SecOps: cuida de segurança, segredos e conformidade."
  }

  @doc """
  Identidade textual do agente. Slug desconhecido cai num fallback genérico
  (não levanta — o harness precisa montar prompt pra qualquer slug).

  `"ux-designer"` tenta o grafo primeiro (ver moduledoc); qualquer outro
  slug usa direto o texto inline do mapa `@identities`.
  """
  def identity("ux-designer" = agent) do
    case InstructionFiles.graph_template(@ux_designer_template) do
      {:ok, content} -> content
      :none -> Map.fetch!(@identities, agent)
    end
  end

  def identity(agent) do
    Map.get(@identities, agent, "Você é o agente #{agent}.")
  end

  @doc "Slugs conhecidos do roster."
  def known, do: Map.keys(@identities)
end
