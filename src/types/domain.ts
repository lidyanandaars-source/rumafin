export type HouseholdRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
export type AccountType = 'CASH' | 'BANK' | 'EWALLET' | 'CREDIT_CARD' | 'SAVINGS' | 'OTHER'
export type TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'ADJUSTMENT'
export type TransactionSource = 'MANUAL' | 'VOICE' | 'RECEIPT' | 'RECURRING' | 'IMPORT'
export type TransactionStatus = 'DRAFT' | 'PENDING_REVIEW' | 'CONFIRMED' | 'VOIDED'

export interface Household {
  id: string
  name: string
  default_currency: string
  timezone: string
  created_at: string
}

export interface Membership {
  household_id: string
  user_id: string
  role: HouseholdRole
  household?: Household
}

export interface Account {
  id: string
  household_id: string
  name: string
  account_type: AccountType
  currency: string
  opening_balance: number
  current_balance?: number
  is_active: boolean
  icon: string | null
  color: string | null
  created_at: string
}

export interface Category {
  id: string
  household_id: string
  parent_id: string | null
  name: string
  transaction_type: 'EXPENSE' | 'INCOME' | 'BOTH'
  icon: string | null
  color: string | null
  is_archived: boolean
  created_at: string
}

export interface TransactionSplit {
  id?: string
  category_id: string | null
  amount: number
  description?: string | null
  category?: Pick<Category, 'id' | 'name' | 'color' | 'icon'> | null
}

export interface Transaction {
  id: string
  household_id: string
  transaction_type: TransactionType
  transaction_at: string
  timezone: string
  merchant_name: string | null
  description: string | null
  notes: string | null
  total_amount: number
  currency: string
  source: TransactionSource
  status: TransactionStatus
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  deleted_by: string | null
  splits?: TransactionSplit[]
  movements?: AccountMovement[]
}

export interface AccountMovement {
  id?: string
  transaction_id?: string
  account_id: string
  amount: number
  account?: Pick<Account, 'id' | 'name' | 'account_type'>
}

export interface Budget {
  id: string
  household_id: string
  category_id: string
  period_month: string
  amount: number
  alert_thresholds: number[]
  category?: Pick<Category, 'id' | 'name' | 'color'>
  actual?: number
}

export interface DashboardSummary {
  income: number
  expense: number
  net_cash_flow: number
  available_balance: number
  savings_rate: number | null
  categories: Array<{ name: string; amount: number; color?: string | null }>
  daily: Array<{ date: string; expense: number; income: number }>
  accounts: Array<{ id: string; name: string; account_type: AccountType; balance: number; currency: string }>
  merchants: Array<{ name: string; amount: number }>
  budgets: Array<{ category_id: string; category: string; budget: number; actual: number; ratio: number }>
  recent_transactions: Transaction[]
}

export type FinancialIntent =
  | 'CREATE_TRANSACTION'
  | 'UPDATE_TRANSACTION'
  | 'DELETE_TRANSACTION'
  | 'FIND_TRANSACTION'
  | 'CREATE_CATEGORY'
  | 'GET_FINANCIAL_SUMMARY'

export interface FinancialCommand {
  intent: FinancialIntent
  transaction_type?: TransactionType | null
  amount?: number | null
  currency?: string | null
  date?: string | null
  date_reference?: 'TODAY' | 'YESTERDAY' | null
  account_hint?: string | null
  category_hint?: string | null
  merchant_hint?: string | null
  description?: string | null
  selector?: {
    description?: string | null
    merchant?: string | null
    relative_date?: 'TODAY' | 'YESTERDAY' | null
    date?: string | null
    amount?: number | null
  } | null
  changes?: {
    amount?: number | null
    date?: string | null
    account_hint?: string | null
    category_hint?: string | null
    merchant_name?: string | null
    description?: string | null
  } | null
  confidence: number
}

export interface ReceiptField<T> {
  value: T | null
  confidence: number
  needs_review: boolean
}

export interface ReceiptExtraction {
  merchant: ReceiptField<string>
  transaction_date: ReceiptField<string>
  total: ReceiptField<number>
  subtotal: ReceiptField<number>
  tax: ReceiptField<number>
  discount: ReceiptField<number>
  payment_method: ReceiptField<string>
  items: Array<{
    name: string | null
    quantity: number | null
    unit_price: number | null
    total: number | null
    confidence: number
  }>
  overall_confidence: number
  needs_review: boolean
  duplicate_candidates?: Transaction[]
  storage_path?: string
  receipt_id?: string
}
