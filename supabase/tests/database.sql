-- Run with: supabase test db
begin;
select plan(8);

select has_table('public','transactions','transactions table exists');
select has_table('public','transaction_splits','transaction_splits table exists');
select has_table('public','account_movements','account_movements table exists');
select has_table('public','receipt_transactions','receipt multi-transaction link table exists');
select has_function('public','create_financial_transaction',array['jsonb'],'atomic create RPC exists');
select has_function('public','soft_delete_transaction',array['uuid'],'soft-delete RPC exists');
select has_function('public','finalize_receipt_transactions',array['uuid','jsonb'],'receipt multi-finalize RPC exists');
select has_function('public','get_financial_dashboard',array['uuid','date','date'],'dashboard calculation RPC exists');

select * from finish();
rollback;
