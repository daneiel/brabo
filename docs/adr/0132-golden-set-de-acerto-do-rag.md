# 0132 — Golden-set de acerto do RAG, e o gate `rag-acertivo`

## Context

O [ADR 0129](0129-telemetria-de-busca-do-rag-como-tabela.md) (Parte 2, Etapa 1)
deu à busca híbrida um rastro — `rag_searches`/`rag_feedback`, com os pesos
CONGELADOS na linha — mas deliberadamente **não mediu nada**: só instrumentou.
`pnpm --filter api medir:rag` lê esse rastro por projeto, quando existe. O que
ainda faltava é o que o próprio `rag-search-limits.ts` continua declarando:

> NENHUM dos quatro números abaixo vem de calibração com dado real: não há,
> ainda, um corpo de perguntas reais rodado contra este índice.

Esta é a Etapa 2 do mesmo programa — a segunda das cinco, na ordem que o dono
do produto fixou. Ela não calibra nada (isso é decisão de produto separada,
Etapa 5, com critério de desistência próprio); ela dá o **corpo de perguntas**
que a Etapa 1 deixou como lacuna.

### O molde já existe, e é o ADR 0123

O golden-set de regressão do julgamento SEMÂNTICO do QA de Automação
([ADR 0123](0123-golden-set-regressao-qa-automacao.md)) resolveu um problema
adjacente — "como medir a confiabilidade de algo não-determinístico, sem CI,
com piso ratchet" — e a decisão aqui é **reusar a estrutura inteira**, não
inventar uma segunda vez o mesmo raciocínio:

| peça | ADR 0123 (QA) | este ADR (RAG) |
|---|---|---|
| alias | `mix.exs` `"golden_set.qa"` | `"golden_set.rag"` |
| exclusão permanente | `test_helper.exs` `:golden_set_qa` | `:golden_set_rag` |
| teste ExUnit | `test/engine/gates/qa_automacao_agent_golden_test.exs` | `test/engine/rag/rag_golden_test.exs` |
| piso ratchet | `test/fixtures/golden_set_qa/floor.json` | `test/fixtures/golden_set_rag/floor.json` |
| seed | `apps/api/scripts/seed-golden-set-qa.ts` | `apps/api/scripts/seed-golden-set-rag.ts` |

A exclusão permanente por TAG (nunca detecção de "Ollama alcançável") vale
pelo MESMO motivo do lado QA: esta máquina de desenvolvimento já tem Ollama de
pé o tempo todo, e inclusão automática faria o módulo disparar dentro de
QUALQUER `mix test`, gastando tokens sem aviso.

### Onde o molde NÃO serve — e por que isso não é desvio

O golden-set do QA testa o julgamento de um **LLM de chat**, chamado através
de `Engine.Gates.QaAutomacaoAgent.run/5`. O RAG não tem julgamento de LLM
nenhum no caminho medido — a busca híbrida inteira (embedding + `ts_rank` +
fusão por peso + corte por limiar) roda dentro da **api** (`HybridSearchUseCase`),
não do engine. Reimplementar a busca em Elixir só para este teste testaria uma
SEGUNDA implementação, nunca a real — o mesmo erro que o ADR 0123 evitou ao
usar o cliente LLM real em vez de simular o julgamento.

A solução: `seed-golden-set-rag.ts` faz as DUAS coisas — provisiona **e**
busca —, devolvendo o resultado já pronto; `rag_golden_test.exs` só invoca o
script (via `System.cmd`, mesmo mecanismo do lado QA) e aplica o piso sobre o
JSON que volta. O papel do lado Elixir não é "rodar a busca", é "ser o ponto
único de `mix test --only`/exclusão permanente/piso ratchet" — a mesma
disciplina de golden-set que o resto do produto já usa, aplicada a um
mecanismo que por acaso vive inteiro do outro lado da fronteira api↔engine.

### As perguntas: compostas, não extraídas — e isso é dito, não escondido

O pedido original pedia perguntas REAIS do dogfooding. Verificado antes de
escrever este ADR: `gh issue list --repo daneiel/brabo --state all` devolve
"No Issues" — é projeto solo, sem histórico de pergunta formulada por alguém
usando o produto, em issue ou PR (os títulos de PR são todos
`tipo(escopo): o que mudou`, nunca uma pergunta).

As 17 perguntas de `seed-golden-set-rag.ts` são portanto **compostas** a
partir de RNs e ADRs REAIS deste repositório — nunca inventadas sem lastro.
Cada uma tem um `expectedPath` que é o arquivo real onde a resposta mora, e a
composição foi verificada por leitura direta do arquivo-alvo antes de escrever
a pergunta (não por título/grep). É a via que o próprio pedido previu para o
caso de não haver corpus genuíno, e fingir que são "reais" seria pior que
declarar a composição.

### O corpus indexado é real, curado, não sintético

Diferente do QA (cujo esqueleto de código é sintético, propositalmente
projetado para cada caso), o corpus do golden-set do RAG é um SUBCONJUNTO REAL
de `docs/` deste próprio monorepo — 22 arquivos (`ARQUIVOS_CURADOS` no seed),
copiados verbatim para o repositório do projeto semeado, indexados pelo MESMO
`IndexProjectDocsUseCase` que qualquer projeto real usa. Curado, não a árvore
inteira (a árvore real tem mais de 130 ADRs) — por custo de embedding numa
rodada manual: buscar entre poucas centenas de chunks já exercita a fusão
vetor+léxico igual a buscar entre milhares, e reindexar mais de cem ADRs a
cada rodada manual multiplicaria o tempo sem melhorar o que o golden-set mede.

### Um projeto só, não um por caso

O golden-set do QA provisiona um repositório por CASO, porque cada caso testa
uma regra de negócio diferente sobre um CÓDIGO diferente — isolamento é
essencial. Os 17 casos do RAG são 17 perguntas sobre o MESMO corpus de
documentação: dividir em 17 projetos indexaria o mesmo conteúdo 17 vezes (17x
o custo de embedding) para isolar buscas que já são, por natureza,
somente-leitura e sem efeito colateral entre si.

### `execution_mode: 'runner'`, não o `container` default

`ReadProjectCodeUseCase.portaoDoContainer` (RN-105) recusa com 409 qualquer
leitura de projeto `container` até o Arquiteto decidir uma imagem —
`IndexProjectDocsUseCase` chama esse caminho para varrer `docs/`. O
golden-set nunca aciona o Arquiteto (não há execução nenhuma a justificar
isso, só indexação de documentação), então o seed insere o projeto com
`execution_mode: 'runner'` — RN-169/RN-421 isentam `mounted`/`runner` do
portão inteiro, e é exatamente para este tipo de caso: projeto sem container
próprio não tem por que esperar decisão de imagem para ter o código lido. O
CHECK `projects_workspace_path_casa_com_modo` exige `workspace_path`
não-nulo para `execution_mode <> 'container'` — o seed grava um caminho
sintético (nunca usado: nenhum runner de verdade conecta a este projeto).

### O critério de acerto: caminho de arquivo, top-K, nunca rank 1

Hit esperado é o **caminho do arquivo**, nunca o chunk exato — mesma régua
frouxa do ADR 0123 adaptada ao RAG: travar no chunk quebraria o golden-set a
cada ajuste de chunking, que é justamente o parâmetro que este programa existe
para poder revisar sem reescrever os casos.

`GOLDEN_SET_RAG_TOP_K = 5`, e não rank 1: é assim que o produto realmente usa
o resultado — o Chat RAG cita VÁRIOS trechos ao lado de uma resposta
(`RagCitationCard`, plural), não só o primeiro. Medir contra rank 1 mediria
uma pergunta que a UI não faz. `5` também não é o mesmo `RAG_SEARCH_RESULT_LIMIT`
(10) que a rota real usa por padrão — pedir 10 e medir contra 10 testaria um
k mais folgado do que a maioria das buscas reais usa (o painel do Chat RAG não
rola para ver os 10). O critério mora em
`apps/api/src/domain/rag/golden-set-criterio.ts`, puro e testado
(`golden-set-criterio.spec.ts`), pelo mesmo motivo de `gate-registry.ts`: a
decisão de "isto bateu" não deveria depender de como o resultado chegou.

### Telemetria: LIGADA, de propósito

`HybridSearchUseCase` grava uma linha em `rag_searches` a cada chamada,
sempre — não há parâmetro para desligar isso, e não deveria haver. A pergunta
certa não é "desligar?", é "isso polui a medição real?": não. `medir:rag`
exige `--projeto <uuid>` (nunca agrega globalmente, ver o próprio cabeçalho do
script), e o golden-set sempre cria um projeto NOVO com sufixo de timestamp —
as linhas que ele grava nunca aparecem em `medir:rag` de projeto real, pelo
mesmo motivo que o golden-set do QA não polui métrica nenhuma de projeto real.
E gravar de verdade é o que faz este golden-set exercitar o MESMO caminho de
código que a Chat RAG real usa.

### O gate `rag-acertivo`

```yaml
- id: rag-acertivo
  fluxo: transversal # o RAG serve todos os fluxos, como acao-aprovada
  dono: usuario
  entrada: [golden-set-rag]
  entregavel: taxa-de-acerto-acima-do-piso
  verificacao: script
  severidade: warn
  aprovacao_humana: false
  status: active
  evidencia:
    tipo: teste
    arquivo: apps/engine/test/engine/rag/rag_golden_test.exs
```

`fluxo: transversal` e `dono: usuario` são reusados do gate `acao-aprovada`,
de propósito — nenhum dos dois campos é validado contra enum
(`apps/api/src/domain/gates/gate-registry.ts`), e inventar uma categoria nova
de um membro só (`instrumentos`/`medicao`) passaria no validador sem
significar nada. Se um dono `medicao` for desejado um dia, ele já existe como
PAPEL em `docs/fluxo.yml` (`camada_instrumentos`), e introduzi-lo é decisão à
parte, não efeito colateral deste gate.

`evidencia.tipo: teste`, e não `event_log` — o que prova este gate é o próprio
golden-set, não um evento no log (não há `proposed_action` nem evento de
domínio associado à passagem de um golden-set). Precedente:
`merge-protegida` já usa `tipo: teste` pelo mesmo motivo — a garantia não vem
do event log.

`severidade: warn` é OBRIGATÓRIO, não estilístico: RN-070 exige
`verificacao: script` para `block` (que este gate TEM), mas a decisão de warn
vem de outro lugar — não há CI com LLM (mesma decisão já registrada para o
golden-set do QA), então o gate roda MANUAL, e prometer `block` descreveria um
travamento automático que não existe. `docs/explanation/gates.md` ganha o
quinto exemplo trabalhado de "por que warn", seguindo a mesma estrutura
argumentativa dos quatro anteriores (`necessidade-validada`,
`workspace-verificado`, `implementavel`, `paralelismo-autorizado`).

`entrada: [golden-set-rag]` não é referência a outro gate — a heurística do
validador (`entrada` terminando em `-verificada`/`-segura`) não casa com esse
nome, então não dispara a checagem de órfão. Confirmado lendo
`apps/api/src/domain/gates/gate-registry.ts` (`pareceGate`), não assumido.

## Decision

1. Copiar a estrutura do ADR 0123 (alias, exclusão permanente, teste
   ExUnit, piso ratchet por MODELO — aqui, modelo de EMBEDDING — ,
   seed externo via `System.cmd`) para o domínio do RAG, com as duas
   adaptações que o domínio exige: o seed roda a busca (não só provisiona,
   porque o julgamento mora inteiro do lado api) e o corpus é real e curado
   (não sintético).
2. `apps/api/src/domain/rag/golden-set-criterio.ts` — puro, testado — define
   o critério de acerto (caminho de arquivo, top-5, nunca chunk exato/rank 1)
   e é consumido tanto pelo seed quanto por qualquer chamada futura de
   depuração.
3. `docs/gates.yml` ganha `rag-acertivo`, `warn`, `status: active`,
   `evidencia.tipo: teste` apontando para o teste ExUnit.
4. `floor.json` chaveado pelo modelo de EMBEDDING (`RAG_EMBEDDING_MODEL`,
   hoje `nomic-embed-text` — o único que o produto suporta, RN-222), contagem
   e `of`, nunca porcentagem, escrito só por humano.

## Consequences

**CI wiring é `TODO(humano)`, igual ao QA.** Sem segredo de LLM de API ou
infra nova (Ollama de verdade em CI), o golden-set roda MANUAL —
`mix golden_set.rag` — e nunca em `mix test` normal.

**As 17 perguntas medem retrieval sobre um corpus de 22 arquivos, não os
+130 ADRs reais.** Um golden-set contra o corpus completo mediria uma
distribuição de dificuldade mais realista (mais distratores plausíveis, mais
chance de dois arquivos cobrirem a mesma pergunta) — decisão de custo de
embedding numa rodada manual, revisável se a rodada real mostrar teto
artificialmente fácil.

**O golden-set mede RETRIEVAL, não RESPOSTA.** Ele nunca chama um LLM de chat
para sintetizar uma resposta a partir dos hits — mede só se o caminho certo
apareceu entre os candidatos. É a métrica que a Etapa 1 (`medir:rag`) também
usa (`precision@k`, distribuição de rank), então os dois instrumentos falam a
mesma língua.

**Sobre a rodada real e o que o piso registra:** ver
`test/fixtures/golden_set_rag/floor.json` para o comentário `_comment` com o
resultado medido (ou a declaração de que a medição ficou pendente de rodada
humana, se o ambiente desta sessão não permitiu rodar contra Ollama de
verdade).
