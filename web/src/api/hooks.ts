import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, UNAUTHORIZED_EVENT, api, unwrap, type Occurrence, type Schemas } from "./client";

export type OccurrenceQuery = {
  status?: "paid" | "unpaid";
  overdue?: boolean;
  currency?: Schemas["Currency"];
  recurring_payment_id?: number;
  category_id?: number;
  from?: string;
  to?: string;
  sort?: Schemas["SortOrder"];
  limit?: number;
  offset?: number;
};

export const keys = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  settings: ["settings"] as const,
  categories: ["categories"] as const,
  summary: (from?: string, to?: string) => ["summary", from ?? null, to ?? null] as const,
  occurrences: (q: OccurrenceQuery) => ["occurrences", q] as const,
  recurring: (includeDeleted: boolean) => ["recurring", includeDeleted] as const,
  users: ["users"] as const,
  audit: (q: object) => ["audit", q] as const,
};

export function useMeta() {
  return useQuery({
    queryKey: keys.meta,
    queryFn: () => unwrap(api.GET("/api/v1/meta")),
    staleTime: 60_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => unwrap(api.GET("/api/v1/settings")) });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["SettingsUpdate"]) => unwrap(api.PATCH("/api/v1/settings", { body })),
    // от окна напоминания зависят статусы «скоро срок» и подсказки «напомним …» по всей панели
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" }),
  });
}

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: () => unwrap(api.GET("/api/v1/categories")) });
}

/** Создание, переименование и удаление категории. */
export function useCategoryMutations() {
  const qc = useQueryClient();
  const onSuccess = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.categories }),
      qc.invalidateQueries({ queryKey: ["recurring"] }),
      qc.invalidateQueries({ queryKey: ["occurrences"] }),
      qc.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  return {
    create: useMutation({ mutationFn: (name: string) => unwrap(api.POST("/api/v1/categories", { body: { name } })), onSuccess }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: number; name: string }) =>
        unwrap(api.PATCH("/api/v1/categories/{category_id}", { params: { path: { category_id: id } }, body: { name } })),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: number) => unwrap(api.DELETE("/api/v1/categories/{category_id}", { params: { path: { category_id: id } } })),
      onSuccess,
    }),
  };
}

export function useSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: keys.summary(from, to),
    queryFn: () => unwrap(api.GET("/api/v1/payments/summary", { params: { query: { from, to } } })),
  });
}

export function useOccurrences(query: OccurrenceQuery) {
  return useQuery({
    queryKey: keys.occurrences(query),
    queryFn: () => unwrap(api.GET("/api/v1/payment-occurrences", { params: { query } })),
    placeholderData: keepPreviousData,
  });
}

/** Один платёж (период) — например, чтобы журнал проверил, прикреплён ли ещё файл чека. */
export function useOccurrence(id: number, enabled = true) {
  return useQuery({
    queryKey: ["occurrences", { id }],
    queryFn: () => unwrap(api.GET("/api/v1/payment-occurrences/{occurrence_id}", { params: { path: { occurrence_id: id } } })),
    enabled,
  });
}

export function useRecurring(includeDeleted = false) {
  return useQuery({
    queryKey: keys.recurring(includeDeleted),
    queryFn: () =>
      unwrap(api.GET("/api/v1/recurring-payments", { params: { query: { include_deleted: includeDeleted } } })),
  });
}

export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: () => unwrap(api.GET("/api/v1/users")) });
}

export function useAudit(query: { action?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: keys.audit(query),
    queryFn: () => unwrap(api.GET("/api/v1/audit-log", { params: { query } })),
    placeholderData: keepPreviousData,
  });
}

/** После любого изменения платежей обновляем всё, что от них зависит. */
function useInvalidatePayments() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["occurrences"] }),
      qc.invalidateQueries({ queryKey: ["summary"] }),
      qc.invalidateQueries({ queryKey: ["recurring"] }),
      qc.invalidateQueries({ queryKey: ["audit"] }),
    ]);
}

export function useUpdateOccurrence() {
  const invalidate = useInvalidatePayments();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Schemas["OccurrenceUpdate"] }) =>
      unwrap(api.PATCH("/api/v1/payment-occurrences/{occurrence_id}", { params: { path: { occurrence_id: id } }, body })),
    onSuccess: invalidate,
  });
}

export function useCreateRecurring() {
  const invalidate = useInvalidatePayments();
  return useMutation({
    mutationFn: (body: Schemas["RecurringPaymentCreate"]) => unwrap(api.POST("/api/v1/recurring-payments", { body })),
    onSuccess: invalidate,
  });
}

export function useUpdateRecurring() {
  const invalidate = useInvalidatePayments();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Schemas["RecurringPaymentUpdate"] }) =>
      unwrap(api.PATCH("/api/v1/recurring-payments/{payment_id}", { params: { path: { payment_id: id } }, body })),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidatePayments();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE("/api/v1/recurring-payments/{payment_id}", { params: { path: { payment_id: id } } })),
    onSuccess: invalidate,
  });
}

export function useRestoreRecurring() {
  const invalidate = useInvalidatePayments();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.POST("/api/v1/recurring-payments/{payment_id}/restore", { params: { path: { payment_id: id } } })),
    onSuccess: invalidate,
  });
}

/** Прекратить или возобновить сразу несколько платежей. */
export function useBulkRecurring() {
  const invalidate = useInvalidatePayments();
  return useMutation({
    mutationFn: ({ action, ids, categoryId = null }: { action: "stop" | "restore" | "category"; ids: number[]; categoryId?: number | null }) =>
      unwrap(
        action === "stop"
          ? api.POST("/api/v1/recurring-payments/bulk/stop", { body: { ids } })
          : action === "restore"
            ? api.POST("/api/v1/recurring-payments/bulk/restore", { body: { ids } })
            : api.POST("/api/v1/recurring-payments/bulk/category", { body: { ids, category_id: categoryId } }),
      ),
    onSuccess: invalidate,
  });
}

/**
 * Файл чека. Тело запроса — сам файл, имя — в заголовке X-File-Name (не в адресе: адреса пишутся в журналы).
 * openapi-fetch не умеет «сырое» тело, поэтому здесь обычный fetch с той же сессией.
 */
export function useReceiptFile() {
  const invalidate = useInvalidatePayments();
  const upload = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }): Promise<Occurrence> => {
      const response = await fetch(`/api/v1/payment-occurrences/${id}/receipt-file`, {
        method: "PUT",
        body: file,
        credentials: "same-origin",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
      });
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
        throw new ApiError(response.status, body.error?.code ?? "error", body.error?.message ?? `Не удалось загрузить файл (${response.status})`);
      }
      return (await response.json()) as Occurrence;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE("/api/v1/payment-occurrences/{occurrence_id}/receipt-file", { params: { path: { occurrence_id: id } } })),
    onSuccess: invalidate,
  });
  return { upload, remove };
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.users }), qc.invalidateQueries({ queryKey: ["audit"] })]);
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (body: Schemas["UserCreate"]) => unwrap(api.POST("/api/v1/users", { body })),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Schemas["UserUpdate"] }) =>
      unwrap(api.PATCH("/api/v1/users/{user_id}", { params: { path: { user_id: id } }, body })),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE("/api/v1/users/{user_id}", { params: { path: { user_id: id } } })),
    onSuccess: invalidate,
  });
}
