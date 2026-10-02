# Update 2026-10-02 — Voice Review & Receipt Multi-Transaction

## 1. Scan receipt: dua jalur input

Dialog **Scan receipt** sekarang menampilkan dua pilihan terpisah:

- **Upload foto / file** — memilih receipt dari gallery atau file (JPG, PNG, WEBP, PDF).
- **Foto dengan kamera** — membuka kamera perangkat melalui `capture="environment"` pada perangkat yang mendukungnya.

Keduanya tetap melewati validasi MIME, batas 10 MB, optimasi gambar, private Supabase Storage, lalu `receipt-extract`.

## 2. Voice CREATE_TRANSACTION: AI tidak lagi menjadi penghalang jika akun/kategori tidak jelas

Untuk intent `CREATE_TRANSACTION`, hasil AI kini diperlakukan sebagai **prefill**. Preview menyediakan field yang dapat diedit sebelum commit:

- nominal;
- akun;
- kategori;
- deskripsi.

Jika AI tidak berhasil menentukan akun atau kategori, tombol simpan dapat aktif setelah user melengkapinya secara manual. Backend `transaction-command-commit` tetap memvalidasi bahwa akun aktif dan kategori valid untuk household serta sesuai tipe transaksi.

Dengan demikian alur menjadi:

`Voice -> transcript -> AI interpretation -> preview/prefill -> user melengkapi/mengoreksi -> server validation -> transaction commit`

## 3. Receipt: item berbeda kategori menjadi transaksi berbeda

`receipt-extract` sekarang meminta `category_hint` pada **setiap line item**, bukan hanya pada receipt secara keseluruhan. Pencocokan kategori dilakukan per item.

Pada review receipt:

- setiap item dapat diperiksa nominal dan kategorinya;
- item dengan kategori yang sama digabung menjadi satu transaksi;
- kategori yang berbeda menghasilkan transaksi yang berbeda;
- total seluruh item harus sama dengan total receipt sebelum mode multi-transaction dapat disimpan.

Contoh:

- Jajan Rp50.000 -> Food & Drinks
- Pampers bayi Rp50.000 -> Child / Diapers

Hasil: **2 transaksi**, masing-masing Rp50.000, dengan satu receipt yang sama sebagai sumber.

## 4. Database migration

Migration baru:

`supabase/migrations/202610020003_receipt_multi_transactions.sql`

Migration menambahkan:

- `voice_commands.manual_override` untuk jejak koreksi manual pada hasil voice;
- `receipt_transactions` sebagai relasi receipt -> banyak transaksi;
- RPC atomik `finalize_receipt_transactions(receipt_id, payloads)`.

Kolom legacy `receipts.transaction_id` tetap diisi dengan transaksi pertama untuk kompatibilitas dengan kode/data lama.

## 5. Safety

Semua transaksi hasil satu receipt dibuat dalam satu RPC database. Bila salah satu payload gagal tervalidasi, seluruh proses rollback sehingga tidak terjadi receipt yang hanya tersimpan sebagian.
