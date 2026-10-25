import { Anchor, Card, Group, Pagination, SegmentedControl, Select, Text } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCalendar, IconFilterOff, IconInbox } from "@tabler/icons-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Currency } from "../api/client";
import { useCategories, useOccurrences, useRecurring, useSummary, type OccurrenceQuery } from "../api/hooks";
import { EmptyState, ErrorAlert, PageHeader } from "../components/common";
import { OccurrenceList, useIsMobile } from "../components/OccurrenceList";
import { CURRENCIES } from "../lib/format";
import { EASE_OUT } from "../theme";

const PAGE_SIZE = 50;

type Tab = "unpaid" | "overdue" | "paid" | "all";

const TABS: { value: Tab; label: string; color?: string; query: Partial<OccurrenceQuery>; empty: string }[] = [
  { value: "unpaid", label: "К оплате", query: { status: "unpaid", sort: "due_date" }, empty: "Неоплаченных платежей нет" },
  { value: "overdue", label: "Просроченные", color: "red", query: { status: "unpaid", overdue: true, sort: "due_date" }, empty: "Просроченных платежей нет" },
  { value: "paid", label: "Оплаченные", color: "green", query: { status: "paid", sort: "-due_date" }, empty: "Оплат пока нет" },
  { value: "all", label: "Все", query: { sort: "-due_date" }, empty: "Платежей пока нет" },
];

export function OccurrencesPage() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get("tab"))?.value ?? "unpaid") as Tab;
  const tabConfig = TABS.find((t) => t.value === tab)!;
  const currency = (params.get("currency") as Currency) || undefined;
  const paymentId = params.get("payment") ? Number(params.get("payment")) : undefined;
  const categoryParam = params.get("category");
  const categoryId = categoryParam !== null && categoryParam !== "" ? Number(categoryParam) : undefined;
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  const page = Number(params.get("page") || 1);

  const setParam = (updates: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in updates)) next.delete("page");
    setParams(next, { replace: true });
  };

  const occurrences = useOccurrences({
    ...tabConfig.query,
    currency,
    recurring_payment_id: paymentId,
    category_id: categoryId,
    from,
    to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const recurring = useRecurring(true);
  const categories = useCategories();
  const summary = useSummary();

  const counts = useMemo(() => {
    const c = summary.data?.currencies ?? [];
    return {
      unpaid: c.reduce((n, x) => n + x.unpaid.count, 0),
      overdue: c.reduce((n, x) => n + x.overdue.count, 0),
      paid: c.reduce((n, x) => n + x.paid.count, 0),
    };
  }, [summary.data]);

  const paymentOptions = useMemo(
    () =>
      (recurring.data ?? []).map((p) => ({
        value: String(p.id),
        label: p.is_active ? p.name : `${p.name} (прекращён)`,
      })),
    [recurring.data],
  );

  const items = occurrences.data?.items ?? [];
  const total = occurrences.data?.total ?? 0;
  const hasFilters = Boolean(currency || paymentId || categoryId !== undefined || from || to);

  const resetFilters = () => setParam({ currency: null, payment: null, category: null, from: null, to: null });

  return (
    <>
      <PageHeader title="Платежи" description="Каждый период — отдельная строка: свой срок и своя отметка об оплате" />

      <Card padding={0}>
        <div className="ik-toolbar" style={{ overflowX: "auto" }}>
          <SegmentedControl
            value={tab}
            onChange={(v) => setParam({ tab: v === "unpaid" ? null : v })}
            transitionDuration={320}
            transitionTimingFunction={EASE_OUT}
            data={TABS.map((t) => {
              const count = t.value === "all" ? null : counts[t.value];
              return {
                value: t.value,
                label: (
                  <span className="nowrap">
                    {t.label}
                    {count ? (
                      <span className="ik-seg-count" data-tone={t.value === "overdue" ? "red" : undefined}>
                        {count}
                      </span>
                    ) : null}
                  </span>
                ),
              };
            })}
          />
          <Text size="sm" c="dimmed" ml="auto" className="nowrap" visibleFrom="sm">
            Найдено: {total}
          </Text>
        </div>

        <div className="ik-toolbar">
          <Select
            placeholder="Все валюты"
            data={CURRENCIES}
            value={currency ?? null}
            onChange={(v) => setParam({ currency: v })}
            clearable
            w={isMobile ? "100%" : 150}
          />
          {(categories.data ?? []).length > 0 && (
            <Select
              placeholder="Все категории"
              data={[
                ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name })),
                { value: "0", label: "Без категории" },
              ]}
              value={categoryId !== undefined ? String(categoryId) : null}
              onChange={(v) => setParam({ category: v })}
              clearable
              w={isMobile ? "100%" : 190}
            />
          )}
          <Select
            placeholder="Все регулярные платежи"
            data={paymentOptions}
            value={paymentId ? String(paymentId) : null}
            onChange={(v) => setParam({ payment: v })}
            clearable
            searchable
            nothingFoundMessage="Не найдено"
            w={isMobile ? "100%" : 260}
          />
          <DatePickerInput
            type="range"
            placeholder="Срок: за всё время"
            leftSection={<IconCalendar size={16} stroke={1.75} />}
            value={[from ?? null, to ?? null]}
            onChange={([start, end]) => setParam({ from: start, to: end })}
            valueFormat="DD.MM.YYYY"
            clearable
            w={isMobile ? "100%" : 250}
          />
          {hasFilters && (
            <Anchor component="button" size="sm" c="dimmed" onClick={resetFilters} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconFilterOff size={16} stroke={1.75} /> Сбросить
            </Anchor>
          )}
        </div>

        <ErrorAlert error={occurrences.error} />

        <OccurrenceList
          items={items}
          loading={occurrences.isLoading}
          empty={
            <EmptyState
              icon={<IconInbox size={22} />}
              title={hasFilters ? "По фильтрам ничего не найдено" : tabConfig.empty}
              action={
                hasFilters ? (
                  <Anchor component="button" size="sm" onClick={resetFilters}>
                    Сбросить фильтры
                  </Anchor>
                ) : undefined
              }
            />
          }
        />

        {total > PAGE_SIZE && (
          <Group justify="center" p="md" style={{ borderTop: "1px solid var(--ik-border)" }}>
            <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={(p) => setParam({ page: String(p) })} radius="md" />
          </Group>
        )}
      </Card>
    </>
  );
}
