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
```

## O que respeitar

- **`mono` não é decoração.** Use sempre que o conteúdo é comparado caractere a
  caractere: token, comando de terminal, nome de branch, id. Sem ele, um `l` e
  um `1` ficam ambíguos no campo.
- `icon` aceita qualquer nó, mas o espaço é de um ícone de 14px. Rótulo dentro
  do campo não cabe — use um `<label>` fora.
- O componente não renderiza rótulo nem mensagem de erro. Isso é do formulário
  que o contém (veja como o `CredentialStep` faz).
