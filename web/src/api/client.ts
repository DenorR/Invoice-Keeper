import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];
export type User = Schemas["UserOut"];
export type Occurrence = Schemas["OccurrenceOut"];
export type RecurringPayment = Schemas["RecurringPaymentOut"];
export type Summary = Schemas["SummaryOut"];
export type Meta = Schemas["MetaOut"];
export type AuditEntry = Schemas["AuditOut"];
export type Currency = Schemas["Currency"];
export type Frequency = Schemas["Frequency"];
export type OccurrenceState = Schemas["OccurrenceState"];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const UNAUTHORIZED_EVENT = "ik:unauthorized";

const unauthorizedMiddleware: Middleware = {
  async onResponse({ request, response }) {
    if (response.status === 401 && !request.url.endsWith("/auth/login")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return response;
  },
};

export const api = createClient<paths>({ baseUrl: window.location.origin, credentials: "same-origin" });
api.use(unauthorizedMiddleware);

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

/** Возвращает данные ответа или бросает ApiError с сообщением сервера. */
export async function unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok) {
    const body = (error ?? {}) as ErrorBody;
    let message = body.error?.message ?? `Ошибка сервера (${response.status})`;
    const details = body.error?.details;
    if (body.error?.code === "validation_error" && Array.isArray(details) && details.length) {
      message = details.map((d: { field?: string; message?: string }) => `${d.field}: ${d.message}`).join("; ");
    }
    throw new ApiError(response.status, body.error?.code ?? "error", message, details);
  }
  return data as T;
}
