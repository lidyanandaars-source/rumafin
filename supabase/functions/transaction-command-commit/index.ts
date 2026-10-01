import { corsHeaders, handleError, json } from '../_shared/http.ts'
import { rateLimit, requireHouseholdAccess, requireUser } from '../_shared/supabase.ts'
import { buildPreview } from '../_shared/preview.ts'
import { intentRequiresOwnerAdmin, normalizeFinancialCandidate, validateFinancialCandidate } from '../_shared/financial-command.ts'

function n(v: any) {
  return v == null ? null : Number(v)
}

function normalizedConfirmation(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('id-ID')
}

function pickCandidate(preview: any, selected: string | null) {
  const candidates = preview.candidates ?? []
  if (selected) return candidates.find((c: any) => c.id === selected) ?? null
  if (candidates.length === 1) return candidates[0]
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { userClient, admin, authUser } = await requireUser(req)
    await rateLimit(admin, authUser.id, 'transaction-command-commit', 30)

    const body = await req.json()
    const householdId = String(body.household_id ?? '')
    const commandId = String(body.command_id ?? '')
    const selected = body.selected_entity_id
      ? String(body.selected_entity_id)
      : body.selected_transaction_id
        ? String(body.selected_transaction_id)
        : null
    const confirmationText = String(body.confirmation_text ?? '')

    if (!householdId || !commandId) throw new Error('household_id and command_id are required')
    const role = await requireHouseholdAccess(admin, authUser.id, householdId, true)

    const { data: row, error } = await admin
      .from('voice_commands')
      .select('*')
      .eq('id', commandId)
      .eq('household_id', householdId)
      .single()

    if (error || !row) throw new Error('Voice command not found')
    if (row.user_id !== authUser.id) throw new Error('Not authorized for this command')

    if (row.status === 'EXECUTED') {
      return json({
        transaction_id: row.execution_transaction_id ?? null,
        entity_type: row.execution_entity_type ?? null,
        entity_id: row.execution_entity_id ?? row.execution_transaction_id ?? null,
        idempotent: true,
      })
    }

    if (!['PARSED', 'AWAITING_CONFIRMATION'].includes(row.status)) {
      throw new Error(`Voice command cannot be executed from status ${row.status}.`)
    }

    const command = normalizeFinancialCandidate(row.parsed_payload, row.transcript)
    validateFinancialCandidate(command, row.transcript)
    if (intentRequiresOwnerAdmin(command.intent) && !['OWNER', 'ADMIN'].includes(role)) {
      throw new Error('Perintah ini hanya dapat dijalankan oleh owner/admin household.')
    }
    const preview = await buildPreview(admin, householdId, command)

    if (preview.can_commit === false) {
      const issues = Array.isArray(preview.blocking_issues) && preview.blocking_issues.length
        ? `: ${preview.blocking_issues.join(', ')}`
        : ''
      throw new Error(`Command is incomplete and cannot be executed${issues}.`)
    }

    let expectedConfirmationPhrase: string | null = preview.confirmation_phrase ?? null
    if (preview.requires_typed_confirmation && !expectedConfirmationPhrase && ['DELETE_ACCOUNT_CASCADE', 'RESET_ACCOUNT'].includes(command.intent)) {
      const selectedTarget: any = pickCandidate(preview, selected)
      if (!selectedTarget) throw new Error('Choose exactly one matching account before confirming this critical action.')
      expectedConfirmationPhrase = command.intent === 'DELETE_ACCOUNT_CASCADE'
        ? `HAPUS AKUN ${selectedTarget.name}`
        : `RESET AKUN ${selectedTarget.name}`
    }

    if (preview.requires_typed_confirmation) {
      const expected = normalizedConfirmation(expectedConfirmationPhrase)
      const received = normalizedConfirmation(confirmationText)
      if (!expected || received !== expected) {
        throw new Error(`Ketik persis: ${expectedConfirmationPhrase}`)
      }
    }

    let txId: string | null = null
    let entityType: string | null = null
    let entityId: string | null = null

    if (command.intent === 'CREATE_TRANSACTION') {
      const p = preview.prepared
      if (!p?.total_amount || !p.account_id || !p.transaction_at) {
        throw new Error('Command is incomplete. Please add the transaction manually.')
      }
      if (!p.category_id) throw new Error('Category is unclear. Please add the transaction manually.')

      const amount = Number(p.total_amount)
      const movement = command.transaction_type === 'INCOME' ? amount : -amount
      const payload = {
        household_id: householdId,
        transaction_type: command.transaction_type ?? 'EXPENSE',
        transaction_at: p.transaction_at,
        timezone: 'Asia/Jakarta',
        merchant_name: command.merchant_hint ?? null,
        description: command.description ?? null,
        notes: null,
        total_amount: amount,
        currency: command.currency ?? 'IDR',
        source: 'VOICE',
        idempotency_key: row.idempotency_key,
        splits: [{ category_id: p.category_id, amount, description: command.description ?? null }],
        movements: [{ account_id: p.account_id, amount: movement }],
      }
      const { data, error: rpcError } = await userClient.rpc('create_financial_transaction', { p_payload: payload })
      if (rpcError) throw rpcError
      txId = (data as any).id
      entityType = 'transaction'
      entityId = txId
    } else if (command.intent === 'TRANSFER_MONEY') {
      const p = preview.prepared
      if (!p?.total_amount || !p.source_account_id || !p.destination_account_id || !p.transaction_at) {
        throw new Error('Transfer is incomplete. Source account, destination account and amount are required.')
      }
      if (p.source_account_id === p.destination_account_id) throw new Error('Transfer source and destination must differ.')
      const amount = Number(p.total_amount)
      const payload = {
        household_id: householdId,
        transaction_type: 'TRANSFER',
        transaction_at: p.transaction_at,
        timezone: 'Asia/Jakarta',
        merchant_name: null,
        description: command.description ?? 'Transfer',
        notes: null,
        total_amount: amount,
        currency: p.currency ?? command.currency ?? 'IDR',
        source: 'VOICE',
        idempotency_key: row.idempotency_key,
        splits: [],
        movements: [
          { account_id: p.source_account_id, amount: -amount },
          { account_id: p.destination_account_id, amount },
        ],
      }
      const { data, error: rpcError } = await userClient.rpc('create_financial_transaction', { p_payload: payload })
      if (rpcError) throw rpcError
      txId = (data as any).id
      entityType = 'transaction'
      entityId = txId
    } else if (['UPDATE_TRANSACTION', 'DELETE_TRANSACTION', 'RESTORE_TRANSACTION'].includes(command.intent)) {
      const target: any = pickCandidate(preview, selected)
      const candidates = preview.candidates ?? []
      if (!target) {
        throw new Error(candidates.length ? 'Choose exactly one matching transaction.' : 'No matching transaction found.')
      }

      if (command.intent === 'DELETE_TRANSACTION') {
        const { error: deleteError } = await userClient.rpc('soft_delete_transaction', { p_transaction_id: target.id })
        if (deleteError) throw deleteError
        txId = target.id
      } else if (command.intent === 'RESTORE_TRANSACTION') {
        const { error: restoreError } = await userClient.rpc('restore_transaction', { p_transaction_id: target.id })
        if (restoreError) throw restoreError
        txId = target.id
      } else {
        const { data: full, error: fetchError } = await admin
          .from('transactions')
          .select('*,splits:transaction_splits(*),movements:account_movements(*)')
          .eq('id', target.id)
          .single()
        if (fetchError || !full) throw new Error('Target transaction not found')

        const changes = command.changes ?? {}
        const newAmount = n(changes.amount) ?? Number(full.total_amount)
        if (changes.amount != null && (full.splits?.length ?? 0) > 1) {
          throw new Error('This transaction has multiple splits. Edit it manually to avoid changing split proportions unexpectedly.')
        }

        let splits = (full.splits ?? []).map((s: any) => ({
          category_id: s.category_id,
          amount: changes.amount != null ? newAmount : Number(s.amount),
          description: s.description,
        }))
        let movements = (full.movements ?? []).map((m: any) => ({
          account_id: m.account_id,
          amount: Number(m.amount) >= 0 ? newAmount : -newAmount,
        }))

        if (changes.category_hint) {
          const categoryPreview = await buildPreview(admin, householdId, {
            intent: 'CREATE_TRANSACTION',
            transaction_type: full.transaction_type,
            amount: newAmount,
            currency: full.currency,
            date: changes.date,
            account_hint: null,
            category_hint: changes.category_hint,
            merchant_hint: changes.merchant_name ?? full.merchant_name,
            description: changes.description ?? full.description,
          })
          if (!categoryPreview.prepared?.category_id) throw new Error('New category is unclear. Edit manually.')
          splits = splits.map((s: any) => ({ ...s, category_id: categoryPreview.prepared.category_id }))
        }

        if (changes.account_hint) {
          const accountPreview = await buildPreview(admin, householdId, {
            intent: 'CREATE_TRANSACTION',
            transaction_type: full.transaction_type,
            amount: newAmount,
            currency: full.currency,
            date: changes.date,
            account_hint: changes.account_hint,
            category_hint: null,
            merchant_hint: null,
            description: null,
          })
          if (!accountPreview.prepared?.account_id) throw new Error('New account is unclear. Edit manually.')
          movements = movements.map((m: any) => ({ ...m, account_id: accountPreview.prepared.account_id }))
        }

        const payload = {
          household_id: householdId,
          transaction_type: full.transaction_type,
          transaction_at: changes.date ? `${changes.date}T12:00:00+07:00` : full.transaction_at,
          timezone: full.timezone,
          merchant_name: changes.merchant_name ?? full.merchant_name,
          description: changes.description ?? full.description,
          notes: full.notes,
          total_amount: newAmount,
          currency: full.currency,
          source: 'VOICE',
          splits,
          movements,
        }
        const { data, error: updateError } = await userClient.rpc('update_financial_transaction', {
          p_transaction_id: target.id,
          p_payload: payload,
        })
        if (updateError) throw updateError
        txId = (data as any).id
      }

      entityType = 'transaction'
      entityId = txId
    } else if (command.intent === 'CREATE_ACCOUNT') {
      const p = preview.prepared
      if (!p?.account_name || !p.account_type_id) throw new Error('Account name and type are required.')
      const { data, error: accountError } = await userClient.rpc('create_account_with_type', {
        p_household_id: householdId,
        p_name: p.account_name,
        p_account_type_id: p.account_type_id,
        p_currency: p.currency ?? 'IDR',
        p_opening_balance: Number(p.opening_balance ?? 0),
        p_source: 'VOICE',
      })
      if (accountError) throw accountError
      entityType = 'account'
      entityId = String((data as any).id)
    } else if (['UPDATE_ACCOUNT', 'SET_ACCOUNT_OPENING_BALANCE', 'ARCHIVE_ACCOUNT', 'RESET_ACCOUNT', 'DELETE_ACCOUNT_CASCADE'].includes(command.intent)) {
      const target: any = pickCandidate(preview, selected)
      const candidates = preview.candidates ?? []
      if (!target) throw new Error(candidates.length ? 'Choose exactly one matching account.' : 'No matching account found.')

      if (command.intent === 'ARCHIVE_ACCOUNT') {
        const { error: accountError } = await userClient.rpc('voice_archive_account', { p_account_id: target.id })
        if (accountError) throw accountError
      } else if (command.intent === 'RESET_ACCOUNT') {
        const { error: accountError } = await userClient.rpc('voice_reset_account', { p_account_id: target.id })
        if (accountError) throw accountError
      } else if (command.intent === 'DELETE_ACCOUNT_CASCADE') {
        const { error: accountError } = await userClient.rpc('voice_delete_account_cascade', { p_account_id: target.id })
        if (accountError) throw accountError
      } else {
        const changes = command.account_changes ?? {}
        const name = command.intent === 'UPDATE_ACCOUNT' ? (changes.name ?? null) : null
        const opening = command.intent === 'SET_ACCOUNT_OPENING_BALANCE'
          ? n(changes.opening_balance)
          : n(changes.opening_balance)
        if (command.intent === 'UPDATE_ACCOUNT' && name == null && opening == null) {
          throw new Error('No account change was provided.')
        }
        if (command.intent === 'SET_ACCOUNT_OPENING_BALANCE' && opening == null) {
          throw new Error('New opening balance is required.')
        }
        const { error: accountError } = await userClient.rpc('voice_update_account', {
          p_account_id: target.id,
          p_name: name,
          p_opening_balance: opening,
        })
        if (accountError) throw accountError
      }

      entityType = 'account'
      entityId = target.id
    } else if (command.intent === 'CREATE_ACCOUNT_TYPE') {
      const name = String(preview.prepared?.account_type_name ?? '').trim()
      if (!name) throw new Error('Account type name is required.')
      const { data, error: typeError } = await userClient.rpc('create_account_type', {
        p_household_id: householdId,
        p_name: name,
        p_icon: null,
        p_color: null,
        p_source: 'VOICE',
      })
      if (typeError) throw typeError
      entityType = 'account_type'
      entityId = String((data as any).id)
    } else if (['UPDATE_ACCOUNT_TYPE', 'DELETE_ACCOUNT_TYPE'].includes(command.intent)) {
      const target: any = pickCandidate(preview, selected)
      const candidates = preview.candidates ?? []
      if (!target) throw new Error(candidates.length ? 'Choose exactly one matching account type.' : 'No matching account type found.')
      if (command.intent === 'DELETE_ACCOUNT_TYPE') {
        const { error: typeError } = await userClient.rpc('delete_account_type', {
          p_account_type_id: target.id,
          p_source: 'VOICE',
        })
        if (typeError) throw typeError
      } else {
        const newName = String(preview.prepared?.new_account_type_name ?? '').trim()
        if (!newName) throw new Error('New account type name is required.')
        const { error: typeError } = await userClient.rpc('update_account_type', {
          p_account_type_id: target.id,
          p_name: newName,
          p_icon: target.icon ?? null,
          p_color: target.color ?? null,
          p_source: 'VOICE',
        })
        if (typeError) throw typeError
      }
      entityType = 'account_type'
      entityId = target.id
    } else if (command.intent === 'CREATE_CATEGORY') {
      const p = preview.prepared
      if (!p?.category_name) throw new Error('Category name is required.')
      let parentId: string | null = null
      if (p.parent_category_hint) {
        const { data: parents, error: parentError } = await admin
          .from('categories')
          .select('id,name')
          .eq('household_id', householdId)
          .eq('is_archived', false)
        if (parentError) throw parentError
        const hint = String(p.parent_category_hint).toLowerCase().trim()
        const exact = (parents ?? []).filter((c: any) => c.name.toLowerCase().trim() === hint)
        const partial = (parents ?? []).filter((c: any) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()))
        const match = exact.length === 1 ? exact[0] : partial.length === 1 ? partial[0] : null
        if (!match) throw new Error('Parent category is unclear. Create the category manually or use an exact parent name.')
        parentId = match.id
      }
      const { data, error: categoryError } = await userClient.rpc('voice_create_category', {
        p_household_id: householdId,
        p_name: p.category_name,
        p_transaction_type: p.category_transaction_type ?? 'EXPENSE',
        p_parent_id: parentId,
      })
      if (categoryError) throw categoryError
      entityType = 'category'
      entityId = String((data as any).id)
    } else if (command.intent === 'RESET_HOUSEHOLD_FINANCES') {
      const { error: resetError } = await userClient.rpc('voice_reset_household_finances', {
        p_household_id: householdId,
      })
      if (resetError) throw resetError
      entityType = 'household'
      entityId = householdId
    } else {
      throw new Error('This command cannot be committed from the voice flow.')
    }

    await admin
      .from('voice_commands')
      .update({
        status: 'EXECUTED',
        execution_transaction_id: txId,
        execution_entity_type: entityType,
        execution_entity_id: entityId,
      })
      .eq('id', commandId)

    return json({
      transaction_id: txId,
      entity_type: entityType,
      entity_id: entityId,
    })
  } catch (e) {
    return handleError(e)
  }
})
