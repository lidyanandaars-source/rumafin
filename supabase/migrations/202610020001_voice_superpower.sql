-- RumaFin AI — Voice Superpower administration layer
-- AI only interprets. These RPCs enforce authorization, validation, auditability,
-- and atomic server-side mutations for privileged voice actions.

alter table public.voice_commands
  add column if not exists execution_entity_type text,
  add column if not exists execution_entity_id text;

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
declare
  a public.accounts;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_household_role(p_household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can create accounts';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Account name is required'; end if;
  if p_currency is null or char_length(trim(p_currency))<>3 then raise exception 'Currency must be a 3-letter code'; end if;

  insert into public.accounts(household_id,name,account_type,currency,opening_balance,created_by)
  values(p_household_id,trim(p_name),p_account_type,upper(trim(p_currency))::char(3),coalesce(p_opening_balance,0),auth.uid())
  returning * into a;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,after_data,source)
  values(p_household_id,auth.uid(),'ACCOUNT_CREATED','account',a.id::text,to_jsonb(a),'VOICE');

  return to_jsonb(a);
end;
$$;

create or replace function public.voice_update_account(
  p_account_id uuid,
  p_name text default null,
  p_opening_balance numeric default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.accounts;
  before_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into a from public.accounts where id=p_account_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if not public.has_household_role(a.household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can update accounts';
  end if;
  if p_name is not null and nullif(trim(p_name),'') is null then raise exception 'Account name cannot be empty'; end if;

  before_row:=to_jsonb(a);

  update public.accounts
  set name=case when p_name is null then name else trim(p_name) end,
      opening_balance=coalesce(p_opening_balance,opening_balance),
      updated_at=now()
  where id=p_account_id
  returning * into a;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(a.household_id,auth.uid(),'ACCOUNT_UPDATED','account',a.id::text,before_row,to_jsonb(a),'VOICE');

  return to_jsonb(a);
end;
$$;

create or replace function public.voice_archive_account(p_account_id uuid) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.accounts;
  before_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into a from public.accounts where id=p_account_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if not public.has_household_role(a.household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can archive accounts';
  end if;

  before_row:=to_jsonb(a);
  update public.accounts set is_active=false,updated_at=now() where id=p_account_id returning * into a;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(a.household_id,auth.uid(),'ACCOUNT_ARCHIVED','account',a.id::text,before_row,to_jsonb(a),'VOICE');

  return to_jsonb(a);
end;
$$;

create or replace function public.voice_create_category(
  p_household_id uuid,
  p_name text,
  p_transaction_type text default 'EXPENSE',
  p_parent_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.categories;
  t text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_household_role(p_household_id,array['OWNER','ADMIN']::public.household_role[]) then
    raise exception 'Only owner/admin can create categories';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Category name is required'; end if;
  t:=upper(coalesce(p_transaction_type,'EXPENSE'));
  if t not in ('EXPENSE','INCOME','BOTH') then raise exception 'Invalid category transaction type'; end if;
  if p_parent_id is not null and not exists(select 1 from public.categories where id=p_parent_id and household_id=p_household_id) then
    raise exception 'Parent category not found';
  end if;

  insert into public.categories(household_id,parent_id,name,transaction_type,created_by)
  values(p_household_id,p_parent_id,trim(p_name),t,auth.uid())
  returning * into c;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,after_data,source)
  values(p_household_id,auth.uid(),'CATEGORY_CREATED','category',c.id::text,to_jsonb(c),'VOICE');

  return to_jsonb(c);
end;
$$;

create or replace function public.voice_reset_account(p_account_id uuid) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.accounts;
  before_row jsonb;
  affected int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into a from public.accounts where id=p_account_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if not public.has_household_role(a.household_id,array['OWNER']::public.household_role[]) then
    raise exception 'Only the household owner can reset an account';
  end if;

  before_row:=to_jsonb(a);

  select count(distinct t.id) into affected
  from public.transactions t
  join public.account_movements m on m.transaction_id=t.id
  where m.account_id=p_account_id and t.deleted_at is null;

  update public.transactions t
  set deleted_at=coalesce(t.deleted_at,now()),deleted_by=auth.uid()
  where t.deleted_at is null
    and exists(select 1 from public.account_movements m where m.transaction_id=t.id and m.account_id=p_account_id);

  update public.accounts set opening_balance=0,updated_at=now() where id=p_account_id returning * into a;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(
    a.household_id,auth.uid(),'ACCOUNT_RESET','account',a.id::text,
    before_row || jsonb_build_object('active_transactions_affected',affected),
    to_jsonb(a) || jsonb_build_object('active_transactions_soft_deleted',affected),
    'VOICE'
  );

  return jsonb_build_object('account',to_jsonb(a),'transactions_soft_deleted',affected);
end;
$$;

create or replace function public.voice_delete_account_cascade(p_account_id uuid) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.accounts;
  before_row jsonb;
  tx_count int;
  recurring_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into a from public.accounts where id=p_account_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if not public.has_household_role(a.household_id,array['OWNER']::public.household_role[]) then
    raise exception 'Only the household owner can permanently delete an account';
  end if;

  before_row:=to_jsonb(a);

  select count(distinct transaction_id) into tx_count
  from public.account_movements where account_id=p_account_id;

  select count(*) into recurring_count
  from public.recurring_transactions
  where account_id=p_account_id or destination_account_id=p_account_id;

  delete from public.recurring_transactions
  where account_id=p_account_id or destination_account_id=p_account_id;

  -- Deleting the whole transaction is intentional: a transfer involving this account
  -- must disappear consistently from both sides of the ledger.
  delete from public.transactions t
  where exists(
    select 1 from public.account_movements m
    where m.transaction_id=t.id and m.account_id=p_account_id
  );

  delete from public.accounts where id=p_account_id;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(
    a.household_id,auth.uid(),'ACCOUNT_DELETED_CASCADE','account',p_account_id::text,
    before_row,
    jsonb_build_object('permanently_deleted',true,'transactions_deleted',tx_count,'recurring_deleted',recurring_count),
    'VOICE'
  );

  return jsonb_build_object(
    'account_id',p_account_id,
    'transactions_deleted',tx_count,
    'recurring_deleted',recurring_count
  );
end;
$$;

create or replace function public.voice_reset_household_finances(p_household_id uuid) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  active_tx_count int;
  account_count int;
  budget_count int;
  recurring_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_household_role(p_household_id,array['OWNER']::public.household_role[]) then
    raise exception 'Only the household owner can reset all finances';
  end if;

  select count(*) into active_tx_count from public.transactions where household_id=p_household_id and deleted_at is null;
  select count(*) into account_count from public.accounts where household_id=p_household_id;
  select count(*) into budget_count from public.budgets where household_id=p_household_id;
  select count(*) into recurring_count from public.recurring_transactions where household_id=p_household_id;

  update public.transactions
  set deleted_at=coalesce(deleted_at,now()),deleted_by=auth.uid()
  where household_id=p_household_id and deleted_at is null;

  update public.accounts set opening_balance=0,updated_at=now() where household_id=p_household_id;
  delete from public.budgets where household_id=p_household_id;
  delete from public.recurring_transactions where household_id=p_household_id;

  insert into public.audit_logs(household_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,source)
  values(
    p_household_id,auth.uid(),'HOUSEHOLD_FINANCES_RESET','household',p_household_id::text,
    jsonb_build_object(
      'active_transactions',active_tx_count,
      'accounts',account_count,
      'budgets',budget_count,
      'recurring_transactions',recurring_count
    ),
    jsonb_build_object(
      'active_transactions_soft_deleted',active_tx_count,
      'account_opening_balances_reset',account_count,
      'budgets_deleted',budget_count,
      'recurring_deleted',recurring_count
    ),
    'VOICE'
  );

  return jsonb_build_object(
    'transactions_soft_deleted',active_tx_count,
    'accounts_reset',account_count,
    'budgets_deleted',budget_count,
    'recurring_deleted',recurring_count
  );
end;
$$;

grant execute on function public.voice_create_account(uuid,text,public.account_type,text,numeric) to authenticated;
grant execute on function public.voice_update_account(uuid,text,numeric) to authenticated;
grant execute on function public.voice_archive_account(uuid) to authenticated;
grant execute on function public.voice_create_category(uuid,text,text,uuid) to authenticated;
grant execute on function public.voice_reset_account(uuid) to authenticated;
grant execute on function public.voice_delete_account_cascade(uuid) to authenticated;
grant execute on function public.voice_reset_household_finances(uuid) to authenticated;
