# 0181 — O tema escuro vira preto neutro, e a dívida de contraste acaba

## Status

**Accepted.** 2026-09-30 (AT-283 e AT-284, história HS-073, épico EP-031,
rodada 29). Sobre o [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md) (o
tema alcançável, a medição nos dois temas, os oito papéis de sintaxe) e o
[ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) (a régua "o handoff estabelece a
intenção, a medição estabelece o número"). Não os edita: o MECANISMO do 0074
fica inteiro — o boot por arquivo, os dois temas medidos, a paridade derivada,
os oito `--syntax-*` —; o que muda é o NÚMERO de quase todo token de cor, e com
ele três coisas que o 0074 afirmava sobre o tema escuro.

## Context

O tema escuro era azul-petróleo saturado (`--surface-0` `#061b24`, matiz 198°,
saturação ~71%) com texto creme e acento terracota vivo (`#d6633a`). Decisão do
dono em 2026-09-30: o produto passa a ter o escuro **preto neutro** de mercado,
calmo, com o acento terracota **suave** (a identidade fica no acento, não na
superfície), e o claro vira o neutro da mesma família no lugar do papel de
areia.

Três fatos medidos pesavam antes da troca:

1. **O escuro carregava dívida de contraste desde a FASE 16.** Cinco pares em
   uso ficavam abaixo de 4,5:1 — `--text-muted` sobre `--surface-1` (3,89) e
   `--surface-2` (3,10), `--accent` e `--danger` sobre `--surface-1` (3,88), e
   `--success` sobre `--surface-2` (4,41). O 0074 os travou por número, e
   quatro telas mudaram de token para contornar (`.hint`, `.link`, o bloco de
   estado de ambiente, a navegação de erro do Shell).
2. **O botão primário tinha uma "exceção conhecida".** `--on-accent` (creme)
   sobre `--accent` dava 3,20:1 no escuro; o ADR 0036 recusou consertá-la
   porque "muda a marca em toda a UI". O mesmo creme sobre `--success` no
   `Button` dava 2,07:1.
3. **Cor fora dos tokens.** Três pontos que pintam com biblioteca de runtime
   (Mermaid, xterm, o canvas do minimapa) tinham 27 hex de fallback escritos à
   mão, no petróleo de antes, e o "person" do C4 usava a paleta BRUTA
   `--teal-400/600`. Três cores de agente eram hex soltos em `lib/agents.ts`,
   calibrados só contra o escuro. O overlay do `Modal` era o petróleo em
   `rgba`. E dois tokens usados não existiam: `--surface-3` e `--radius-pill`.

## Decision

**1. Os valores semânticos mudam; os nomes, não.** Nenhum módulo precisa
trocar referência: `--surface-*`, `--text-*`, `--accent*`, `--on-accent`,
estados, `--violet`, bordas, `--code-bg`, `--diff-*` e os oito `--syntax-*`
continuam com os mesmos nomes. Entra uma escala bruta **`--neutro-*`**
(`000`…`950`, zinco sem matiz) que as superfícies, o texto secundário e as
bordas dos dois temas referenciam; as quatro matrizes brutas antigas ficam
(ninguém as usa na UI, e tirá-las não compraria nada).

**2. O número sai da medição, não do rascunho.** O rascunho do dono foi o ponto
de partida; onde reprovava, o número foi ajustado até o piso passar:

| token (escuro) | rascunho | final | por quê |
|---|---|---|---|
| `--text-muted` | `#71717a` | `#86868f` | o rascunho repetia a dívida (3,80 / 3,51 sobre card e cabeçalho); o final mede 5,38 / 5,10 / 4,70 e continua abaixo do `--text-secondary` |
| `--on-accent` | (claro) | `--neutro-900` | branco sobre `#c8744f` daria 3,46 e 2,68 no hover; o preto neutro mede 5,61 / 7,25, e 7,65 sobre `--success`, 5,24 sobre `--danger` |

| token (claro) | rascunho | final | por quê |
|---|---|---|---|
| `--text-muted` | `#71717a` | `#696972` | o rascunho dava 4,40 sobre `--surface-2`, e o claro fecha texto em 4,5 desde o 0074 |

O resto do rascunho passou como veio: superfícies `#0d0d0f/#141417/#1c1c21`,
bordas `#2a2a30/#3a3a42`, texto `#ececef/#a1a1aa`, acento `#c8744f`, estados
`#3fb68b/#d4a13a/#e5534b`, `--code-bg` `#0a0a0c`; no claro `#ffffff/#fafafa/
#f4f4f5`, texto `#18181b/#52525b` e o terracota escurecido `#a4502c` (5,08
contra o `--code-bg`, 5,58 com o branco do botão). Os oito `--syntax-*` foram
recalculados contra os dois `--code-bg` novos e passam 4,5:1 nos dois temas
(o menor é o `--syntax-type` do claro, 4,85). O acento segue terracota: o
matiz fica em ~18° nos dois temas, e isso é cobrado por teste.

**3. A dívida do escuro acaba, e o que era número travado vira PISO.** Os cinco
pares da dívida passam 4,5:1 nos dois temas, e o teste agora cobra o piso em
vez de "continua em 3,89". As duas asserções INVERTIDAS de
`design-contraste.test.ts` ("muted reprova sobre card", "accent reprova sobre
card") foram reescritas como piso, e os consumidores revistos: `.link`
(AuthLayout) volta ao `--accent` que o mock sempre pediu; `.hint` (Input) fica
no `--text-secondary`, agora por hierarquia e não por contraste. A exceção do
botão primário deixa de existir, e o conserto não mudou a marca — mudou o
TEXTO sobre ela.

**4. Cor fora dos tokens entra nos tokens (AT-284).**

- `apps/web/src/lib/tokens-padrao.ts` guarda UMA cópia dos valores do tema
  primário para Mermaid, xterm e minimapa, e `tokens-padrao.test.ts` reprova
  quando ela diverge do `:root`. O "person" do C4 passa ao `--accent` sobre
  `--surface-1`.
- `--agent-leve`, `--agent-frontend` e `--agent-secops` nascem com valor por
  tema e são medidos a 3:1 nas três superfícies; `lib/agents.ts` passa a ter só
  `var(--token)`, e um teste reprova hex.
- `--overlay` é o véu do `Modal`, por tema.
- `--surface-3` e `--radius-pill` NÃO nascem: os dois usos caem no que já
  renderizavam (`--surface-1`/`--surface-2` e `--r-pill`), e
  `design-tokens-existentes.test.ts` reprova o próximo `var(--x)` sem
  declaração em CSS nem escrita em runtime.

## Consequences

- A lacuna "dívida de contraste do tema ESCURO travada por número (ADR 0074)"
  do `CLAUDE.md` fecha. A régua de nunca afrouxar piso continua, agora sem
  exceção registrada.
- Os 111 `color-mix()` dos módulos (AT-285) NÃO foram revistos aqui: eles
  misturam tokens e continuam válidos, mas o resultado visual de cada um muda
  com a base nova, e a revisão é da lane própria.
- Vários comentários de módulos CSS citam os números antigos da dívida
  (`Shell.module.css`, `SinaisDoAmbiente.module.css`, `ProjectCard.module.css`,
  `ProjectRail.module.css`, `TurnActivityStrip.module.css`,
  `Input.module.css` no placeholder). As escolhas que eles justificam seguem
  válidas; o número citado é histórico. Atualizá-los é da revisão dos módulos.
- O site de documentação (`website/src/css/custom.css`) tem paleta própria e
  não foi tocado.
- Os previews de `.design-sync` que dependem de contraste ficam inválidos até a
  próxima validação visual (a própria NOTES.md de lá diz isso).
