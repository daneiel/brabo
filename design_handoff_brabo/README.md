# Handoff: Brabo — plataforma de orquestração de agentes de engenharia

## Overview
Brabo é uma plataforma SaaS técnica onde times de agentes de IA (Psicólogo, PO, Arquiteto, Dev Backend, Dev Frontend, Design Review, QA) executam trabalho de engenharia de software sobre um repositório Git real, com aprovação humana em pontos privilegiados (merge, deploy, comandos de terminal, migrações).

Este pacote contém 10 telas de alta fidelidade cobrindo: autenticação, lista de projetos, visão de projeto, sessão criativa (ideação → primeiro commit), aba de código no padrão IDE, dashboard de gastos, chat RAG do projeto, fila de aprovações e configurações (conectores de IA + IAM), além do documento vivo do design system.

Todas as telas compartilham um **shell de navegação** (`designs/brabo-sidebar.js`) — ver a seção *Navigation shell* abaixo.

**Como usar este pacote no Claude Code:**
1. `tokens.css` — fonte da verdade das cores, tipografia e métricas nos dois temas. Copie para o codebase e substitua hex soltos por variáveis.
2. `CHECKLIST-CONFRONTO.md` — checklist verificável para comparar o código atual com o design **antes** de escrever qualquer coisa. Peça ao Claude Code um relatório de divergências (existe / divergente / ausente) e só depois implemente.
3. `PROMPTS-CLAUDE-CODE.md` — a sequência de prompts recomendada (levantamento → plano → fundação → tela por tela).
4. `designs/*.dc.html` — os protótipos. Abrem direto no navegador; sirva a pasta (`npx serve designs`) para que a navegação entre telas funcione.
5. `screenshots/` — capturas para conferência rápida (índice em `screenshots/README.md`).

## About the Design Files
Os arquivos em `designs/` são **referências de design escritas em HTML** — protótipos que mostram aparência e comportamento pretendidos, **não código de produção para copiar**.

A tarefa é **recriar estes designs no ambiente já existente do codebase alvo** (React, Vue, Svelte, SwiftUI, nativo…), usando seus padrões, bibliotecas de componentes e convenções estabelecidas. Se ainda não existe ambiente, escolha o framework mais apropriado ao projeto e implemente lá. Não faça deploy do HTML.

Cada arquivo `.dc.html` abre direto no navegador. Estilos são inline por construção do protótipo — no codebase alvo use o sistema de estilos existente (CSS Modules, Tailwind, styled-components, tokens, o que já houver).

## Fidelity
**Alta fidelidade (hifi).** Cores, tipografia, espaçamento, estados e microinterações são finais. Recreie a UI com fidelidade visual usando as bibliotecas do codebase. As medidas abaixo são exatas e devem ser respeitadas.

---

## Design Tokens

### Cores (tema escuro — primário)
| Token | Hex | Uso |
|---|---|---|
| `surface-0` | `#061B24` | fundo da aplicação |
| `surface-1` | `#0A2E3D` | cards, sidebar, headers |
| `surface-2` | `#123F4E` | cabeçalho de tabela, hover, chips |
| `code-bg` | `#03141B` | editor, terminal, inputs |
| `border` | `#1C4A5A` | divisórias padrão |
| `border-strong` | `#2E6072` | divisórias em foco, scrollbar |
| `text-primary` | `#F5EDE0` | texto principal |
| `text-secondary` | `#AEC6CE` | texto de apoio |
| `text-muted` | `#6E8A94` | metadados, labels |
| `accent` (terracota) | `#D6633A` | ação primária, seleção, marca |
| `accent-hover` | `#E37B4E` | hover da ação primária |
| `on-accent` | `#F7EEE2` | texto sobre terracota |
| `success` (teal) | `#37B3A4` | ativo, adições, local/grátis |
| `warning` | `#E0982F` | atenção, arquivo modificado, cota |
| `danger` | `#E05A3E` | erro, remoções, destrutivo |
| `violet` | `#9C7BE0` | agentes/IA, ações de agente |

Sombra padrão: `0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.45)`. No login: `0 24px 60px rgba(0,0,0,.55)`.

### Cores (tema claro)
Ativado por `data-theme="light"` no elemento raiz. Mesmos nomes de token, valores diferentes — nenhum componente conhece hex.

| Token | Hex | Token | Hex |
|---|---|---|---|
| `surface-0` | `#F5EDE0` | `accent` | `#C4552D` |
| `surface-1` | `#FCF8F1` | `accent-hover` | `#A5451F` |
| `surface-2` | `#ECDDC7` | `on-accent` | `#F7EEE2` |
| `code-bg` | `#EFE4D2` | `success` | `#217E73` |
| `border` | `#DEC9AA` | `warning` | `#B5701C` |
| `border-strong` | `#C6AF8C` | `danger` | `#B33A26` |
| `text-primary` | `#0A2E3D` | `violet` | `#6B4FB0` |
| `text-secondary` | `#3C5A66` | `diff-add` | `#DCEBE2` |
| `text-muted` | `#80939A` | `diff-del` | `#F5DED7` |

Sombra clara: `0 1px 2px rgba(10,46,61,.08), 0 10px 28px rgba(10,46,61,.10)`.

**Realce de sintaxe** (tela de Código) também é tokenizado — `--syn-kw/fn/str/num/cm/txt/op/typ`, com valores próprios por tema. Ver `tokens.css`.

**Troca de tema:** botão no rodapé da barra lateral (ícone sol/lua + estado textual). Grava `localStorage['brabo.theme']` e escreve `data-theme` no `<html>`. Aplique o atributo antes do primeiro paint para não piscar. Login e o documento do design system respeitam o mesmo atributo.

Cores derivadas usam `color-mix(in srgb, <cor> N%, transparent)` — tipicamente 11–15% para fundos de chip e 34–45% para bordas de chip.

### Tipografia
- **Space Grotesk** — títulos, nomes de agentes/projetos, wordmark. Pesos 600/700. Títulos de seção 18px/600; H1 22px/700 letter-spacing −.02em; wordmark 700 letter-spacing −.045em.
- **Archivo** — corpo, labels, botões. Pesos 400/500/600. Corpo 13px, labels 12px, botão 13px/600.
- **IBM Plex Mono** — código, diffs, terminal, contadores de token, caminhos, chaves, IDs, badges de status. 10–13px. Labels de cabeçalho de tabela: 10px/600, letter-spacing .05em, uppercase.

Google Fonts: `Space+Grotesk:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600`

### Espaçamento e forma
- Grade de 8px. Padding de card 14–18px; padding de célula de tabela 10–11px × 14px.
- Raios: 4–5px (badge mono), 6–7px (input pequeno, botão de ícone), 8px (botão, input, card pequeno), 10–12px (card, tabela), 22px (tile de marca grande).
- Alturas: barra de topo 44px, aba de editor 36px, breadcrumb 28px, status bar 24px, linha de código 21px, input 42px, botão primário 44px (login) / 28–36px (denso).
- Transições: 120–130ms para cor/borda; `bfade` .13s ease-out para dropdowns; caret do terminal 1.05s step-end.

---

## Marca

Monograma **B**: haste vertical sólida + dois chevrons. De perto é a letra B; de longe lê-se `>>` — agentes avançando em cadeia. O chevron inferior fica a **58% de opacidade** = o handoff ainda em execução.

SVG canônico (viewBox 24×24, `fill:none`, `stroke-linecap/linejoin: round`):
```html
<path d="M5.4 3.6v16.8" stroke-width="3.4"/>
<path d="M10.4 4.6l5.6 3.8-5.6 3.8" stroke-width="2.8"/>
<path d="M10.4 12l5.6 3.8-5.6 3.8" stroke-width="2.8" opacity=".58"/>
```

Aplicação: tile terracota (`--accent`) com stroke `--on-accent`, raio ≈ 28% do lado (32px→9px, 40px→11px, 96px→22px). Tamanho mínimo 16px (nesse tamanho subir a opacidade do chevron inferior para .7). Variantes permitidas: tile terracota; terracota sobre superfície; teal sobre fundo escuro (estado ativo); monocromático. Nunca girar, esticar, contornar ou aplicar gradiente. Respiro mínimo = largura da haste (3.4 unidades da grade). Wordmark: Space Grotesk 700, letter-spacing −.045em.

---

## Screens / Views

### 1. Login — `designs/Brabo Login.dc.html`
**Propósito:** autenticar no workspace.

**Layout:** viewport centralizado, card de `max-width: 412px`. Fundo `surface-0` com grid de 64px (`linear-gradient(border 1px, transparent 1px)` nos dois eixos, opacidade .22) e um brilho radial teal (900×520px, `rgba(55,179,164,.14)`) atrás do topo. Card entra com `bfade` .4s.

**Componentes:**
- Lockup acima do card: tile 40px do logo + "Brabo" (Space Grotesk 700, 24px) e sublinha mono 10px uppercase "orquestração de agentes".
- Card `surface-1`, borda `border`, raio 12px, sombra grande. Cabeçalho "Entrar" (Space Grotesk 600, 19px) + subtítulo 13px `text-secondary`.
- Campo e-mail: label 12px/500, input 42px, fundo `code-bg`, borda `border`, raio 8px. Foco: borda `border-strong` + `box-shadow 0 0 0 3px rgba(214,99,58,.18)`.
- Campo senha: mesmo estilo, fonte IBM Plex Mono 13.5px, botão-olho 32px absoluto à direita alterna `type` password/text. Link "Esqueci minha senha" alinhado à direita do label.
- Botão primário 44px terracota, mostra spinner (borda 2px girando, .7s linear) + label "Autenticando…" durante loading.
- Divisor "ou" com linhas e label mono 10px uppercase.
- Botão secundário GitHub: 42px, `surface-2`, borda `border-strong`, ícone GitHub 17px.
- Rodapé do card (`surface-0`, borda superior): "Criar uma conta" + indicador pulsante teal "12 agentes online".
- Aviso abaixo do card: borda esquerda 2px `warning`, ícone triângulo, texto sobre senha não migrada.
- Rodapé: `v2.4.1 · Status · Documentação` em mono 10.5px.

**Validação:** e-mail precisa conter "@" → "Informe um e-mail válido do workspace."; senha < 8 caracteres → "A senha precisa ter no mínimo 8 caracteres." Erro aparece como faixa `rgba(224,90,62,.1)` com borda `rgba(224,90,62,.4)` no topo do formulário e limpa ao digitar. Submit válido → loading 1.6s.

---

### 2. Design System — `designs/Brabo Design System.dc.html`
Documentação viva: seção **00 · Marca** (símbolo, construção na grade de 24, escala mínima, variantes), escalas de cor, tipografia, componentes base com todos os estados, e componentes de domínio (AgentCard, TokenMeter, ApprovalCard). Use como fonte de verdade visual ao implementar.

---

### 3. App / lista de projetos — `designs/Brabo App.dc.html`
**Propósito:** entrada no produto; escolher projeto ou criar um novo.

**Layout:** sidebar fixa de 248px (`surface-1`) + área principal em grid de cards.

**Componentes:** logo 32px no topo da sidebar; navegação; grid de projetos, cada card com nome, repositório, agentes ativos e **TokenMeter** (barra com limiares visuais em 70% / 90% / 100% e economia por compressão destacada em verde); sino de notificações; modal "Novo projeto" em 4 passos com templates de política de branch (Gitflow como padrão).

---

### 4. Projeto — `designs/Brabo Project.dc.html`
**Propósito:** operar um projeto: quem está trabalhando e no quê.

**Layout:** header (logo 30px + divisória 1px + tile do repositório + nome) → 3 regiões: navegação/contexto, grid do time de agentes, feed de atividade de 360px à direita com borda esquerda.

**Componentes:** cards de agente com status ao vivo, modelo vinculado, contador de tokens e toggle de autonomia; feed com filtros; estado vazio.

---

### 5. Criativo — `designs/Brabo Criativo.dc.html`
**Propósito:** a conversa que sai da ideação e chega ao primeiro commit. Antes chamada "Sessão"; renomeada porque o valor da tela é a ideação virando trabalho, não o registro do chat.

**Layout:** barra de topo (contexto da ideação com indicador pulsante) → coluna de mensagens → painel de contexto colapsável à direita ("Contexto da ideação").

**Componentes:** mensagens de agente com avatar e cor própria; blocos de código e terminal em IBM Plex Mono sobre `code-bg`; marcadores de handoff entre agentes; **ApprovalCard** inline; painel de contexto colapsável.

---

### 5b. Gastos — `designs/Brabo Gastos.dc.html`
**Propósito:** onde o dinheiro e os tokens estão sendo gastos, por qual eixo.

**Layout:** header com título, seletor de período (7 dias / 30 dias / trimestre / ano), Exportar CSV e Definir orçamento → linha de chips de escopo por projeto → conteúdo em cards.

**Blocos, em ordem:**
1. **KPIs** (grid `auto-fit minmax(210px,1fr)`): gasto total, tokens consumidos, economia com modelos locais, custo médio por sessão, agentes ativos. Cada um com delta colorido (danger = subiu, success = caiu, neutro = estável) e sublinha de contexto.
2. **Gasto diário por provider** — 30 barras empilhadas (Anthropic terracota, OpenAI teal, Google violeta, Ollama cinza), legenda no topo, eixo de datas embaixo.
3. **Por provider** — barra de proporção por provider com tokens, custo, % do total e os modelos/chaves envolvidos. Ollama sempre R$ 0,00 em verde.
4. **Por owner** — avatar em gradiente, papel, barra de consumo e nº de sessões. Inclui a service account do CI.
5. **Por modelo** — tabela `2fr 1fr 1fr 1fr 1fr 1.2fr`: modelo (+papel que ele serve), tokens de entrada, de saída, requisições, R$/1M e custo.
6. **Por agente** — custo acumulado por papel no time, com nº de sessões.
7. **Por projeto** — consumo contra o orçamento, com barra que muda de cor nos limiares 70% (warning) e 90% (danger).
8. **Alertas de custo** — regras vindas de `.brabo/budget.json`: orçamento em 90%, modelo dominando o gasto, owner acima da média, economia obtida com local.

**Estado:** `{ period, scope }`. Ambos apenas filtram — o dado real vem de agregações do backend por período/projeto.

---

### 5c. Chat RAG — `designs/Brabo Chat.dc.html`
**Propósito:** consultar o conhecimento do projeto. **Só consulta — não executa ações**; isso é dito explicitamente na UI para separá-la do Criativo.

**Layout:** coluna de consultas 236px → conversa (max-width 760px, centralizada) → painel "Base de conhecimento" 320px colapsável.

**Componentes:**
- Header: título + "RAG · somente consulta", chip do projeto, selo teal "índice atualizado · há 12min", contagem `1.284 chunks · 46 fontes`, botão de toggle do painel.
- Resposta do RAG: avatar de lupa em accent@16%, meta `gpt-4o-mini · 6 chunks · 0,42s`, faixa de trace da busca ("busca híbrida · embeddings + BM25 · limiar 0,78" + `6/1.284 chunks`), corpo com marcadores de citação `[1] [2] [3]` em superscript terracota.
- **Trechos usados:** cards com número da citação, arquivo/origem, localização (linhas ou seção), excerto e score (verde ≥ 0.90).
- Ações: copiar, útil, e custo da resposta em mono.
- Estado "recuperando trechos da base…" com três pontos piscando (`bblink` 1s, defasagem .2s).
- Sugestões de pergunta em chips arredondados; chips de escopo da busca (docs / ADRs / sessões / código / PRs) alternáveis; nota "consulta · não executa ações" ao lado do botão Perguntar.
- Painel: cobertura do índice (barra + % + arquivos fora), fontes indexadas com nº de chunks, perguntas frequentes do time com contagem, botão Reindexar agora.

**Estado:** `{ panelOpen, thread, draft, scopes[] }`.

---

### 6. Aprovações — `designs/Brabo Approvals.dc.html`
**Propósito:** fila do humano no loop.

**Layout:** breadcrumb (logo 28px + "Brabo" / "brabo-api") → fila agrupada por urgência.

**Componentes:** ApprovalCard com diff colapsável (`+` verde / `−` vermelho, formato unificado mono); ações em lote; tabela de regras editável representando `permissions.json`.

---

### 7. Configurações — `designs/Brabo Settings.dc.html`
**Propósito:** repositório, execução, catálogo de IA e IAM.

**Seções, em ordem:**

1. **Repositório** — caminho do bare repo em mono, branch, selo "sincronizado" teal.
2. **Execução** — circuit breaker: "Tasks blocked seguidas até parar", input mono 150px + botão Salvar. Hint muda entre "Sem valor próprio — usa o default (3)" e "Valor próprio do projeto · default 3".
3. **Promoção de histórias** — select: Automática (o PO promove) / Manual (você promove) / Automática com revisão do Arquiteto. As validações são idênticas nos três; muda só quem dispara.
4. **Conectores de IA** — grid `repeat(auto-fill, minmax(300px, 1fr))`, gap 12px. Cada card tem borda esquerda 2px na cor do conector, chip com sigla de 2 letras, nome, tipo (`credencial de provider` vs `runtime local`), status pulsante, credencial mascarada em mono sobre `code-bg`, chips de capacidade e rodapé com contagem de modelos + link "gerenciar".
   - Ollama · runtime local · `http://127.0.0.1:11434` · teal · ativo · "no disco · 42 GB"
   - Anthropic · `sk-ant-api03-••••••••7f2c` · terracota · ativo · "org · brabo-dev"
   - OpenAI · `sk-proj-••••••••a91d` · teal claro · ativo · "projeto · brabo"
   - Google AI · `AIza••••••••kQ4` · violeta · **cota 78%** (warning) · "free tier"
5. **Melhores modelos por capacidade** — tabela `1.15fr 1.5fr 1.35fr .8fr 1.5fr`: capacidade, recomendado, alternativa, score, usado por.
6. **Modelos por agente** — tabela `1.4fr 1.9fr .8fr 1.4fr .9fr` com seletor de modelo em dropdown agrupado (ver abaixo), badge de origem da cascata, fallback e custo estimado. Acima, faixa com custo mensal total do time.
7. **Membros e papéis (IAM)** — convite por e-mail + select de papel + botão Convidar; tabela de membros com avatar em gradiente, select de papel colorido por papel, status e botão remover; matriz "quem pode aprovar o quê" com ✓/— por papel.

**Capacidades (chips):** código `#37B3A4` · imagem `#9C7BE0` · design `#D6633A` · chat `#5EBEB1` · docs `#E0982F`. Chip: fundo cor@13%, borda cor@34%, mono 9–9.5px uppercase, raio 4px.

**Catálogo de modelos (dados):**
| Modelo | Conector | Capacidades | Custo/mês est. |
|---|---|---|---|
| qwen2.5-coder:14b | Ollama (local) | código | grátis |
| llama3.1:8b | Ollama (local) | chat, docs | grátis |
| llava:13b | Ollama (local) | imagem | grátis |
| deepseek-r1:8b | Ollama (local) | código, docs | grátis |
| claude-sonnet-4 | Anthropic | código, design, docs, imagem | R$ 18 |
| claude-haiku-4 | Anthropic | chat, docs | R$ 4,80 |
| gpt-4o | OpenAI | imagem, chat, design | R$ 15 |
| o3-mini | OpenAI | código | R$ 9,20 |
| gemini-2.5-pro | Google AI | docs, imagem, código | R$ 11 |

**Ranking por capacidade:** código → claude-sonnet-4 / qwen2.5-coder:14b (9.4) · imagem → gpt-4o / llava:13b (9.1) · design → claude-sonnet-4 / sem cobertura local (8.7) · chat → claude-haiku-4 / llama3.1:8b (8.9) · docs → gemini-2.5-pro / deepseek-r1:8b (9.0).

**Agentes e bindings:** Psicólogo (chat, docs → claude-sonnet-4, origem agente, fallback claude-haiku-4, R$ 84,20) · PO (docs, chat → claude-haiku-4, projeto, llama3.1:8b, R$ 41,00) · Arquiteto (código, docs → claude-sonnet-4, global, gpt-4o, R$ 132,40) · Dev Backend (código → qwen2.5-coder:14b, agente, claude-sonnet-4, R$ 0,00) · Dev Frontend (código, design → claude-sonnet-4, projeto, claude-haiku-4, R$ 96,30) · Design Review (design, imagem → gpt-4o, agente, claude-sonnet-4, R$ 52,80) · QA (código, imagem → claude-haiku-4, global, llama3.1:8b, R$ 28,50). Total: R$ 640,10 · US$ 116.

**Cascata de origem:** `global` (`text-muted`) → `projeto` (`warning`) → `agente` (`accent`). O mais específico vence; escolher um modelo diferente do default promove a origem para `agente`.

**Dropdown de modelo:** abre abaixo do botão, largura da célula, `max-height: 420px` com scroll, overlay `position:fixed; inset:0` para fechar ao clicar fora. Cabeçalho mostra o modo de agrupamento e "exige: <capacidades do agente>". Cada grupo tem faixa `surface-2` com ponto colorido + nome + meta. Cada opção: radio, nome do modelo, sublinha com capacidades + conector, badge verde **ideal** quando o modelo cobre todas as capacidades exigidas, e custo (verde quando local).

**Matriz de aprovação:** Merge/abrir PR → owner, maintainer, developer. Deploy em produção / comando privilegiado / alterar schema → owner, maintainer. Adicionar credencial de provider / editar permissions.json → só owner.

---

### 8. Código (IDE) — `designs/Brabo Code.dc.html`
**Propósito:** ler o código que os agentes estão escrevendo, ver a branch e operar o terminal.

**Layout (altura de viewport, sem scroll externo):**
```
┌─ barra de topo 44px: logo · abas · seletor de branch · Abrir PR ─┐
├─ rail 48px ─┬─ explorador 252px ─┬─ editor (flex) ───────────────┤
│             │                    │  abas 36px                    │
│             │                    │  breadcrumb 28px              │
│             │                    │  código (scroll x/y) + minimap│
│             │                    │  painel inferior 180/236/300px│
├─ status bar 24px ────────────────────────────────────────────────┤
```

**Seletor de branch:** botão `surface-2` 28px com ícone de branch teal, nome em mono 11.5px, contador `+4 −2` em warning, chevron. Dropdown 330px com cabeçalho "gitflow · brabo-api" e as branches: `feature/refresh-grace` (atual, +4 −2, terracota) · `develop` (atrás 3, teal) · `main` (protegida, teal) · `release/2.4` (congelada, warning) · `hotfix/token-leak` (PR #218, violeta). Também abre pelo botão terracota da status bar.

**Rail de atividade:** Explorador, Buscar, Controle de versão (badge 3), Agentes (badge 2), Testes. Ativo = fundo accent@12%, ícone terracota, barra de 2px à esquerda. Trocar de item muda o título do painel do explorador.

**Explorador:** árvore com indentação de 13px por nível, ícone de pasta warning / arquivo, letra de status à direita (M warning, A success). Arquivo ativo: fundo accent@12% + borda esquerda terracota. Rodapé fixo: ponto teal pulsante + "Dev Backend editando session.py" + "qwen2.5-coder:14b · local · 3.1k tokens".

**Abas do editor:** borda superior de 2px terracota na aba ativa, fundo `code-bg`, ponto colorido de estado (warning = modificado, success = novo). Botão "dividir editor" à direita.

**Área de código:** container `position: relative`; scroller absoluto com `overflow:auto` e `padding-right: 64px`; minimapa é overlay absoluto de 64px na direita (`pointer-events:none`). Cada linha: `width: max-content; min-width: 100%`, altura 21px, gutter de número 52px alinhado à direita, coluna de sinal 14px, tokens em spans `white-space: pre` dentro de flex nowrap, e coluna de blame de 170px com `margin-left: auto`. Linhas adicionadas: fundo success@11% + borda esquerda 2px success; removidas: danger@11% + borda danger.

**Syntax highlighting:** keyword `#D6633A` · função `#5EBEB1` · string `#E0982F` · número/decorator `#9C7BE0` · comentário `#5C7A85` · tipo/classe `#37B3A4` · operador `#8FB0BA` · texto `#DCE9ED`.

**Arquivos de exemplo:** `src/auth/session.py` (diff da janela de graça no refresh token), `src/auth/store.py`, `tests/test_session.py` (teste novo). Clicar na árvore troca o arquivo e adiciona a aba.

**Painel inferior:** abas terminal / problemas (badge 3 vermelho) / diff (badge 6) / saída; à direita "zsh · brabo-api · pid 4821" e botões novo terminal / maximizar (58% da altura) / fechar. Conteúdo em mono 12px, linha 19px, prefixos coloridos: `$` verde (comando), `⟩` violeta (ação de agente), `+`/`−` verde/vermelho. Linha final tem prompt + comando digitado + caret terracota 7×14px piscando (1.05s step-end).

O terminal mostra a narrativa central do produto: o agente pediu `git push origin feature/refresh-grace` e o sistema respondeu "aguardando aprovação — comando privilegiado (maintainer+)".

**Status bar 24px:** botão de branch terracota · `↑1 ↓0` · `● 1 ▲ 2` (danger) · `✓ 3 testes` · [flex] · posição do cursor · UTF-8 · linguagem · toggle do painel · "2 agentes ativos" com ponto teal pulsante.

---

## Sub-navegação de sessões (Criativo e Chat RAG)

Ambas as telas alternam entre a sessão aberta e o histórico completo, por um segmento no topo do conteúdo (não é aba de projeto — vive **abaixo** da fileira de abas):

```
[ Sessão atual | Todas as sessões ]   texto de contexto        [ + Nova sessão ]
```

Segmento: contêiner `surface-1` + borda, raio 8px, padding 2px; item ativo com fundo `surface-2`, peso 600, `text-primary`; inativo `text-muted`. Fonte mono 12px.

**Criativo → Todas as sessões**
- 4 KPIs (`auto-fit minmax(190px,1fr)`): sessões no projeto, ativas agora, taxa ideação→commit, custo do mês.
- Filtros pill: todas / ativas / fechadas / abortadas.
- Cards de sessão: selo de status (ativa teal com ponto pulsante · aguardando âmbar · fechada neutra · abortada vermelha), título 15/600, id mono à direita, resumo (`max-width:92ch`, `text-wrap:pretty`), chips dos agentes participantes, tokens + duração, custo, e rodapé com artefatos / decisões / arquivos tocados / desfecho colorido. Card de sessão ativa tem borda teal a 30%.
- Clicar num card abre aquela sessão.

**Chat RAG → Todas as sessões**
- 4 KPIs: sessões de consulta, perguntas respondidas, % de respostas com citação, custo do mês.
- Filtros pill: todas / minhas / abertas / de agentes.
- Tabela `2.4fr 1fr .8fr .8fr .9fr 1fr`: sessão (título + escopo consultado, ponto verde se aberta), autor (avatar de iniciais — pessoa **ou** agente), nº de perguntas, chunks recuperados, custo, última atividade.
- Nota de rodapé reforçando que consultas não alteram o projeto.

## Navigation shell

Componente compartilhado por todas as telas autenticadas — `designs/brabo-sidebar.js`, um web component `<brabo-sidebar active="…" project="…" [auto-collapse]>`. No codebase alvo, implemente como um layout/shell único; não duplique a navegação por tela.

**Estrutura (264px expandido, 62px recolhido):**
1. **Marca** — tile do logo + wordmark, é um link para a lista de projetos.
2. **Projetos** — lista expansível. Vários projetos podem ficar abertos ao mesmo tempo (1 ou N). Cada linha: chevron, ponto de cor do projeto, nome em mono e **badge com o total de últimas iterações**. Ao expandir, mostra as **abas daquele projeto**: Criativo, Código, Chat RAG, Gastos, Aprovações, Configurações. Não existem itens globais além de Projetos e Atividades — tudo é escopado a um projeto.
3. **Atividades** — colapsos por agente. Cada agente mostra ponto de cor, nome, badge de nº de instâncias (quando > 1) e badge de total de interações. Abrir um agente com **uma** instância revela seus eventos direto; um agente com **várias** instâncias (Dev Backend, QA) revela um segundo nível de colapso, uma linha por instância (`dev-backend-01`, `dev-backend-02`) com sua própria contagem, e os eventos abrem dentro dela.
4. **Rodapé** — botão "Recolher menu" e o cartão do usuário.

**Recolhido:** vira trilha de ícones — um quadrado por projeto com as iniciais (borda na cor do projeto) mais um ícone de Atividades. Clicar em um projeto na trilha reexpande a barra e abre aquele projeto.

**Persistência (localStorage):**
| Chave | Conteúdo |
|---|---|
| `brabo.sidebar.collapsed` | `'1'`/`'0'` — preferência de colapso do usuário |
| `brabo.sidebar.open` | ids dos projetos expandidos |
| `brabo.sidebar.agents` | ids de agentes/instâncias expandidos (`'dev'`, `'dev/dev-01'`) |
| `brabo.project` | projeto ativo |
| `brabo.tab` | aba do projeto ativa — persiste entre as páginas do dashboard |

**Auto-collapse:** a tela de Código monta o shell com `auto-collapse`, então a barra abre recolhida para dar largura ao editor. Isso **não** grava a preferência do usuário — ao sair do Código, o estado anterior volta.

**Abas do projeto:** todas as telas de projeto (Visão geral, Criativo, Código, Chat RAG, Gastos, Aprovações, Configurações) repetem a mesma fileira de abas, com a ativa marcada por borda inferior terracota de 2px (barra compacta com fundo `surface-2` na tela de Código). Aprovações leva badge com o nº de pendências.

## Interactions & Behavior

- **Dropdowns** (branch, modelo por agente): abrem com `bfade` .13s ease-out; fecham por clique no overlay `position:fixed; inset:0` ou ao selecionar.
- **Hover:** linhas de tabela → `surface-1`; botões de ícone → `surface-2`; botão primário → `accent-hover`; botão remover → borda e ícone `danger`. Todos 120ms.
- **Foco em input:** borda `accent` + `box-shadow 0 0 0 3px color-mix(in srgb, accent 22%, transparent)`.
- **Pulsos ao vivo:** `bpulse` 2.4s ease-in-out infinite (opacidade 1 → .35) em todos os pontos de status.
- **Loading:** spinner circular .7s linear; botão troca o label.
- **Navegação:** árvore de arquivos → troca arquivo + abre aba; abas → troca arquivo; rail → troca painel do explorador; status bar → abre/fecha painel e abre seletor de branch.

## State Management
- **Login:** `{ email, senha, showPw, loading, error }`.
- **Configurações:** `{ open: agentId|null, bindings: {agentId: modelId}, invite, breaker }`. Bindings sobrescrevem o default do agente e promovem a origem para `agente`.
- **Código:** `{ file, tabs[], branch, branchOpen, panelOpen, panelTab, maxed, rail }`.

**Dados a buscar do backend:** lista de projetos + consumo de tokens; time de agentes com status ao vivo (streaming/websocket); catálogo de modelos por conector (o catálogo remoto vem da credencial; o local vem do `/api/tags` do Ollama); bindings resolvidos por cascata; fila de aprovações; árvore de arquivos e conteúdo por branch; stream do terminal; membros e papéis.

## Assets
Nenhum binário no produto (as imagens em `screenshots/` são só referência de conferência). Todos os ícones são SVG inline de traço 1.6–2.0, 24×24, `stroke-linecap/linejoin: round` — trocáveis por qualquer biblioteca outline equivalente (Lucide combina bem). O único asset de marca é o monograma B documentado acima; recrie-o como componente e não o rasterize.

## Files
| Arquivo | Conteúdo |
|---|---|
| `tokens.css` | tokens dos dois temas — **portar primeiro** |
| `PROMPTS-CLAUDE-CODE.md` | sequência de prompts para planejar e executar |
| `screenshots/` | capturas das 10 telas (dark + light) |
| `CHECKLIST-CONFRONTO.md` | checklist de divergências design × código atual |
| `designs/Brabo Design System.dc.html` | fundação visual e componentes |
| `designs/Brabo Login.dc.html` | login |
| `designs/Brabo App.dc.html` | lista de projetos |
| `designs/Brabo Project.dc.html` | visão de projeto |
| `designs/Brabo Criativo.dc.html` | criativo — ideação → primeiro commit |
| `designs/Brabo Gastos.dc.html` | dashboard de gastos |
| `designs/Brabo Chat.dc.html` | chat RAG do projeto |
| `designs/Brabo Approvals.dc.html` | fila de aprovações |
| `designs/Brabo Settings.dc.html` | configurações (IA + IAM) |
| `designs/Brabo Code.dc.html` | aba de código (IDE) |
| `designs/brabo-sidebar.js` | shell de navegação compartilhado — **portar como layout** |
| `designs/support.js` | runtime do protótipo — **não portar** |

## Ordem sugerida de implementação
1. Tokens (`tokens.css`, dois temas) + tipografia + componente do logo + troca de tema no root.
2. Login (isolado, valida o sistema de tokens ponta a ponta).
3. Shell de navegação (sidebar com projetos/atividades, colapso persistido, abas do projeto) + lista de projetos.
4. Visão de projeto e Criativo (dependem de status ao vivo).
5. Configurações e Gastos (mais estado, sem tempo real).
6. Chat RAG (depende do pipeline de indexação e do retorno de citações).
7. Aba de código (a mais custosa: virtualização de linhas, syntax highlighting, stream do terminal).
