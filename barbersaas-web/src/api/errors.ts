/** Error de la API en formato Problem Details (RFC 9457) con `code` estable. */
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  code: string;
  errors?: Array<{ path: string; message: string }>;
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiError';
  }
  get status(): number {
    return this.problem.status;
  }
  get code(): string {
    return this.problem.code;
  }
  /** Errores por campo (para pintarlos en el formulario). */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (!code || e.code === code);
}
