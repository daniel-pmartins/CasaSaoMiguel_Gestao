create table if not exists public.categorias_insumos (
  nome text primary key,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

insert into public.categorias_insumos (nome, ordem)
values
  ('INGREDIENTE', 0),
  ('EMBALAGEM', 1),
  ('DESCARTAVEL', 2),
  ('LIMPEZA', 3),
  ('MANUTENCAO', 4),
  ('PREPARO', 5)
on conflict (nome) do nothing;

update public.insumos
set categoria = upper(translate(categoria, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'))
where categoria <> upper(translate(categoria, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'));

insert into public.categorias_insumos (nome, ordem)
select distinct upper(translate(i.categoria, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')),
       100 + row_number() over (order by i.categoria)
from public.insumos i
where trim(i.categoria) <> ''
on conflict (nome) do nothing;
