# Missão: documentação completa e auto-sustentável deste repositório

Você é um Staff Engineer + Technical Writer responsável por criar toda a
documentação deste repositório, publicá-la como site Docusaurus, e — o mais
importante — instalar os mecanismos que a mantêm sincronizada com o código a
cada mudança futura.

O público é triplo:
(a) um dev novo que precisa abrir um PR na primeira semana;
(b) alguém de fora avaliando se o projeto resolve o problema dele;
(c) o mantenedor às 3h da manhã tentando entender por que algo quebrou.

---

## CONTEXTO DO PROJETO
Preencha o que souber; o resto você descobre lendo o repositório.

- **Nome:** <<< >>>
- **Repositório:** <<< https://github.com/owner/repo >>>
- **Plataforma:** <<< GitHub | GitLab >>>
- **Branch default:** <<< main >>>
- **Domínio de negócio em uma frase:** <<< >>>
- **Idioma da documentação:** <<< pt-BR | en | ambos (i18n do Docusaurus) >>>
- **Modelo:** projeto **open source colaborativo**. Qualquer pessoa pode abrir
  issue e PR, mas **todo merge passa pela minha aprovação** (modelo BDFL).
- **Licença:** **MIT** — titular <<<Nome/Org>>>, ano <<<2026>>>
- **Meu handle:** <<< @usuario >>>
- **E-mail de contato (segurança / código de conduta):** <<< >>>
- **Apoio financeiro:** Buy Me a Coffee — <<< https://buymeacoffee.com/usuario >>>
- **Canal de conversa:** <<< GitHub Discussions | Discord | nenhum ainda >>>
- **URL do site de docs:** <<< https://usuario.github.io/repo >>>

---

## PRINCÍPIOS INEGOCIÁVEIS

1. **Nunca invente.** Cada afirmação deve ser rastreável a código, config, commit,
   PR, issue ou doc existente. Quando não conseguir determinar algo, escreva
   literalmente `> **TODO(humano):** <pergunta específica>`. Prefiro doc curta e
   verdadeira a doc longa e inventada.
2. **Nunca exponha segredo.** Documente apenas NOMES de variáveis e onde são
   lidas. Se encontrar credencial no histórico, pare e me avise como incidente.
3. **Fonte única de verdade.** O Markdown vive em `docs/` na raiz. O Docusaurus
   **lê** de lá, nunca duplica. Se você criar `website/docs/`, você errou.
4. **README é vitrine, não manual.** Seção acima de ~20 linhas migra para `docs/`
   e fica só o link.
5. **Documentação estável.** Escreva de forma que mudanças normais de código não
   invalidem o documento (especialmente ARCHITECTURE.md).
6. **Peça permissão antes de escrever.** As fases têm pontos de parada.

---

# FASE 1 — RECONHECIMENTO
Somente leitura. Não crie nem edite arquivo nenhum nesta fase.

## 1.1 Estrutura e stack
- `git ls-files | head -300` e árvore de diretórios até 3 níveis
- Manifestos: `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`,
  `pyproject.toml`, `go.mod`, `Gemfile`, `*.csproj`, `Cargo.toml`, `composer.json`
- Infra: `Dockerfile`, `docker-compose.yml`, `k8s/`, `helm/`, `terraform/`,
  `.github/workflows/`, `.gitlab-ci.yml`, `Makefile`, `Procfile`
- Config: `.env.example`, `application.yml`, `appsettings.json`, `config/`.
  Liste TODA variável de ambiente e onde ela é lida no código.
- Entrypoints (`main`, `index`, `app`, `cmd/`, `server`) e o caminho quente de uma
  requisição típica ponta a ponta.
- Scripts (npm scripts, targets do Makefile, `bin/`, `scripts/`): nome, o que faz,
  quando usar, pré-requisitos.
- Fontes de referência auto-geráveis: OpenAPI/Swagger, GraphQL schema, JSON Schema,
  Protobuf, tipos TS exportados, docstrings. **Marque cada uma** — elas vão para
  geração automática na Fase 5, não para redação manual.
- Testes: framework, como rodar, cobertura atual se houver.

## 1.2 História do Git
```bash
git log --oneline -n 500
git log --pretty=format:'%h|%ad|%an|%s' --date=short -n 800
git shortlog -sne --all                                          # donos do código
git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c    # ritmo do projeto
git tag --sort=-creatordate | head -30                           # releases
git log --diff-filter=A --name-only --pretty=format:'%ad' --date=short | head -100
git log --numstat --pretty=format:'' | awk '{print $3}' \
  | sort | uniq -c | sort -rn | head -40                         # hotspots
git log --format='%s' | grep -iE 'BREAKING|revert|migrat|refactor|rename'
```
Extraia: viradas arquiteturais, módulos instáveis (hotspot = documentar melhor e
vigiar no `.docmap.yml`), convenção de commit realmente em uso, donos por área.

## 1.3 PRs, issues e discussões
GitHub (se `gh` estiver autenticado):
```bash
gh repo view --json name,description,topics,homepageUrl,licenseInfo,defaultBranchRef
gh pr list --state merged --limit 150 --json number,title,body,labels,mergedAt,author,files
gh issue list --state all --limit 100 --json number,title,body,labels,state
gh release list --limit 30
gh api repos/{owner}/{repo}/labels
```
GitLab: `glab mr list --merged`, `glab issue list`, `glab release list`.
Se nenhum CLI estiver disponível, diga isso explicitamente, siga com Git puro e
me peça um export.

Procure: descrições que explicam o **porquê** de uma decisão (matéria-prima para
ADR), trade-offs discutidos, bug fix que revela regra de negócio implícita,
mudanças breaking, padrões de PR recusado.

## 1.4 Regras de negócio
Varra o código atrás de lógica de **domínio**, não de plumbing:
- validações, guard clauses, `if` com constantes de negócio, máquinas de estado,
  enums de status, cálculos (juros, impostos, descontos, SLA, limites)
- nomes de entidades e a linguagem ubíqua do time
- **testes são a melhor fonte de regra já escrita** — leia `*_test`, `*.spec`,
  `features/` e extraia as regras dos nomes dos casos
- migrations e schema: constraints, unique, not null, defaults são regra
  Monte um glossário dos termos do domínio com a definição inferida.

## 1.5 Auditoria de licenças
- Node: `npx license-checker --summary` · Python: `pip-licenses`
- Go: `go-licenses report ./...` · Java/.NET: leia POM/csproj
  Sinalize copyleft forte (GPL-2.0/3.0, AGPL-3.0) ou licença ambígua, pois conflita
  com a promessa permissiva da MIT. **Não conclua nada jurídico** — registre
  `> **ATENÇÃO(humano):** dependência X sob AGPL-3.0, verificar`. Se tudo for
  permissivo (MIT/BSD/Apache/ISC), afirme isso. Procure também código de terceiros
  vendorizado, assets, fontes e ícones que exijam atribuição.

## ⛔ ENTREGA DA FASE 1 — PARE AQUI
Apresente e aguarde meu OK:
1. Sumário de ~15 linhas do que o projeto é e faz
2. Diagrama textual do fluxo principal
3. Achados do histórico (viradas, hotspots, convenções, riscos)
4. Resultado da auditoria de licenças
5. Lista das fontes de referência auto-geráveis encontradas
6. Perguntas abertas que só eu posso responder
7. Plano dos arquivos que você vai criar

---

# FASE 2 — DOCUMENTAÇÃO NÚCLEO
Após meu OK. Um arquivo por vez, mostrando o diff. Não faça commit sem eu pedir.

Todo arquivo em `docs/` nasce com frontmatter YAML compatível com Docusaurus:
```yaml
---
id: architecture
title: Arquitetura
sidebar_label: Arquitetura
sidebar_position: 1
description: <uma frase, usada em SEO e nos cards de índice>
keywords: [arquitetura, code map]
---
```
Use extensão `.md` para conteúdo puro e `.mdx` **somente** quando precisar de
componente React — a sintaxe MDX estrita quebra HTML solto e `{` literal.

### `README.md` — a vitrine
1. **Banner** no topo. Se não existir, gere `docs/assets/banner.svg` (1200×300,
   tipografia forte, 2 cores coerentes com o produto) e `logo.svg` (512×512).
   Centralize com `<p align="center">`.
2. **Badges** reais e verificáveis: build, deploy do site de docs, `License: MIT`,
   versão (última tag), linguagem, PRs welcome, last commit, contributors.
   Nada de badge decorativo falso.
3. Tagline de uma linha + parágrafo "o problema que isso resolve".
4. **Link destacado para o site de documentação**, logo abaixo dos badges.
5. Sumário com âncoras.
6. **✨ Features** — bullets curtos, cada um com o benefício, não a implementação.
7. **🏗️ Arquitetura em 30 segundos** — um Mermaid + link para a doc completa.
8. **🚀 Quickstart** — o caminho MAIS CURTO até "rodando na minha máquina".
   Copy-paste, pré-requisitos com versão exata, e o **output esperado** de cada
   comando para a pessoa saber que deu certo.
9. **⚙️ Configuração** — tabela resumida + link para a referência completa.
10. **📜 Scripts** — tabela `Comando | O que faz | Quando usar`.
11. **🗺️ Roadmap** — derive de issues abertas e labels.
12. **🤝 Contribuindo** — convite direto + links para
    `/labels/good%20first%20issue` e `/labels/help%20wanted`.
13. **👥 Contribuidores** — widget contrib.rocks ou all-contributors.
14. **☕ Apoie o projeto** — perto do fim. Frase honesta sobre ser gratuito e
    mantido em tempo livre, badge do Buy Me a Coffee, e o que o apoio viabiliza.
    Sem culpa, sem promessa de recompensa, sem sugerir prioridade a quem paga.
15. **📄 Licença** — "Distribuído sob a licença MIT. Veja [LICENSE](LICENSE)."

### `docs/architecture.md` — no estilo matklad
- **Bird's eye view**: um parágrafo, o sistema como caixa-preta, entradas e saídas
- **Diagrama de containers** em Mermaid (estilo C4 nível 2)
- **Code map**: cada diretório de topo — o que é, por qual arquivo começar a ler,
  e a que ele **não** serve. Aponte pontos de partida pesquisáveis (entrypoints,
  símbolos que dá para grepar)
- **Fluxo de uma requisição/job** ponta a ponta em `sequenceDiagram`
- **Fronteiras de camada e invariantes** — o que nunca pode ser violado
  (ex.: "domain não importa nada de infra"). É a parte mais valiosa do documento
- **Cross-cutting**: auth, logging, erro, transação, cache, feature flags
- **Dados**: modelo, `erDiagram`, estratégia de migration
- **Dívida técnica conhecida** — dos hotspots e de issues com label de débito

### `docs/business-rules.md`
- Propósito e contexto de negócio, atores/personas
- Glossário da linguagem ubíqua
- Regras numeradas `RN-001`, cada uma com: enunciado, onde vive (`arquivo:linha`),
  teste que a cobre, origem (PR/issue) quando encontrar
- Máquinas de estado em `stateDiagram`
- Casos de borda e o que acontece quando dá errado

### `docs/adr/`
Um ADR por decisão estrutural reconstruída do histórico. Formato Nygard:
**Título / Status / Contexto / Decisão / Consequências**, com data e link para o
PR ou commit de origem. Só decisão de peso (banco, monolito vs serviço, estado de
sessão, modelo de consistência) — não "trocamos de lib de data".
Crie `0001-registrar-decisoes-com-adr.md` primeiro.

### Organização Diátaxis dentro de `docs/`
```
docs/
  intro.md                 # landing page do site
  getting-started.md       # TUTORIAL: do zero ao primeiro resultado
  how-to/                  # HOW-TO: uma tarefa real por arquivo
  reference/               # REFERÊNCIA: API, env vars, CLI, schema
  explanation/             # EXPLICAÇÃO: trade-offs, contexto histórico
  architecture.md · business-rules.md · runbook.md
  adr/ · assets/
```
Nunca misture os quatro tipos num mesmo arquivo. Tutorial que explica demais vira
ruim como tutorial e ruim como explicação.

### Demais
- `docs/runbook.md` — se houver deploy: healthcheck, logs, rollback, alertas
- `CHANGELOG.md` — reconstruído de tags e PRs, formato Keep a Changelog
- `SECURITY.md` — versões suportadas e canal privado de reporte

---

# FASE 3 — CAMADA DE COMUNIDADE

### `.github/FUNDING.yml`
```yaml
buy_me_a_coffee: <<<handle>>>
```
Não invente outras plataformas que eu não citei.

### `CONTRIBUTING.md`
- **Antes de codar**: abra uma issue e espere alinhamento. Com todas as letras —
  PR grande sem issue prévia provavelmente será recusado.
- **Setup de dev em 5 minutos.** Se o setup real demorar mais, marque
  `TODO(humano)` — é o maior assassino de contribuição externa.
- **Como rodar o site de docs localmente** (`npm run docs:start`) e a regra de que
  **PR que muda comportamento precisa atualizar a doc correspondente**, com
  ponteiro para o `.docmap.yml`.
- **Fluxo**: fork → branch (`feat/`, `fix/`, `docs/`) → commit no padrão que o
  histórico usa → PR contra `<<<branch>>>` → meu review → squash merge.
- **O que eu aceito com prazer** vs **o que provavelmente não aceito** (troca de
  stack, refactor amplo sem discussão, dependência nova pesada, mudança de
  escopo). Seja concreto — essa seção economiza tempo dos dois lados.
- **Definition of Done**: testes passando, lint limpo, **doc atualizada**,
  CHANGELOG tocado, build do site de docs sem link quebrado, nenhum segredo.
- **SLA honesto**: "reviso em geral em até X dias; é projeto de tempo livre, se eu
  sumir por uma semana, dá um ping educado no PR". Nada de prometer 24h.
- **Reconhecimento**: como o contribuidor aparece.
- **Licenciamento inbound = outbound**: ao enviar PR, o contribuidor concorda em
  licenciar sob a mesma MIT. Sem CLA. Apresente DCO (`git commit -s`) como
  **opcional**, explicando o atrito para contribuidor casual.

### `GOVERNANCE.md`
Modelo BDFL, sem arrogância: quem tem merge, como uma decisão é tomada, como
discordar (abrir Discussion, não brigar no review), como decisão vira ADR, e o
critério para alguém virar mantenedor com direito a merge.

### `CODE_OF_CONDUCT.md`
Contributor Covenant 2.1, texto oficial na íntegra, com meu e-mail preenchido.
Não reescreva o texto do CoC.

### `SUPPORT.md`
Roteia: dúvida de uso → Discussions/Discord; bug reprodutível → issue de bug;
ideia → issue de feature; falha de segurança → SECURITY.md, **nunca** issue pública.

### `.github/ISSUE_TEMPLATE/` (formato `.yml`, campos obrigatórios)
- `bug_report.yml` — versão, ambiente, passos, esperado vs obtido, logs, checkbox
  "procurei issues duplicadas"
- `feature_request.yml` — problema que resolve, alternativas consideradas, e
  **disposição de implementar (sim/não)**: separa ideia de contribuição
- `doc_issue.yml` — página, o que está errado ou faltando, link do site
- `config.yml` — `blank_issues_enabled: false` + contact_links para Discussions,
  site de docs e Buy Me a Coffee

### `.github/pull_request_template.md`
Descrição, `Closes #`, tipo de mudança, como testar, screenshots se UI, checklist
de DoD **incluindo "atualizei a documentação afetada (ver `.docmap.yml`)"**, e
checkbox "concordo em licenciar esta contribuição sob a MIT do projeto".

### `CODEOWNERS`
`* @<<<handle>>>` — me torna reviewer requerido em tudo.

### Labels
Conjunto enxuto com comando `gh label create` pronto: `good first issue`,
`help wanted`, `bug`, `enhancement`, `docs`, `docs-needed`, `question`, `wontfix`,
`needs-triage`, `blocked`, `breaking`.

---

# FASE 4 — SITE DOCUSAURUS

## 4.1 Scaffold
Instale em `website/`, **sem** duplicar conteúdo:
```bash
npx create-docusaurus@latest website classic --typescript
```
Fixe as dependências em `3.x` — a v4 está em desenvolvimento com breaking changes.

Adicione ao `package.json` da raiz (ou crie um se não houver):
```json
"scripts": {
  "docs:start": "npm --prefix website start",
  "docs:build": "npm --prefix website build",
  "docs:serve": "npm --prefix website serve"
}
```

## 4.2 `website/docusaurus.config.ts`
Configure obrigatoriamente:
- `title`, `tagline`, `favicon`, `url`, `baseUrl` (`/<repo>/` para GitHub Pages),
  `organizationName`, `projectName`, `trailingSlash: false`
- **`path: '../docs'`** no preset `docs` — lê a fonte única de verdade
- **`routeBasePath: '/'`** — docs na raiz do site, sem landing page separada
- **`onBrokenLinks: 'throw'` e `onBrokenMarkdownLinks: 'throw'`** — isto transforma
  link quebrado em falha de CI, o mecanismo mais barato contra doc apodrecendo
- **`editUrl`** apontando para `blob/<branch>/docs/` — botão "editar esta página"
  em toda página, o menor atrito possível para contribuição de doc
- **`showLastUpdateTime: true` e `showLastUpdateAuthor: true`** — expõe
  publicamente quando a página foi tocada por último. Página velha fica visível.
- **Mermaid**: `markdown: { mermaid: true }` + `themes: ['@docusaurus/theme-mermaid']`
- **Docusaurus Faster** (build 3–4× mais rápido, já estável):
```ts
  future: { experimental_faster: true }
```
- **Busca**: se eu não tiver Algolia DocSearch, use
  `@easyops-cn/docusaurus-search-local` com `hashed: true`. Não deixe o site sem busca.
- **Blog**: habilite como canal de release notes; senão `blog: false`
- **i18n**: só se eu pedi doc em dois idiomas (`defaultLocale`, `locales`)
- **Dark mode** com `respectPrefersColorScheme: true`
- Navbar com: Docs, Referência da API, Blog, link do GitHub, e um item
  **☕ Apoie** apontando para o Buy Me a Coffee
- Footer com licença MIT, links da comunidade e copyright

## 4.3 `website/sidebars.ts`
Escrito à mão e organizado por **Diátaxis**, não autogerado bagunçado:
```
🚀 Comece aqui   → intro, getting-started
📘 Guias         → how-to/*
🏗️ Arquitetura   → architecture, adr/*
📐 Regras        → business-rules
📖 Referência    → reference/*  (parcialmente autogerada — Fase 5)
💡 Explicação    → explanation/*
🛠️ Operação      → runbook
🤝 Contribuir    → contributing
```

## 4.4 Versionamento
Se o projeto tem releases publicados, configure `versions` e documente o comando
`npm run docusaurus docs:version X.Y` no CONTRIBUTING, junto da regra de **quando**
versionar (só em major/minor, nunca em patch — versionar demais multiplica
o custo de manutenção da doc por N).

## 4.5 Deploy — `.github/workflows/docs-deploy.yml`
- Trigger: push em `<<<branch>>>` com `paths: ['docs/**', 'website/**']`
- Job de **build em todo PR** (sem deploy) para pegar link quebrado e erro de MDX
  antes do merge
- Deploy para GitHub Pages via `actions/deploy-pages`, com concorrência controlada
- Cache de `node_modules` e do cache persistente do Rspack

## 4.6 Ajustes de conteúdo
- `docs/intro.md` como landing: o que é, para quem, e três caminhos ("quero usar",
  "quero entender", "quero contribuir")
- Converta as tabelas de env vars e scripts para `reference/`
- Substitua links absolutos do GitHub por links relativos entre docs
- Um `<Tabs>` nos comandos que variam por SO ou por gerenciador de pacotes
- Verifique que os Mermaid renderizam no tema claro **e** escuro

---

# FASE 5 — SINCRONIZAÇÃO CONTÍNUA
Esta é a fase mais importante. Documentação não morre por falta de escrita
inicial, morre por drift. Instale mecanismos, não boas intenções.
Ordem de preferência: **gerar > verificar > lembrar**.

## 5.1 `.docmap.yml` — o mapa de responsabilidade
Crie na raiz, derivado do que você aprendeu nas Fases 1 e 2:
```yaml
# Mapa: mudança de código → documentação que precisa ser revisada.
# Usado pelo Claude Code (/sync-docs) e pelo CI (docs-drift).
version: 1

rules:
  - id: api-surface
    watch: ["src/routes/**", "src/controllers/**", "openapi.yaml"]
    docs:  ["docs/reference/api.md"]
    generated: true          # gerado do OpenAPI, não editar à mão
    severity: block          # bloqueia o PR

  - id: domain-rules
    watch: ["src/domain/**", "src/**/*.rules.*", "migrations/**"]
    docs:  ["docs/business-rules.md"]
    severity: block
    note: "Toda RN alterada precisa da referência arquivo:linha atualizada."

  - id: config
    watch: [".env.example", "src/config/**"]
    docs:  ["docs/reference/configuration.md"]
    generated: true
    severity: block

  - id: architecture
    watch: ["src/**/index.*", "docker-compose.yml", "package.json"]
    docs:  ["docs/architecture.md"]
    severity: warn           # apenas comenta no PR
    note: "Só atualize se mudou fronteira de camada ou dependência estrutural."

  - id: scripts
    watch: ["package.json", "Makefile", "scripts/**"]
    docs:  ["docs/reference/scripts.md", "README.md"]
    severity: warn

  - id: adr-trigger
    watch: ["src/infra/**", "docker-compose.yml", "terraform/**"]
    requires_adr: true
    severity: warn
    note: "Mudança estrutural? Provavelmente merece um ADR."
```
Ajuste os caminhos ao repositório real. Não copie o exemplo cegamente.

## 5.2 `CLAUDE.md` na raiz — instruções permanentes
Isto faz cada sessão futura do Claude Code atualizar a doc por padrão, sem eu ter
que pedir. Escreva conciso e imperativo:
```markdown
# Instruções do projeto

## Documentação é parte da definição de pronto
Ao alterar código, consulte `.docmap.yml` e atualize os documentos mapeados
**na mesma mudança**. Não deixe para depois e não me pergunte se deve fazer —
faça, e mostre o diff da doc junto com o diff do código.

## Regras
- Fonte de verdade do Markdown: `docs/`. Nunca crie `website/docs/`.
- Arquivos marcados `generated: true` no `.docmap.yml` são gerados: rode o script
  de geração, não edite à mão. Se você editar, o próximo build sobrescreve.
- Mudou comportamento observável? Adicione entrada em `CHANGELOG.md` (Unreleased).
- Mudou fronteira arquitetural, banco, modelo de consistência ou dependência
  estrutural? Crie um ADR em `docs/adr/` com o número seguinte.
- Nova regra de negócio? Adicione `RN-XXX` em `docs/business-rules.md` com
  `arquivo:linha` e o teste que a cobre.
- Antes de finalizar, rode `npm run docs:build` — link quebrado falha o build.
- Nunca invente conteúdo de doc. Sem informação suficiente, use
  `> **TODO(humano):** <pergunta>`.

## Convenções
- Commits: <<<Conventional Commits>>>. Doc-only usa `docs:`.
- Diagramas em Mermaid, no próprio Markdown. Nunca imagem de diagrama.
```

## 5.3 Referência gerada — elimine o drift na origem
O que pode ser gerado nunca deve ser escrito à mão. Crie os scripts que se
aplicarem ao stack real e ligue-os a `npm run docs:generate`:
- **API**: OpenAPI → `docusaurus-plugin-openapi-docs`, ou GraphQL schema →
  `docusaurus-graphql-plugin`
- **Env vars**: script que varre o código atrás de leitura de env e regenera
  `docs/reference/configuration.md` com marcadores
  `<!-- BEGIN:GENERATED --> ... <!-- END:GENERATED -->`
- **CLI**: capture o `--help` de cada comando
- **Tipos/SDK**: TypeDoc, pdoc, godoc, javadoc → embutido em `reference/`
- **Scripts**: extraia de `package.json` / `Makefile`
- **ADR index**: gere `docs/adr/index.md` a partir dos arquivos e seus status
- **Contribuidores**: all-contributors ou action que atualiza a seção
  Todo arquivo gerado começa com:
  `> ⚠️ Arquivo gerado por \`npm run docs:generate\`. Não edite à mão.`
  E entra no CI como verificação: se o gerado difere do commitado, o PR falha.

## 5.4 `.github/workflows/docs-check.yml` — o guardião
Rode em todo PR:
1. **Build do site** com `onBrokenLinks: throw` → pega link quebrado e MDX inválido
2. **Drift check**: script que lê `.docmap.yml`, cruza com
   `git diff --name-only origin/<branch>...HEAD`, e para cada regra acionada sem
   doc correspondente alterada:
    - `severity: block` → falha o check
    - `severity: warn` → comenta no PR listando os arquivos a revisar
    - Escape hatch obrigatório: label `docs-not-needed` ou linha
      `docs-not-needed: <motivo>` no corpo do PR libera o check. Sem escape hatch,
      o time aprende a burlar a regra em vez de cumpri-la.
3. **Gerados em dia**: roda `docs:generate` e falha se houver diff
4. **Lint de prosa**: Vale ou textlint (opcional, proponha e pergunte)
5. **Links externos**: `lychee`, apenas em schedule semanal — não em PR, para não
   quebrar build por site de terceiro fora do ar

## 5.5 `.claude/commands/sync-docs.md` — comando manual
Slash command para quando eu quiser rodar a sincronização sob demanda:
```markdown
Compare o código atual com a documentação e corrija o drift.

1. `git diff --name-only <<<branch>>>...HEAD` (ou o range que eu passar como $ARGUMENTS)
2. Leia `.docmap.yml` e determine quais docs foram afetados
3. Para cada doc afetado: leia, compare com a realidade do código, e corrija
   **apenas o que está factualmente errado ou faltando**. Não reescreva estilo.
4. Rode `npm run docs:generate` e inclua o resultado
5. Atualize `CHANGELOG.md` se houver mudança observável
6. Verifique se algum ADR é necessário; se sim, proponha o texto
7. Rode `npm run docs:build` e conserte o que quebrar
8. Relatório final: o que mudou, o que ficou como TODO(humano), e o que você
   deliberadamente NÃO mudou e por quê
```

## 5.6 `.github/workflows/docs-audit.yml` — auditoria periódica
Mensal (`schedule: cron`), abre ou atualiza uma issue única com label `docs`:
- Páginas com `last_update` mais antigo que N meses cujo código correspondente
  mudou depois
- Documentos com `TODO(humano)` pendentes
- Referências `arquivo:linha` que não resolvem mais (arquivo movido ou removido)
- ADRs em status `proposed` há mais de 60 dias
- Links externos mortos (do check semanal)
  Nada de abrir issue nova a cada rodada — atualize a existente.

## 5.7 Hooks locais (opcional — proponha e pergunte)
`pre-push` via husky/lefthook que roda o drift check localmente, para o
contribuidor descobrir antes de abrir o PR e não depois. Só instale se eu aprovar:
hook lento é a maneira mais rápida de fazer alguém usar `--no-verify` para sempre.

## 5.8 Documente o próprio mecanismo
Crie `docs/explanation/documentation-workflow.md` explicando como esse sistema
funciona, por que ele existe, e o que fazer quando o drift check reclamar
injustamente. Mecanismo que ninguém entende é mecanismo que alguém desliga.

---

# FASE 6 — LICENCIAMENTO MIT

### `LICENSE`
Texto MIT **oficial, sem qualquer modificação**, na raiz, sem extensão, ano e
titular preenchidos. Se existir LICENSE com outra licença ou placeholder
(`[year]`, `[fullname]`), corrija e me avise. Nunca acrescente cláusulas — MIT
alterada deixa de ser reconhecida por ferramentas e por jurídico de empresa.

### Coerência declarada
Verifique se `package.json` (raiz **e** `website/`), `pyproject.toml`,
`Cargo.toml`, `pom.xml` declaram `"license": "MIT"` e corrija divergências.
Licença declarada em três lugares com valores diferentes é problema real e comum.

### `THIRD_PARTY_NOTICES.md`
Se a Fase 1.5 encontrou código vendorizado, assets, fontes ou ícones que exijam
atribuição, crie o arquivo com a atribuição de cada um. Inclua o footer do
Docusaurus com a nota de licença.

### SPDX (opcional — proponha e pergunte antes)
Cabeçalho `// SPDX-License-Identifier: MIT` nos fontes principais.

---

# REGRAS DE ESCRITA
- Voz ativa, presente, segunda pessoa nos passos. Frases curtas.
- Todo comando em bloco com a linguagem certa e o **output esperado**.
- Diagramas sempre em **Mermaid** no próprio Markdown — renderiza no GitHub e no
  Docusaurus, versiona bem, e sobrevive a diff. Nunca imagem de diagrama.
  Máximo ~12 nós; se passar, quebre em dois.
- Emojis só em títulos de seção do README e labels de sidebar, com parcimônia.
- Links **relativos** entre docs, para funcionar em fork, mirror e no site.
- Tom convidativo e específico, nunca burocrático. "Abra uma issue antes" >
  "É vedado ao contribuinte submeter alterações sem prévia anuência".
- Diga o "não" cedo e com motivo. Recusar PR depois de 300 linhas escritas é o que
  queima mantenedor e contribuidor.
- Nada de linguagem que transforme apoio financeiro em contrato de suporte.
- Zero lorem ipsum. Zero TODO genérico — só `TODO(humano)` com pergunta específica.

---

# ENCERRAMENTO
Ao final, entregue:
1. Árvore dos arquivos criados e alterados
2. Lista consolidada de `TODO(humano)` e `ATENÇÃO(humano)`, ordenada por impacto
3. Confirmação de que `npm run docs:build` passa sem link quebrado
4. Simulação do drift check: rode contra os últimos 5 commits e mostre o que ele
   teria acusado — é a prova de que o mecanismo funciona
5. Checklist do GitHub Community Standards com o que ficou pendente
6. Mensagens de commit em Conventional Commits, agrupadas logicamente
7. Três coisas que você percebeu sobre o projeto lendo o histórico e que eu
   provavelmente não sabia