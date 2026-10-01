import { z } from 'zod'

export const transactionSplitSchema = z.object({
  category_id: z.string().uuid().nullable(),
  amount: z.coerce.number().positive(),
  description: z.string().trim().max(500).nullable().optional(),
})

export const transactionFormSchema = z.object({
  transaction_type: z.enum(['EXPENSE', 'INCOME', 'TRANSFER', 'ADJUSTMENT']),
  total_amount: z.coerce.number().positive('Nominal harus lebih besar dari 0'),
  currency: z.string().length(3).default('IDR'),
  transaction_date: z.string().min(1),
  transaction_time: z.string().min(1),
  account_id: z.string().uuid().nullable(),
  destination_account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  merchant_name: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (!value.account_id) ctx.addIssue({ code: 'custom', path: ['account_id'], message: 'Pilih akun' })
  if (value.transaction_type === 'TRANSFER') {
    if (!value.destination_account_id) ctx.addIssue({ code: 'custom', path: ['destination_account_id'], message: 'Pilih akun tujuan' })
    if (value.destination_account_id === value.account_id) ctx.addIssue({ code: 'custom', path: ['destination_account_id'], message: 'Akun tujuan harus berbeda' })
  } else if (!value.category_id) {
    ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'Pilih kategori' })
  }
})

export type TransactionFormValues = z.infer<typeof transactionFormSchema>
