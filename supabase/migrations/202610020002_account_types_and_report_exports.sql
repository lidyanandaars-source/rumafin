-- RumaFin AI — customizable account types + report export support
-- Keeps the legacy account_type enum for backward compatibility while account_type_id
-- becomes the source of truth for user-facing account type names.

create table if not exists public.account_types (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  legacy_type public.account_type not null default 'OTHER',
  icon text,
  color text,
  is_system boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_account_types_active_name
  on public.account_types(household_id, lower(name))
  where deleted_at is null;
create index if not exists idx_account_types_household_active
  on public.account_types(household_id, deleted_at, name);

do $$ begin
  create trigger trg_account_types_updated
  before update on public.account_types
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

alter table public.accounts
  add column if not exists account_type_id uuid references public.account_types(id) on delete restrict;

-- Seed the six original types for every existing household.
insert into public.account_types(household_id,name,legacy_type,is_system,created_by)
select h.id, v.name, v.legacy_type::public.account_type, true, h.created_by
from public.households h
cross join (values
  ('Cash','CASH'),
  ('Bank','BANK'),
  ('E-Wallet','EWALLET'),
  ('Kartu Kredit','CREDIT_CARD'),
  ('Tabungan','SAVINGS'),
  ('Lainnya','OTHER')
) as v(name,legacy_type)
where not exists (
  select 1 from public.account_types at
  where at.household_id=h.id and at.is_system and at.legacy_type=v.legacy_type::public.account_type and at.deleted_at is null
);

-- Attach pre-existing accounts to the corresponding seeded type.
update public.accounts a
set account_type_id = at.id
from public.account_types at
where a.account_type_id is null
  and at.household_id=a.household_id
  and at.is_system
  and at.legacy_type=a.account_type
  and at.deleted_at is null;

-- All existing households were seeded above, so every existing account should now resolve.
alter table public.accounts alter column account_type_id set not null;

-- Keep the legacy enum synchronized automatically and prevent cross-household/deleted
-- account type assignments even if an older client attempts a direct UPDATE.
create or replace function public.sync_account_type_legacy()
returns trigger
language plpgsql
set search_path=public
as $$
declare resolved public.account_types;
begin
  select * into resolved
  from public.account_types
  where id=new.account_type_id
    and household_id=new.household_id
    and deleted_at is null;
  if resolved.id is null then
    raise exception 'Account type not found, deleted, or belongs to another household';
  end if;
  new.account_type:=resolved.legacy_type;
  return new;
end;
$$;

drop trigger if exists trg_accounts_sync_account_type on public.accounts;
create trigger trg_accounts_sync_account_type
before insert or update of account_type_id,household_id on public.accounts
for each row execute function public.sync_account_type_legacy();

alter table public.account_types enable row level security;

drop policy if exists account_types_member_select on public.account_types;
create policy account_types_member_select on public.account_types
for select to authenticated
using(public.is_household_member(household_id));

drop policy if exists account_types_admin_insert on public.account_types;
create policy account_types_admin_insert on public.account_types
for insert to authenticated
with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

drop policy if exists account_types_admin_update on public.account_types;
create policy account_types_admin_update on public.account_types
for update to authenticated
using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]))
with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

-- account_balances retains all original columns and appends the dynamic type fields.
create or replace view public.account_balances with (security_invoker=true) as
select a.id,a.household_id,a.name,a.account_type,a.currency,a.opening_balance,
       (a.opening_balance + coalesce(sum(case when t.deleted_at is null and t.status='CONFIRMED' then m.amount else 0 end),0))::numeric(18,2) as current_balance,
       a.is_active,a.icon,a.color,a.created_at,a.updated_at,
       a.account_type_id,
       coalesce(at.name,initcap(replace(a.account_type::text,'_',' '))) as account_type_name
from public.accounts a
left join public.account_types at on at.id=a.account_type_id
left join public.account_movements m on m.account_id=a.id
left join public.transactions t on t.id=m.transaction_id
group by a.id,at.id,at.name;

create or replace function public.create_account_type(
  p_household_id uuid,
  p_name text,
  p_icon text default null,
  p_color text default null,
  p_source text default 'MANUAL'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r public.account_types;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_household_role(p_household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can create account types';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Account type name is required'; end if;

  insert into public.account_types(household_id,name,legacy_type,icon,color,is_system,created_by)
  values(p_household_id,trim(p_name),'OTHER',nullif(trim(coalesce(p_icon,'')),''),nullif(trim(coalesce(p_color,'')),''),false,auth.uid())
  returning * into r;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,after_data,source)
  values(p_household_id,auth.uid(),'ACCOUNT_TYPE_CREATED','account_type',r.id::text,to_jsonb(r),upper(coalesce(p_source,'MANUAL'))::public.transaction_source);
  return to_jsonb(r);
end;
$$;

create or replace function public.update_account_type(
  p_account_type_id uuid,
  p_name text,
  p_icon text default null,
  p_color text default null,
  p_source text default 'MANUAL'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r public.account_types; before_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into r from public.account_types where id=p_account_type_id and deleted_at is null for update;
  if r.id is null then raise exception 'Account type not found'; end if;
  if not public.has_household_role(r.household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can update account types';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Account type name is required'; end if;
  before_row:=to_jsonb(r);

  update public.account_types
  set name=trim(p_name),
      icon=nullif(trim(coalesce(p_icon,'')),''),
      color=nullif(trim(coalesce(p_color,'')),''),
      updated_at=now()
  where id=p_account_type_id
  returning * into r;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(r.household_id,auth.uid(),'ACCOUNT_TYPE_UPDATED','account_type',r.id::text,before_row,to_jsonb(r),upper(coalesce(p_source,'MANUAL'))::public.transaction_source);
  return to_jsonb(r);
end;
$$;

-- "Delete" is intentionally a soft delete. Existing accounts keep their historical type label,
-- while the type disappears from choices for new accounts.
create or replace function public.delete_account_type(
  p_account_type_id uuid,
  p_source text default 'MANUAL'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r public.account_types; before_row jsonb; account_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into r from public.account_types where id=p_account_type_id and deleted_at is null for update;
  if r.id is null then raise exception 'Account type not found'; end if;
  if not public.has_household_role(r.household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can delete account types';
  end if;
  before_row:=to_jsonb(r);
  select count(*) into account_count from public.accounts where account_type_id=r.id;

  update public.account_types set deleted_at=now(),updated_at=now() where id=r.id returning * into r;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(r.household_id,auth.uid(),'ACCOUNT_TYPE_DELETED','account_type',r.id::text,before_row,to_jsonb(r)||jsonb_build_object('accounts_using_type',account_count),upper(coalesce(p_source,'MANUAL'))::public.transaction_source);
  return to_jsonb(r)||jsonb_build_object('accounts_using_type',account_count);
end;
$$;

create or replace function public.create_account_with_type(
  p_household_id uuid,
  p_name text,
  p_account_type_id uuid,
  p_currency text default 'IDR',
  p_opening_balance numeric default 0,
  p_source text default 'MANUAL'
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare a public.accounts; at public.account_types;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_household_role(p_household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can create accounts';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Account name is required'; end if;
  if p_currency is null or char_length(trim(p_currency))<>3 then raise exception 'Currency must be a 3-letter code'; end if;
  if coalesce(p_opening_balance,0)<0 then raise exception 'Opening balance cannot be negative'; end if;

  select * into at from public.account_types
  where id=p_account_type_id and household_id=p_household_id and deleted_at is null;
  if at.id is null then raise exception 'Account type not found or has been deleted'; end if;

  insert into public.accounts(household_id,name,account_type,account_type_id,currency,opening_balance,created_by)
  values(p_household_id,trim(p_name),at.legacy_type,at.id,upper(trim(p_currency))::char(3),coalesce(p_opening_balance,0),auth.uid())
  returning * into a;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,after_data,source)
  values(p_household_id,auth.uid(),'ACCOUNT_CREATED','account',a.id::text,to_jsonb(a)||jsonb_build_object('account_type_name',at.name),upper(coalesce(p_source,'MANUAL'))::public.transaction_source);
  return to_jsonb(a)||jsonb_build_object('account_type_name',at.name);
end;
$$;

-- Keep the original voice RPC compatible for any older frontend still calling it.
create or replace function public.voice_create_account(
  p_household_id uuid,
  p_name text,
  p_account_type public.account_type,
  p_currency text default 'IDR',
  p_opening_balance numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare type_id uuid;
begin
  select id into type_id from public.account_types
  where household_id=p_household_id and legacy_type=p_account_type and deleted_at is null
  order by is_system desc, created_at asc limit 1;
  if type_id is null then raise exception 'Account type is not available'; end if;
  return public.create_account_with_type(p_household_id,p_name,type_id,p_currency,p_opening_balance,'VOICE');
end;
$$;

-- New households receive customizable account types before the default Cash account.
create or replace function public.create_household_with_defaults(p_name text,p_currency text default 'IDR',p_timezone text default 'Asia/Jakarta')
returns public.households language plpgsql security definer set search_path=public as $$
declare h public.households; food uuid; transport uuid; housing uuid; child uuid; income_cat uuid; cash_type uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Household name is required'; end if;
  insert into public.households(name,default_currency,timezone,created_by) values(trim(p_name),upper(p_currency)::char(3),p_timezone,auth.uid()) returning * into h;
  insert into public.household_members(household_id,user_id,role) values(h.id,auth.uid(),'OWNER');

  insert into public.account_types(household_id,name,legacy_type,is_system,created_by) values
    (h.id,'Cash','CASH',true,auth.uid()),
    (h.id,'Bank','BANK',true,auth.uid()),
    (h.id,'E-Wallet','EWALLET',true,auth.uid()),
    (h.id,'Kartu Kredit','CREDIT_CARD',true,auth.uid()),
    (h.id,'Tabungan','SAVINGS',true,auth.uid()),
    (h.id,'Lainnya','OTHER',true,auth.uid());
  select id into cash_type from public.account_types where household_id=h.id and legacy_type='CASH' and deleted_at is null order by created_at limit 1;
  insert into public.accounts(household_id,name,account_type,account_type_id,currency,opening_balance,created_by) values(h.id,'Cash','CASH',cash_type,h.default_currency,0,auth.uid());

  insert into public.categories(household_id,name,transaction_type,icon,color,created_by) values(h.id,'Food & Drinks','EXPENSE','utensils','#f59e0b',auth.uid()) returning id into food;
  insert into public.categories(household_id,parent_id,name,transaction_type,created_by) values
    (h.id,food,'Groceries','EXPENSE',auth.uid()),(h.id,food,'Restaurant','EXPENSE',auth.uid()),(h.id,food,'Coffee','EXPENSE',auth.uid()),(h.id,food,'Delivery','EXPENSE',auth.uid());
  insert into public.categories(household_id,name,transaction_type,icon,color,created_by) values(h.id,'Transportation','EXPENSE','car','#3b82f6',auth.uid()) returning id into transport;
  insert into public.categories(household_id,parent_id,name,transaction_type,created_by) values
    (h.id,transport,'Fuel','EXPENSE',auth.uid()),(h.id,transport,'Parking','EXPENSE',auth.uid()),(h.id,transport,'Toll','EXPENSE',auth.uid()),(h.id,transport,'Taxi','EXPENSE',auth.uid()),(h.id,transport,'Public Transport','EXPENSE',auth.uid());
  insert into public.categories(household_id,name,transaction_type,icon,color,created_by) values(h.id,'Housing','EXPENSE','house','#8b5cf6',auth.uid()) returning id into housing;
  insert into public.categories(household_id,parent_id,name,transaction_type,created_by) values
    (h.id,housing,'Rent','EXPENSE',auth.uid()),(h.id,housing,'Electricity','EXPENSE',auth.uid()),(h.id,housing,'Water','EXPENSE',auth.uid()),(h.id,housing,'Internet','EXPENSE',auth.uid()),(h.id,housing,'Maintenance','EXPENSE',auth.uid());
  insert into public.categories(household_id,name,transaction_type,icon,color,created_by) values(h.id,'Child','EXPENSE','baby','#ec4899',auth.uid()) returning id into child;
  insert into public.categories(household_id,parent_id,name,transaction_type,created_by) values
    (h.id,child,'Food','EXPENSE',auth.uid()),(h.id,child,'Diapers','EXPENSE',auth.uid()),(h.id,child,'Healthcare','EXPENSE',auth.uid()),(h.id,child,'Education','EXPENSE',auth.uid()),(h.id,child,'Toys','EXPENSE',auth.uid());
  insert into public.categories(household_id,name,transaction_type,created_by) values
    (h.id,'Healthcare','EXPENSE',auth.uid()),(h.id,'Shopping','EXPENSE',auth.uid()),(h.id,'Entertainment','EXPENSE',auth.uid()),(h.id,'Travel','EXPENSE',auth.uid()),(h.id,'Education','EXPENSE',auth.uid()),(h.id,'Insurance','EXPENSE',auth.uid()),(h.id,'Tax','EXPENSE',auth.uid()),(h.id,'Others','EXPENSE',auth.uid());
  insert into public.categories(household_id,name,transaction_type,icon,color,created_by) values(h.id,'Income','INCOME','wallet','#10b981',auth.uid()) returning id into income_cat;
  insert into public.categories(household_id,parent_id,name,transaction_type,created_by) values
    (h.id,income_cat,'Salary','INCOME',auth.uid()),(h.id,income_cat,'Bonus','INCOME',auth.uid()),(h.id,income_cat,'Other Income','INCOME',auth.uid());
  return h;
end; $$;

-- Export all transactions matching the same filters used by the Reports page.
create or replace function public.get_financial_report_transactions(
  p_household_id uuid,
  p_from date,
  p_to date,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_member_id uuid default null,
  p_merchant text default null,
  p_transaction_type public.transaction_type default null
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare merchant_pattern text; result jsonb;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Not authorized'; end if;
  if p_to<p_from then raise exception 'Invalid date range'; end if;
  merchant_pattern:=case when nullif(trim(p_merchant),'') is null then null else '%'||replace(replace(trim(p_merchant),'%',''),'_','')||'%' end;

  with filtered as (
    select t.*
    from public.transactions t
    where t.household_id=p_household_id
      and t.status='CONFIRMED'
      and t.deleted_at is null
      and t.transaction_at>=p_from
      and t.transaction_at<(p_to+1)
      and (p_transaction_type is null or t.transaction_type=p_transaction_type)
      and (p_member_id is null or t.created_by=p_member_id)
      and (merchant_pattern is null or coalesce(t.merchant_name,'') ilike merchant_pattern)
      and (p_account_id is null or exists(select 1 from public.account_movements am where am.transaction_id=t.id and am.account_id=p_account_id))
      and (p_category_id is null or exists(select 1 from public.transaction_splits ts where ts.transaction_id=t.id and ts.category_id=p_category_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,
    'transaction_at',f.transaction_at,
    'transaction_type',f.transaction_type,
    'merchant_name',f.merchant_name,
    'description',f.description,
    'notes',f.notes,
    'total_amount',f.total_amount,
    'filtered_amount',case
      when p_category_id is null then f.total_amount
      else coalesce((select sum(s2.amount) from public.transaction_splits s2 where s2.transaction_id=f.id and s2.category_id=p_category_id),0)
    end,
    'currency',f.currency,
    'source',f.source,
    'created_by',f.created_by,
    'member_name',coalesce(pr.display_name,pr.email,f.created_by::text),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',ab.id,'name',ab.name,'type',coalesce(ab.account_type_name,ab.account_type::text),'movement',am.amount) order by ab.name) from public.account_movements am join public.account_balances ab on ab.id=am.account_id where am.transaction_id=f.id),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'amount',s.amount) order by c.name) from public.transaction_splits s join public.categories c on c.id=s.category_id where s.transaction_id=f.id),'[]'::jsonb)
  ) order by f.transaction_at desc),'[]'::jsonb) into result
  from filtered f
  left join public.profiles pr on pr.id=f.created_by;
  return result;
end; $$;

revoke insert on public.accounts from authenticated;
revoke all on function public.sync_account_type_legacy() from public,anon,authenticated;
grant select on public.account_types to authenticated;
grant execute on function public.create_account_type(uuid,text,text,text,text) to authenticated;
grant execute on function public.update_account_type(uuid,text,text,text,text) to authenticated;
grant execute on function public.delete_account_type(uuid,text) to authenticated;
grant execute on function public.create_account_with_type(uuid,text,uuid,text,numeric,text) to authenticated;
grant execute on function public.get_financial_report_transactions(uuid,date,date,uuid,uuid,uuid,text,public.transaction_type) to authenticated;
grant execute on function public.voice_create_account(uuid,text,public.account_type,text,numeric) to authenticated;

-- Refresh report RPCs so custom account type names are visible in Dashboard/Reports.
create or replace function public.get_financial_dashboard(p_household_id uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare income_total numeric; expense_total numeric; balance_total numeric; result jsonb;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Not authorized'; end if;
  if p_to<p_from then raise exception 'Invalid date range'; end if;
  select coalesce(sum(total_amount) filter(where transaction_type='INCOME'),0),coalesce(sum(total_amount) filter(where transaction_type='EXPENSE'),0)
  into income_total,expense_total from public.transactions where household_id=p_household_id and status='CONFIRMED' and deleted_at is null and transaction_at>=p_from and transaction_at<(p_to+1);
  select coalesce(sum(current_balance),0) into balance_total from public.account_balances where household_id=p_household_id and is_active;

  result:=jsonb_build_object(
    'income',income_total,'expense',expense_total,'net_cash_flow',income_total-expense_total,'available_balance',balance_total,
    'savings_rate',case when income_total>0 then round(((income_total-expense_total)/income_total)*100,2) else null end,
    'categories',coalesce((select jsonb_agg(x order by (x->>'amount')::numeric desc) from (select jsonb_build_object('name',c.name,'amount',sum(s.amount),'color',c.color) x from public.transaction_splits s join public.categories c on c.id=s.category_id join public.transactions t on t.id=s.transaction_id where t.household_id=p_household_id and t.transaction_type='EXPENSE' and t.status='CONFIRMED' and t.deleted_at is null and t.transaction_at>=p_from and t.transaction_at<(p_to+1) group by c.id,c.name,c.color) q),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'expense',coalesce(x.expense,0),'income',coalesce(x.income,0)) order by d) from generate_series(p_from,p_to,'1 day') d left join lateral (select sum(total_amount) filter(where transaction_type='EXPENSE') expense,sum(total_amount) filter(where transaction_type='INCOME') income from public.transactions t where t.household_id=p_household_id and t.status='CONFIRMED' and t.deleted_at is null and t.transaction_at>=d and t.transaction_at<d+interval '1 day') x on true),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',coalesce(account_type_name,account_type::text),'balance',current_balance,'currency',currency) order by name) from public.account_balances where household_id=p_household_id and is_active),'[]'::jsonb),
    'merchants',coalesce((select jsonb_agg(jsonb_build_object('name',merchant_name,'amount',amount) order by amount desc) from (select coalesce(nullif(merchant_name,''),'Unspecified') merchant_name,sum(total_amount) amount from public.transactions where household_id=p_household_id and transaction_type='EXPENSE' and status='CONFIRMED' and deleted_at is null and transaction_at>=p_from and transaction_at<(p_to+1) group by 1 order by 2 desc limit 10) m),'[]'::jsonb),
    'budgets',coalesce((select jsonb_agg(jsonb_build_object('category_id',b.category_id,'category',c.name,'budget',b.amount,'actual',coalesce(a.actual,0),'ratio',case when b.amount>0 then round(coalesce(a.actual,0)/b.amount*100,2) else 0 end)) from public.budgets b join public.categories c on c.id=b.category_id left join lateral (select sum(s.amount) actual from public.transaction_splits s join public.transactions t on t.id=s.transaction_id where s.category_id=b.category_id and t.household_id=p_household_id and t.transaction_type='EXPENSE' and t.deleted_at is null and t.status='CONFIRMED' and t.transaction_at>=b.period_month and t.transaction_at<b.period_month+interval '1 month') a on true where b.household_id=p_household_id and b.period_month=date_trunc('month',p_from)::date),'[]'::jsonb),
    'recent_transactions',coalesce((select jsonb_agg(to_jsonb(r) order by r.transaction_at desc) from (select * from public.transactions where household_id=p_household_id and deleted_at is null order by transaction_at desc limit 8) r),'[]'::jsonb)
  );
  return result;
end; $$;

create or replace function public.get_filtered_financial_report(
  p_household_id uuid,
  p_from date,
  p_to date,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_member_id uuid default null,
  p_merchant text default null,
  p_transaction_type public.transaction_type default null
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb; merchant_pattern text;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Not authorized'; end if;
  if p_to<p_from then raise exception 'Invalid date range'; end if;
  if p_account_id is not null and not exists(select 1 from public.accounts where id=p_account_id and household_id=p_household_id) then raise exception 'Invalid account filter'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id=p_category_id and household_id=p_household_id) then raise exception 'Invalid category filter'; end if;
  if p_member_id is not null and not exists(select 1 from public.household_members where household_id=p_household_id and user_id=p_member_id) then raise exception 'Invalid member filter'; end if;
  merchant_pattern:=case when nullif(trim(p_merchant),'') is null then null else '%'||replace(replace(trim(p_merchant),'%',''),'_','')||'%' end;

  with filtered as materialized (
    select t.*
    from public.transactions t
    where t.household_id=p_household_id
      and t.status='CONFIRMED'
      and t.deleted_at is null
      and t.transaction_at>=p_from
      and t.transaction_at<(p_to+1)
      and (p_transaction_type is null or t.transaction_type=p_transaction_type)
      and (p_member_id is null or t.created_by=p_member_id)
      and (merchant_pattern is null or coalesce(t.merchant_name,'') ilike merchant_pattern)
      and (p_account_id is null or exists(select 1 from public.account_movements am where am.transaction_id=t.id and am.account_id=p_account_id))
      and (p_category_id is null or exists(select 1 from public.transaction_splits ts where ts.transaction_id=t.id and ts.category_id=p_category_id))
  ), expense_rows as materialized (
    select f.id,f.transaction_at,f.merchant_name,
           case when p_category_id is null then f.total_amount else coalesce(sum(s.amount) filter(where s.category_id=p_category_id),0) end::numeric as amount
    from filtered f left join public.transaction_splits s on s.transaction_id=f.id
    where f.transaction_type='EXPENSE'
    group by f.id,f.transaction_at,f.merchant_name,f.total_amount
  ), income_rows as materialized (
    select f.id,f.transaction_at,
           case when p_category_id is null then f.total_amount else coalesce(sum(s.amount) filter(where s.category_id=p_category_id),0) end::numeric as amount
    from filtered f left join public.transaction_splits s on s.transaction_id=f.id
    where f.transaction_type='INCOME'
    group by f.id,f.transaction_at,f.total_amount
  ), totals as (
    select coalesce((select sum(amount) from income_rows),0)::numeric income,
           coalesce((select sum(amount) from expense_rows),0)::numeric expense
  )
  select jsonb_build_object(
    'income',totals.income,
    'expense',totals.expense,
    'net_cash_flow',totals.income-totals.expense,
    'available_balance',coalesce((select sum(current_balance) from public.account_balances where household_id=p_household_id and is_active and (p_account_id is null or id=p_account_id)),0),
    'savings_rate',case when totals.income>0 then round(((totals.income-totals.expense)/totals.income*100)::numeric,2) else null end,
    'categories',coalesce((select jsonb_agg(jsonb_build_object('name',q.name,'amount',q.amount,'color',q.color) order by q.amount desc) from (
      select c.name,c.color,sum(s.amount)::numeric amount
      from filtered f join public.transaction_splits s on s.transaction_id=f.id join public.categories c on c.id=s.category_id
      where f.transaction_type='EXPENSE' and (p_category_id is null or s.category_id=p_category_id)
      group by c.id,c.name,c.color order by amount desc
    ) q),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'expense',coalesce(e.expense,0),'income',coalesce(i.income,0)) order by d)
      from generate_series(p_from,p_to,'1 day') d
      left join lateral (select sum(amount) expense from expense_rows r where r.transaction_at>=d and r.transaction_at<d+interval '1 day') e on true
      left join lateral (select sum(amount) income from income_rows r where r.transaction_at>=d and r.transaction_at<d+interval '1 day') i on true
    ),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',coalesce(account_type_name,account_type::text),'balance',current_balance,'currency',currency) order by name) from public.account_balances where household_id=p_household_id and is_active and (p_account_id is null or id=p_account_id)),'[]'::jsonb),
    'merchants',coalesce((select jsonb_agg(jsonb_build_object('name',q.name,'amount',q.amount) order by q.amount desc) from (
      select coalesce(nullif(merchant_name,''),'Unspecified') name,sum(amount)::numeric amount
      from expense_rows group by 1 order by 2 desc limit 10
    ) q),'[]'::jsonb),
    'budgets','[]'::jsonb,
    'recent_transactions',coalesce((select jsonb_agg(to_jsonb(q) order by q.transaction_at desc) from (select * from filtered order by transaction_at desc limit 8) q),'[]'::jsonb)
  ) into result from totals;
  return result;
end; $$;

grant execute on function public.get_financial_dashboard(uuid,date,date) to authenticated;
grant execute on function public.get_filtered_financial_report(uuid,date,date,uuid,uuid,uuid,text,public.transaction_type) to authenticated;
