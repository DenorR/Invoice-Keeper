import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "./client";

export type OccurrenceQuery = {
  status?: "paid" | "unpaid";
  overdue?: boolean;
  currency?: Schemas["Currency"];
  recurring_payment_id?: number;
  from?: string;
  to?: string;
  sort?: Schemas["SortOrder"];
  limit?: number;
  offset?: number;
};

export const keys = {
  me: ["me"] as const,
  meta: ["meta"] as const,
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
