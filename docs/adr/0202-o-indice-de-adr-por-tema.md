# 0202 — O índice de ADR por tema, com o tema fora do ADR

## Status

**Accepted.** 2026-10-01 (AT-137, história HS-014, épico EP-011, finding
`BRB-026`, rodada 36; decisão do dono em 01/10: *"sim, reorganizar por tema,
com o tema FORA do ADR"* — um arquivo de mapeamento ADR → tema ao lado do
índice, aferido pelo `docs:check`, e nenhum ADR aceito editado). A
**taxonomia** — a lista de 15 temas e o tema de cada um dos 191 ADRs — é
PROPOSTA desta lane, e o dono a revisa no PR: trocar o tema de um ADR ou
fundir dois temas é mudança de `docs/adr/temas.yml`, não deste texto.

## Context

O `docs/adr/index.md` era agrupado por FASE. Isso ajudou enquanto as fases
eram o jeito de o projeto andar; deixou de ajudar quando as fases acabaram e o
trabalho passou a nascer do kanban: medido em 2026-10-01, das 191 linhas do
índice, **148** moravam sob um cabeçalho só, `## Phase 12 — Post-dogfooding
operability`, de 0044 a 0197 — a seção que era "o resto" virou o índice. Quem
procura "o que foi decidido sobre o broker" ou "por que a chave de máquina é
assim" não tem por onde começar a não ser ler 148 linhas.

A AT-027 fez a metade da contagem do
`BRB-026` (o índice dizia 134 com 156 escritos) e separou esta metade por
escrito, com a pergunta que a travava: o tema seria um metadado `tema:` no
frontmatter de cada ADR — e acrescentar frontmatter a um ADR aceito é editá-lo,
o que a convenção do índice proíbe sem exceção. A decisão do dono resolve a
pergunta pelo outro lado: o tema mora FORA do ADR.

O que já existia e continua: `verificarIndiceAdr` (`scripts/docs/generate.mjs`)
reprova ADR sem link no índice, e `verificarContagensEmProsa` afere a contagem
no `description` do índice e "the next one is **NNNN**". Nenhum dos dois sabe
nada de agrupamento.

## Decision

**1. O tema mora em `docs/adr/temas.yml`, ao lado do índice.** Duas chaves:
`temas:` — a lista FECHADA, em ordem, cada um com `id` (kebab-case, a âncora
`{#tema-<id>}` e o valor do mapa), `titulo` (o cabeçalho da seção no índice,
em inglês como o índice) e `descricao` — e `adrs:`, o mapa `"NNNN": <id>`.
Cada ADR tem UM tema, o principal: quando dois servem, vale aquele em que
alguém procuraria primeiro. Nenhum ADR aceito é tocado.

**2. O índice é CONFERIDO, não gerado.** Cada linha do índice é uma frase
curada sobre o ADR, e nenhum script a escreve (o motivo que `verificarIndiceAdr`
já registrava). Gerar o índice exigiria mover as 191 frases para o YAML — trocar
um Markdown legível por uma string YAML longa, para ganhar uma ordenação que a
conferência já garante. O índice passa a ter uma seção
`## <titulo> {#tema-<id>}` por tema, na ordem da lista, com a frase de uma
linha da `descricao` e a tabela de sempre, em ordem numérica.

**3. `scripts/docs/temas-de-adr.mjs` confere, e o `docs:check` reprova**
(`verificarTemasDeAdr`, irmão de `verificarIndiceAdr`, chamado logo depois
dele): ADR em `docs/adr/` sem tema; tema no mapa que não está na lista; entrada
no mapa para ADR que não existe; tema da lista sem ADR nenhum; lista com id ou
título repetido; no índice, seção de tema ausente, repetida, com título
diferente do da lista, fora da ordem da lista ou de tema inexistente; e linha de
ADR sob a seção de outro tema, fora de qualquer seção de tema, repetida ou fora
da ordem numérica. YAML ilegível, lista ou mapa vazios, ou índice sem nenhuma
seção de tema é `CEGO` e reprova. Cada regra é provada por mutação em
`scripts/docs/temas-de-adr.spec.ts`, como os outros aferidores.

**4. A taxonomia proposta tem 15 temas.** Ela sai das FRENTES do produto — as
mesmas que organizam o `CLAUDE.md` e o catálogo de `agent-areas.ts` —, não das
fases nem das pastas do código:

| id | tema | ADRs |
|---|---|---|
| `git` | Git, repository and branch policy | 11 |
| `agentes` | Agent harness, turns and sessions | 11 |
| `time` | The agent team — roles, areas and handoffs | 26 |
| `gates` | Gates, QA and security review | 12 |
| `execucao` | Execution, terminal policy and approvals | 13 |
| `modos` | Where the code lives — execution modes | 9 |
| `container` | Project container and broker | 15 |
| `runner` | The local runner | 11 |
| `iam` | Auth, access and secrets | 13 |
| `llm` | LLM providers, models and spend | 16 |
| `conhecimento` | RAG, knowledge graph and artifacts | 11 |
| `web` | Web UI and design system | 12 |
| `operacao` | Operation, deploy and installation | 15 |
| `engenharia` | CI, release and supply chain | 10 |
| `docs` | Documentation | 7 |

Por que ESTA lista, e as fronteiras que não são óbvias:

- **`agentes` × `time`.** `agentes` é COMO um agente roda (contexto, laço de
  ferramentas, turno, sessão, fila de mensagens, idioma da resposta); `time` é
  QUAIS agentes existem e o que entregam a quem (papéis, áreas, delegação,
  handoff, o Psicólogo e a Anamnese). Juntos dariam 37 ADRs — um "Phase 12"
  menor. O Infra Lead conversacional (0175) cai em `agentes` porque decide o
  turno dele; o Dev Lead (0053) em `time` porque decide o papel.
- **`modos` × `container` × `runner`.** Três frentes que se tocam em todo ADR
  desde o 0104, e por isso separadas pela PERGUNTA: onde a pasta mora
  (`modos`), quem sobe o container e com que contenção (`container`), o CLI na
  máquina do usuário (`runner`). O runner subindo o container (0137) é
  `container`; o `git` credenciado no host do runner (0193) é `runner`.
- **`execucao` × `gates`.** `execucao` é a política que segura o agente que
  AGE (`proposed_action`, escopo de caminho, modo automático, tetos absolutos);
  `gates` é o veredito sobre o que foi feito.
- **`operacao` junta deploy e instalação.** Os dois respondem "como o produto
  roda numa máquina que não é a de quem o desenvolve" e dividem backup e o
  compose de instalação; separados, a instalação teria 7 ADRs e o 16º tema.
- **`engenharia` leva o que é do REPOSITÓRIO e não do produto:** esteira,
  imagens publicadas, assinatura, Trivy, pin por digest, as camadas de teste e
  a divisão do schema por agregado (0121) — a única refatoração estrutural da
  api, que em nenhum outro tema seria procurada. As divisões do
  `SessionPage.tsx`/`ProjectSettingsTab.tsx` ficam em `web`, onde quem mexe
  nesses arquivos procura.
- **Idioma não é tema** (só o 0177 decide sobre ele, e está em `agentes`);
  **segurança não é tema** — ela atravessa `iam` (CSP, CORS, envelope),
  `execucao` (tetos), `container` (contenção do broker) e `engenharia` (cadeia
  de suprimentos), e um tema "segurança" esvaziaria quatro para encher um.

Dez a quinze foi o intervalo pedido: menos que dez juntaria `modos`/`container`/
`runner` ou `agentes`/`time`, que é onde o índice por fase falhou; mais que
quinze faria o tema virar a pasta.

**5. Quem decide o tema de um ADR novo:** quem o escreve, no mesmo PR — uma
linha em `adrs:` e a linha do índice na seção do tema, em ordem numérica. Quem
revisa o PR confirma. Tema NOVO é mudança da lista em `temas.yml`, justificada
no PR que o cria; passar de 15 exige ADR que revise este.

## Consequences

- O índice deixa de ter seção por fase, e com ela saem as frases de abertura
  de cada fase. A narrativa por fase continua onde sempre esteve completa,
  `docs/explanation/historico-de-fases.md`; o aviso de critério de aceite
  aberto dos ADRs 0020/0021 vai junto com eles para `gates`.
- ADR novo custa uma linha a mais (`temas.yml`), e esquecê-la REPROVA o
  `docs:check` — o mesmo preço e o mesmo motivo de `verificarIndiceAdr`.
- O tema é uma CLASSIFICAÇÃO e vários ADRs servem a dois. O índice mostra cada
  um uma vez, no principal; quem procura pelo outro tema não o acha ali. É o
  preço de "um tema por ADR", e a alternativa (tema secundário) foi
  considerada e não entrou: duplicaria a linha curada ou a deixaria em dois
  lugares que envelhecem separados.
- ADRs em paralelo: o mapeamento cobre os ADRs que existiam na `origin/dev` em
  2026-10-01 (de 0001 a 0197, mais este). Quem integrar um ADR nascido em outra
  branch acrescenta a linha dele — o `docs:check` aponta qual falta.
- A tradução pt-BR do índice (`website/i18n/pt-BR/.../adr/index.md`) segue por
  FASE e já estava atrás (103 de 191 linhas); não é reorganizada aqui. A regra
  `traducao-pt-br` do docmap avisa, em `warn`, como sempre.

## O que este ADR NÃO faz

- Não edita ADR nenhum, nem para corrigir um título.
- Não gera o índice: as frases continuam curadas à mão.
- Não cria RN: a regra é de documentação, como a dos procedimentos do runbook.
