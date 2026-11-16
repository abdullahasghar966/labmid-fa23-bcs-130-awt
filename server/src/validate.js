import { badRequest } from './errors.js';

export function idParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`${name} must be a positive integer`);
  return n;
}

export function integer(value, name, { min = 0, max = 100000 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${name} must be a whole number between ${min} and ${max}`);
  }
  return value;
}

export function text(value, name, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw badRequest(`${name} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${name} is required`);
  if (trimmed.length > max) throw badRequest(`${name} must be at most ${max} characters`);
  return trimmed;
}

export function money(value, name, { min = 0 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > 10_000_000) {
    throw badRequest(`${name} must be a number of at least ${min}`);
  }
  if (Math.round(value * 100) !== value * 100) {
    throw badRequest(`${name} can have at most 2 decimal places`);
  }
  return value;
}

export const round2 = (n) => Math.round(n * 100) / 100;
