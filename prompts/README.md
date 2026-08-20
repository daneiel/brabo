# prompts/

Templates de prompt de agentes, versionados como arquivos `.md`, fora do
código Elixir que hoje os carrega. Esta é a PRIMEIRA leva de conteúdo
extraído — quatro templates, hoje heredoc/string inline em
`apps/engine/lib/engine/**`. A leitura por agente (o mecanismo que vai
buscar estes arquivos em vez do texto inline nos `.ex`) é uma onda
POSTERIOR, ainda não iniciada: **nenhum agente consome este diretório
hoje**. Os `.ex` originais continuam sendo a fonte de verdade em
produção até essa onda entrar.

## Por que separar prompt de código

O padrão desta pasta — e o gatilho para propô-lo aqui — veio de estudar o
repositório [`ErickWendel/neo4j-ai-experiments`](https://github.com/ErickWendel/neo4j-ai-experiments),
do Erick Wendel. Aquele projeto mantém os prompts de tradução NL→Cypher,
de montagem de contexto e de formatação de resposta como arquivos
próprios, deliberadamente fora da lógica de aplicação que os invoca — e
isso não é só organização de pasta: é o que torna cada prompt revisável
em diff isolado, versionável sem recompilar nada, e legível por quem
nunca abriu o código Elixir/TypeScript ao redor. É a mesma separação que
este diretório persegue para o Brabo, e vale registrar o crédito: a
inspiração concreta — front-matter simples, um arquivo por
responsabilidade, hash como chave de idempotência ao indexar — nasceu de
ler o material do Erick Wendel sobre como ele organiza prompts de agentes
Neo4j/GraphRAG. Obrigado pela base de conhecimento aberta; ela poupou
uma rodada inteira de tentativa-e-erro sobre "onde mora o prompt quando
ele não mora mais no código".

## Formato

Cada arquivo `prompts/<nome>.md` tem front-matter YAML no topo:

```yaml
---
name: nome-do-arquivo
version: "1"
---
```

- `name` — identificador do template. Por convenção, o mesmo nome do
  arquivo (sem `.md`).
- `version` — string, não número (evita ambiguidade `1` vs `1.0`).
  Sobe quando o CONTEÚDO do template muda de forma que quem consome
  precisa saber — o hash do corpo (ver abaixo) já detecta qualquer
  mudança de byte, então `version` é para leitura humana, não para
  deduplicação.
- Campos extras são permitidos e documentam propriedades do `.ex`
  original que não são texto de prompt — hoje só `pinned: true`, nos
  dois kickoffs (Psicólogo, Anamnese) cuja mensagem original nasce
  marcada como pinned e por isso nunca é compactada pelo
  `Engine.Harness.ContextManager`.

O corpo (tudo depois do segundo `---`) é o texto do prompt. Onde o
`.ex` original interpola dado dinâmico (`#{...}` — coisa que muda por
sessão, projeto ou turno, não é texto fixo), o Markdown usa um
placeholder `{{variavel}}` em vez de tentar reproduzir a interpolação.
Cada arquivo documenta seus placeholders numa seção final "## Variáveis",
explicando o que cada um representava no código original. **Esta frente
só documenta os placeholders — a substituição real (motor de template
lendo `{{variavel}}` e resolvendo contra o contexto do turno) é trabalho
da onda que vai consumir isto, ainda não implementada.**

## Templates extraídos nesta leva

| Arquivo | Origem no `.ex` |
| --- | --- |
| `ux-designer-identity.md` | `apps/engine/lib/engine/harness/agents.ex`, entrada `"ux-designer"` de `@identities` |
| `psychologist-kickoff.md` | `apps/engine/lib/engine/workers/psychologist_worker.ex`, `initial_message/4` |
| `anamnese-kickoff.md` | `apps/engine/lib/engine/workers/anamnese_worker.ex`, `initial_message/1` |
| `context-manager-summarize.md` | `apps/engine/lib/engine/harness/context_manager.ex`, `summarize/2` |

## Como rodar o seeder

```bash
node scripts/dev/seed-prompts.ts
```

O script (`scripts/dev/seed-prompts.ts`):

1. Lê todo `prompts/*.md` (exceto este README), parseia o front-matter e
   separa `name`/`version`/`body`.
2. Calcula `sha256` do `body` (`crypto.createHash('sha256')` do Node —
   sem lib nova).
3. Chama `POST /internal/graph/prompt-templates` (`{ name, version, body,
   hash }`), autenticado com o service token interno
   (`x-brabo-service-token`, valor de `BRABO_SERVICE_TOKEN`) contra
   `API_PUBLIC_URL` (default `http://localhost:3000`).
4. É idempotente por hash: rodar duas vezes com o mesmo conteúdo não cria
   versão nova — quem decide isso é a resposta do endpoint (`active`
   permanece a mesma versão quando o hash já existe).

**Estado desta entrega**: a rota `POST /internal/graph/prompt-templates`
é contrato combinado com a frente que constrói a infraestrutura de
leitura (api/engine, em paralelo) — pode ainda não existir quando você
rodar o seeder. Se a chamada falhar por 404/conexão recusada, o script
reporta claramente que a leitura/parsing/hash locais rodaram OK e que o
roundtrip contra a api depende dessa frente estar de pé; ele não finge
sucesso.

## O que este diretório NÃO faz, hoje

- Nenhum agente do `apps/engine` lê estes arquivos — os `.ex` continuam
  carregando os prompts inline, como sempre.
- Nenhuma substituição de placeholder acontece aqui — `{{variavel}}` é
  documentação, não motor de template.
- Não há mais templates além dos quatro listados acima; o resto dos
  prompts inline segue no código até a onda que migra o restante.
