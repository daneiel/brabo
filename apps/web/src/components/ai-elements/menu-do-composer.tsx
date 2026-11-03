import { Popover, PopoverContent } from '@/components/shadcn/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/shadcn/command';
import { cn } from '@/lib/utils';
import type { ItemDoMenu } from '../../lib/comandos-do-composer';

export const idDoItemDoMenu = (idDaLista: string, indice: number) => `${idDaLista}-${indice}`;

/**
 * AT-717: a LISTA de sugestões do `@` e do `/` — `Command` do shadcn dentro de
 * um `Popover`. O foco NUNCA sai do campo (que segue NÃO controlado, RN-882):
 * quem filtra, navega (`ativo`) e escolhe é o `SessionComposer`, pelo teclado
 * do próprio campo; aqui só se desenha. O campo aponta para a opção ativa por
 * `aria-activedescendant` (o id sai de `idDoItemDoMenu`).
 */
export function MenuDoComposer({
  aberto,
  ancora,
  idDaLista,
  titulo,
  vazio,
  itens,
  ativo,
  aoEscolher,
}: {
  aberto: boolean;
  ancora: HTMLElement | null;
  idDaLista: string;
  titulo: string;
  vazio: string;
  itens: ItemDoMenu[];
  ativo: number;
  aoEscolher: (item: ItemDoMenu) => void;
}) {
  return (
    <Popover open={aberto && !!ancora}>
      <PopoverContent
        anchor={ancora}
        side="top"
        align="start"
        className="w-80 p-0"
        initialFocus={false}
        finalFocus={false}
        data-testid="menu-do-composer"
      >
        <Command filter={null}>
          <CommandList id={idDaLista} aria-label={titulo}>
            <CommandGroup>
              {itens.map((item, i) => (
                <CommandItem
                  key={item.id}
                  {...({ id: idDoItemDoMenu(idDaLista, i) } as object)}
                  value={item.id}
                  aria-selected={i === ativo}
                  aria-disabled={item.inerte ? true : undefined}
                  className={cn('flex-col items-start gap-0.5', i === ativo && 'bg-muted')}
                  // O clique não rouba o foco do campo.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => aoEscolher(item)}
                >
                  <span className="font-medium">{item.rotulo}</span>
                  {(item.inerte ?? item.descricao) && (
                    <span className="text-xs text-muted-foreground">{item.inerte ?? item.descricao}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {itens.length === 0 && <CommandEmpty>{vazio}</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
