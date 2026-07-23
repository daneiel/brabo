# Telas — layout extraído do claude.ai/design

Mesma fonte de `COMPONENTS.md` (ver lá pra detalhes visuais dos
componentes citados abaixo). Este arquivo cobre a COMPOSIÇÃO de cada tela
— quais regiões existem, como se organizam, e o comportamento de estado
de cada uma.

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
