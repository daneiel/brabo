# Checklist de confronto — design vs. código atual

Use este arquivo dentro do Claude Code para comparar o que **já existe** no seu
repositório com o que os designs em `designs/` especificam. Cada linha é uma
afirmação verificável: marque `[x]` quando o código atual já cumpre, anote a
divergência quando não.

Sugestão de prompt inicial no Claude Code:

> Leia `design_handoff_brabo/README.md`, `tokens.css` e este checklist.
> Para cada item, procure a implementação correspondente no repositório e
> responda em três colunas: **existe / divergente / ausente**, com o caminho do
> arquivo. Não altere código ainda — só produza o relatório de divergências.

Depois, para executar:

> Comece pelos itens marcados como *ausente* na ordem da seção
> "Ordem sugerida de implementação" do README. Um PR por seção.

---

## 0. Fundação

- [ ] Existe um único arquivo de tokens equivalente a `tokens.css` (nenhum hex solto em componentes).
- [ ] `data-theme` no elemento raiz, com `dark` como padrão.
- [ ] Tema persistido em `localStorage['brabo.theme']` e aplicado antes do primeiro paint (sem flash).
- [ ] Três famílias tipográficas carregadas: Space Grotesk (display), Archivo (corpo), IBM Plex Mono (código/metadados).
- [ ] Regra global de `a` / `a:hover` usando `--text-secondary` / `--text-primary`.
- [ ] Componente de logo (haste + 2 chevrons, chevron inferior a 58% de opacidade) reutilizável, em tile `--accent` com raio 9px.
- [ ] `::selection` = fundo `--accent`, texto `--on-accent`.
- [ ] Scrollbar customizada (`--border-strong`, raio 6px, borda 2px na cor da superfície).

## 1. Shell de navegação (`designs/brabo-sidebar.js`)

- [ ] Um único componente de layout envolve **todas** as telas autenticadas — nenhuma tela redesenha a navegação.
- [ ] Largura 264px expandido / 62px recolhido, transição `width .18s ease`.
- [ ] Marca no topo é link para a lista de projetos.
- [ ] Seção **Projetos**: lista expansível, N projetos abertos simultaneamente.
- [ ] Cada projeto exibe badge com o **total de últimas iterações**.
- [ ] Expandir um projeto revela suas abas: Criativo, Código, Chat RAG, Gastos, Aprovações, Configurações.
- [ ] Não existem itens de menu globais além de Projetos e Atividades (tudo é escopado a projeto).
- [ ] Seção **Atividades**: colapso por agente, com badge de nº de instâncias (quando > 1) e badge de total de interações.
- [ ] Agente com 1 instância abre direto nos eventos; agente com N instâncias abre um **segundo nível** por instância (`dev-backend-01`, `dev-backend-02`), cada um com sua contagem.
- [ ] Estado recolhido vira trilha de ícones: 1 quadrado por projeto (iniciais, borda na cor do projeto) + ícone de Atividades.
- [ ] Clicar num projeto na trilha reexpande a barra e abre aquele projeto.
- [ ] Botão de tema no rodapé (sol/lua + estado textual), funcional também recolhido.
- [ ] Botão "Recolher menu" no rodapé; cartão do usuário abaixo.

### Persistência esperada

| Chave | Conteúdo |
|---|---|
| `brabo.theme` | `'dark'` \| `'light'` |
| `brabo.sidebar.collapsed` | `'1'` \| `'0'` |
| `brabo.sidebar.open` | ids de projetos expandidos |
| `brabo.sidebar.agents` | ids de agentes/instâncias expandidos (`'dev'`, `'dev/dev-01'`) |
| `brabo.project` | projeto ativo |
| `brabo.tab` | aba do projeto ativa (persiste entre páginas) |

- [ ] A tela de **Código** monta o shell em modo auto-recolhido, **sem** gravar a preferência do usuário (ao sair, o estado anterior volta).

## 2. Moldura de tela (vale para todas as telas de projeto)

- [ ] Header de **60px**: título (Space Grotesk 18/600) + subtítulo mono 11px + chip do projeto + indicador de estado à direita. `overflow:hidden` na linha.
- [ ] Fileira de **abas do projeto** logo abaixo do header: Visão geral · Criativo · Código · Chat RAG · Gastos · Aprovações · Configurações.
- [ ] Aba ativa: `box-shadow: inset 0 -2px 0 var(--accent)`, peso 600, `--text-primary`. Inativa: peso 500, `--text-muted`.
- [ ] Abas com rolagem horizontal em larguras estreitas (`overflow-x:auto`, `white-space:nowrap`).
- [ ] Aprovações leva badge com nº de pendências na aba.
- [ ] Conteúdo em container com rolagem própria (`flex:1; overflow-y:auto; padding:24px`), largura máxima 960–1040px onde o design especifica.
- [ ] Nenhuma tela repete logo, wordmark ou navegação que o shell já fornece.

## 3. Telas

- [ ] **Login** — card centralizado, sem shell.
- [ ] **Projetos** (`Brabo App`) — grid de cards; card abre a visão do projeto.
- [ ] **Projeto** — visão geral com time de agentes ao vivo.
- [ ] **Criativo** — segmento *Sessão atual* ↔ *Todas as sessões* + botão "Nova sessão".
  - [ ] Lista: 4 KPIs (sessões, ativas, taxa ideação→commit, custo do mês), filtros (todas/ativas/fechadas/abortadas), cards com status, resumo, agentes participantes, tokens, custo, desfecho.
  - [ ] Estados de sessão: ativa (teal, ponto pulsante), aguardando (âmbar), fechada (neutro), abortada (vermelho).
- [ ] **Código** — file tree, editor com diff inline, terminal/problemas, blame, minimapa, status bar.
  - [ ] Realce de sintaxe via variáveis `--syn-*` (não hex fixo) — tema claro tem paleta própria.
- [ ] **Chat RAG** — segmento *Consulta atual* ↔ *Todas as sessões* + "Nova consulta".
  - [ ] Só consulta: a UI declara que nada é executado.
  - [ ] Respostas com citações numeradas + cards de trechos com score (verde ≥ 0.90) + trace da busca híbrida.
  - [ ] Lista: 4 KPIs + filtros (todas/minhas/abertas/de agentes) + tabela (escopo, autor pessoa-ou-agente, perguntas, trechos, custo, última atividade).
- [ ] **Gastos** — KPIs, barras diárias empilhadas por provider, quebras por provider/owner/modelo/agente/projeto, alertas de orçamento.
  - [ ] Barra de projeto muda de cor nos limiares 70% (warning) e 90% (danger).
  - [ ] Custo zero (modelos locais) sempre em `--success`.
- [ ] **Aprovações** — fila do humano no loop, diff com `--diff-add` / `--diff-del`, ações em lote.
- [ ] **Configurações** — repositório, execução, catálogo de IA agrupado por provider (com recomendação por capacidade) e IAM.

## 4. Comportamento

- [ ] Dropdowns: `bfade` .13s ease-out; fecham por overlay `position:fixed; inset:0` ou ao selecionar.
- [ ] Indicadores "ao vivo": ponto com `bpulse` 1.4–2.4s ease-in-out infinite.
- [ ] Estado de carregamento do RAG: 3 pontos com `bblink` 1s, defasagem .2s.
- [ ] Hover de card: só `border-color` → `--border-strong` (sem transform, sem sombra nova).
- [ ] Nenhuma cor de estado depende apenas de cor: sempre acompanha texto ou ícone.

## 5. Acessibilidade e contraste

- [ ] Contraste AA nos dois temas, inclusive nos chips derivados por `color-mix`.
- [ ] Alvos de toque ≥ 32px em desktop; ≥ 44px se houver versão touch.
- [ ] Foco visível em todos os controles (o protótipo usa `style-focus`; no codebase use `:focus-visible`).
- [ ] Botões de ícone sem rótulo têm `aria-label` / `title`.
- [ ] Colapsos usam `aria-expanded`; a trilha recolhida mantém rótulo acessível.

## 6. Dados que o backend precisa entregar

- [ ] Projetos: nome, cor, **contagem de últimas iterações**, consumo de tokens/custo, orçamento.
- [ ] Atividades: evento (texto, timestamp) → agente → **instância** do agente.
- [ ] Agentes: papel, status ao vivo (streaming/websocket), modelo vinculado, custo acumulado.
- [ ] Sessões criativas: status, resumo, participantes, tokens, custo, artefatos, decisões, arquivos tocados, desfecho.
- [ ] Sessões RAG: escopo consultado, autor (pessoa ou agente), nº de perguntas, chunks recuperados, custo, última atividade.
- [ ] Gastos: agregações por período × projeto × provider × modelo × owner × agente; orçamento por projeto; regras de alerta (`.brabo/budget.json`).
- [ ] RAG: cobertura do índice, fontes com nº de chunks, citações com score e localização (arquivo + linhas/seção).
- [ ] Aprovações: tipo, diff, autor-agente, risco, pendências por projeto.
