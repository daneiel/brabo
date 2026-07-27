# Runbook — restaurar o Postgres a partir do backup

Decisões em [ADR 0027](../adr/0027-fase5-backup-hardening-release.md).

> **Testado.** O procedimento abaixo é exatamente o que `make test-restore`
> executa, e ele é rodado contra o cluster local. Não existe aqui nenhum passo
> que ninguém nunca exercitou. O registro da última execução está no fim.

## Onde está o backup

| o quê | onde |
|---|---|
| agendamento | CronJob `brabo-backup`, 03:17 UTC, diário |
| destino | bucket S3-compatível — `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` no Secret `brabo-secrets` |
| layout | `daily/brabo-<ISO>.dump` e `weekly/brabo-<ISO>.dump` |
| retenção | 7 diários + 4 semanais, por CONTAGEM (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`) |
| formato | `pg_dump --format=custom --compress=9` |
| histórico | tabela `backup_runs` |

No cluster local o destino é um MinIO dentro do namespace `brabo`; em
staging/prod é o bucket real. O procedimento não muda — só o endpoint.

## Antes de restaurar: o backup existe e presta?

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

Três coisas nessa saída importam mais que a última linha:

- **`status = 'failed'` recente com sucesso antigo** é o caso perigoso: existe
  backup, ele só é velho. O alerta *Última execução do backup falhou* cobre
  exatamente isso.
- **Queda brusca de `size_bytes`** entre execuções sugere dump truncado, e o
  tamanho sozinho não denuncia — o `pg_restore --list` do script é quem pega.
- **Nenhuma linha** significa que o CronJob nunca rodou com sucesso. Aí o
  problema não é o restore.

## Restaurar

### O caminho automatizado (o mesmo que o teste roda)

```bash
make test-restore
```

Dispara um backup real, restaura em `brabo_restore_test`, valida e derruba a
database. Use quando o objetivo é **verificar** o backup, não recuperar dados.

### Restaurar de verdade, num incidente

O script `brabo-restore` restaura numa database NOVA e nunca toca na de origem
— de propósito. Restaurar por cima do banco vivo é irreversível e quase sempre
a decisão errada nos primeiros minutos de um incidente.

**1. Suba um Job de restore apontando para o nome de database que você quer:**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

Para restaurar de uma cópia semanal em vez da última diária:
`RESTORE_PREFIX=weekly/`.

**2. Confira o que voltou** — as mesmas perguntas que o script faz, agora com
os seus olhos:

```sql
-- 32 tabelas
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- o event log é denso por sessão: esta consulta tem que voltar VAZIA
select session_id, count(*), min(seq), max(seq)
  from session_events
 group by session_id
having count(*) <> max(seq) - min(seq) + 1 or min(seq) <> 1;
```

**3. Promova a database recuperada** apontando a `DATABASE_URL` para ela e
reiniciando api e engine. É a última etapa e a única destrutiva:

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> O Secret é materializado pelo External Secrets a partir do provider. Um
> `patch` direto é sobrescrito no próximo `refreshInterval` (1 h): mude
> **também** o valor no provider, ou o sistema volta sozinho para o banco
> antigo dentro de uma hora — em plena recuperação.

## O que o restore NÃO cobre

- **Credenciais de usuário ficam ilegíveis se a `CREDENTIALS_MASTER_KEY` for
  outra.** O dump traz os DEKs embrulhados, não as chaves. Restaurar num
  ambiente com master key diferente devolve o banco íntegro e as credenciais de
  LLM e git inúteis. Ver
  [rotacao-chave-mestra.md](rotacao-chave-mestra.md).
- **Keycloak** tem banco próprio e não entra neste backup: usuários e realm são
  recriados pelo import do realm.
- **PVCs** (`/data/git-repos`, worktrees dos agentes) não são copiados. Os
  repositórios de verdade vivem no GitHub/GitLab; o que se perde é cache de
  trabalho em andamento.
- **Não é PITR.** A granularidade é o último dump; tudo escrito depois dele se
  perde. Se isso não for aceitável, o caminho é WAL archiving no CloudNativePG,
  que está fora do escopo desta fase.

## Quando o restore falha

| sintoma | causa provável |
|---|---|
| `nenhum backup em .../daily/` | bucket errado, credencial errada, ou o CronJob nunca rodou |
| `não é um dump custom íntegro` | upload interrompido; use o objeto anterior ou o `weekly/` |
| `pg_restore falhou` com erro de extensão | a database de destino precisa das mesmas extensões (`pgvector`); em CNPG elas vêm do cluster, não do dump |
| `esperava 32 tabelas, encontrou N` | dump de uma versão de schema diferente — confira a data do objeto contra a migration mais recente |
| `fora da janela` numa tabela crítica | contagem incompatível com o instante do dump: investigue antes de promover |
| timeout no Job | banco grande demais para `activeDeadlineSeconds`; suba o valor no Job, não no CronJob |

## Última execução verificada

<!-- Atualize esta seção sempre que rodar o teste num ambiente novo. -->

| campo | valor |
|---|---|
| data | 2026-07-27 |
| ambiente | cluster local k3d, PostgreSQL 16.10 (CloudNativePG), MinIO |
| comando | `make test-restore` |
| RTO observado | ~40 s do disparo do backup ao veredito (banco de ~108 KB) |

Saída:

```
[restore]   ok    dump íntegro (107980 bytes)
[restore] restaurando em brabo_restore_test
[restore]   ok    pg_restore concluído
[restore]   ok    35 tabelas restauradas, idênticas à origem
[restore]   ok    users: 2 linhas (janela 2–2)
[restore]   ok    projects: 2 linhas (janela 2–2)
[restore]   ok    sessions: 2 linhas (janela 2–2)
[restore]   ok    session_events: 3 linhas (janela 3–3)
[restore]   ok    proposed_actions: 0 linhas (janela 0–0)
[restore]   ok    event log íntegro: 3 eventos em 1 sessões, seq densa a partir de 1
[restore] RESTORE VALIDADO — todas as verificações passaram
```

O RTO acima é de um banco vazio de produção — serve para provar o
PROCEDIMENTO, não para dimensionar uma recuperação real. Meça de novo com um
dump representativo antes de prometer RTO a alguém.

### O que essa execução encontrou (e que o teste agora impede)

1. **Divergência de major do Postgres.** O CloudNativePG local subia 17.4
   enquanto o compose e o CLAUDE.md dizem 16; o `pg_dump` recusou a conexão
   com "server version mismatch". O `imageName` do cluster foi pinado em 16.10.
2. **Falso verde por banco vazio.** Com zero linhas, toda comparação de
   contagem vira `0 == 0` e a checagem de `seq` não olha nada. Hoje o script
   reprova explicitamente nos dois casos.
3. **Contagem fixa de tabelas envelhece.** A validação comparava com um número
   escrito no script, que ficou desatualizado na mesma sessão. Agora compara a
   LISTA de tabelas contra a origem e diz qual falta.
