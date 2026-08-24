# 0051 — Facetas de capability provadas; "para que serve" é curadoria

## Contexto

O primeiro sync real do OpenRouter trouxe **338 modelos** para a tela de
curadoria. O agrupamento por fabricante (Fase 12, hub com subgrupos) tornou a
lista navegável, mas não respondeu à pergunta que se faz de verdade diante
dela: *qual destes serve para o que eu preciso agora?*

Duas descobertas, medidas contra a API viva, delimitam o problema.

**A primeira: o catálogo já publicava o que a tela não mostrava.** O parser
lia `id`, `name`, `context_length`, `pricing` e `supported_parameters` — e
descartava `architecture`. Pior, o sync nunca consultava o remoto para
capability de modalidade:

```ts
// sync-model-catalog.use-case.ts:202, antes
supportsVision: local?.supportsVision ?? false,
```

O valor saía do que já estava gravado, e o que estava gravado tinha nascido
`false`. Resultado: `supports_vision = false` nos 338, incluindo os modelos
cuja página inteira do provider se chama "vision". A coluna nascia falsa e
morria falsa — não havia caminho pelo qual ela pudesse virar verdadeira.

Contra o catálogo de 2026-08-04, o OpenRouter declara: **181** modelos aceitam
imagem na entrada, **11** produzem imagem, **213** aceitam `reasoning`, **25**
aceitam áudio, **0** produzem vídeo.

**A segunda: metade do que se quer filtrar não existe em catálogo nenhum.** O
pedido incluía "melhores IAs por tipo — documentar, imagem, vídeo, thinking,
code". Imagem e thinking o provider declara. "Melhor para código" e "bom para
documentação" **nenhum provider publica** — não há campo, não há convenção, não
há nada além do nome do modelo. E derivar capability do nome é exatamente o que
o [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
proíbe: capability só se declara quando a suite prova.

Vídeo é o caso extremo: zero modelos, em nove providers. Uma faceta de vídeo
seria um filtro que nunca casa nada.

## Decisão

**Os dois eixos existem, separados, e cada um mora onde sua verdade mora.**

### 1. Faceta de capability — o que o provider PROVA

Três campos novos em `models`, alimentados pelo catálogo remoto:

| campo | origem no OpenRouter |
|---|---|
| `supports_vision` | `architecture.input_modalities` contém `image` |
| `generates_image` | `architecture.output_modalities` contém `image` |
| `supports_reasoning` | `supported_parameters` contém `reasoning` |

Entrada e saída de imagem são **eixos distintos**, não um só: um modelo que lê
diagrama e um que desenha resolvem problemas diferentes, e fundi-los mandaria o
usuário para o modelo errado.

O sync passa a ler do remoto com fallback local, na mesma forma do
`supportsToolCalling`:

```ts
supportsVision: remoto.supportsVision ?? local?.supportsVision ?? false,
```

`undefined` no remoto preserva o local — **ausência de declaração não é
declaração de ausência**. O parser omite o campo quando o provider se cala, em
vez de emitir `false`; declarar `false` ali apagaria uma curadoria feita à mão
na primeira vez que o provider mudasse o formato do catálogo.

Áudio e vídeo ficam **de fora**: áudio porque nenhuma parte do produto o
consome hoje, vídeo porque não existe. Entram quando houver o que filtrar.

### 2. Curadoria por uso — o que o TIME descobriu

Vocabulário fechado de cinco usos — `codigo`, `documentacao`, `analise`,
`imagem`, `conversa` — marcado por workspace, na coluna `workspace_models.uses`
(`text[]`).

Mora em `workspace_models`, e não em `models`, pela mesma razão do
[ADR 0049](0049-curadoria-de-modelo-por-workspace.md): é **opinião de quem
opera**. O mesmo modelo é "o de código" num workspace e o de conversa barata em
outro, e quem paga a conta é quem tem o direito de decidir. Não há eixo global
porque não existe uma resposta global.

Vocabulário **fechado**, não texto livre: `code`, `coding`, `Code` e `código`
na mesma tela em uma semana produzem um filtro que não casa nada — pior que
filtro nenhum. Uso novo entra no tipo e ganha migração, com prova de
exaustividade em tempo de compilação dos dois lados (o mesmo mecanismo de
`llm-provider-names.ts`).

`text[]` e não enum do Postgres, como `delegations.area` da Fase 8: uso novo
não deve exigir migração de tipo.

### 3. Os dois eixos não se misturam na UI nem no banco

- Selo de faceta e selo de uso têm **tons diferentes** na linha do catálogo, e
  os chips de filtro ficam separados por um divisor.
- Marcar uso **não liga** o modelo no seletor. A coluna `is_active` tem DEFAULT
  `true`, então a linha nascida de uma marcação de uso é inserida com
  `isActive: false` explícito — sem isso, opinar sobre um modelo o autorizaria a
  gastar, contra a [RN-043](../business-rules.md#rn-043).
- Trocar o uso não desliga o que estava ligado: `is_active` fica fora do `SET`
  do `ON CONFLICT`.
- A tela nunca escreve "não lê imagem". Selo só afirma o que é verdade, porque
  `false` aqui quer dizer "o provider não declarou".

## Consequências

- A tela responde "qual modelo serve para isto" por dois caminhos: o que o
  provider prova e o que o time descobriu usando.
- Um filtro que zera a lista passa a ser distinguível de catálogo vazio — antes
  a tela diria "cadastre uma credencial" para quem já tem uma.
- O catálogo existente só ganha as facetas verdadeiras **no próximo sync**: a
  migração cria as colunas com `false`, e é o sync que as preenche a partir do
  remoto. Nenhum backfill é possível sem consultar o provider, e inventar valor
  seria o defeito original de novo.
- Os oito providers que não publicam modalidade seguem com `false` — honesto, e
  degradável assim que qualquer um deles passe a declarar.
- "Melhor para código" nunca será capability neste produto. Se um provider
  publicar um campo assim algum dia, ele será mais uma opinião — a dele — e não
  substitui a do time.

Três desenhos foram descartados, e o motivo de cada um é a consequência que
ficaria:

- **Inferir uso do nome do modelo** (`*-coder-*` → código): palpite vestido de
  dado. Erra no generalista bom em código, erra no que tem "coder" no nome e o
  time achou ruim, e ninguém que sabe consegue corrigir.
- **Uso global em `models`**: repetiria exatamente o defeito que o ADR 0049
  corrigiu — um workspace decidindo pelo vizinho.
- **Texto livre no uso**: fragmenta o vocabulário em uma semana e transforma o
  filtro em busca textual.

## O que fica para depois

**Faceta de áudio e de vídeo**, quando houver o que filtrar: áudio já tem 25
modelos no OpenRouter, mas nenhuma parte do produto consome áudio hoje; vídeo
tem zero em nove providers.

**Ordenar o catálogo por uso marcado** — hoje o uso só filtra. Com o
vocabulário travado, ordenar é uma linha; sem ninguém ter marcado nada,
ordenaria por lista vazia.

**As facetas nos outros oito providers.** Só o OpenRouter publica modalidade
hoje; cada um dos demais precisa ser investigado contra a doc oficial, como a
Fase 11 fez com os quirks — herdar o parser de um no outro é proibido.

As regras estão em [RN-056](../business-rules.md#rn-056) e
[RN-057](../business-rules.md#rn-057).
