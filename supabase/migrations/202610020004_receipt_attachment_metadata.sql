-- Persist receipt attachment metadata so a finalized financial transaction can
-- show and download the receipt that created it.

alter table public.receipts
  add column if not exists original_filename text,
  add column if not exists stored_filename text,
  add column if not exists file_size_bytes bigint,
  add column if not exists capture_source text;

alter table public.receipts
  drop constraint if exists receipts_file_size_bytes_check;
alter table public.receipts
  add constraint receipts_file_size_bytes_check
  check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 10485760));

alter table public.receipts
  drop constraint if exists receipts_capture_source_check;
alter table public.receipts
  add constraint receipts_capture_source_check
  check (capture_source is null or capture_source in ('UPLOAD','CAMERA'));

-- Receipt images/files are now part of the transaction evidence. Existing
-- preferences that requested deletion are normalized to KEEP. The column is
-- retained for backward compatibility with older clients.
update public.user_preferences
set receipt_retention = 'KEEP'
where receipt_retention = 'DELETE_AFTER_EXTRACTION';

grant select on public.receipt_transactions to authenticated;
