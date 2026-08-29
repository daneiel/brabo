# ADR 0078 — Moldura de tela, e o registro de abas diverge do handoff de propósito

- **Status:** aceito
- **Data:** 2026-08-15
- **Contexto anterior:** [RN-048](../business-rules/custo.md#rn-048)
  (promoção de história pendente), [RN-104](../business-rules.md#rn-104) (Chat e
  Criativo como lugares, com a chave `sessions`), [RN-121](../business-rules.md#rn-121)
  (aba Executores, dev agent e QA fora do "Time de agentes" misturado),
  [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md) (embeddings no
  contrato de `LLMProvider` — fundação sem consumo)

## Contexto

O checklist "moldura de tela" do handoff de design (`design_handoff_brabo/CHECKLIST-CONFRONTO.md`,
seção 2) descreve a faixa que envolve toda tela de projeto: header de 60px,
régua de abas logo abaixo, aba ativa com `box-shadow: inset 0 -2px 0
var(--accent)`, rolagem horizontal em telas estreitas, e container de conteúdo
com largura máxima 960–1040px. O código de `ProjectPage.tsx` tinha os quatro
defeitos: header com padding variável em vez de altura fixa, aba ativa com
`border-bottom` (não `box-shadow`), sem rolagem horizontal declarada, e sem
teto de largura no container de conteúdo.

Corrigir os quatro é o essencial deste ADR, mas a parte que precisa de decisão
— e não só de CSS — é outra: **o handoff lista 7 abas** (Visão geral, Criativo,
Código, Chat RAG, Gastos, Aprovações, Configurações) e **o registro
(`apps/web/src/routes/project-tabs.ts`) tem 10**. As três a mais são
`executores`, `backlog` e `insights`.

O handoff é de uma leva anterior do PROGRAMA 16–26. Entre a leva que o desenhou
e hoje, três coisas aconteceram que ele não podia prever:

1. **Executores** nasceu na FASE 27 (RN-121) quando o grid de agentes saiu da
   Visão geral para uma aba própria — dado real (status ao vivo, modelo
   vinculado, toggle de autonomia), não maquete.
2. **Backlog** tem contador próprio de histórias aguardando promoção do
   usuário desde a Fase 12c (RN-048) — outra fila de decisão, com regra de
   negócio e teste cobrindo o quê e quando ela soa.
3. **Insights** mostra as hipóteses do Psicólogo esperando aceitar/descartar
   — a terceira fila de decisão do projeto, existente desde antes do handoff
   ser escrito.

Nenhuma das três é redundante com as 7 do handoff, e nenhuma é ornamento:
todas têm dado real, contador derivado de consulta, e pelo menos uma RN
própria com teste. Apagá-las para "bater" com o handoff destruiria informação
que o produto já sabia mostrar.

## Decisão

**As 10 abas ficam. O handoff é referência de fidelidade VISUAL — cores,
tipografia, espaçamento, o desenho da moldura — não teto de quantas abas o
produto pode ter** (RN-203). Ele fixa como cada tela deve SE PARECER; não
congela o inventário de funcionalidades no dia em que foi escrito. A regra já
valia implicitamente (a FASE 26 registrou a aba Código sem o handoff prever
"Executores" nem "Insights" como abas separadas, e ninguém cogitou removê-las
por isso) — este ADR só a torna explícita, com teste que reprova se alguém
"arrumar" o registro contra o handoff sem ler esta decisão.

**A chave `sessions` continua rotulada "Chat", nunca "Chat RAG"** (RN-202). O
handoff chama essa aba de "Chat RAG" nas telas mais recentes
(`designs/Brabo Chat.dc.html`), e a tentação óbvia seria só trocar a string do
rótulo. A rejeição é literal: "Chat RAG" descreve uma FUNCIONALIDADE — consulta
por embeddings sobre o repositório indexado, com citação de fonte — que o
produto não tem. O ADR 0075 pôs `embed` no contrato de `LLMProvider`
(capability provada só no Ollama), mas nada ainda CONSOME essa operação: não
há pipeline de indexação, não há índice vetorial por projeto, não há UI de
citação. A aba `sessions` de hoje é o Chat CONSULTIVO comum (RN-104) — um
agente respondendo com o contexto da sessão, igual ao Criativo, só que sem
produzir backlog. Rotulá-la "Chat RAG" hoje seria a mesma mentira que o ADR
0042 recusa para modelo de catálogo: anunciar uma capacidade antes de ela
existir, só porque o nome já está reservado no design.

**As quatro correções literais da moldura, sem exceção declarada:**

1. **Header como piso, não teto.** `.headerTop` (o cabeçalho de identidade do
   projeto — ícone do provider, nome, chip de repositório, branch/adotado — e
   o `TokenMeter` compacto) ganhou `min-height: var(--header-h)` (60px), não
   `height`. O conteúdo desta faixa é mais rico do que o cabeçalho genérico
   que o handoff desenha nas 6 telas internas (título 18/600 + subtítulo mono
   + chip + indicador): o card do `TokenMeter` sozinho, com o próprio padding
   interno, já soma cerca de 70px. Forçar 60px cortaria o alerta de
   orçamento — e a RN-088 já estabeleceu que falha/estado nunca vira
   invisível; cortar o orçamento por estética seria a mesma classe de erro
   com outro nome. `min-height` honra o token como PISO — quando o conteúdo é
   mais simples (sem `TokenMeter`, por exemplo, em carregamento), a faixa fica
   perto de 60px; quando não é, ela cresce, visível.
2. **Aba ativa com `box-shadow: inset 0 -2px 0 var(--accent)`**, não
   `border-bottom`, em `Tabs.module.css`. A diferença visual entre os dois é
   pequena, mas `border-bottom` desloca o layout em 2px na troca de estado
   (a borda ocupa espaço mesmo transparente-vs-sólida quando mal
   implementada) e o handoff é explícito no atributo. Os valores de
   espaçamento (`gap: 2px`, `padding: 11px 13px`) que viviam como override de
   CSS de descendente em `ProjectPage.module.css` — pendência declarada desde
   a FASE 16 ("quando ela puder mudar, o lugar disto é lá") — migraram para a
   primitiva, porque esta onda deu o mesmo dono aos dois arquivos.
3. **Rolagem horizontal** (`overflow-x: auto` em `.list`, `flex-shrink: 0` e
   `white-space: nowrap` em `.tab`) — não existia; a régua quebraria linha ou
   espremeria rótulos em telas estreitas.
4. **Largura máxima do container de conteúdo** — `.body` ganhou
   `max-width: 1040px; margin: 0 auto`, para as abas em forma de documento
   (Backlog, Aprovações, Insights, Gastos, Configurações, Criativo, Chat).
   Continua sem teto nas abas `semRespiro` (Visão geral, Código): a primeira
   tem um trilho lateral próprio, e a segunda é "a aba mais custosa do
   programa" nas palavras do próprio handoff — as duas usam a tela inteira
   de propósito.

**O rótulo "Code" virou "Código".** Nenhum outro ponto do código compara pela
STRING do rótulo (busca confirmada por grep); a CHAVE de registro e de
deep-link continua `code`, intocada.

## Consequências

**O registro de abas fica, deliberadamente, maior que a intenção original do
handoff — e cada item a mais tem RN e teste próprios apontados neste ADR.**
Quem ler só o handoff e comparar com o código vai ver uma divergência; quem
ler este ADR entende que ela é escolhida, não esquecida.

**Nenhuma FORMA de export mudou.** `AbaDoProjeto` continua com os mesmos
campos (`key`, `label`, `component`, `count?`, `ordem`, `semRespiro?`), e
`ABAS_DO_PROJETO` continua sendo o array ordenado que outros consumidores
(a Frente B do shell de navegação, em paralelo nesta mesma onda) leem para
listar as abas de um projeto na sidebar — só o VALOR do rótulo de `code`
mudou, e a lista de chaves não perdeu nem ganhou nenhuma.

**"Chat RAG" fica reservado, não cancelado.** Quando o pipeline de indexação e
a UI de citação existirem, a aba `sessions` deste registro é onde a
funcionalidade chega — o nome muda naquele dia, com o dado por trás dele.
Renomear antes seria a mesma classe de erro que o ADR 0042 já nomeou para
modelo: "ativar" a aparência de uma capacidade sem a capacidade.

**Fica de fora, declarado:** o dropdown rico de branch da aba Código, a UI de
blame e a lista de PRs (FASE 26b) não são tocados por este ADR — moldura é
sobre o CONTORNO das telas, não sobre o conteúdo interno de cada uma.
