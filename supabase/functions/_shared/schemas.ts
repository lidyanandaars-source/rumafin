export const financialCommandSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['CREATE_TRANSACTION','UPDATE_TRANSACTION','DELETE_TRANSACTION','FIND_TRANSACTION','CREATE_CATEGORY','GET_FINANCIAL_SUMMARY'] },
    transaction_type: { type: ['string','null'], enum: ['EXPENSE','INCOME','TRANSFER','ADJUSTMENT',null] },
    amount: { type: ['number','null'], minimum: 0 },
    currency: { type: ['string','null'] },
    date: { type: ['string','null'] },
    date_reference: { type: ['string','null'], enum: ['TODAY','YESTERDAY',null] },
    account_hint: { type: ['string','null'] },
    category_hint: { type: ['string','null'] },
    merchant_hint: { type: ['string','null'] },
    description: { type: ['string','null'] },
    selector: {
      type: ['object','null'], additionalProperties: false,
      properties: { description:{type:['string','null']},merchant:{type:['string','null']},relative_date:{type:['string','null'],enum:['TODAY','YESTERDAY',null]},date:{type:['string','null']},amount:{type:['number','null'],minimum:0} },
      required: ['description','merchant','relative_date','date','amount']
    },
    changes: {
      type: ['object','null'], additionalProperties: false,
      properties: { amount:{type:['number','null'],minimum:0},date:{type:['string','null']},account_hint:{type:['string','null']},category_hint:{type:['string','null']},merchant_name:{type:['string','null']},description:{type:['string','null']} },
      required: ['amount','date','account_hint','category_hint','merchant_name','description']
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  },
  required: ['intent','transaction_type','amount','currency','date','date_reference','account_hint','category_hint','merchant_hint','description','selector','changes','confidence']
} as const

const field = (valueType: string) => ({ type:'object',additionalProperties:false,properties:{value:{type:[valueType,'null']},confidence:{type:'number',minimum:0,maximum:1},needs_review:{type:'boolean'}},required:['value','confidence','needs_review'] })

export const receiptSchema = {
  type:'object',additionalProperties:false,
  properties:{
    merchant:field('string'), transaction_date:field('string'), total:field('number'), subtotal:field('number'), tax:field('number'), discount:field('number'), payment_method:field('string'), category_hint:field('string'),
    items:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:['string','null']},quantity:{type:['number','null']},unit_price:{type:['number','null']},total:{type:['number','null']},confidence:{type:'number',minimum:0,maximum:1}},required:['name','quantity','unit_price','total','confidence']}}
  },required:['merchant','transaction_date','total','subtotal','tax','discount','payment_method','category_hint','items']
} as const

export const financialQuerySchema = {
  type:'object',additionalProperties:false,properties:{metric:{type:'string',enum:['expense','income','net_cash_flow']},category_hint:{type:['string','null']},merchant_hint:{type:['string','null']},from:{type:'string'},to:{type:'string'}},required:['metric','category_hint','merchant_hint','from','to']
} as const
