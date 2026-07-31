---
category: Primitivas
keywords: [campo, formulário, texto, mono, ícone]
---

# Input

Campo de texto de uma linha. Repassa os atributos de `<input>` por spread, então
`type`, `placeholder`, `disabled`, `readOnly` e `value`/`onChange` são os
nativos.

## Como usar

```tsx
<Input placeholder="Nome do projeto" value={nome} onChange={(e) => setNome(e.target.value)} />

// Com adorno à esquerda — na app é sempre um ícone do set.
<Input icon={<SearchIcon size={14} />} placeholder="Buscar sessão" />

// mono para segredo, comando, branch ou SHA.
<Input mono type="password" placeholder="ghp_…" />

// Campo de formulário: rótulo, apoio e erro são do próprio Input.
<Input label="E-mail" type="email" autoComplete="username" value={email} onChange={…} />
<Input label="Senha" type="password" error={erro} value={senha} onChange={…} />
```

## O que respeitar

- **`mono` não é decoração.** Use sempre que o conteúdo é comparado caractere a
  caractere: token, comando de terminal, nome de branch, id. Sem ele, um `l` e
  um `1` ficam ambíguos no campo.
- `icon` aceita qualquer nó, mas o espaço é de um ícone de 14px. Rótulo dentro
  do campo não cabe: é para isso que existe a prop `label`.
- **Use `label` em formulário, sempre.** O componente associa rótulo e campo por
  um `id` estável (`useId()`), que é o que faz leitor de tela e clique no rótulo
  funcionarem. Um `<label>` montado à mão fora do componente perde isso.
- **`error` e `hint` ocupam o mesmo lugar** sob o campo, e `error` ganha quando
  os dois vêm juntos. `error` também marca o campo como inválido
  (`aria-invalid`) e anuncia a mensagem com `role="alert"` — não sinalize erro
  só com cor de borda.
- Sem `label`, `error` e `hint`, o componente é só a caixa — é assim que ele
  aparece em filtro, busca e campo de token.
