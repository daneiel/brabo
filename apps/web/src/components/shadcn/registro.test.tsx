import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { simularLayoutMovel } from '../../test/match-media';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';
import { Alert } from './alert';
import { Badge } from './badge';
import { Breadcrumb } from './breadcrumb';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { DropdownMenu, DropdownMenuTrigger } from './dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { Empty } from './empty';
import { Input } from './input';
import { Label } from './label';
import { NativeSelect } from './native-select';
import { Popover, PopoverTrigger } from './popover';
import { Progress } from './progress';
import { Questionnaire, QuestionnaireItem } from './questionnaire';
import { RadioGroup, RadioGroupItem } from './radio-group';
import { ScrollArea } from './scroll-area';
import { Separator } from './separator';
import { Sheet, SheetTrigger } from './sheet';
import { Sidebar, SidebarProvider } from './sidebar';
import { Skeleton } from './skeleton';
import { Spinner } from './spinner';
import { Switch } from './switch';
import { Table } from './table';
import { Textarea } from './textarea';
import { Toggle } from './toggle';
import { Trace } from './trace';

// AT-646 Lane 0 e AT-655 (lane L0, onda 4): fumaça dos componentes baixados do
// registry base-nova. Nada disto é usado em tela ainda; a prova é só que cada um
// monta sem lançar.
const simples = {
  accordion: (
    <Accordion>
      <AccordionItem value="a">
        <AccordionTrigger>x</AccordionTrigger>
        <AccordionContent>y</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  alert: <Alert />,
  badge: <Badge>x</Badge>,
  breadcrumb: <Breadcrumb />,
  card: <Card />,
  checkbox: <Checkbox />,
  dropdown: (
    <DropdownMenu>
      <DropdownMenuTrigger>x</DropdownMenuTrigger>
    </DropdownMenu>
  ),
  popover: (
    <Popover>
      <PopoverTrigger>x</PopoverTrigger>
    </Popover>
  ),
  'radio-group': (
    <RadioGroup>
      <RadioGroupItem value="a" />
    </RadioGroup>
  ),
  'scroll-area': <ScrollArea>x</ScrollArea>,
  sheet: (
    <Sheet>
      <SheetTrigger>x</SheetTrigger>
    </Sheet>
  ),
  switch: <Switch />,
  empty: <Empty />,
  input: <Input />,
  label: <Label>x</Label>,
  'native-select': <NativeSelect />,
  progress: <Progress value={30} />,
  questionnaire: (
    <Questionnaire>
      <QuestionnaireItem name="q" />
    </Questionnaire>
  ),
  separator: <Separator />,
  skeleton: <Skeleton />,
  spinner: <Spinner />,
  table: <Table />,
  textarea: <Textarea />,
  toggle: <Toggle>x</Toggle>,
  trace: <Trace />,
};

describe('shadcn (registry base-nova)', () => {
  it('sidebar monta dentro do provedor no layout móvel (useIsMobile lê matchMedia)', () => {
    const movel = simularLayoutMovel(true);
    try {
      const { container } = render(
        <SidebarProvider>
          <Sidebar>x</Sidebar>
        </SidebarProvider>,
      );
      expect(container.querySelector('[data-slot]')).not.toBeNull();
    } finally {
      movel.restaurar();
    }
  });

  it.each(Object.entries(simples))('%s renderiza com data-slot', (_nome, el) => {
    const { container } = render(el);
    expect(container.querySelector('[data-slot]')).not.toBeNull();
  });

  it('dialog aberto mostra o título e o ícone do lucide no fechar', () => {
    const { baseElement } = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(baseElement.querySelector('[data-slot="dialog-title"]')).not.toBeNull();
    expect(baseElement.querySelector('[data-slot="dialog-close"] svg')).not.toBeNull();
  });

  it('todo módulo exporta algo e nenhum resta com resíduo do registry', () => {
    const mods = import.meta.glob('./*.tsx', { eager: true });
    const fontes = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' });
    for (const [caminho, fonte] of Object.entries(fontes)) {
      if (caminho.includes('.test.')) continue;
      expect(Object.keys(mods[caminho] as object).length, caminho).toBeGreaterThan(0);
      expect(fonte as string, caminho).not.toMatch(/registry\/base-nova|IconPlaceholder|from "cn"/);
    }
  });
});
