-- 002_dashboard_pos_schema.sql — VentasCel
-- Esquema para POS, Gastos, Métricas y Ajustes.
-- Idempotente: se puede aplicar dos veces sin error.
-- Origen: Spec 002, Plan §4.

-- 1) Añadir columna cost_price a public.products si no existe
alter table public.products
  add column if not exists cost_price numeric(12,2) not null default 0.00
  check (cost_price >= 0);

-- 2) Tabla public.settings (ajustes de una sola fila, exchange_rate)
create table if not exists public.settings (
    id            smallint primary key default 1 check (id = 1),
    exchange_rate numeric(12,2) not null default 820.00 check (exchange_rate > 0),
    updated_at    timestamptz not null default now(),
    updated_by    uuid references auth.users(id) on delete set null
);

insert into public.settings (id, exchange_rate)
values (1, 820.00)
on conflict (id) do nothing;

-- 3) Tabla public.sales
create table if not exists public.sales (
    id             uuid primary key default gen_random_uuid(),
    created_at     timestamptz not null default now(),
    origin         varchar(20) not null default 'FISICO' check (origin in ('ONLINE', 'FISICO')),
    payment_method varchar(20) not null check (payment_method in ('EFECTIVO', 'DIGITAL')),
    items          jsonb       not null check (jsonb_typeof(items) = 'array'),
    total_cup      numeric(12,2) not null check (total_cup >= 0),
    total_usd      numeric(12,2) not null check (total_usd >= 0),
    total_profit   numeric(12,2) not null,
    rate_used      numeric(12,2) not null check (rate_used > 0),
    created_by     uuid references auth.users(id) on delete set null
);

create index if not exists sales_created_at_idx on public.sales (created_at desc);

-- 4) Tabla public.expenses
create table if not exists public.expenses (
    id         uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    concept    text        not null,
    category   varchar(50) not null default 'General',
    amount_cup numeric(12,2) not null check (amount_cup >= 0)
);

create index if not exists expenses_created_at_idx on public.expenses (created_at desc);

-- 5) Disparadores y funciones auxiliares para public.settings
create or replace function public.settings_set_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.settings_apply_exchange_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.exchange_rate is distinct from old.exchange_rate then
    update public.products
       set price_usd = round(price_cup / new.exchange_rate, 2),
           old_price_usd = case
             when old_price_cup is null then null
             else round(old_price_cup / new.exchange_rate, 2)
           end;
  end if;
  return null;
end $$;

drop trigger if exists settings_audit_trg on public.settings;
create trigger settings_audit_trg
  before insert or update on public.settings
  for each row execute function public.settings_set_audit();

drop trigger if exists settings_rate_trg on public.settings;
create trigger settings_rate_trg
  after update of exchange_rate on public.settings
  for each row execute function public.settings_apply_exchange_rate();

-- 6) Función atómica register_sale
create or replace function public.register_sale(
  p_items jsonb,
  p_payment_method text,
  p_origin text default 'FISICO'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text := (select auth.jwt()) -> 'app_metadata' ->> 'role';
  v_rate       numeric(12,2);
  v_sale_id    uuid := gen_random_uuid();
  v_total_cup  numeric(12,2) := 0;
  v_profit     numeric(12,2) := 0;
  v_items      jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_product    public.products%rowtype;
  v_qty        integer;
begin
  if v_role is distinct from 'admin' then
    raise exception 'Solo admin' using errcode = '42501';
  end if;
  if p_payment_method not in ('EFECTIVO', 'DIGITAL') then
    raise exception 'Método de pago no válido' using errcode = '22023';
  end if;
  if p_origin not in ('ONLINE', 'FISICO') then
    raise exception 'Origen no válido' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene líneas' using errcode = '22023';
  end if;

  select exchange_rate into v_rate from public.settings where id = 1;
  if v_rate is null then
    v_rate := 820.00;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad no válida' using errcode = '22023';
    end if;

    select * into v_product
      from public.products
     where id = (v_item ->> 'product_id')::bigint
       for update;

    if not found then
      raise exception 'Producto % no existe', v_item ->> 'product_id' using errcode = '22023';
    end if;

    if v_product.stock is not null then
      if v_product.stock < v_qty then
        raise exception 'Stock insuficiente para %', v_product.name using errcode = '22023';
      end if;
      update public.products
         set stock = stock - v_qty
       where id = v_product.id;
    end if;

    v_total_cup := v_total_cup + (v_qty * v_product.price_cup);
    v_profit    := v_profit    + (v_qty * (v_product.price_cup - v_product.cost_price));
    v_items := v_items || jsonb_build_object(
      'product_id', v_product.id,
      'title',      v_product.name,
      'qty',        v_qty,
      'unit_price', v_product.price_cup,
      'cost_price', v_product.cost_price
    );
  end loop;

  insert into public.sales (id, origin, payment_method, items,
                            total_cup, total_usd, total_profit, rate_used, created_by)
  values (v_sale_id, p_origin, p_payment_method, v_items, v_total_cup,
          round(v_total_cup / v_rate, 2), v_profit, v_rate, auth.uid());

  return v_sale_id;
end $$;

-- 7) Habilitar RLS y definir políticas
alter table public.sales    enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;

-- sales: lectura solo admin, sin escritura directa
drop policy if exists sales_admin_read on public.sales;
create policy sales_admin_read on public.sales
  for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

-- expenses: CRUD admin
drop policy if exists expenses_admin_read on public.expenses;
create policy expenses_admin_read on public.expenses
  for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists expenses_admin_insert on public.expenses;
create policy expenses_admin_insert on public.expenses
  for insert to authenticated
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists expenses_admin_update on public.expenses;
create policy expenses_admin_update on public.expenses
  for update to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists expenses_admin_delete on public.expenses;
create policy expenses_admin_delete on public.expenses
  for delete to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

-- settings: lectura pública, update solo admin
drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select using (true);

drop policy if exists settings_admin_update on public.settings;
create policy settings_admin_update on public.settings
  for update to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

-- 8) Grants y Revokes
revoke select on public.sales from anon;
revoke insert, update, delete on public.sales from anon, authenticated;

revoke select, insert, update, delete on public.expenses from anon;

revoke insert, update, delete on public.settings from anon;
revoke insert, delete on public.settings from authenticated;
grant select on public.settings to anon, authenticated;
grant update on public.settings to authenticated;
grant select, insert, update, delete on public.sales, public.expenses to authenticated;

revoke execute on function public.register_sale(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.register_sale(jsonb, text, text) to authenticated;

revoke execute on function public.settings_set_audit() from public, anon, authenticated;
revoke execute on function public.settings_apply_exchange_rate() from public, anon, authenticated;

notify pgrst, 'reload schema';
