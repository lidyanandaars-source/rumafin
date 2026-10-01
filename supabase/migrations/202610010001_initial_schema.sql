-- RumaFin AI initial schema
-- Principle: AI interprets. Application validates. Database calculates. User remains in control.

create extension if not exists pgcrypto;

-- =========================
-- Enums
-- =========================
do $$ begin
  create type public.household_role as enum ('OWNER','ADMIN','MEMBER','VIEWER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_type as enum ('CASH','BANK','EWALLET','CREDIT_CARD','SAVINGS','OTHER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.transaction_type as enum ('EXPENSE','INCOME','TRANSFER','ADJUSTMENT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.transaction_source as enum ('MANUAL','VOICE','RECEIPT','RECURRING','IMPORT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.transaction_status as enum ('DRAFT','PENDING_REVIEW','CONFIRMED','VOIDED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.voice_command_status as enum ('TRANSCRIBED','PARSED','AWAITING_CONFIRMATION','EXECUTED','REJECTED','FAILED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.extraction_source as enum ('VOICE','RECEIPT');
exception when duplicate_object then null; end $$;

-- =========================
-- Core tables
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  default_currency char(3) not null default 'IDR',
  timezone text not null default 'Asia/Jakarta',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'MEMBER',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role public.household_role not null check (role <> 'OWNER'),
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_pending_household_invitation on public.household_invitations(household_id, lower(email)) where accepted_at is null;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  account_type public.account_type not null,
  currency char(3) not null default 'IDR',
  opening_balance numeric(18,2) not null default 0,
  is_active boolean not null default true,
  icon text,
  color text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_accounts_name on public.accounts(household_id, lower(name));

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  transaction_type text not null default 'EXPENSE' check (transaction_type in ('EXPENSE','INCOME','BOTH')),
  icon text,
  color text,
  is_archived boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index if not exists idx_categories_household_parent on public.categories(household_id,parent_id);
create unique index if not exists uq_categories_root_name on public.categories(household_id,lower(name)) where parent_id is null;
create unique index if not exists uq_categories_child_name on public.categories(household_id,parent_id,lower(name)) where parent_id is not null;

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  unique(household_id, normalized_name)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_type public.transaction_type not null,
  transaction_at timestamptz not null,
  timezone text not null default 'Asia/Jakarta',
  merchant_name text,
  description text,
  notes text,
  total_amount numeric(18,2) not null check (total_amount > 0),
  currency char(3) not null default 'IDR',
  source public.transaction_source not null default 'MANUAL',
  status public.transaction_status not null default 'CONFIRMED',
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  unique(household_id,idempotency_key)
);
create index if not exists idx_transactions_household_at on public.transactions(household_id,transaction_at desc) where deleted_at is null;
create index if not exists idx_transactions_household_type_at on public.transactions(household_id,transaction_type,transaction_at desc) where deleted_at is null;
create index if not exists idx_transactions_merchant on public.transactions(household_id,lower(merchant_name)) where deleted_at is null;

create table if not exists public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  description text,
  created_at timestamptz not null default now()
);
create index if not exists idx_splits_transaction on public.transaction_splits(transaction_id);
create index if not exists idx_splits_category on public.transaction_splits(category_id);

create table if not exists public.account_movements (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_movements_transaction on public.account_movements(transaction_id);
create index if not exists idx_movements_account on public.account_movements(account_id);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  storage_path text not null unique,
  mime_type text,
  merchant text,
  receipt_date date,
  subtotal numeric(18,2),
  tax numeric(18,2),
  discount numeric(18,2),
  total numeric(18,2),
  extraction_status text not null default 'PENDING' check (extraction_status in ('PENDING','EXTRACTED','NEEDS_REVIEW','FAILED','FINALIZED')),
  overall_confidence numeric(5,4),
  transaction_id uuid unique references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_receipts_household_date on public.receipts(household_id,receipt_date desc);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  line_no integer,
  name text,
  quantity numeric(12,3),
  unit_price numeric(18,2),
  total numeric(18,2),
  confidence numeric(5,4),
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  period_month date not null check (period_month = date_trunc('month',period_month)::date),
  amount numeric(18,2) not null check (amount > 0),
  alert_thresholds integer[] not null default array[75,90,100],
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,category_id,period_month)
);

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_type public.transaction_type not null,
  frequency text not null check (frequency in ('DAILY','WEEKLY','MONTHLY','YEARLY')),
  start_date date not null,
  end_date date,
  amount numeric(18,2) not null check (amount > 0),
  account_id uuid not null references public.accounts(id),
  destination_account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id),
  description text,
  auto_create boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.voice_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  household_id uuid not null references public.households(id) on delete cascade,
  audio_path text,
  transcript text not null,
  intent text,
  parsed_payload jsonb,
  confidence numeric(5,4),
  status public.voice_command_status not null default 'TRANSCRIBED',
  idempotency_key uuid not null default gen_random_uuid(),
  execution_transaction_id uuid references public.transactions(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,idempotency_key)
);
create index if not exists idx_voice_commands_household_created on public.voice_commands(household_id,created_at desc);

create table if not exists public.ai_extractions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  source_type public.extraction_source not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  schema_version text not null default 'v1',
  raw_input_reference text,
  raw_output jsonb,
  normalized_output jsonb,
  confidence numeric(5,4),
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_extractions_household_created on public.ai_extractions(household_id,created_at desc);

create table if not exists public.audit_logs (
  id bigint generated by default as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  source public.transaction_source not null default 'MANUAL',
  request_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_household_created on public.audit_logs(household_id,created_at desc);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_retention text not null default 'NEVER' check (voice_retention in ('NEVER','24_HOURS','ALWAYS')),
  receipt_retention text not null default 'KEEP' check (receipt_retention in ('KEEP','DELETE_AFTER_EXTRACTION')),
  fast_voice_entry boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_category_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  merchant_normalized text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  source text not null default 'USER' check (source in ('USER','HISTORY')),
  weight integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,merchant_normalized)
);

create table if not exists public.api_request_log (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_api_request_rate on public.api_request_log(user_id,endpoint,created_at desc);

create table if not exists public.ai_model_config (
  capability text primary key,
  primary_model text not null,
  fallback_model text,
  provider text not null,
  updated_at timestamptz not null default now()
);
insert into public.ai_model_config(capability,primary_model,fallback_model,provider) values
  ('voice_transcription','whisper-large-v3-turbo','whisper-large-v3','groq'),
  ('intent','gemini-3.8-flash','openai/gpt-oss-20b','gemini+groq'),
  ('receipt','gemini-3.8-flash',null,'gemini')
on conflict (capability) do nothing;

-- =========================
-- Utility triggers/functions
-- =========================
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.validate_category_parent() returns trigger language plpgsql as $$
declare parent_household uuid;
begin
  if new.parent_id is not null then
    select household_id into parent_household from public.categories where id=new.parent_id;
    if parent_household is null or parent_household <> new.household_id then raise exception 'Parent category must belong to the same household'; end if;
  end if;
  return new;
end; $$;

create or replace function public.audit_structure_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare hid uuid; entity uuid; action_name text; before_json jsonb; after_json jsonb;
begin
  hid:=coalesce(new.household_id,old.household_id); entity:=coalesce(new.id,old.id);
  if tg_op='INSERT' then action_name:=upper(tg_table_name)||'_CREATED'; before_json:=null; after_json:=to_jsonb(new);
  elsif tg_op='UPDATE' then action_name:=upper(tg_table_name)||'_UPDATED'; before_json:=to_jsonb(old); after_json:=to_jsonb(new);
  else action_name:=upper(tg_table_name)||'_DELETED'; before_json:=to_jsonb(old); after_json:=null; end if;
  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(hid,auth.uid(),action_name,tg_table_name,entity::text,before_json,after_json,'MANUAL');
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;

create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_households_updated before update on public.households for each row execute function public.set_updated_at();
create trigger trg_accounts_updated before update on public.accounts for each row execute function public.set_updated_at();
create trigger trg_categories_updated before update on public.categories for each row execute function public.set_updated_at();
create trigger trg_categories_parent before insert or update on public.categories for each row execute function public.validate_category_parent();
create trigger trg_accounts_audit after insert or update on public.accounts for each row execute function public.audit_structure_change();
create trigger trg_categories_audit after insert or update on public.categories for each row execute function public.audit_structure_change();
create trigger trg_budgets_audit after insert or update or delete on public.budgets for each row execute function public.audit_structure_change();
create trigger trg_recurring_audit after insert or update or delete on public.recurring_transactions for each row execute function public.audit_structure_change();
create trigger trg_transactions_updated before update on public.transactions for each row execute function public.set_updated_at();
create trigger trg_receipts_updated before update on public.receipts for each row execute function public.set_updated_at();
create trigger trg_budgets_updated before update on public.budgets for each row execute function public.set_updated_at();
create trigger trg_recurring_updated before update on public.recurring_transactions for each row execute function public.set_updated_at();
create trigger trg_voice_updated before update on public.voice_commands for each row execute function public.set_updated_at();
create trigger trg_preferences_updated before update on public.user_preferences for each row execute function public.set_updated_at();
create trigger trg_merchant_rules_updated before update on public.merchant_category_rules for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'))
  on conflict (id) do update set email=excluded.email;

  insert into public.user_preferences(user_id) values(new.id) on conflict do nothing;

  insert into public.household_members(household_id,user_id,role)
  select i.household_id,new.id,i.role
  from public.household_invitations i
  where lower(i.email)=lower(coalesce(new.email,'')) and i.accepted_at is null and i.expires_at>now()
  on conflict (household_id,user_id) do update set role=excluded.role;

  update public.household_invitations set accepted_at=now()
  where lower(email)=lower(coalesce(new.email,'')) and accepted_at is null and expires_at>now();
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users for each row execute function public.handle_new_user();

-- Membership helpers avoid RLS recursion.
create or replace function public.is_household_member(p_household_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.household_members hm where hm.household_id=p_household_id and hm.user_id=auth.uid());
$$;

create or replace function public.has_household_role(p_household_id uuid,p_roles public.household_role[]) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.household_members hm where hm.household_id=p_household_id and hm.user_id=auth.uid() and hm.role=any(p_roles));
$$;

create or replace function public.can_write_finance(p_household_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.has_household_role(p_household_id,array['OWNER','ADMIN','MEMBER']::public.household_role[]);
$$;

-- =========================
-- RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.merchants enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.account_movements enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.budgets enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.voice_commands enable row level security;
alter table public.ai_extractions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.user_preferences enable row level security;
alter table public.merchant_category_rules enable row level security;
alter table public.ai_model_config enable row level security;
alter table public.api_request_log enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (id=auth.uid());
create policy profiles_household_select on public.profiles for select to authenticated using (exists(select 1 from public.household_members me join public.household_members them on them.household_id=me.household_id where me.user_id=auth.uid() and them.user_id=profiles.id));
create policy profiles_self_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());

create policy households_member_select on public.households for select to authenticated using(public.is_household_member(id));
create policy households_admin_update on public.households for update to authenticated using(public.has_household_role(id,array['OWNER','ADMIN']::public.household_role[])) with check(public.has_household_role(id,array['OWNER','ADMIN']::public.household_role[]));

create policy household_members_member_select on public.household_members for select to authenticated using(public.is_household_member(household_id));
create policy household_members_owner_write on public.household_members for all to authenticated using(public.has_household_role(household_id,array['OWNER']::public.household_role[])) with check(public.has_household_role(household_id,array['OWNER']::public.household_role[]));
create policy invitations_admin_select on public.household_invitations for select to authenticated using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

create policy accounts_member_select on public.accounts for select to authenticated using(public.is_household_member(household_id));
create policy accounts_admin_insert on public.accounts for insert to authenticated with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));
create policy accounts_admin_update on public.accounts for update to authenticated using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[])) with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

create policy categories_member_select on public.categories for select to authenticated using(public.is_household_member(household_id));
create policy categories_admin_insert on public.categories for insert to authenticated with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));
create policy categories_admin_update on public.categories for update to authenticated using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[])) with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

create policy merchants_member_select on public.merchants for select to authenticated using(public.is_household_member(household_id));
create policy merchants_writer_all on public.merchants for all to authenticated using(public.can_write_finance(household_id)) with check(public.can_write_finance(household_id));

create policy transactions_member_select on public.transactions for select to authenticated using(public.is_household_member(household_id));
create policy splits_member_select on public.transaction_splits for select to authenticated using(exists(select 1 from public.transactions t where t.id=transaction_id and public.is_household_member(t.household_id)));
create policy movements_member_select on public.account_movements for select to authenticated using(exists(select 1 from public.transactions t where t.id=transaction_id and public.is_household_member(t.household_id)));

create policy receipts_member_select on public.receipts for select to authenticated using(public.is_household_member(household_id));
create policy receipt_items_member_select on public.receipt_items for select to authenticated using(exists(select 1 from public.receipts r where r.id=receipt_id and public.is_household_member(r.household_id)));

create policy budgets_member_select on public.budgets for select to authenticated using(public.is_household_member(household_id));
create policy budgets_admin_insert on public.budgets for insert to authenticated with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));
create policy budgets_admin_update on public.budgets for update to authenticated using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[])) with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));
create policy budgets_admin_delete on public.budgets for delete to authenticated using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

create policy recurring_member_select on public.recurring_transactions for select to authenticated using(public.is_household_member(household_id));
create policy recurring_admin_all on public.recurring_transactions for all to authenticated using(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[])) with check(public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));

create policy voice_member_select on public.voice_commands for select to authenticated using(user_id=auth.uid() or public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));
create policy ai_extractions_select on public.ai_extractions for select to authenticated using(user_id=auth.uid() or public.has_household_role(household_id,array['OWNER','ADMIN']::public.household_role[]));
create policy audit_member_select on public.audit_logs for select to authenticated using(public.is_household_member(household_id));
create policy preferences_self_all on public.user_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy merchant_rules_member_select on public.merchant_category_rules for select to authenticated using(public.is_household_member(household_id));
create policy merchant_rules_writer_all on public.merchant_category_rules for all to authenticated using(public.can_write_finance(household_id)) with check(public.can_write_finance(household_id));
create policy model_config_authenticated_select on public.ai_model_config for select to authenticated using(true);

-- =========================
-- Account balance view
-- =========================
create or replace view public.account_balances with (security_invoker=true) as
select a.id,a.household_id,a.name,a.account_type,a.currency,a.opening_balance,
       (a.opening_balance + coalesce(sum(case when t.deleted_at is null and t.status='CONFIRMED' then m.amount else 0 end),0))::numeric(18,2) as current_balance,
       a.is_active,a.icon,a.color,a.created_at,a.updated_at
from public.accounts a
left join public.account_movements m on m.account_id=a.id
left join public.transactions t on t.id=m.transaction_id
group by a.id;

-- =========================
-- Onboarding RPC
-- =========================
create or replace function public.create_household_with_defaults(p_name text,p_currency text default 'IDR',p_timezone text default 'Asia/Jakarta')
returns public.households language plpgsql security definer set search_path=public as $$
declare h public.households; food uuid; transport uuid; housing uuid; child uuid; income_cat uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Household name is required'; end if;
  insert into public.households(name,default_currency,timezone,created_by) values(trim(p_name),upper(p_currency)::char(3),p_timezone,auth.uid()) returning * into h;
  insert into public.household_members(household_id,user_id,role) values(h.id,auth.uid(),'OWNER');
  insert into public.accounts(household_id,name,account_type,currency,opening_balance,created_by) values(h.id,'Cash','CASH',h.default_currency,0,auth.uid());

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

-- =========================
-- Transaction validation / atomic service
-- =========================
create or replace function public.assert_transaction_payload(
  p_household_id uuid,p_type public.transaction_type,p_total numeric,p_splits jsonb,p_movements jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare split_sum numeric; movement_sum numeric; negatives int; positives int; item jsonb; aid uuid; cid uuid;
begin
  if p_total is null or p_total<=0 then raise exception 'Amount must be greater than zero'; end if;
  p_splits:=coalesce(p_splits,'[]'::jsonb); p_movements:=coalesce(p_movements,'[]'::jsonb);

  for item in select value from jsonb_array_elements(p_splits) loop
    cid:=(item->>'category_id')::uuid;
    if cid is null or not exists(select 1 from public.categories c where c.id=cid and c.household_id=p_household_id and not c.is_archived) then raise exception 'Invalid or archived category'; end if;
    if coalesce((item->>'amount')::numeric,0)<=0 then raise exception 'Split amount must be positive'; end if;
  end loop;
  select coalesce(sum((value->>'amount')::numeric),0) into split_sum from jsonb_array_elements(p_splits);

  for item in select value from jsonb_array_elements(p_movements) loop
    aid:=(item->>'account_id')::uuid;
    if aid is null or not exists(select 1 from public.accounts a where a.id=aid and a.household_id=p_household_id and a.is_active) then raise exception 'Invalid or inactive account'; end if;
    if coalesce((item->>'amount')::numeric,0)=0 then raise exception 'Movement amount cannot be zero'; end if;
  end loop;
  select coalesce(sum((value->>'amount')::numeric),0),count(*) filter(where (value->>'amount')::numeric<0),count(*) filter(where (value->>'amount')::numeric>0)
  into movement_sum,negatives,positives from jsonb_array_elements(p_movements);

  if p_type in ('EXPENSE','INCOME') then
    if jsonb_array_length(p_splits)=0 or round(split_sum,2)<>round(p_total,2) then raise exception 'Split sum must equal transaction total'; end if;
    if jsonb_array_length(p_movements)<>1 then raise exception 'Expense/income requires exactly one account movement'; end if;
    if p_type='EXPENSE' and (movement_sum>=0 or abs(round(movement_sum,2))<>round(p_total,2)) then raise exception 'Expense movement must be negative total'; end if;
    if p_type='INCOME' and (movement_sum<=0 or round(movement_sum,2)<>round(p_total,2)) then raise exception 'Income movement must be positive total'; end if;
  elsif p_type='TRANSFER' then
    if jsonb_array_length(p_splits)<>0 then raise exception 'Transfer cannot have category splits'; end if;
    if jsonb_array_length(p_movements)<>2 or round(movement_sum,2)<>0 or negatives<>1 or positives<>1 then raise exception 'Transfer requires one debit and one credit movement'; end if;
    if not exists(select 1 from jsonb_array_elements(p_movements) v where round(abs((v->>'amount')::numeric),2)=round(p_total,2)) then raise exception 'Transfer movements must equal total'; end if;
    if (select count(distinct value->>'account_id') from jsonb_array_elements(p_movements))<>2 then raise exception 'Transfer source and destination must differ'; end if;
  else
    if jsonb_array_length(p_movements)<>1 or abs(round(movement_sum,2))<>round(p_total,2) then raise exception 'Adjustment requires one movement matching total'; end if;
    if jsonb_array_length(p_splits)>0 and round(split_sum,2)<>round(p_total,2) then raise exception 'Adjustment split sum must equal total'; end if;
  end if;
end; $$;

create or replace function public.transaction_json(p_transaction_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
select to_jsonb(t) || jsonb_build_object(
  'splits',coalesce((select jsonb_agg(to_jsonb(s)) from public.transaction_splits s where s.transaction_id=t.id),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m)) from public.account_movements m where m.transaction_id=t.id),'[]'::jsonb)
) from public.transactions t where t.id=p_transaction_id;
$$;

create or replace function public.create_financial_transaction(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare hid uuid; typ public.transaction_type; total numeric; txid uuid; idem uuid; item jsonb; src public.transaction_source; existing uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  hid:=(p_payload->>'household_id')::uuid; typ:=(p_payload->>'transaction_type')::public.transaction_type; total:=(p_payload->>'total_amount')::numeric;
  idem:=coalesce(nullif(p_payload->>'idempotency_key','')::uuid,gen_random_uuid()); src:=coalesce((p_payload->>'source')::public.transaction_source,'MANUAL');
  if not public.can_write_finance(hid) then raise exception 'Not authorized for this household'; end if;
  select id into existing from public.transactions where household_id=hid and idempotency_key=idem;
  if existing is not null then return public.transaction_json(existing); end if;
  perform public.assert_transaction_payload(hid,typ,total,p_payload->'splits',p_payload->'movements');

  insert into public.transactions(household_id,transaction_type,transaction_at,timezone,merchant_name,description,notes,total_amount,currency,source,status,idempotency_key,created_by)
  values(hid,typ,(p_payload->>'transaction_at')::timestamptz,coalesce(p_payload->>'timezone','Asia/Jakarta'),nullif(p_payload->>'merchant_name',''),nullif(p_payload->>'description',''),nullif(p_payload->>'notes',''),total,upper(coalesce(p_payload->>'currency','IDR'))::char(3),src,'CONFIRMED',idem,auth.uid()) returning id into txid;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'splits','[]'::jsonb)) loop
    insert into public.transaction_splits(transaction_id,category_id,amount,description) values(txid,(item->>'category_id')::uuid,(item->>'amount')::numeric,nullif(item->>'description',''));
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'movements','[]'::jsonb)) loop
    insert into public.account_movements(transaction_id,account_id,amount) values(txid,(item->>'account_id')::uuid,(item->>'amount')::numeric);
  end loop;
  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,after_data,source,request_id)
  values(hid,auth.uid(),'TRANSACTION_CREATED','transaction',txid::text,public.transaction_json(txid),src,idem);
  return public.transaction_json(txid);
end; $$;

create or replace function public.update_financial_transaction(p_transaction_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare oldrow jsonb; hid uuid; typ public.transaction_type; total numeric; item jsonb; src public.transaction_source;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select household_id into hid from public.transactions where id=p_transaction_id for update;
  if hid is null then raise exception 'Transaction not found'; end if;
  if not public.can_write_finance(hid) then raise exception 'Not authorized'; end if;
  if exists(select 1 from public.transactions where id=p_transaction_id and deleted_at is not null) then raise exception 'Restore transaction before editing'; end if;
  if p_payload ? 'household_id' and (p_payload->>'household_id')::uuid<>hid then raise exception 'Household cannot be changed'; end if;
  oldrow:=public.transaction_json(p_transaction_id); typ:=(p_payload->>'transaction_type')::public.transaction_type; total:=(p_payload->>'total_amount')::numeric; src:=coalesce((p_payload->>'source')::public.transaction_source,'MANUAL');
  perform public.assert_transaction_payload(hid,typ,total,p_payload->'splits',p_payload->'movements');

  update public.transactions set transaction_type=typ,transaction_at=(p_payload->>'transaction_at')::timestamptz,timezone=coalesce(p_payload->>'timezone',timezone),merchant_name=nullif(p_payload->>'merchant_name',''),description=nullif(p_payload->>'description',''),notes=nullif(p_payload->>'notes',''),total_amount=total,currency=upper(coalesce(p_payload->>'currency','IDR'))::char(3),source=src where id=p_transaction_id;
  delete from public.transaction_splits where transaction_id=p_transaction_id; delete from public.account_movements where transaction_id=p_transaction_id;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'splits','[]'::jsonb)) loop insert into public.transaction_splits(transaction_id,category_id,amount,description) values(p_transaction_id,(item->>'category_id')::uuid,(item->>'amount')::numeric,nullif(item->>'description','')); end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'movements','[]'::jsonb)) loop insert into public.account_movements(transaction_id,account_id,amount) values(p_transaction_id,(item->>'account_id')::uuid,(item->>'amount')::numeric); end loop;
  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source) values(hid,auth.uid(),'TRANSACTION_UPDATED','transaction',p_transaction_id::text,oldrow,public.transaction_json(p_transaction_id),src);
  return public.transaction_json(p_transaction_id);
end; $$;

create or replace function public.soft_delete_transaction(p_transaction_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare hid uuid; before_row jsonb; src public.transaction_source;
begin
  select household_id,source into hid,src from public.transactions where id=p_transaction_id for update;
  if hid is null then raise exception 'Transaction not found'; end if; if not public.can_write_finance(hid) then raise exception 'Not authorized'; end if;
  before_row:=public.transaction_json(p_transaction_id); update public.transactions set deleted_at=coalesce(deleted_at,now()),deleted_by=auth.uid() where id=p_transaction_id;
  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source) values(hid,auth.uid(),'TRANSACTION_DELETED','transaction',p_transaction_id::text,before_row,public.transaction_json(p_transaction_id),src);
end; $$;

create or replace function public.restore_transaction(p_transaction_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare hid uuid; before_row jsonb; src public.transaction_source;
begin
  select household_id,source into hid,src from public.transactions where id=p_transaction_id for update;
  if hid is null then raise exception 'Transaction not found'; end if; if not public.can_write_finance(hid) then raise exception 'Not authorized'; end if;
  before_row:=public.transaction_json(p_transaction_id); update public.transactions set deleted_at=null,deleted_by=null where id=p_transaction_id;
  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source) values(hid,auth.uid(),'TRANSACTION_RESTORED','transaction',p_transaction_id::text,before_row,public.transaction_json(p_transaction_id),src);
end; $$;

create or replace function public.finalize_receipt_transaction(p_receipt_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.receipts; tx jsonb;
begin
  select * into r from public.receipts where id=p_receipt_id for update;
  if r.id is null then raise exception 'Receipt not found'; end if; if r.transaction_id is not null then return public.transaction_json(r.transaction_id); end if;
  if not public.can_write_finance(r.household_id) then raise exception 'Not authorized'; end if;
  if (p_payload->>'household_id')::uuid<>r.household_id then raise exception 'Receipt household mismatch'; end if;
  tx:=public.create_financial_transaction(p_payload || jsonb_build_object('source','RECEIPT'));
  update public.receipts set transaction_id=(tx->>'id')::uuid,extraction_status='FINALIZED' where id=p_receipt_id;
  return tx;
end; $$;

create or replace function public.remove_household_member(p_household_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare target_role public.household_role; target_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_household_role(p_household_id,array['OWNER']::public.household_role[]) then raise exception 'Only the owner can remove household members'; end if;
  if p_user_id=auth.uid() then raise exception 'Owner cannot remove themselves'; end if;
  select role into target_role from public.household_members where household_id=p_household_id and user_id=p_user_id;
  if target_role is null then raise exception 'Member not found'; end if;
  if target_role='OWNER' then raise exception 'Another owner cannot be removed with this action'; end if;
  select email into target_email from public.profiles where id=p_user_id;
  delete from public.household_members where household_id=p_household_id and user_id=p_user_id;
  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,source)
  values(p_household_id,auth.uid(),'MEMBER_REMOVED','member',p_user_id::text,jsonb_build_object('email',target_email,'role',target_role),'MANUAL');
end; $$;

-- =========================
-- Reporting RPCs
-- =========================
create or replace function public.get_budget_progress(p_household_id uuid,p_month date)
returns table(id uuid,household_id uuid,category_id uuid,period_month date,amount numeric,alert_thresholds integer[],category jsonb,actual numeric)
language sql stable security invoker set search_path=public as $$
  select b.id,b.household_id,b.category_id,b.period_month,b.amount,b.alert_thresholds,
         jsonb_build_object('id',c.id,'name',c.name,'color',c.color) as category,
         coalesce(sum(s.amount) filter(where t.id is not null),0)::numeric as actual
  from public.budgets b join public.categories c on c.id=b.category_id
  left join public.transaction_splits s on s.category_id=b.category_id
  left join public.transactions t on t.id=s.transaction_id and t.household_id=b.household_id and t.transaction_type='EXPENSE' and t.status='CONFIRMED' and t.deleted_at is null and t.transaction_at>=b.period_month and t.transaction_at<(b.period_month+interval '1 month')
  where b.household_id=p_household_id and b.period_month=date_trunc('month',p_month)::date
  group by b.id,c.id;
$$;

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
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'balance',current_balance,'currency',currency) order by name) from public.account_balances where household_id=p_household_id and is_active),'[]'::jsonb),
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
           case when p_category_id is null then f.total_amount
                else coalesce(sum(s.amount) filter(where s.category_id=p_category_id),0) end::numeric as amount
    from filtered f left join public.transaction_splits s on s.transaction_id=f.id
    where f.transaction_type='EXPENSE'
    group by f.id,f.transaction_at,f.merchant_name,f.total_amount
  ), income_rows as materialized (
    select f.id,f.transaction_at,
           case when p_category_id is null then f.total_amount
                else coalesce(sum(s.amount) filter(where s.category_id=p_category_id),0) end::numeric as amount
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
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'balance',current_balance,'currency',currency) order by name) from public.account_balances where household_id=p_household_id and is_active and (p_account_id is null or id=p_account_id)),'[]'::jsonb),
    'merchants',coalesce((select jsonb_agg(jsonb_build_object('name',q.name,'amount',q.amount) order by q.amount desc) from (
      select coalesce(nullif(merchant_name,''),'Unspecified') name,sum(amount)::numeric amount
      from expense_rows group by 1 order by 2 desc limit 10
    ) q),'[]'::jsonb),
    'budgets','[]'::jsonb,
    'recent_transactions',coalesce((select jsonb_agg(to_jsonb(q) order by q.transaction_at desc) from (select * from filtered order by transaction_at desc limit 8) q),'[]'::jsonb)
  ) into result from totals;
  return result;
end; $$;

create or replace function public.get_financial_metric(
  p_household_id uuid,p_metric text,p_from date,p_to date,p_category_hint text default null,p_merchant_hint text default null
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare value numeric:=0; cat_ids uuid[]; merchant_pattern text;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Not authorized'; end if;
  if p_metric not in ('expense','income','net_cash_flow') then raise exception 'Unsupported metric'; end if;
  if p_to<p_from then raise exception 'Invalid date range'; end if;
  merchant_pattern:=case when nullif(trim(p_merchant_hint),'') is null then null else '%'||replace(replace(trim(p_merchant_hint),'%',''),'_','')||'%' end;
  if nullif(trim(p_category_hint),'') is not null then
    select array_agg(id) into cat_ids from public.categories where household_id=p_household_id and not is_archived and lower(name) like '%'||lower(trim(p_category_hint))||'%';
  end if;

  if p_metric='expense' then
    if cat_ids is null then
      select coalesce(sum(t.total_amount),0) into value from public.transactions t where t.household_id=p_household_id and t.transaction_type='EXPENSE' and t.status='CONFIRMED' and t.deleted_at is null and t.transaction_at>=p_from and t.transaction_at<(p_to+1) and (merchant_pattern is null or t.merchant_name ilike merchant_pattern);
    else
      select coalesce(sum(s.amount),0) into value from public.transaction_splits s join public.transactions t on t.id=s.transaction_id where t.household_id=p_household_id and t.transaction_type='EXPENSE' and t.status='CONFIRMED' and t.deleted_at is null and s.category_id=any(cat_ids) and t.transaction_at>=p_from and t.transaction_at<(p_to+1) and (merchant_pattern is null or t.merchant_name ilike merchant_pattern);
    end if;
  elsif p_metric='income' then
    if cat_ids is null then
      select coalesce(sum(t.total_amount),0) into value from public.transactions t where t.household_id=p_household_id and t.transaction_type='INCOME' and t.status='CONFIRMED' and t.deleted_at is null and t.transaction_at>=p_from and t.transaction_at<(p_to+1) and (merchant_pattern is null or t.merchant_name ilike merchant_pattern);
    else
      select coalesce(sum(s.amount),0) into value from public.transaction_splits s join public.transactions t on t.id=s.transaction_id where t.household_id=p_household_id and t.transaction_type='INCOME' and t.status='CONFIRMED' and t.deleted_at is null and s.category_id=any(cat_ids) and t.transaction_at>=p_from and t.transaction_at<(p_to+1) and (merchant_pattern is null or t.merchant_name ilike merchant_pattern);
    end if;
  else
    select coalesce(sum(case when transaction_type='INCOME' then total_amount when transaction_type='EXPENSE' then -total_amount else 0 end),0) into value from public.transactions t where t.household_id=p_household_id and t.status='CONFIRMED' and t.deleted_at is null and t.transaction_at>=p_from and t.transaction_at<(p_to+1) and (merchant_pattern is null or t.merchant_name ilike merchant_pattern);
  end if;
  return jsonb_build_object('metric',p_metric,'value',value,'from',p_from,'to',p_to,'category_hint',p_category_hint,'merchant_hint',p_merchant_hint);
end; $$;

-- =========================
-- Storage bucket & policies
-- =========================
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipts','receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('voice-recordings','voice-recordings',false,26214400,array['audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/flac'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists receipts_storage_select on storage.objects;
create policy receipts_storage_select on storage.objects for select to authenticated using(bucket_id='receipts' and public.is_household_member(((storage.foldername(name))[1])::uuid));
drop policy if exists receipts_storage_insert on storage.objects;
create policy receipts_storage_insert on storage.objects for insert to authenticated with check(bucket_id='receipts' and public.can_write_finance(((storage.foldername(name))[1])::uuid) and owner_id=auth.uid()::text);
drop policy if exists receipts_storage_delete on storage.objects;
create policy receipts_storage_delete on storage.objects for delete to authenticated using(bucket_id='receipts' and (owner_id=auth.uid()::text or public.has_household_role(((storage.foldername(name))[1])::uuid,array['OWNER','ADMIN']::public.household_role[])));

-- =========================
-- Grants: direct writes to transaction internals intentionally denied.
-- =========================
grant usage on schema public to authenticated;
grant select,update on public.profiles to authenticated;
grant select,update on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select on public.household_invitations to authenticated;
grant select,insert,update on public.accounts to authenticated;
grant select,insert,update on public.categories to authenticated;
grant select,insert,update,delete on public.merchants to authenticated;
grant select on public.transactions,public.transaction_splits,public.account_movements to authenticated;
grant select on public.receipts,public.receipt_items to authenticated;
grant select,insert,update,delete on public.budgets,public.recurring_transactions to authenticated;
grant select on public.voice_commands,public.ai_extractions,public.audit_logs to authenticated;
grant select,insert,update,delete on public.user_preferences,public.merchant_category_rules to authenticated;
grant select on public.ai_model_config,public.account_balances to authenticated;

grant execute on function public.create_household_with_defaults(text,text,text) to authenticated;
grant execute on function public.create_financial_transaction(jsonb) to authenticated;
grant execute on function public.update_financial_transaction(uuid,jsonb) to authenticated;
grant execute on function public.soft_delete_transaction(uuid) to authenticated;
grant execute on function public.restore_transaction(uuid) to authenticated;
grant execute on function public.remove_household_member(uuid,uuid) to authenticated;
grant execute on function public.finalize_receipt_transaction(uuid,jsonb) to authenticated;
grant execute on function public.get_budget_progress(uuid,date) to authenticated;
grant execute on function public.get_financial_dashboard(uuid,date,date) to authenticated;
grant execute on function public.get_filtered_financial_report(uuid,date,date,uuid,uuid,uuid,text,public.transaction_type) to authenticated;
grant execute on function public.get_financial_metric(uuid,text,date,date,text,text) to authenticated;

revoke all on function public.assert_transaction_payload(uuid,public.transaction_type,numeric,jsonb,jsonb) from public,anon;
revoke all on function public.transaction_json(uuid) from public,anon;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.audit_structure_change() from public,anon,authenticated;

-- Optional realtime for UI refreshes.
do $$ begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object then null; end $$;
