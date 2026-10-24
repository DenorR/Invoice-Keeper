import { Badge, Card, Group, Pagination, Select, Stack, Tabs, Text } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCalendar, IconInbox } from "@tabler/icons-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Currency } from "../api/client";
import { useOccurrences, useRecurring, useSummary, type OccurrenceQuery } from "../api/hooks";
import { ErrorAlert, PageHeader } from "../components/common";
import { OccurrenceList, useIsMobile } from "../components/OccurrenceList";
import { CURRENCIES } from "../lib/format";

const PAGE_SIZE = 50;

type Tab = "unpaid" | "overdue" | "paid" | "all";

const TABS: { value: Tab; label: string; color?: string; query: Partial<OccurrenceQuery>; empty: string }[] = [
  { value: "unpaid", label: "К оплате", query: { status: "unpaid", sort: "due_date" }, empty: "Неоплаченных платежей нет 🎉" },
  { value: "overdue", label: "Просроченные", color: "red", query: { status: "unpaid", overdue: true, sort: "due_date" }, empty: "Просроченных платежей нет 🎉" },
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
    from,
    to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const recurring = useRecurring(true);
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
  const hasFilters = Boolean(currency || paymentId || from || to);

  return (
    <>
      <PageHeader title="Платежи" description="Каждый месяц — отдельная строка: свой срок и своя отметка об оплате" />

      <Card withBorder padding={0}>
        <Tabs value={tab} onChange={(v) => setParam({ tab: v === "unpaid" ? null : v })}>
          <Tabs.List px={isMobile ? "xs" : "md"} pt="xs">
            {TABS.map((t) => {
              const count = t.value === "all" ? null : counts[t.value];
              return (
                <Tabs.Tab
                  key={t.value}
                  value={t.value}
                  color={t.color}
                  rightSection={
                    count ? (
                      <Badge size="sm" circle={count < 10} variant={t.value === "overdue" ? "filled" : "light"} color={t.color ?? "gray"}>
                        {count}
                      </Badge>
                    ) : null
                  }
                >
                  {t.label}
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
        </Tabs>

        <Group p="md" gap="sm" wrap="wrap">
          <Select
            placeholder="Все валюты"
            data={CURRENCIES}
            value={currency ?? null}
            onChange={(v) => setParam({ currency: v })}
            clearable
            w={isMobile ? "100%" : 140}
          />
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
            leftSection={<IconCalendar size={16} />}
            value={[from ?? null, to ?? null]}
            onChange={([start, end]) => setParam({ from: start, to: end })}
            valueFormat="DD.MM.YYYY"
            clearable
            w={isMobile ? "100%" : 260}
          />
          <Text size="sm" c="dimmed" ml={isMobile ? 0 : "auto"}>
            Найдено: {total}
          </Text>
        </Group>

        <ErrorAlert error={occurrences.error} />

        <div style={isMobile ? { padding: "0 var(--mantine-spacing-sm) var(--mantine-spacing-sm)" } : undefined}>
          <OccurrenceList
            groups={[{ key: "all", title: null, items }]}
            loading={occurrences.isLoading}
            showPaidInfo={tab === "paid" || tab === "all"}
            empty={
              <Stack align="center" py={48} gap={4}>
                <IconInbox size={36} color="var(--mantine-color-gray-5)" />
                <Text fw={600}>{hasFilters ? "По фильтрам ничего не найдено" : tabConfig.empty}</Text>
                {hasFilters && (
                  <Text size="sm" c="blue" style={{ cursor: "pointer" }} onClick={() => setParam({ currency: null, payment: null, from: null, to: null })}>
                    Сбросить фильтры
                  </Text>
                )}
              </Stack>
            }
          />
        </div>

        {total > PAGE_SIZE && (
          <Group justify="center" p="md">
            <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={(p) => setParam({ page: String(p) })} />
          </Group>
        )}
      </Card>
    </>
  );
}
