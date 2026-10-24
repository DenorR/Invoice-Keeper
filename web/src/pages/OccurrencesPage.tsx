import { Badge, Card, Group, Pagination, Select, Skeleton, Stack, Table, Tabs, Text, Tooltip } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconBrandTelegram, IconCalendar, IconInbox } from "@tabler/icons-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Currency } from "../api/client";
import { useOccurrences, useRecurring, type OccurrenceQuery } from "../api/hooks";
import { ErrorAlert, Money, PageHeader, StatusBadge } from "../components/common";
import { OccurrenceActions } from "../components/OccurrenceActions";
import { CURRENCIES, formatDate } from "../lib/format";

const PAGE_SIZE = 50;

type Tab = "all" | "unpaid" | "overdue" | "paid";

const TAB_QUERY: Record<Tab, Partial<OccurrenceQuery>> = {
  all: { sort: "-due_date" },
  unpaid: { status: "unpaid", sort: "due_date" },
  overdue: { status: "unpaid", overdue: true, sort: "due_date" },
  paid: { status: "paid", sort: "-due_date" },
};

export function OccurrencesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "all";
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

  const query: OccurrenceQuery = {
    ...TAB_QUERY[tab],
    currency,
    recurring_payment_id: paymentId,
    from,
    to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const occurrences = useOccurrences(query);
  const recurring = useRecurring(true);

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

  return (
    <>
      <PageHeader
        title="Платежи"
        description="Каждый период регулярного платежа — со своим сроком и отметкой об оплате"
      />

      <Card withBorder padding={0}>
        <Tabs value={tab} onChange={(v) => setParam({ tab: v === "all" ? null : v })}>
          <Tabs.List px="md" pt="xs">
            <Tabs.Tab value="all">Все</Tabs.Tab>
            <Tabs.Tab value="unpaid">К оплате</Tabs.Tab>
            <Tabs.Tab value="overdue" color="red">
              Просроченные
            </Tabs.Tab>
            <Tabs.Tab value="paid" color="green">
              Оплаченные
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <Group p="md" gap="sm" wrap="wrap">
          <Select
            placeholder="Все валюты"
            data={CURRENCIES}
            value={currency ?? null}
            onChange={(v) => setParam({ currency: v })}
            clearable
            w={140}
          />
          <Select
            placeholder="Все платежи"
            data={paymentOptions}
            value={paymentId ? String(paymentId) : null}
            onChange={(v) => setParam({ payment: v })}
            clearable
            searchable
            w={260}
          />
          <DatePickerInput
            type="range"
            placeholder="Срок: любой"
            leftSection={<IconCalendar size={16} />}
            value={[from ?? null, to ?? null]}
            onChange={([start, end]) => setParam({ from: start, to: end })}
            valueFormat="DD.MM.YYYY"
            clearable
            w={260}
          />
          <Text size="sm" c="dimmed" ml="auto">
            Найдено: {total}
          </Text>
        </Group>

        <ErrorAlert error={occurrences.error} />

        <Table.ScrollContainer minWidth={900}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Срок</Table.Th>
                <Table.Th>Платёж</Table.Th>
                <Table.Th ta="right">Сумма</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Дата оплаты</Table.Th>
                <Table.Th>Отметил</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {occurrences.isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <Table.Tr key={i}>
                    <Table.Td colSpan={7}>
                      <Skeleton h={24} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              {items.map((o) => (
                <Table.Tr key={o.id} className={o.payment_active ? undefined : "row-muted"}>
                  <Table.Td className="nowrap tabular">{formatDate(o.due_date)}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {o.name}
                      </Text>
                      {!o.payment_active && (
                        <Badge size="xs" variant="outline" color="gray">
                          прекращён
                        </Badge>
                      )}
                      {o.reminder_sent_at && o.status === "unpaid" && (
                        <Tooltip label={`Напоминание отправлено ${formatDate(o.reminder_sent_at)}`}>
                          <IconBrandTelegram size={16} color="var(--mantine-color-blue-5)" />
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Money amount={o.amount} currency={o.currency} />
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge occurrence={o} />
                  </Table.Td>
                  <Table.Td className="nowrap tabular">{formatDate(o.paid_at)}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {o.paid_by?.label ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <OccurrenceActions occurrence={o} compact />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {!occurrences.isLoading && items.length === 0 && (
          <Stack align="center" py={48} gap={4}>
            <IconInbox size={36} color="var(--mantine-color-gray-5)" />
            <Text fw={600}>Ничего не найдено</Text>
            <Text size="sm" c="dimmed">
              Измените фильтры или вкладку
            </Text>
          </Stack>
        )}

        {total > PAGE_SIZE && (
          <Group justify="center" p="md">
            <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={(p) => setParam({ page: String(p) })} />
          </Group>
        )}
      </Card>
    </>
  );
}
