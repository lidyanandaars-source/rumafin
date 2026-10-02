-- Receipt review can finalize one receipt into multiple financial transactions.
-- The legacy receipts.transaction_id column remains populated with the first
-- transaction for backward compatibility; all receipt-created transactions are
-- linked through receipt_transactions.

alter table public.voice_commands
  add column if not exists manual_override jsonb;

create table if not exists public.receipt_transactions (
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  group_no integer not null check (group_no > 0),
  created_at timestamptz not null default now(),
  primary key (receipt_id, transaction_id),
  unique (receipt_id, group_no)
);

create index if not exists idx_receipt_transactions_receipt
  on public.receipt_transactions(receipt_id, group_no);

alter table public.receipt_transactions enable row level security;

drop policy if exists receipt_transactions_member_select on public.receipt_transactions;
create policy receipt_transactions_member_select
  on public.receipt_transactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.receipts r
      where r.id = receipt_transactions.receipt_id
        and public.is_household_member(r.household_id)
    )
  );

create or replace function public.finalize_receipt_transactions(
  p_receipt_id uuid,
  p_payloads jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.receipts;
  payload jsonb;
  tx jsonb;
  tx_id uuid;
  first_tx_id uuid := null;
  group_number integer := 0;
  created jsonb := '[]'::jsonb;
  existing jsonb;
  payload_total numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into r
  from public.receipts
  where id = p_receipt_id
  for update;

  if r.id is null then
    raise exception 'Receipt not found';
  end if;
  if not public.can_write_finance(r.household_id) then
    raise exception 'Not authorized';
  end if;

  select coalesce(jsonb_agg(public.transaction_json(rt.transaction_id) order by rt.group_no), '[]'::jsonb)
    into existing
  from public.receipt_transactions rt
  where rt.receipt_id = p_receipt_id;

  if jsonb_array_length(existing) > 0 then
    return jsonb_build_object(
      'transactions', existing,
      'count', jsonb_array_length(existing),
      'idempotent', true
    );
  end if;

  -- Backward compatibility for receipts finalized before this migration.
  if r.transaction_id is not null then
    return jsonb_build_object(
      'transactions', jsonb_build_array(public.transaction_json(r.transaction_id)),
      'count', 1,
      'idempotent', true
    );
  end if;

  if p_payloads is null or jsonb_typeof(p_payloads) <> 'array' or jsonb_array_length(p_payloads) = 0 then
    raise exception 'At least one transaction payload is required';
  end if;
  if jsonb_array_length(p_payloads) > 100 then
    raise exception 'Receipt cannot create more than 100 transactions';
  end if;

  select coalesce(sum((value->>'total_amount')::numeric), 0)
    into payload_total
  from jsonb_array_elements(p_payloads);
  if payload_total <= 0 then
    raise exception 'Receipt transaction total must be greater than zero';
  end if;

  for payload in select value from jsonb_array_elements(p_payloads)
  loop
    group_number := group_number + 1;

    if coalesce(payload->>'household_id', '') = ''
      or (payload->>'household_id')::uuid <> r.household_id then
      raise exception 'Receipt household mismatch';
    end if;

    tx := public.create_financial_transaction(payload || jsonb_build_object('source', 'RECEIPT'));
    tx_id := (tx->>'id')::uuid;

    if first_tx_id is null then
      first_tx_id := tx_id;
    end if;

    insert into public.receipt_transactions(receipt_id, transaction_id, group_no)
    values (p_receipt_id, tx_id, group_number)
    on conflict do nothing;

    created := created || jsonb_build_array(tx);
  end loop;

  update public.receipts
  set transaction_id = first_tx_id,
      total = payload_total,
      extraction_status = 'FINALIZED',
      updated_at = now()
  where id = p_receipt_id;

  return jsonb_build_object(
    'transactions', created,
    'count', jsonb_array_length(created),
    'idempotent', false
  );
end;
$$;

grant execute on function public.finalize_receipt_transactions(uuid, jsonb) to authenticated;
