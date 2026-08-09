# ADR 0064 — Escopo de área na cascata de modelo, e o binding de agente global

- **Status:** aceito
- **Data:** 2026-08-09
- **Contexto anterior:** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
  (capabilities em duas camadas e a revalidação de `resolveBinding` ao cair de
  nível), [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (áreas como dado por projeto, `agent_areas`/`agent_area_members`), FASE 18
  (a área nasce com o projeto, RN-094)

## Contexto

O pedido do usuário: "para leads de áreas e seu subgrupo estarem em conjunto,
dando a possibilidade de escolher um mesmo modelo vigente para ambos." A
decisão dele já veio junto — o modelo da área é **padrão herdável**: um agente
específico pode divergir, e a UI mostra quem herda e quem divergiu.

A cascata de binding (`domain/llm/binding-resolver.ts`) resolve hoje
`sessão > agente > projeto > workspace`, um binding por escopo, o mais
específico vencendo. `agent_areas`/`agent_area_members` (ADR 0053, FASE 18)
já são dado real por projeto — lead, subagentes e o teto de paralelismo. O que
falta é o MODELO da área entrar nessa mesma cascata.

Isso levanta uma pergunta de posição: entre quais dois níveis a área entra? E
uma segunda, que só aparece ao tentar responder a primeira, é o coração desta
ADR.

### A incoerência: binding de agente é GLOBAL, área é POR PROJETO

`SetModelBindingUseCase.execute('agent', agentSlug, ...)` grava com
`scope_id = agentSlug` — um SLUG, sem projeto. `PUT
/projects/:projectId/agent-bindings/:agentSlug` recebe `:projectId` na rota e
o **descarta explicitamente**: o comentário no código já dizia isso é
intencional. Escolher o modelo do Arquiteto na tela de um projeto muda o
modelo dele em TODOS os projetos onde ele existe.

Área, ao contrário, é por projeto desde o ADR 0053 — o mesmo `qa` de dois
projetos diferentes pode ter tetos e (agora) modelos diferentes.

Colocar um escopo POR PROJETO acima de um escopo GLOBAL na mesma cascata é uma
contradição de fato, não só de estilo: o mesmo agente resolveria modelos
diferentes por projeto **só onde existisse área configurada**, e igual em
todos os outros — comportamento que depende de um acidente de dados, não de
uma regra. Tem duas saídas, mutuamente exclusivas:

1. **O binding de agente passa a ser por projeto.** Muda um comportamento que
   existia desde a Fase 9a.
2. **A área fica ABAIXO do agente na cascata.** Mantém o agente global, mas
   contradiz "padrão herdável" — a área nunca conseguiria ser o padrão de um
   agente que já tem binding (que é o caso comum, porque HOJE quase todo
   binding registrado é de agente, não há outro nível entre ele e o projeto).

## Decisão

**Escolhida a opção 1: o binding de agente passa a ser por projeto.**

A cascata ganha o nível `area`, entre `agent` e `project`:

```
sessão > agente > área > projeto > workspace
```

A área é o PADRÃO que o lead e os subagentes de uma área compartilham; o
binding do próprio agente é a DIVERGÊNCIA explícita que o sobrepõe. Essa
ORDEM — e não a mera existência do nível — é a decisão do usuário sendo
cumprida: se a área viesse acima do agente ela venceria sempre, e "padrão
herdável" seria, na prática, "padrão imposto".

Para a posição fazer sentido sem a contradição de escopo global acima de
escopo por projeto, o binding de `agent` teve de deixar de ser global. O
`scope_id` de `agent` e de `area` virou **composto**:
`<projectId>:<slug do agente | chave da área>`. Nenhuma tabela nova: `UUID` de
projeto e slug/chave nunca contêm `:`, o que torna o primeiro `:` um
separador não ambíguo (`domain/llm/binding-scope-id.ts`), e o formato antigo
(sem `:`) é **recusado** na escrita — gravá-lo criaria um binding que a
cascata nunca mais encontraria, invisível em vez de um erro.

A migração 0040 espalha cada binding de agente global existente para uma
linha por projeto, preservando o modelo que cada projeto resolvia antes da
mudança, e apaga o formato antigo. É espalhar e não escolher um projeto
"dono": a linha global nunca guardou informação de a quem pertencia.

**O nível novo entra na mesma revalidação de capability já existente** (ADR
0041/RN-041/RN-043): modelo da área que sumiu do provider ou que não faz tool
calling é pulado e registrado em `skipped`, exatamente como já acontecia com
`agent`. `area` também passou a exigir `supports_tool_calling`
(`assertModelFitsBindingScope`) — ela nunca é lida por chat humano, só por
agente, e deixá-la passar adiaria a mesma falha silenciosa em um nível.

**"Voltar a herdar" apaga o binding, nunca copia o modelo do nível de baixo
para o de cima.** `DELETE /projects/:id/agent-bindings/:slug` e `DELETE
/projects/:id/area-bindings/:key`, os dois 204 e os dois 404 quando o escopo
já herda. Gravar no agente o modelo que a área decidiu pareceria igual na
tela e não é: viraria cópia, e a próxima mudança da área deixaria esse agente
para trás em silêncio — herdar é a AUSÊNCIA de decisão própria.

Mudar o modelo da ÁREA exige papel `maintainer`, e não `developer` como o do
agente individual — o mesmo motivo do teto de paralelismo (RN-083): o
binding da área alcança o lead e todos os subagentes de uma vez, e escolher
modelo é decidir quanto o produto gasta sem perguntar. O binding de agente
continua em `developer`, como já era.

A UI (`AreaModelsSection` em `ProjectSettingsTab.tsx`) lista o padrão de cada
área ao lado da tabela de agentes; a coluna Origem da tabela de agentes ganha
"voltar a herdar" quando `origin === 'agent'` — o agente diverge, de uma área
quando ele tem uma, ou do projeto/workspace quando não tem.

## Consequências

- **A cascata cresce de quatro para cinco níveis**, e todo consumidor que
  enumerava os quatro (testes, DTOs, `ORIGIN_TONE` na UI) precisou do quinto.
  É custo pago uma vez; a estrutura (revalidação de capability, `skipped`,
  origem explícita) já existia e só se estendeu.
- **O binding de agente deixou de ser global.** Quem dependia do slug global
  — três scripts de seed/demo — passou a gravar por projeto
  (`chaveDeAgente(projectId, slug)`). Não há mais forma de "um modelo para
  este agente em todo lugar"; quem quer isso hoje configura por projeto, ou
  configura no `workspace` (que continua global e é o fallback de todos).
- **A área não tem tabela de binding própria** — reusa `model_bindings` com
  `scope = 'area'`, pelo mesmo motivo que `agent` sempre reusou: não há
  atributo do binding que dependa do tipo de escopo, só do `scope_id`.
- **`scope_id` composto é um formato implícito**, não reforçado por
  constraint de banco (é `text`). A validação vive em uma função só
  (`assertScopeIdBemFormado`), e é ela — não o schema — quem impede o
  binding fantasma. Se um dia `area`/`agent` ganharem tabela própria, este
  formato vira o `id` dela e o `scope_id` some.
- **Herdar por padrão de área não alcança subagentes fora do catálogo**: a
  área do agente é resolvida pelo catálogo estático (`agent-areas.ts`), que
  já cobre a área dinâmica de `dev` pelo predicado `ehDevDeModulo` sem
  round-trip ao banco — nenhuma consulta nova a `agent_areas` foi necessária.
