// "Error API (409)" - every error uses one JSON shape:
//   { "error": { "status": 409, "code": "NOT_ENOUGH_UNITS", "message": "...", "details": {...} } }

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'VALIDATION_ERROR', message, details);
export const forbidden = (message = 'You do not have permission to do this') =>
  new ApiError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);

// Served at GET /api/meta/errors so the frontend (and the examiner) can see every 409.
export const ERROR_CATALOGUE = [
  {
    status: 409,
    code: 'NOT_ENOUGH_UNITS',
    when: 'A student books more units than are left for that lab equipment (the Variant 0 rule).',
    details: '{ equipmentId, requested, unitsLeft }',
  },
  {
    status: 409,
    code: 'CAPACITY_CONFLICT',
    when: 'Staff lower an equipment quantity below the units currently out on pending/confirmed loans.',
    details: '{ equipmentId, requestedQuantity, unitsOnLoan }',
  },
  {
    status: 409,
    code: 'EQUIPMENT_HAS_ACTIVE_LOANS',
    when: 'Staff delete equipment that still has pending/confirmed loans.',
    details: '{ equipmentId, activeLoans }',
  },
  {
    status: 409,
    code: 'INVALID_STATUS_TRANSITION',
    when: 'A loan is moved backwards or out of a final state (forward only: pending -> confirmed -> completed, or cancelled).',
    details: '{ loanId, from, to, allowed }',
  },
  {
    status: 409,
    code: 'AMOUNT_BELOW_PAID',
    when: 'Staff set a loan amount lower than what has already been paid.',
    details: '{ loanId, amount, amountPaid }',
  },
  {
    status: 409,
    code: 'PAYMENT_EXCEEDS_BALANCE',
    when: 'A payment is larger than the remaining loan balance.',
    details: '{ loanId, amount, remaining }',
  },
  {
    status: 409,
    code: 'DUPLICATE',
    when: 'A unique value already exists (e.g. an equipment name).',
    details: '{ constraint }',
  },
  { status: 400, code: 'VALIDATION_ERROR', when: 'The request body or parameters are invalid.' },
  { status: 401, code: 'UNAUTHENTICATED', when: 'No or invalid Google sign-in token.' },
  { status: 403, code: 'FORBIDDEN', when: 'Your role is not allowed to do this, or it is not your loan.' },
  { status: 404, code: 'NOT_FOUND', when: 'The equipment, loan or user does not exist.' },
];

export function errorHandler(err, req, res, _next) {
  let apiError = err;

  if (!(err instanceof ApiError)) {
    if (err.code === '23505') {
      apiError = conflict('DUPLICATE', 'That value already exists', { constraint: err.constraint });
    } else if (err.code === '23514') {
      apiError = conflict('INVALID_STATUS_TRANSITION', err.message);
    } else if (err.type === 'entity.parse.failed') {
      apiError = badRequest('Request body must be valid JSON');
    } else {
      console.error(err);
      apiError = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on the server');
    }
  }

  res.status(apiError.status).json({
    error: {
      status: apiError.status,
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details !== undefined && { details: apiError.details }),
    },
  });
}
