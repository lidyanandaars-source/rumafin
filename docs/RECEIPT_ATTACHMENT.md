# Receipt attachment behavior

- Every receipt image/PDF uploaded through **Scan receipt** remains in the private Supabase Storage bucket `receipts`.
- The `receipts` row stores the storage path plus file metadata (`original_filename`, `stored_filename`, `file_size_bytes`, and `capture_source`).
- Finalized receipt transactions are linked through `receipt_transactions`; one receipt can therefore be opened from every transaction generated from that receipt.
- Clicking a transaction opens transaction detail. If a receipt is linked, the UI shows receipt metadata, a signed preview, and an **Unduh receipt** action.
- Signed preview URLs expire after a short period. Downloads use the authenticated Supabase Storage client and existing household RLS.
- Receipt files are not automatically deleted after AI extraction. Existing `DELETE_AFTER_EXTRACTION` preferences are migrated back to `KEEP`.
- Receipt files deleted by an older deployed version cannot be recreated automatically from database metadata.
