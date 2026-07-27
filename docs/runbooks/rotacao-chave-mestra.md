# Runbook — rotacionar a chave mestra da envelope encryption

Decisões em [ADR 0027](../adr/0027-fase5-backup-hardening-release.md).

A `CREDENTIALS_MASTER_KEY` embrulha os DEKs que cifram os segredos do usuário:
chaves de API de LLM e tokens de git. Ela é rotacionada periodicamente e,
obrigatoriamente, depois de qualquer suspeita de vazamento.

## O que está em jogo

O `wrapped_dek` gravado no banco **não identifica qual chave o embrulhou**.
Consequência direta: trocar a variável e reiniciar a api torna ilegível toda
credencial existente, de uma vez, sem erro no boot — a falha só aparece no
primeiro uso, como "não foi possível decriptar", e não há caminho de volta a não
ser restaurar a chave antiga.

Por isso a rotação tem três etapas e não uma. Durante a do meio, as duas chaves
coexistem:

| variável | papel |
|---|---|
| `CREDENTIALS_MASTER_KEY` | chave ATUAL — usada sempre para cifrar |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | chave anterior — tentada só quando a atual falha |

Duas tabelas guardam envelopes: `user_credentials` e `project_git_connections`.

## Antes: dimensione

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

O re-embrulho é um UPDATE por registro. Milhares de linhas levam segundos; é
bom saber a ordem de grandeza antes de começar.

## 1. Publicar as duas chaves

Gere a nova e publique **as duas** no provider de segredos, mantendo a antiga
em `CREDENTIALS_MASTER_KEY_PREVIOUS`:

```bash
openssl rand -hex 32   # a chave nova
```

No cluster local o Secret-fonte é criado pelo bootstrap; em staging/prod o valor
vai no provider que o External Secrets lê. Depois, reinicie a api para que ela
carregue as duas:

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Confirme que a api está no modo de rotação — ela avisa no log, de propósito:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
```

> A partir daqui **nada quebra**: segredo novo já nasce na chave nova, segredo
> antigo continua legível pela anterior. Você pode parar neste estado por horas
> se precisar — mas não por semanas: aceitar duas chaves dobra a superfície de
> uma chave vazada, que é justamente o motivo da rotação.

## 2. Re-embrulhar o acervo

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

Saída esperada:

```
[rewrap] resultado

  user_credentials         total=12  re-embrulhados=12  já na chave atual=0  falhas=0
  project_git_connections  total=3   re-embrulhados=3   já na chave atual=0  falhas=0

[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.
```

Propriedades que importam se algo interromper o script:

- **Idempotente.** Rodar de novo conta os já convertidos em `já na chave atual`
  e não reescreve nada. Interrompeu? Rode outra vez.
- **Só o envelope muda.** O texto cifrado do segredo permanece byte a byte o
  mesmo, então parar no meio deixa o acervo consistente: parte na chave nova,
  parte na antiga, e as duas legíveis enquanto a PREVIOUS existir.
- **`falhas > 0` bloqueia a etapa 3.** São registros que não abrem com nenhuma
  das duas chaves — normalmente vindos de outro ambiente, ou de uma rotação
  anterior interrompida com a chave já descartada. O script identifica cada um
  por id. Não remova a PREVIOUS: sem ela você perde também o que ainda abria.

## 3. Descartar a chave antiga

Só depois de `falhas=0`:

```bash
# remova CREDENTIALS_MASTER_KEY_PREVIOUS do provider e então
kubectl -n brabo rollout restart deployment/api
```

Verifique que o aviso de rotação sumiu do log e que uma credencial existente
ainda funciona (o caminho mais direto é a tela de credenciais do projeto, ou
qualquer turno de agente que use chave de LLM).

## Verificar sem esperar um incidente

O `rewrap` roda em qualquer ambiente. Num de teste, o ciclo completo cabe em
poucos minutos e é o que valida o procedimento — a mesma lógica está coberta em
`test/infrastructure/security/envelope-encryption.service.spec.ts`, inclusive o
caso em que nenhuma das duas chaves serve.

## Interação com o restore

**Restaurar um dump num ambiente com master key diferente devolve o banco
íntegro e as credenciais inúteis.** O dump carrega os DEKs embrulhados, não a
chave. Se você restaurou um backup de produção num ambiente de teste e as
credenciais não abrem, não há corrupção: é a chave errada. Ver
[restore.md](restore.md).

Por isso a chave mestra faz parte do plano de recuperação: um backup do banco
sem a chave correspondente não recupera os segredos do usuário.

## Quando algo dá errado

| sintoma | causa |
|---|---|
| api sobe sem aviso de rotação, mas o script exige a PREVIOUS | a variável não chegou ao pod; o ESO só ressincroniza a cada `refreshInterval` (1 h) |
| `falhas` igual ao total | a PREVIOUS publicada não é a chave que embrulhou o acervo |
| `já na chave atual` igual ao total, sem ter rodado antes | as duas variáveis têm o mesmo valor — o serviço ignora a PREVIOUS nesse caso |
| credencial para de funcionar DEPOIS da etapa 3 | algum registro ficou para trás; republique a PREVIOUS imediatamente e rode o script de novo |
