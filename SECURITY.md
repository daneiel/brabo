# Política de segurança

## Versões suportadas

| versão | suportada |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ (pré-release) |

O projeto está em `0.x`: só a série mais recente recebe correção. Não há
backport para versões anteriores.

## Reportar uma vulnerabilidade

**Não abra issue pública para falha de segurança.**

Mande um e-mail para **daneoliveira.s@gmail.com** com o assunto começando em
`[SEGURANÇA]`.

> **Por que e-mail e não o canal do GitHub.** O *Private vulnerability
> reporting* do GitHub é o caminho preferido — ele cria um aviso visível só
> para os mantenedores, sem sair da plataforma. Mas ele **só existe em
> repositório público**, e este é privado: a API responde 404, não 403.
>
> Quando o repositório for aberto, habilite em *Settings → Security → Private
> vulnerability reporting* e troque esta seção pelo link
> [Report a vulnerability][pvr]. O e-mail continua valendo como alternativa.

O que ajuda no relato: o que você observou, como reproduzir, e o impacto que
enxerga. Prova de conceito é bem-vinda; exploração contra instalação de
terceiro, não.

**Prazo de resposta:** este é um projeto mantido em tempo livre. O compromisso
honesto é confirmar o recebimento; não há SLA de correção.

## Escopo

O que **é** deste projeto: o código em `apps/`, `packages/`, `docker/` e
`deploy/`, e as imagens construídas a partir dele.

O que **não** é: Keycloak, PostgreSQL, Ollama, MinIO e os demais componentes de
terceiros que o Brabo orquestra — reporte a eles diretamente. As imagens de
desenvolvimento (`docker-compose.yml`) usam segredos padrão e Keycloak em
`start-dev` **de propósito**, e isso está documentado no
[ADR 0024](docs/adr/0024-fase5-imagens-producao-ci.md); não é vulnerabilidade.

## O que o projeto já faz

Para calibrar o relato, o que existe hoje:

- **Segredos do usuário** (chaves de LLM, tokens de git) sob envelope
  encryption; nunca em texto plano no banco ou em log. Rotação da chave mestra
  documentada no [runbook](docs/runbook.md).
- **Superfície HTTP auditada**: as 110 rotas da api estão classificadas em
  [`docs/security-surface.md`](docs/security-surface.md), e um teste de tabela
  reprova rota nova sem classificação.
- **Toda ação com efeito externo** passa por aprovação
  (`proposed_action` + `permissions.json`, `deny` vence `allow`).
- **CI** roda gitleaks na árvore, Trivy nas imagens (`HIGH`/`CRITICAL`
  corrigíveis reprovam) e auditoria de dependências com gate em crítica.

[pvr]: https://github.com/daneiel/brabo/security/advisories/new
