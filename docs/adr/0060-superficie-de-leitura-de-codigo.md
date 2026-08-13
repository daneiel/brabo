# ADR 0060 — A superfície de leitura de código, contida e com orçamento

- **Status:** aceito
- **Data:** 2026-08-08
- **Contexto anterior:** [ADR 0001](0001-git-provider-contract-shape.md) (o contrato
  normalizado de git e o que entra nele), [ADR 0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)
  (a contenção de caminho central, RN-092), [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)
  (as primitivas de escopo que esta contenção reusa)

## Contexto

A FASE 26a acrescentou `listTree` e `getPullRequestDiff` ao `GitProviderContract`,
provadas nos três providers pela suite única. Faltava o consumidor — e a trava
que a própria 26a instalou (`SEM_CONSUMIDOR_AINDA`) reprovaria o CI enquanto ele
não existisse.

O consumidor é a aba Code, e escrevê-lo obrigou a decidir três coisas que nenhum
código anterior tinha decidido, porque nenhuma rota do produto até aqui recebeu
**caminho de arquivo do cliente**.

**A primeira é onde mora a busca.** A aba precisa de quatro leituras: árvore,
conteúdo, busca e diff de PR. Três são operações do contrato. A busca não é de
nenhum dos três providers: GitHub e GitLab têm code search de plataforma, com
semânticas e limites próprios; o `LocalGitProvider` é um bare repo e não tem
nada disso. Declarar `search` no contrato significaria ou uma 13ª operação com
capability `false` no local — uma aba que funciona em dois providers e some no
terceiro — ou importar o vocabulário de code search de uma plataforma para
dentro do contrato normalizado, que existe justamente para não deixar o shape do
Octokit vazar.

**A segunda é o custo.** Ler é barato por chamada e caro por repetição. A árvore
e o diff já têm teto no contrato (26a), mas eles limitam UMA resposta; a busca
composta faz N chamadas, e N cresce com o tamanho do repositório e não com o
tamanho do pedido. Quem paga é a credencial do owner do workspace
([RN-058](../business-rules.md#rn-058)/[RN-082](../business-rules.md#rn-082)),
e o rate limit é do provider. O produto já viu essa família de defeito de perto:
o dashboard fazia 3.824 requisições por minuto porque cada projeto pedia a sua
(RN-090), e o `429` resultante virava tela branca.

**A terceira é o caminho.** `../../etc/passwd` numa query string chega ao
handler já decodificado pelo Express. Em `github`/`gitlab` esse caminho vira
segmento de URL da API do provider, então um `..` não lê o arquivo errado: ele
**troca de endpoint**, com o token do owner na mão. Em `local` ele vira o lado
direito de `git show <ref>:<path>`. É a mesma classe de problema que o ADR 0058
fechou para o `projectId`, aplicada agora ao caminho de arquivo — e a FASE 14d
já ensinou o modo de falha que interessa evitar: testar a peça não é testar o
caminho até ela.

## Decisão

**A busca fica FORA do contrato de git, composta na camada de aplicação, com
orçamento.** `ReadProjectCodeUseCase` varre a árvore em largura chamando
`listTree` e abre arquivos com `getFileContent`. Três orçamentos a param —
diretórios percorridos, arquivos abertos, casamentos devolvidos — e `truncated`
diz que ela parou. Largura e não profundidade porque, cortada no meio, ela
entrega os arquivos mais rasos, que é onde quem busca costuma olhar. Um cache de
TTL curto (30s), limitado em número de entradas, evita que navegar e buscar
repitam as mesmas chamadas; curto porque a aba lê uma branch viva, e um TTL
longo mostraria código que já mudou.

**A contenção de caminho é UMA função, no arquivo da RN-092.**
`caminhoDeRepositorioContido()` ancora o caminho do cliente na pasta do projeto
via `projectScopeRoot()` e reusa `normalizarCaminho`/`dentroDoEscopo` do ADR
0055. Ela devolve o caminho **normalizado**, e o chamador usa o que voltou —
devolver o original permitiria conferir uma string e mandar outra ao provider.
Caminho absoluto é recusado mesmo quando o nome existiria dentro do repositório:
reinterpretar a barra inicial seria conversão silenciosa. A `ref` é conferida no
mesmo lugar, e `..` nela é recusado porque para o git `dev..main` é intervalo de
commits, não revisão. Nenhuma rota valida caminho por conta própria.

**As quatro rotas são `GET`, `role:viewer`, e o controller não tem verbo de
escrita.** Ver o código do projeto é a mesma permissão que ver o projeto.
Leitura **não** vira `proposed_action`: ela não é efeito externo, e transformá-la
em ação de aprovação encheria a fila de ruído até ninguém mais ler as de verdade.
A credencial usada é a do owner, pelo mesmo resolvedor da escrita.

## Consequências

**O CodeQL vai continuar apontando, e isso é o preço aceito.** Barreira que mora
em outra função ele não enxerga — foi o que fez os três `js/path-injection`
sobreviverem à correção da PÓS-FASE 15, e a decisão de então foi manter a
checagem central e pagar no painel. Ela não muda aqui: duplicar a contenção em
cada rota calaria o alerta e criaria quatro cópias que um dia divergem. Alerta
novo deste caminho se dispensa com justificativa escrita, nunca em silêncio.

**A busca não é a busca do GitHub, e não deve fingir que é.** Ela não indexa,
não entende sintaxe, não ordena por relevância, e num repositório grande ela
CORTA. O contrato com quem consome é `truncated` + `filesScanned`: a tela diz
que houve corte e sugere refinar o `path`. Trocar isso por code search de
plataforma é decisão futura, e teria de resolver a assimetria do provider
`local` antes.

**O cache é compartilhado entre quem tem acesso ao mesmo projeto.** A chave não
tem usuário, porque quem chega já passou pelo `role:viewer` da rota e o
repositório é o mesmo para todos eles. Se algum dia a leitura passar a depender
de QUEM lê, a chave precisa ganhar essa dimensão — está escrito no código porque
é o tipo de premissa que some.

**A janela de 30s é atraso visível.** Um push feito fora do produto pode demorar
até meio minuto para aparecer na aba. Invalidação de verdade exigiria saber
quando o repositório mudou, e o produto não tem esse sinal para push externo;
o TTL curto é a escolha honesta enquanto ele não existir.

**Fica de fora, declaradamente:** destaque de sintaxe (dependência nova, item 35
da fase, decisão da 26c), terminal interativo (depende do container por projeto
da FASE 25) e qualquer escrita pela aba. Quando a escrita vier, ela nasce
`proposed_action` — e o fato de este controller não ter um único verbo de
escrita é o que torna essa fronteira verificável, e não uma intenção.
