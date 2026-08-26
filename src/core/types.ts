export interface BibEntry {
  key: string
  type: string
  fields: Record<string, string>
  raw: string
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export function ok<T>(data: T): Result<T> { return { ok: true, data } }
export function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}
