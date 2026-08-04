# 0050 — Credencial sempre cifrada; verificação vira ação explícita

## Contexto

O [ADR 0004](0004-git-credential-registration.md) estabeleceu, para tokens de
git, que o cadastro **testa a credencial contra o provider antes de cifrar e
persistir** — token inválido responde erro em vez de ser guardado para falhar
depois. A Fase 11a copiou a mesma ordem para chaves de LLM.

A ordem parecia prudente. Em uso real produziu o pior desfecho possível.

Um owner tentou cadastrar a chave do OpenRouter na tela de configurações.
Seis cliques, seis `POST /users/me/credentials`, seis `422`. Do lado dele, o
botão Salvar **não fazia nada** — e essa parte era um segundo defeito, no web
(`handleSave` sem `try/catch`, com o `ApiError` escapando para o
`window.onunhandledrejection`, que só loga). Mas mesmo com a mensagem na tela,
o desenho já estava errado, por três motivos que só aparecem juntos:

1. **Nada é gravado, e a chave não é recuperável.** O campo é write-only e a
   tela nunca reexibe o que foi digitado. Uma recusa deixa o usuário sem
   credencial **e** sem o texto para corrigir — ele reabre a tela no mesmo
   estado de antes, tendo perdido o que colou.
2. **O cadastro julga com informação incompleta.** O teste falha por chave
   inválida, por chave sem saldo, por rede, por timeout, por DNS. Todos viram
   o mesmo `422` no momento errado: o de guardar. A pergunta "esta chave é
   boa?" não é a mesma que "quero guardar esta chave?", e amarrá-las faz a
   segunda depender da primeira ter resposta agora.
3. **A promessa da tela fica impossível de cumprir.** "Write-only, nunca
   reexibida" quer dizer que ninguém — nem o dono — consegue conferir o que
   está guardado. Se guardar pode falhar em silêncio, não sobra nenhuma forma
   de saber em que estado a credencial está.

Havia ainda uma assimetria sem justificativa: o único motivo documentado para
`POST /users/me/git-credentials` existir separado de
`POST /users/me/credentials` era justamente o teste obrigatório.

## Decisão

**Guardar e verificar são dois assuntos. O cadastro só guarda; a verificação é
uma ação própria sobre a credencial já gravada.**

Vale para as duas famílias — chave de LLM e token de git. São a mesma tabela
(`user_credentials`), o mesmo mecanismo de envelope encryption e a mesma
promessa ao usuário; tratá-las diferente produziria duas telas com regras
distintas para o mesmo objeto.

1. **`UpsertUserCredentialUseCase` e `RegisterGitCredentialUseCase` perdem o
   tester.** Restam duas linhas: cifrar e gravar. Uma chave que o provider
   recusaria é gravada do mesmo jeito — o cadastro não julga.

2. **`TestStoredCredentialUseCase`** (novo,
   `application/use-cases/credentials/`) lê o envelope por
   `findSecretByUserAndProvider`, decifra, chama o tester certo (git ou LLM,
   despachado por `isGitCredentialProvider`) e devolve **só o veredito**. O
   texto plano existe dentro do método e não atravessa fronteira nenhuma.

3. **O resultado tem TRÊS estados, não dois:**

   | | quando | por quê |
   |---|---|---|
   | `ok` | o provider aceitou | — |
   | `recusado` | o provider rejeitou | carrega o **motivo dele** (`401`, timeout, sem saldo) — o diagnóstico útil |
   | `nao_suportado` | não há endpoint de teste verificado | `ollama`, `anthropic`, `openai` |

   O terceiro estado não é enfeite. O tester de LLM é NO-OP para os providers
   sem endpoint verificado, e num resultado binário eles voltariam como `ok`:
   a tela afirmaria que a chave foi checada quando ninguém a checou. É a mesma
   regra de capability do [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
   — só se declara o que foi provado. Por isso o port ganhou `supports()`: sem
   ele o silêncio de `test()` é ambíguo.

4. **`POST /users/me/credentials/:provider/test`** — 200 nos três resultados,
   porque o pedido foi processado; `recusado` é um resultado, não um erro de
   protocolo. 404 quando não há credencial: aí não há o que testar.

5. **Chave ruim deixou de ser exceção HTTP.** `LLMCredentialConnectionTestFailedError`
   e `GitCredentialConnectionTestFailedError` continuam existindo e sendo
   lançados pelos testers, mas agora são capturados pelo caso de uso. Saíram
   dos dois `@Catch` (`LlmBindingErrorFilter`, `GitProviderErrorFilter`): um
   filtro que não pode disparar é regra morta, mesmo critério que o docmap
   aplica a glob que não casa com arquivo nenhum.

6. **Um teto de comprimento, e ele é proteção — não validação de formato.**
   `CREDENCIAL_COMPRIMENTO_MAXIMO = 512` nos dois DTOs, mesma natureza do
   `@MaxLength` da senha (`domain/auth/password-policy.ts`): a rota cifra, e
   cifrar copia a entrada. O valor é folgado de propósito. A tentação, depois
   de uma chave truncada ter sido gravada em silêncio, é apertar o teto até
   ele "validar" a chave — e isso recriaria o portão por outra porta. As
   credenciais reais dos nove providers vão de ~26 caracteres (`glpat-`) a
   ~164 (project key da OpenAI); um teto perto do tamanho real recusaria
   cadastro de chave boa, e envelheceria mal quando um provider alongasse o
   formato. Uma chave pela metade continua sendo aceita, e é a rota de teste
   que a desmascara.

7. **A tela oferece o que é possível oferecer.** Não dá para conferir o que
   está guardado, então o que se oferece é **trocar** (o campo agora fica
   visível também com credencial salva — antes era preciso remover primeiro) e
   **testar**. E todo caminho ganhou `try/catch` com toast: era a ausência
   deles que transformava um 422 explicado numa tela muda.

## Consequências

**O que melhora.** A credencial sempre existe depois do cadastro, então há
sempre o que corrigir, trocar ou testar. O diagnóstico ficou melhor do que era:
antes, `422` dizia "não deu"; agora `recusado` carrega a frase do provider. A
rota de git deixou de ter motivo especial para existir separada — segue
separada só pelo formato do corpo, o que está escrito no controller.

**O que piora, e é aceito.** Uma chave inválida pode ficar guardada até alguém
testá-la ou até o primeiro uso real falhar. Isso é intencional: o erro do
primeiro uso é normalizado por `code` desde o ADR 0041, e a alternativa —
recusar a gravação — é o que este ADR está desfazendo. O smoke de cada provider
continua provando a chave real contra a API real, agora pelo caminho novo.

**O que não muda.** Envelope encryption, `user_credentials`, a projeção sem
segredo, o RBAC das rotas, e a regra de que o texto plano nunca volta em
resposta nenhuma.

## O que fica para depois

- **Testar no momento de usar, e mostrar.** Hoje a recusa em `chat`/`sync`
  aparece como erro de turno; poderia marcar a credencial como suspeita na
  tela. Precisa de estado persistido por credencial — não é este ADR.
- **`openai`/`anthropic` sem endpoint de teste verificado** seguem em
  `nao_suportado`. Fecha-se lendo a doc oficial de cada um e acrescentando a
  base URL no mapa do tester, com smoke que prove.

Referencia o [ADR 0004](0004-git-credential-registration.md), cuja ordem este
inverte, e o [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md),
de quem herda a regra de só declarar o que foi provado. Nenhum dos dois é
editado.
