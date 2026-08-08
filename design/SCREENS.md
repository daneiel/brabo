# Telas — layout extraído do claude.ai/design

Mesma fonte de `COMPONENTS.md` (ver lá pra detalhes visuais dos
componentes citados abaixo). Este arquivo cobre a COMPOSIÇÃO de cada tela
— quais regiões existem, como se organizam, e o comportamento de estado
de cada uma.

## A referência viva é `design_handoff_brabo/` (desde 2026-08-08, FASE 16)

O handoff está **versionado no repositório**: um `README.md` com a
especificação completa (cores, tipografia, alturas, raios, transições, marca)
e oito `.dc.html` de alta fidelidade em `designs/`. Ele substitui o
`DesignSync(get_file)` como forma de reconferir um detalhe — a fonte não é
mais um serviço externo que pode sumir.

Os `.dc.html` são **referência de design, não código de produção**: estilos
inline por construção do protótipo, e `designs/support.js` é o runtime do
protótipo, que o README do handoff marca explicitamente como **não portar**.

Cobertura, comparada com este arquivo:

| arquivo do handoff | tela | composição escrita aqui |
|---|---|---|
| `Brabo Login.dc.html` | login e telas irmãs | sim — seção "Auth" |
| `Brabo App.dc.html` | lista de projetos | sim — "App shell + Dashboard" |
| `Brabo Project.dc.html` | visão de projeto | sim — "Projeto" |
| `Brabo Session.dc.html` | sessão com agentes | sim — "Sessão / Chat" |
| `Brabo Approvals.dc.html` | fila de aprovações | sim — "Aprovações" |
| `Brabo Settings.dc.html` | configurações (IA + IAM) | sim — "Configurações" |
| `Brabo Design System.dc.html` | fundação visual e componentes | é `COMPONENTS.md`, não tela |
| `Brabo Code.dc.html` | aba de código (IDE) | **não** — ver abaixo |

**Aba de código (IDE):** o handoff a especifica inteira (rail 48px, explorador
252px, editor com minimapa overlay de 64px, painel inferior, status bar 24px,
seletor de branch, realce de sintaxe). A composição **não** foi transcrita para
cá porque o terminal dessa tela virou decisão de arquitetura — container por
projeto, com a imagem decidida pelo Arquiteto — e escrever o layout antes da
decisão seria fixar uma tela que a decisão pode mover. Enquanto isso, a
referência é o `.dc.html`.

**Divergência de marca a resolver:** o handoff tem **um** símbolo, o monograma
B (ver `COMPONENTS.md`). O produto tem dois — o `LogoMark` das telas de auth,
que é o monograma, e o `BrandIcon` do app shell, que é um cubo isométrico sem
contraparte no handoff. Pendência declarada da fidelidade visual das telas, não
corrigida aqui: esta fase é fundação, e trocar o símbolo do shell mexe nas
telas.

## Divergências deliberadas de Projeto e Sessão (FASE 17b)

As duas telas foram reescritas contra `Brabo Project.dc.html` e
`Brabo Session.dc.html`. O que segue **não** foi portado, e cada item tem
motivo — a lista existe para que a próxima leitura do handoff não trate como
esquecimento o que foi decisão.

**O logo no cabeçalho da tela.** Os dois `.dc.html` abrem com o monograma de
30px (Projeto) e 28px (Sessão) seguido de uma divisória vertical. Os protótipos
são telas ISOLADAS, sem o shell; no produto as duas vivem dentro dele, e a marca
já está na sidebar. Repeti-la a 250px de distância é ruído, não fidelidade.

**Dados que não existem.** O cabeçalho do Projeto mostra a cadeia da política
(`dev → qa → rc → main`), o hash do commit corrente e `↑3 ↓1`; a barra da Sessão
mostra a duração (`24min`). Nada disso está no que a api devolve hoje —
`ProvisionedRepository` traz `defaultBranch` e mais nada de estado do repo. O
que existe é mostrado; o resto é pendência, não invenção.

**O estado vazio do time de agentes** ("Nenhum agente no time ainda" + botão
"Adicionar agentes") é **inalcançável** no produto: a presença de agente é uma
REGRA, não uma lista editável — `rosterFromFacts` sempre devolve pelo menos
Criativo, PO e Arquiteto. Um estado vazio que nenhum caminho produz é código
morto, e o botão prometeria uma ação que não existe.

**Blocos de código e de terminal dentro da bolha** (header com nome do arquivo,
corpo mono sobre `--code-bg`, badge `rtk −78%`) dependem de a resposta do agente
ser estruturada. Ela é texto hoje. Pendência.

**A cor do texto da bolha** fica em `--text-primary`, e o handoff pede
`--text-secondary`. O conteúdo da mensagem é a superfície de leitura mais densa
do produto, e o par `--text-secondary` sobre `--surface-1` fica na fronteira do
piso AA medido em `apps/web/src/lib/contraste.test.ts`.

**O selo numérico da régua de abas** continua sólido (`--accent` com
`--on-accent`), e o handoff o pede tingido (`--accent` a 18% com texto em
`--accent`). O tingido usa um par que já está na dívida de contraste registrada
(3,88:1), e o selo é texto de 10px.

**A régua de abas foi ajustada por CSS do chamador**, em
`ProjectPage.module.css`, e não na primitiva `components/ui/Tabs`: respiro por
aba (11px × 14px), 2px de intervalo e a divisória da lista desligada, porque
quem a desenha é o cabeçalho. O lugar disso é a primitiva — a régua do handoff
é a régua do design system, não a do Projeto. Migrar para lá é mudança de outro
dono, e continua pendente.

## App shell + Dashboard (`Brabo App.dc.html`)

Layout: `display:flex;height:100vh` — sidebar fixa (248px) + coluna
principal (`flex:1`).

**Sidebar** (`var(--surface-1)`, `border-right`): logo+nome no topo;
label "PROJETOS" (mono uppercase, muted); lista de projetos (nav, cada
item = dot de cor + nome mono truncado + badge de não-lidos condicional,
ativo = fundo `surface-2`); rodapé fixo com 2 botões ("Chat global",
"Configurações" — fora do escopo desta implementação, é navegação
global) + card do usuário logado (avatar gradiente com iniciais, nome +
`"{senioridade} · {papel}"`, chevron).

**Topbar** (60px, `border-bottom`): título "Projetos" à esquerda; busca
(input com ícone, 260px); `NotificationBell`; botão primary "+ Novo
projeto" (abre o wizard, ver `COMPONENTS.md`).

**Main**: linha de resumo (`"{N} projetos ativos · {N} agentes · R$ {X}
este mês"`, mono) + grid responsivo (`repeat(auto-fill, minmax(340px,1fr))`)
de `ProjectCard`.

**Notif dropdown**: ver `COMPONENTS.md` (`NotificationBell`) — abre
ancorado no topo direito, overlay invisível clicável fecha.

## Projeto — Visão geral (`Brabo Project.dc.html`)

Layout: header fixo + corpo com tabs; overview tem 2 colunas
(`flex:1` conteúdo + aside 360px fixo).

**Header**: ícone do provider + nome do projeto (Space Grotesk 700 20px)
+ badge `"{provider} · {visibilidade}"`; abaixo, metadata mono
(política de branch atual `dev → qa → rc → main`, hash do commit,
`↑N ↓N` ahead/behind); `TokenMeter` do projeto (variante com alerta
quando ≥90%, ver `COMPONENTS.md`) alinhado à direita; toggle
"ver estado vazio" (dev-only, pra visualizar o empty state).

**Tabs**: Visão geral / Sessões / Aprovações (badge com contagem de
pendentes) / Configurações. Sessões/Backlog aparecem no mockup mas o
conteúdo delas está fora do escopo desta tela (placeholder genérico
"Conteúdo desta aba fora do escopo desta tela" — nesta implementação,
Sessões vira uma tela real simples, ver plano; Backlog não existe no
pedido, omitir).

**Região "Time de agentes"** (área principal): header com contagem
(`"{N} agentes · {N} trabalhando · {N} aguardando"`); grid de
`AgentCard` (`repeat(auto-fill, minmax(300px,1fr))`) com o toggle de
autonomia manual/auto por card. Estado vazio (projeto recém-criado):
ilustração de ícone + título + texto + botão "Adicionar agentes"
(dashed border, centralizado).

**Aside "Atividade"**: header com contagem; select de filtro por agente
+ chips de filtro por tipo (ver `COMPONENTS.md` EventItem); lista
scrollável de `EventItem`; estado vazio com mensagem contextual.

## Sessão / Chat (`Brabo Session.dc.html`)

Layout: `flex-direction:column`, topbar (60px) + corpo (`flex:1` chat +
aside opcional 320px).

**Topbar**: dot pulsante verde + título da sessão + metadata mono
(`"{projeto} · #{id-curto} · {duração}"`); `ModelPicker` (dropdown,
trigger compacto); `TokenMeter` variante "ao vivo" (220px); botão
"Encerrar" (ghost, cor danger); botão de toggle do painel de contexto
(ícone de layout com coluna).

**Chat** (`max-width:780px`, centralizado): mensagens empilhadas
(`gap:20px`), cada uma = avatar (gradiente pro usuário; ícone geométrico
colorido por agente pros demais, ver paleta em `COMPONENTS.md`) + nome
(cor do agente) + meta (modelo · tempo) + bolha (`var(--surface-1)`,
`border-top-left-radius:2px` — cauda no canto superior esquerdo).
Conteúdo da bolha pode incluir, além de texto: bloco de código/diff
(header com nome do arquivo + badge "diff", corpo mono sobre
`var(--code-bg)`, linhas +/- coloridas) e bloco de terminal (header
"terminal · output" + badge opcional `rtk −N%` quando há compressão,
corpo mono). Divisor de handoff entre agentes: linha horizontal + pílula
central (`"{agente A} → passou o bastão ao {agente B}"`). `ApprovalCard`
aparece inline como mais uma "mensagem" quando uma ação `pending` chega
(mesmo componente da fila de Aprovações, variante compacta sem seleção
em lote). Indicador de digitação: avatar + 3 dots piscando em sequência
+ texto `"{agente} está aguardando aprovação…"` (ou "digitando", conforme
o estado real).

**Aside de contexto** (colapsável): 3 seções com header uppercase mono —
"Artefatos gerados" (lista de arquivo+ícone+autor), "Decisões
registradas" (lista com dot colorido + texto), "Arquivos tocados"
(lista estilo git status: letra M/A colorida + path + `+N −N`).

**Composer**: não detalhado explicitamente no mockup extraído (a
interação de digitar é implícita) — implementar como um input de texto
multi-linha fixo no rodapé do chat, estilo consistente com os outros
inputs (`COMPONENTS.md`), com botão de enviar; desabilitado durante
streaming.

## Aprovações (`Brabo Approvals.dc.html`)

Layout: coluna única, `max-width:960px` centralizada. Header do projeto
(mesmo padrão de nome+badge) + tabs (mesmas 5, "Aprovações" ativa).

**Seção "Pendentes"**: header com contagem + texto "ordenadas por
urgência"; barra de seleção em lote (aparece só com seleção ativa, ver
`COMPONENTS.md`) ou botão "Selecionar todas" (sem seleção); lista de
`ApprovalCard` (variante com checkbox + badge de urgência), ordenada
crítico→alta→normal; estado "tudo limpo" quando não há pendências (ícone
de check + mensagem).

**Seção "Permissões do projeto"**: header + subtítulo referenciando
`.brabo/permissions.json`; banner fixo de aviso (ícone + texto):
`"Ordem de avaliação: deny sempre vence allow, independente da ordem no
arquivo."` (`var(--warning)` de fundo suave, texto com `deny`/`allow`
destacados em `var(--danger)`/`var(--success)` mono); busca (input,
340px) filtrando por padrão/tipo/concedido-por; tabela densa de regras
(colunas: PADRÃO mono, TIPO badge allow/deny/ask, CONCEDIDO POR,
QUANDO, AÇÃO = botão de revogar por linha, ícone de lixeira, hover vira
vermelho). Revogar remove a linha da lista local (na implementação real:
remove o padrão do array correspondente — `allow`/`deny`/`ask` conforme
o TIPO da linha — e persiste via `PUT .../permissions`).

## Configurações (`Brabo Settings.dc.html`)

Layout: mesma estrutura de header+tabs (`max-width:1040px`), 2 seções.

**Seção "Modelos por agente"**: subtítulo explicando a cascata
(`global → projeto → agente`, cores muted/warning/accent respectivamente
— nota: no texto do mockup os rótulos usados são "global/projeto/agente",
mas o vocabulário real da API é `workspace/project/agent/session`; usar
o vocabulário real da API na implementação, mapeando visualmente pros
mesmos 3 níveis de cor + acrescentando "sessão" como 4º nível quando
aplicável); resumo de custo estimado do time (card com ícone de
relógio); tabela densa (AGENTE com avatar+nome, MODELO VIGENTE =
`ModelPicker` inline dropdown, ORIGEM = badge colorido pelo nível da
cascata, FALLBACK mono, EST. MÊS).

**Seção "Membros e papéis"**: subtítulo; barra de convite (input de
e-mail + select de papel + botão "Convidar"); tabela de membros
(MEMBRO = avatar gradiente+nome+email, PAPEL NO PROJETO = select inline,
STATUS = dot+texto "ativo"/"convite", ação = botão remover); matriz
resumida "Quem pode aprovar o quê" (tabela: tipo de ação × papel,
check/traço por célula) — linhas do mockup: Merge/abrir PR, Deploy em
produção, Comando privilegiado, Alterar schema/migração, Editar
permissions.json; colunas owner/maintainer/developer/viewer. Esta matriz
é ilustrativa/estática na implementação (reflete `MIN_ROLE_FOR_ACTION_TYPE`
do backend onde aplicável — terminal/git_commit≥developer,
git_push/pr_open≥maintainer, spend≥owner — mas as linhas "Merge/PR" e
"Editar permissions.json" não têm checagem de papel granular
implementada no backend hoje; manter a tabela como informativa, não
editável).

**Seção "Credenciais de provider"** (não estava explícita no mockup de
Settings extraído, mas faz parte do pedido — item 6): formulário
write-only por provider (Anthropic/OpenAI): campo de API key (nunca
preenchido de volta, só "Configurado em {data}" quando já existe uma
credencial salva) + botão salvar/remover. Seguir o mesmo padrão visual
de inputs/botões já documentado.

## Auth — Login e telas irmãs (`Brabo Login.dc.html`)

**Fonte diferente das cinco acima.** Este mockup foi criado no mesmo projeto
de design (`1c960ca8-5e00-4558-8ced-80dfbdf01027`) mas **depois** da extração
de 2026-07-23 — as telas de auth nasceram na Fase 7a sem mockup nenhum,
porque até o corte era o Keycloak que servia essa superfície. Extraído em
2026-07-30. Decisões e divergências no
[ADR 0036](../docs/adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md).

Quatro telas compartilham a moldura: `/login`, `/registrar`,
`/esqueci-senha`, `/definir-senha`.

### Moldura (vale para as quatro)

Página `min-height:100vh` flex centrado, `position:relative;
overflow:hidden`, fundo `var(--surface-0)`, padding vertical 32px / lateral
24px. Duas camadas decorativas, ambas `aria-hidden`:

- **grade**: `inset:0`, duas `linear-gradient` cruzadas de 1px em
  `var(--border)`, `background-size:64px 64px`, `opacity:.22` — o papel
  milimetrado que dá a leitura de ferramenta de engenharia;
- **brilho**: elipse 900×520 em `top:-160px`, centrada,
  `radial-gradient(closest-side, color-mix(in srgb, var(--success) 14%,
  transparent), transparent)`, cortada pelo `overflow` da página.

Container `max-width:412px`, entrada `bfade .4s ease both` (zerada em
`prefers-reduced-motion`, que mantém o estado final do keyframe).

**Cabeçalho de marca** (flex, gap 12px, `margin-bottom:26px`): selo 40×40
radius 11px em `var(--accent)` com o glyph 23px em `var(--on-accent)`
(`LogoMark` — barra vertical + dois chevrons, o segundo a `opacity:.58`;
é desenho DIFERENTE do `BrandIcon` do app shell, que é o cubo isométrico),
depois wordmark "Brabo" (Space Grotesk 700, 24px, `letter-spacing:-.035em`,
`line-height:1.1`) com a tagline abaixo (IBM Plex Mono 10px,
`letter-spacing:.12em`, uppercase, `var(--text-muted)`).

**Card**: `var(--surface-1)`, `1px var(--border)`, radius 12px,
`var(--shadow)`, `overflow:hidden` (é o que faz o rodapé respeitar o raio).
Três regiões:

1. **cabeça** — padding `26px 28px 8px`: `<h1>` (Space Grotesk 600, 19px,
   `letter-spacing:-.015em`) + subtítulo 13px `var(--text-secondary)`. O
   título do card é o **único `<h1>` da página**: "Brabo" é identidade, não
   cabeçalho, e promovê-lo daria dois `<h1>`;
2. **corpo** — padding `20px 28px 26px`, flex column gap 16px: o `Alert` de
   erro (quando houver) e o formulário, **irmãos, nunca aninhados**;
3. **rodapé** — `border-top 1px var(--border)`, fundo `var(--surface-0)` (um
   degrau abaixo do card), padding `14px 28px`, 12.5px
   `var(--text-secondary)` com um link para a tela vizinha.

**Bloco abaixo do card** (`margin-top:18px`): `Alert` fora do card, quando a
tela tem contexto a dar sobre a conta. Fica fora de propósito — dentro
competiria com o que a pessoa veio fazer.

**Rodapé da página** (`margin-top:22px`, flex centrado, gap 16px uniforme
entre os cinco filhos, IBM Plex Mono 10.5px `var(--text-muted)`):
`<versão> · Status · Documentação`. A versão é o valor **cru** do artefato —
`dev` fora de um release, e isso é informação verdadeira. "Status" é botão
(rota interna); "Documentação" é `<a target="_blank" rel="noreferrer">`.

### `/login`

Título "Entrar", subtítulo "Acesse seu workspace e retome as sessões em
andamento.". Campos: e-mail (placeholder `voce@empresa.com`) e senha
(`revelavel`, mono, placeholder `••••••••••`), os dois na variante
`preenchido`. "Esqueci minha senha" na linha do rótulo da senha, à direita.
Submit full-width com `loading` (`Entrar` → `Autenticando…`). Rodapé do card:
"Não tem acesso? **Criar uma conta**". Abaixo do card: aviso `warning` sobre
a conta migrada.

**Três coisas do mockup que a implementação não tem** (ADR 0036): o botão
"Continuar com GitHub" (login social é backlog da fase), o divisor "ou" (que
existia só para separar os dois botões) e o indicador "N agentes online" (dado
dinâmico pré-autenticação). Sem o indicador, o rodapé do card fica com um item
e o `space-between` do mockup vira alinhamento à esquerda.

### `/registrar`, `/esqueci-senha`, `/definir-senha`

Mesma moldura, mesmos componentes. Cada uma tem **estado de sucesso** que
substitui o formulário: um `Alert` tom `success` com `role="status"` (polido,
não interrompe — interromper para dar boa notícia é grosseria) mais um botão
de saída.

Os textos de sucesso são **condicionais de propósito** ("se o endereço estiver
disponível", "se houver uma conta com…"): a api responde igual para conta
existente e inexistente, e uma frase afirmativa aqui reabriria a enumeração
que o servidor fecha.

Erro de campo (senha curta, confirmação diferente) vai **sob o campo** com
`aria-invalid`; erro de formulário (credencial recusada, link inválido, falha
de rede) vai no **`Alert` do topo do card**. Quem lê a mensagem não deveria
precisar dela para saber onde mexer.
