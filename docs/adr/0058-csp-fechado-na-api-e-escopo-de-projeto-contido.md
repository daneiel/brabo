# ADR 0058 — CSP fechado na api, e o escopo de projeto contido na raiz

- **Status:** aceito
- **Data:** 2026-08-08
- **Contexto:** alertas abertos do CodeQL (varredura de 2026-08-04)
- **Revisa:** [ADR 0027](0027-fase5-backup-hardening-release.md), item 7
- **Toca:** [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)

## Contexto

A varredura de código do CodeQL deixou dez alertas HIGH abertos. Sete deles são
falso positivo e foram dispensados com razão escrita no próprio GitHub (a lista
está no fim deste documento, porque a razão de dispensar também é decisão). Os
outros três são reais e mudam desenho, que é o que este ADR registra.

### 1. `contentSecurityPolicy: false` (`js/insecure-helmet-configuration`)

O [ADR 0027](0027-fase5-backup-hardening-release.md), item 7, decidiu "helmet na
api, CSP só na web", com `contentSecurityPolicy: false`. O argumento era: a api
serve JSON, quem executa script é a web, e o CSP da web já existe e é mais
específico (`docker/web/nginx.conf`, com o `connect-src` montado por ambiente).
Ligar um CSP **genérico** na api daria impressão de cobertura sem acrescentar
defesa.

Esse argumento continua correto no que afirma, e é por isso que ele sobreviveu
uma fase inteira. O que ele não considerou é que a alternativa a um CSP genérico
não é cabeçalho nenhum — é um CSP **específico**. E para uma api que só serve
JSON, o específico é o mais fechado que existe: `default-src 'none'`. Ela não
carrega script, folha de estilo, imagem, fonte nem frame, então negar tudo custa
zero comportamento.

E há dois caminhos concretos em que uma resposta da api vira superfície de
execução, nos quais o CSP da web não está presente porque a web não está no
caminho:

- **navegação direta** a uma rota da api — link colado, redirect, aba aberta
  pelo usuário. O browser renderiza a resposta na ORIGEM DA API, onde o CSP do
  nginx da web não vale;
- **`frame-ancestors`**, que só tem efeito sobre o documento emoldurado. Nenhum
  CSP da web impede um terceiro de emoldurar uma rota da api.

### 2. `join(raiz, projectId)` sem validar o `projectId` (`js/path-injection`)

O `projectId` chega em `@Param('projectId')` sem pipe de validação, e o Express
**decodifica o percent-encoding do segmento antes de entregá-lo**: um
`..%2F..%2Fetc` chega como `../../etc`, e o `join` resolve para fora da raiz sem
reclamar.

O alcance é maior do que "lê o arquivo errado". `projectScopeRoot` tem dois
consumidores, e o segundo é o que dói:

- o `permissions.json` seria lido **e escrito** em caminho arbitrário
  (`fs-permissions-file-store.ts`);
- o escopo de caminho do [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)
  autoriza comando de terminal sob essa pasta
  (`propose-action.use-case.ts` → `decide.ts`). Um escopo que escapa da raiz é a
  política de aprovação apontando para o lugar errado — falha de SEGURANÇA, não
  de arquivo não encontrado.

### 3. Escape de célula de tabela incompleto (`js/incomplete-sanitization`)

No corpo do PR de promoção (`scripts/ci/promote.ts`), o título do PR era
escapado com `.replace(/\|/g, '\\|')`. Escapar só o pipe deixa passar um título
terminado em contrabarra: `a\` seguido de `|` vira `a\\|`, que o parser de
tabela do GFM lê como contrabarra escapada seguida de um DELIMITADOR de coluna.

## Decisão

**1. A api manda CSP, e ele é fechado.** As opções do helmet saem do literal no
`main.ts` para `infrastructure/security/security-headers.ts` — o mesmo movimento
que `cors-origins.ts` já tinha feito, e pela mesma razão: no literal do boot elas
não eram testáveis, e nenhum teste via qual cabeçalho a api mandava de verdade.

Em produção:

```
default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

Fora de produção o `main.ts` monta o Swagger UI em `/docs`, que é HTML de verdade
e precisa de script, estilo e imagem próprios — sob `default-src 'none'` a página
abriria em branco. O perfil de desenvolvimento afrouxa o necessário para o
Swagger e nada além. A condição é EXATAMENTE a mesma que monta o Swagger
(`NODE_ENV !== 'production'`), e isso é deliberado: se um dia o Swagger passar a
subir em produção, o CSP acompanha em vez de barrá-lo em silêncio.

`'unsafe-inline'` aparece só no perfil de desenvolvimento, e é limitação do
Swagger UI (ele injeta o inicializador inline), não escolha nossa.

`crossOriginResourcePolicy` deixa de ser `false` e passa a ser
`{ policy: 'cross-origin' }`. O efeito no browser é o mesmo — a web é outra
origem e precisa consumir estas respostas — mas a intenção passa a estar DITA no
cabeçalho em vez de omitida na ausência dele.

**2. O `projectId` é validado onde a raiz é derivada**, e não em cada chamador.
`projectScopeRoot` recusa o que não for segmento de caminho simples
(`^[A-Za-z0-9_-]{1,64}$`), lançando. A checagem é deliberadamente mais larga que
UUID para não amarrar o formato do id, e estreita o bastante para que o resultado
nunca escape da raiz.

Validar num lugar só é a mesma razão que fez essa função existir: as duas
derivações têm que concordar, e uma checagem duplicada é uma checagem que um dia
diverge.

**3. O escape de célula escapa a contrabarra antes do pipe**, em
`celulaDeTabela`. Vale para célula de TEXTO; numa célula que é code span a
contrabarra é literal e escapá-la renderizaria `\\` visível — por isso a função
não é usada nas colunas entre crases.

## Consequências

- A api passa a mandar `Content-Security-Policy` em toda resposta. Quem depender
  de abrir uma rota da api direto no browser e ver algo além de JSON cru não
  depende mais — e não havia esse caso.
- Um `projectId` malformado agora FALHA em vez de resolver para fora da raiz. O
  caminho feliz não muda: todo id real é UUID vindo do banco.
- Os cabeçalhos deixaram de ser invisíveis ao teste. A prova é uma requisição de
  verdade contra o middleware, não uma afirmação sobre o objeto de configuração —
  `false` e um objeto de diretivas são os dois "configuração válida", e a
  diferença entre eles só aparece na resposta HTTP.

## O que foi dispensado, e por quê

Dispensar com razão escrita é resposta; deixar aberto calado não é. Os sete:

| alerta | regra | razão |
|---|---|---|
| #5 | `js/insufficient-password-hash` | Não há senha. O `secret` é `GIT_OAUTH_STATE_SECRET`, chave HMAC de servidor, e HMAC-SHA256 é o primitivo CERTO para assinar um `state` de OAuth. Hash lento ali seria erro. Senha de usuário no produto usa argon2id, em `argon2-password-hasher.ts`. |
| #4 | `js/loop-bound-injection` | O laço termina. `b` é resultado de `String.prototype.split` — array de verdade, `.length` não forjável, e `j` incrementa a cada volta. A premissa da regra (objeto controlado com `.length` falso) não vale aqui. |
| #7, #8 | `js/incomplete-sanitization` | Em `scripts/docs/generate.mjs` as duas células são **code span** (entre crases), onde a contrabarra é literal: escapá-la renderizaria `\\` visível: o "conserto" quebraria a saída. Entradas são conteúdo do próprio repositório (scripts do `package.json`, rótulos de seção da doc), em gerador de build. |
| #9 | `js/incomplete-multi-character-sanitization` | É arquivo de TESTE. O `replace` tira comentários de um `index.html` versionado NESTE repositório para afirmar que ele não referencia CDN de fonte. Não é fronteira de sanitização de entrada não confiável. |
| #1, #2, #3 | `js/path-injection` | Fechados pela decisão 2 acima; a dispensa não se aplica — entram aqui só para a lista dos dez fechar. |

Sobrou aberto, no Dependabot: `image-size` (dois alertas HIGH). Não há versão
corrigida publicada — a 2.0.2 é a última do registry e é a vulnerável. Entra por
`@docusaurus/mdx-loader`, build da doc, lendo imagens versionadas neste
repositório; não há entrada não confiável no caminho.
