# ADR 0113 — Pasta local anexada vira `chunks.scope = 'local'`, lida pelo NAVEGADOR, nunca um caminho do host

## Status

Aceito.

Referencia (sem editar): [ADR 0072](0072-projeto-local-ou-container.md),
[ADR 0079](0079-tabela-de-chunks-vetor-e-tsvector-juntos.md),
[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md),
[ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md),
[ADR 0108](0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md).

## Contexto

### O pedido

Deixar o usuário anexar a um projeto uma pasta local da própria máquina como
material de REFERÊNCIA SOMENTE LEITURA para os agentes — explicitamente SEM
rodar a CLI `brabo-runner` (ADR 0103). Isto NÃO é execução de projeto nem
workspace: o `execution_mode: runner` (ADR 0104) existe justamente porque a
execução precisa de um caminho REAL do HOST para o qual o container/engine
possa rotear comandos, confirmado por um runner que se conecta e o verifica
(RN-423). Esta feature está mais perto de "anexar arquivos a uma conversa" do
que de "montar um workspace".

### O que o ADR 0072 e o ADR 0107 de fato recusaram, e por que isto é diferente

As duas decisões tratam de resolver um CAMINHO absoluto DO HOST a partir do
navegador. O ADR 0072 recusou um *seletor* de pasta na criação do projeto
porque "um seletor exigiria que a api enumerasse para o navegador o sistema
de arquivos do CONTAINER" — superfície nova só por ergonomia, e ainda por
cima um sistema de arquivos do contexto errado. O ADR 0107 resolveu a
*navegação* de pasta roteando a leitura pelo Runner (um processo com os
privilégios do próprio usuário na própria máquina dele, não a api)
justamente porque a api nunca enxerga o sistema de arquivos real do usuário.

As duas tratam de DE ONDE VEM UM CAMINHO NO DISCO DO USUÁRIO, e as duas
importam porque um caminho alimenta ou a criação do projeto
(`workspace_path`) ou a execução de comando (o `cwd` do `TerminalExecutor`) —
contextos em que um caminho ERRADO é problema de segurança e de correção: ele
decide contra o que um agente pode executar.

Esta feature nunca resolve um caminho do host. O `<input webkitdirectory>` do
navegador devolve objetos `File`; o código lê o *conteúdo* deles
(`File.text()`) e o caminho *relativo* dentro da pasta escolhida
(`File.webkitRelativePath`) — nunca um caminho absoluto, porque a File API
do navegador não expõe um, por desenho, para site nenhum. O que atravessa a
rede é TEXTO que o navegador já tinha direito legítimo de ler, exatamente o
mesmo modelo de confiança de qualquer upload comum por `<input type="file">`
em qualquer site. Não há caminho a validar, isolar ou rotear para um runner,
porque não há caminho nenhum. Construir um repasse no estilo do runner para
isto seria resolver um problema que esta feature não tem.

### Por que reusar o pipeline do RAG em vez de um mecanismo paralelo

O produto já tem um pipeline de chunking/embedding/busca híbrida que
funciona (ADR 0079/0080): a tabela `chunks`, o `RagEmbeddingService`,
`chunkText`/`chunkMarkdownDocument`, `ChunkRepository.searchByVector`/
`searchByLexicalQuery`, e a renderização de citação da aba Chat RAG
(`RagCitationCard`, `origemDoChunk`). Um arquivo anexado localmente tem,
estruturalmente, a mesma forma de um arquivo de doc/ADR indexado: um caminho
mais conteúdo que deve ser buscável e citável. Construir um segundo
armazenamento paralelo de "arquivos anexados" e uma segunda UI de citação
duplicaria um pipeline que já faz exatamente esse trabalho, sem outro motivo
além de a origem dos bytes ser um upload do navegador em vez de um blob do
git.

## Decisão

**`chunks.scope` ganha um quarto valor, `'local'`**, acrescentado via `ALTER
TYPE ... ADD VALUE` (migration `0052`) — aditivo, sem migração de dados, sem
CHECK novo: as constraints existentes `chunks_session_id_casa_com_escopo`/
`chunks_source_path_casa_com_escopo` (migration `0045`) já estão escritas
como "é `session` ou não", então `local` cai do mesmo lado de `docs`/`adr`
(tem `source_path`, não tem `session_id`) com zero mudança de schema além do
valor do enum.

**`IndexLocalFolderUseCase`** espelha de perto o `IndexProjectDocsUseCase`:
divide cada arquivo em chunks (ciente de Markdown via
`chunkMarkdownDocument` para `.md`/`.mdx`, `chunkText` nos demais), chama o
mesmo `RagEmbeddingService`, grava chunks com `embedding: null` quando o
embedding falha (o mesmo padrão de honestidade que `docs`/`adr` já usam —
RN-233), e faz `deleteByScope(projectId, 'local')` completo + recriação a
cada chamada. `origemDoChunk` precisou de ZERO mudança: chunks `local`
carregam `sourcePath` exatamente como `docs`/`adr`, então caem no ramo
existente `kind: 'file'` — a UI de citação já os trata.

**Recusa de uma vez, nunca truncamento silencioso.** Ao contrário de
`docs`/`adr` (uma varredura em segundo plano sem usuário olhando), anexar uma
pasta é um gesto único do usuário, com um seletor de pasta na frente dele. O
`IndexLocalFolderUseCase` RECUSA (400) o upload inteiro quando os tetos
agregados são ultrapassados (contagem de arquivos, soma de bytes) — quem
clicou em "Anexar" está olhando a tela e pode escolher uma pasta menor. Um
arquivo individual grande demais ou com extensão não reconhecida é só
PULADO (`filesSkipped`), nunca derruba o lote — a mesma distinção que o
`IndexProjectDocsUseCase` já faz implicitamente ao filtrar só `.md`.

**Nunca ligado ao "Reindexar agora" genérico.** O `ReindexProjectUseCase`
relê de uma fonte que o SERVIDOR pode revisitar — o repositório do projeto
(`docs`/`adr`) e o event log (`session`). O escopo `local` não tem fonte
assim: o texto vive só no navegador de quem o anexou, e o servidor nunca
persistiu um caminho do host (não existe um). Chamar `deleteByScope(projectId,
'local')` pelo botão genérico de reindexar apagaria o material de referência
anexado pelo usuário sem forma de recriá-lo — reenviar a pasta é o ÚNICO
mecanismo de ressincronização, e ele é um botão deliberadamente separado
(`POST .../rag/local`, `maintainer`, o mesmo papel de `reindex` porque ele
também aciona o provider de embedding e substitui o que está indexado). Os
dois casos de uso levam um comentário explícito no código apontando um para o
outro e para este ADR, para que uma futura "correção" não os ligue e apague
em silêncio o material de referência dos usuários num clique sem relação.

**A cobertura diz a verdade sobre o que `local` de fato é.**
`RagCoverage.local` é uma forma NOVA (`RagLocalCoverage`), não um reuso de
`RagFileCoverage`: não há "total de arquivos no repositório" com que
comparar — um upload do navegador não tem repositório a revarrer. Ela
informa o que está indexado AGORA (`filesIndexed`, `folderName`,
`lastAttachedAt`). `lastAttachedAt` é a ÚNICA exceção declarada à regra do
produto de "nunca mostrar um timestamp chutado" (RN-237/ADR 0080): é um
`MAX(chunks.created_at)` real sobre o escopo, não um valor calculado ou
estimado — a mesma disciplina de honestidade, aplicada a um escopo em que um
timestamp real por acaso tem resposta.

## O que este ADR NÃO faz

- **Não toca `execution_mode`/`workspace_path`/o runner.** Eles continuam
  exatamente como os ADRs 0072/0104/0107 descrevem: como o código de um
  projeto EXECUTA. Esta feature acrescenta material de referência ao índice
  do RAG; não tem opinião sobre onde o código de um projeto mora ou roda.
- **Não acrescenta um quinto conceito de "arquivos anexados".** Nenhuma
  tabela nova, nenhum formato de citação paralelo — `local` é um valor do
  mesmo `ChunkScope` que o resto do pipeline já fala.
- **Não indexa o repositório do próprio projeto uma segunda vez.** `docs`/
  `adr` continuam sendo lidos do repositório git do projeto via
  `ReadProjectCodeUseCase`; `local` é deliberadamente uma fonte SEPARADA,
  para material que não tem nada a ver com o repositório do próprio projeto
  (uma spec, uma implementação de referência, a doc de um concorrente,
  qualquer coisa que o usuário queira que um agente consiga buscar).

## Consequências

- **Um segundo upload substitui o primeiro, inteiro.** Não há "acrescentar
  ao que está anexado" — o `IndexLocalFolderUseCase` apaga o escopo `local`
  inteiro antes de gravar o novo. É a MESMA disciplina de reconstrução
  completa e idempotente que `docs`/`adr`/`session` já seguem (RN-231),
  aplicada de forma coerente em vez de inventada especialmente para este
  escopo.
- **Arquivos binários e grandes demais ficam ausentes da busca em silêncio,
  declarados via `filesSkipped`.** A allowlist de extensões
  (`RAG_LOCAL_ALLOWED_EXTENSIONS`) é uma restrição real de conteúdo, não só
  acabamento de UX — o servidor a impõe independentemente do que o navegador
  tenha pré-filtrado, porque o pré-filtro do lado do cliente é conveniência,
  não a garantia.
- **A fronteira de confiança é exatamente a de um upload de arquivo comum.**
  Sem isolamento, sem allowlist de caminho, sem ticket de runner — porque não
  há caminho nenhum nesta feature, só bytes que o navegador já tinha. Quem
  pode chamar `POST .../rag/local` (papel `maintainer`) pode pôr texto
  arbitrário no índice de busca do projeto; é a mesma autoridade que a rota
  já exige para `reindex`.

## Alternativas consideradas

- **Rotear a leitura pelo Runner (ADR 0103/0107), como a navegação de
  pasta.** Recusada: o Runner existe para dar ao ENGINE um caminho real do
  host contra o qual executar comandos, numa máquina que o usuário configurou
  explicitamente com a CLI. Esta feature foi pensada explicitamente para
  funcionar SEM a CLI, para material de referência somente leitura — roteá-la
  pelo Runner tornaria a CLI um requisito que esta feature foi desenhada para
  não ter.
- **Uma tabela `attachments` nova, independente de `chunks`.** Recusada:
  duplicaria chunking, embedding, busca híbrida e renderização de citação
  sem benefício nenhum — a forma "caminho + conteúdo, buscável, citável" é
  exatamente o que `chunks` já modela.
- **Ligar `local` ao `ReindexProjectUseCase`.** Recusada: não há nada do lado
  do servidor a reler para este escopo; ligá-lo faria o botão genérico de
  reindexar apagar em silêncio o material de referência anexado pelos
  usuários, sem forma de trazê-lo de volta.
