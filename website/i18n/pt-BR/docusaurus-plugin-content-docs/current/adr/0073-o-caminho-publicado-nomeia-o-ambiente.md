# ADR 0073 — O caminho publicado nomeia o ambiente, não a branch

- **Status:** aceito
- **Data:** 2026-08-13
- **Revisa:** [ADR 0071](0071-publicacao-simetrica-por-degrau.md)

## Contexto

O [ADR 0071](0071-publicacao-simetrica-por-degrau.md) pôs os três degraus em
`/brabo/<branch>/` e resolveu a assimetria que existia desde o
[ADR 0034](0034-documentacao-publicada-por-degrau.md). O que ele não questionou
foi a identidade entre as duas coisas: o segmento da URL **era** o nome da
branch, por interpolação de `$GITHUB_REF_NAME`.

Isso deixou a documentação estável em `https://daneiel.github.io/brabo/main/`, e
`main` é uma palavra de quem commita. Quem lê a documentação não está escolhendo
uma branch — está escolhendo **quão maduro** é o texto que vai ler. `qa` e `dev`
funcionam como endereço por coincidência: são, ao mesmo tempo, nome de branch e
nome de ambiente. `main` não é nome de ambiente em lugar nenhum.

O pedido veio do dono do produto, em uma frase: *"a `main` não pode ter o path
`/main`, modificar para `/prd`"*.

## Decisão

### 1. `main` publica em `/brabo/prd/`

Os outros dois seguem em `/brabo/qa/` e `/brabo/dev/`. A publicação continua
simétrica no mecanismo — o que muda é que o mapa branch→caminho passa a
**existir**, em vez de ser a função identidade escrita como interpolação de
string.

| branch | caminho publicado |
|---|---|
| `main` | `/brabo/prd/` |
| `qa` | `/brabo/qa/` |
| `dev` | `/brabo/dev/` |

### 2. O mapa mora num lugar por processo, e cada um deriva o resto dele

São três processos independentes, e cada um tem seu ponto único:

- **`.github/workflows/docs-deploy.yml`** — o passo "Qual degrau, e para onde ele
  publica" emite `branch`, `caminho` e `base`. `baseUrl` e subdiretório saem
  **juntos** daí; separá-los é como eles passam a divergir, e um `baseUrl` que
  não bate com o diretório serve HTML e nada mais.
- **`website/docusaurus.config.ts`** — a tabela `DEGRAUS` traz `branch`,
  `caminho` e rótulo. O seletor da navbar e o `baseUrl` default leem dela.
- **`scripts/docs/landing.mjs`** — a mesma tabela, com `caminho` (o diretório na
  árvore) separado de `branch` (de onde sai a **tag** que carimba a versão do
  degrau). Este é o par que mais engana: a versão de `/prd/` vem das tags da
  `main`, e trocar um pelo outro faria `/prd/` parecer nunca publicado.

O que **não** é derivado do caminho: `E_PRODUCAO` continua sendo
`DOCS_BRANCH === 'main'`. O item 4 do ADR 0071 registra por que deduzir ambiente
de string de caminho é acoplamento que só aparece quando o caminho muda — e este
ADR é o caminho mudando. Confirmar isso era o teste mais importante da mudança:
`DOCS_BRANCH=main` continua **sem** `noIndex`; `dev` continua com.

### 3. `/brabo/main/` é reescrito pelo `404.html`, não preservado

O diretório `main/` **existe publicado hoje**. Como a árvore é montada e
empurrada com `keep_files: false`, ele fica órfão e some no primeiro push — e
todo link salvo para `/brabo/main/architecture` quebraria.

A saída é a mesma que o ADR 0071 usou para os links da raiz antiga, e pelo mesmo
motivo (manter uma cópia do site em dois endereços é duplicar a publicação a
cada push): o `404.html` da raiz reescreve o prefixo. `/brabo/main/<algo>` →
`/brabo/prd/<algo>`.

O detalhe que não é detalhe: isso é um caso **próprio**, não o
reencaminhamento genérico. A guarda anti-laço do ADR 0071 ignorava qualquer
caminho começado por `main|qa|dev`, e com `main` fora da árvore ela faria
exatamente a coisa errada — devolver 404 para o único caminho que precisa de
tratamento. A guarda passa a cobrir só os caminhos que **existem**
(`prd|qa|dev`), e `main` é tratado antes dela. Sem o caso próprio, o genérico
produziria `/brabo/prd/main/<algo>`.

### 4. A transição semeia `/prd/` a partir do `gh-pages:main`

Mesmo raciocínio do item 6 do ADR 0071. `gh-pages:prd` só nasce quando a `main`
passar pela esteira depois desta mudança, e o primeiro push de `dev` ou `qa`
chega antes disso: sem semente, `/brabo/prd/` responderia 404 por dias, com o
`404.html` mandando todo mundo justamente para lá.

O conteúdo de `gh-pages:main` é, literalmente, o build da `main`. Ele semeia
`/prd/` — **reescrito**, e essa parte foi descoberta simulando a montagem contra
a `gh-pages` real: o `baseUrl` embutido naquele build aponta para
`/brabo/main/`, e o `404.html` do item 3 **não salva subrecurso**. O script dele
roda em navegação; um `<script src>` ou `<link rel=stylesheet>` que caia no 404
recebe HTML com status 404 e falha calado. Sem reescrever, `/prd/` serviria
texto sem CSS, sem busca e sem hidratação — o "carrega HTML e nada mais" que o
`docusaurus.config.ts` descreve como o modo de falha mais traiçoeiro desta
publicação.

A reescrita é um `sed` de `/brabo/main/` para `/brabo/prd/` nos arquivos de
TEXTO da semente que contêm a string (542 dos 634, na simulação). Arquivo
binário fica de fora por `grep -I`: `sed -i` num deles pode acrescentar o
newline final que falta e corrompê-lo.

Na primeira publicação de `main` o caminho normal assume e o bloco não roda
mais.

O bloco análogo do ADR 0071 (semear `/main/` a partir da raiz antiga) foi
**removido** no mesmo commit. Ele já cumpriu o papel — a `gh-pages` de hoje tem
`main/`, `qa/` e `dev/` —, e a condição dele (`FETCH_HEAD:index.html` existir)
passou a casar com o índice gerado pela própria landing: mantido, ele
transformaria a página raiz em degrau.

## Consequências

- **Um link para `/brabo/main/…` passa a custar um redirecionamento**, para
  sempre. É o preço declarado de mover um endereço público, e é menor que o de
  duplicar o site ou o de quebrar links salvos.
- **`qa` e `dev` viram coincidência, não regra.** Quem for renomear um deles
  amanhã mexe na tabela e em nada mais — foi essa a mudança estrutural, e não o
  valor `prd` em si.
- **A raiz não muda de papel.** Continua sendo o índice gerado que lista os três,
  agora canonizando para `/prd/`; o About do repositório, o README e o
  `AuthLayout.tsx` apontam para ela e seguem corretos.
- **O `noIndex` continua atado à branch.** Nenhum ambiente novo é criado, e
  nenhuma configuração do GitHub Pages muda: a fonte segue sendo a branch
  `gh-pages` na pasta `/ (root)`.
- **Um degrau a mais é uma linha a mais** em três tabelas — não uma varredura
  atrás de `$GITHUB_REF_NAME` interpolado.

## Alternativas descartadas

- **Publicar em `/prd/` e manter `/main/` como cópia.** Preserva os links sem
  redirecionamento, ao custo de duplicar o site inteiro a cada publicação e de
  ter dois endereços indexáveis com o mesmo conteúdo — a mesma alternativa que o
  ADR 0071 já descartara para a raiz.
- **Renomear a branch `main` para `prd`.** Resolveria a identidade mantendo a
  interpolação, e trocaria um endereço público por uma quebra em rulesets,
  esteira de release, backmerge e em toda referência a `main` no repositório. O
  vocabulário de quem commita não é o problema; o de quem lê é.
- **Redirecionar `/brabo/main/` no servidor.** O GitHub Pages não tem regra de
  redirecionamento; o `404.html` da raiz é o mecanismo que existe.
- **Deixar como estava.** É a alternativa que o pedido recusa, e ela tem um
  argumento fraco a favor (`main` já estava publicado) contra um forte contra: o
  endereço fala com quem lê, não com quem commita.
