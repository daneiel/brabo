# ADR 0079 — Ranking de modelos por capacidade, sem nota inventada

- **Status:** aceito
- **Data:** 2026-08-15
- **Contexto:** PROGRAMA 28, Onda 2, frente H2 — handoff de design,
  Configurações item 5 ("Melhores modelos por capacidade") e item 6
  ("Modelos por agente", dropdown com badge "ideal")
- **Estende:** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
  (capability só declarada quando provada), [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
  (curadoria sempre manual), [ADR 0051](0051-facetas-de-capability-e-curadoria-por-uso.md)
  (`uses` como curadoria de workspace, não capability — [RN-057](../business-rules.md#rn-057))

## Contexto

O handoff (`design_handoff_brabo/README.md`, seção 7) pede duas coisas que a
tela de Configurações não tinha:

1. Uma tabela de RANKING — "Melhores modelos por capacidade" — com colunas
   capacidade, recomendado, alternativa, **score** e "usado por". O exemplo do
   mock mostra números como "código → claude-sonnet-4 / qwen2.5-coder:14b
   (9.4)".
2. Um badge verde **ideal** no dropdown de `ModelPicker`, "quando o modelo
   cobre TODAS as capacidades exigidas pelo agente".

As duas pedem o mesmo tipo de dado que o produto não tem, e a investigação
antes de codar confirmou isso por DOIS caminhos independentes.

### O score é fictício

"9.4", "9.1", "8.7"... são números do MOCK, sem correspondência em nenhum
catálogo de provider nem em nenhuma métrica que o produto calcule. Nenhum
provider publica "qualidade de código" e o produto não mede taxa de acerto,
satisfação ou qualquer proxy disso. Copiar os números do mock para produção
seria exibir dado fabricado como se fosse medido — o mesmo "palpite vestido
de dado" que o [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
proíbe para capability de MODELO, agora sobre qualidade.

### "Capacidades exigidas pelo agente" não existe no domínio

A busca no código (web e api) não achou NENHUMA estrutura que amarre um
`AgentKey` a um conjunto de capacidades exigidas. Mais que isso: o próprio
`ModelsSection` (`ProjectSettingsTab.tsx`) já tinha decidido isso antes desta
frente — a coluna do desenho era "Agente · capacidades" e o código a renomeou
para só "Agente", com o comentário "as capacidades exigidas por agente não
existem no domínio, e prometer uma coluna que não tem conteúdo é pior que não
prometer". Inventar uma tabela `AgentKey → UsoDeModelo[]` agora, mesmo
"declarada" à mão como `color`/`icon`/`initials` em `agents.ts`, contradiria
essa decisão sem revogá-la — e é exatamente o tipo de classificação de
produto que o CLAUDE.md reserva para decisão explícita do usuário, com ADR.

Há uma segunda barreira, estrutural, que fecha a questão mesmo se a primeira
não existisse: o `ModelPicker` usado para vincular modelo a um agente lê
`GET /projects/:projectId/models` (papel `viewer`), que devolve `Model` PURO.
A curadoria (`uses`, ADR 0051) só existe em `ModelComCuradoria`, servida por
`GET /workspaces/:workspaceId/models/catalog` — que exige `maintainer`. Pintar
um badge que depende de `uses` nesse picker exigiria ou (a) elevar o nível de
acesso do picker de agente para `maintainer` (recuo de RBAC que ninguém
pediu), ou (b) abrir uma rota nova que vaze `uses` num nível mais baixo — as
duas são mudança de fronteira de acesso, decisão de produto por si só.

## Decisão

**O badge "ideal" NÃO é construído.** Fica documentado em
`apps/web/src/components/ModelPicker.tsx`, no lugar onde o handoff o pedia,
com as duas razões acima. Não é regressão: o badge nunca existiu. É pendência
declarada, como as que a FASE 26 já deixou para blame/PRs antes da 26b.

**O bloco "Melhores modelos por capacidade" É construído, com dois sinais
REAIS e nenhuma nota:**

| coluna do handoff | o que a tela mostra agora | de onde vem |
| --- | --- | --- |
| score | *(removida)* | não existe dado — ver acima |
| recomendado / alternativa | os dois primeiros modelos, entre os que a curadoria (`uses`) marcou para aquela capacidade | `workspace_models.uses` (ADR 0051), nunca calculado |
| usado por | contagem de agentes DESTE projeto cujo binding vigente resolve para aquele modelo | a mesma cascata que `ModelsSection` já lê (`getAgentModelBinding` por agente) |

O desempate entre candidatos é por CUSTO (`inputPricePerMillionMicros`
ascendente) — real, do catálogo, nunca proxy de qualidade. A ORDEM de
prioridade é uso real primeiro (quantos agentes do projeto já resolvem para
aquele modelo), custo em segundo: "o que o time já escolheu" é o sinal mais
honesto disponível sem inventar nota. Capacidade sem nenhum modelo curado
mostra "sem cobertura curada" — nunca some a linha, mesmo padrão de
`fallbackDe`/coluna Origem em `ModelsSection`.

A seção (`MelhoresModelosPorCapacidadeSection`,
`apps/web/src/routes/ProjectSettingsTab.tsx`) lê
`GET /workspaces/:workspaceId/models/catalog` — a mesma rota de
`ModelCatalogSection`, e por isso herda a MESMA visibilidade (`maintainer`):
não é uma tela nova com regra de acesso própria, é a mesma pergunta
("como este workspace curou o catálogo?") respondida de outro jeito.

## Consequências

- Quem não é `maintainer` do workspace não vê esta seção — igual ao
  `CatalogoDeModelos` que já existia. Não é regra nova.
- "Recomendado" muda quando o time muda de modelo (uso real) ou quando o
  owner reprecifica manualmente (`manualPricing`) — nunca por conta própria:
  não há job recalculando nada, é derivado na leitura.
- Se um dia o produto ganhar uma métrica real de qualidade (taxa de sucesso
  de proposed_action por modelo, por exemplo), ela entra como COLUNA NOVA,
  não substitui "usado por"/custo — as duas perguntas ("o que o time usa" e
  "o que funciona melhor") são diferentes, mesmo argumento do
  [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) para não fundir
  perguntas diferentes numa métrica só.
- O badge "ideal" continua no backlog de
  `docs/explanation/backlog.md`-equivalente só se o usuário decidir que
  "capacidades exigidas por agente" vale a pena existir como dado — o que é
  decisão de produto, não retomada automática desta frente.
