-- Alinha a opção Full do Mercado Livre genérico ao formato operacional solicitado.
-- Não altera histórico, fila ou cadastros comerciais.
UPDATE public.nisti_dispatch_platform_options
SET options='["Full","Empresa","Venda Direta","Mercado Flex","Flex Avulso","Turbo"]'::jsonb,
    updated_at=clock_timestamp()
WHERE platform='MERCADO LIVRE'
  AND NOT (options ? 'Full');
