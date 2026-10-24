import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Skeleton, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertTriangle, IconBrandTelegram, IconCircleCheck, IconClockHour4, IconConfetti } from "@tabler/icons-react";
import dayjs from "dayjs";
import { Link } from "react-router";
import type { Currency, Schemas } from "../api/client";
import { useMeta, useOccurrences, useSummary } from "../api/hooks";
import { useAuth } from "../auth";
import { ErrorAlert, Money, PageHeader, StatusBadge } from "../components/common";
import { OccurrenceActions } from "../components/OccurrenceActions";
import { CURRENCY_LABEL, formatDate, formatMoney, pluralPeriods } from "../lib/format";

const MONTHS_PREPOSITIONAL = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

function CurrencyCard({
  currency,
  current,
  month,
  monthLabel,
}: {
  currency: Currency;
  current?: Schemas["CurrencySummaryOut"];
  month?: Schemas["CurrencySummaryOut"];
  monthLabel: string;
}) {
  const overdue = current?.overdue;
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Text fw={700} size="lg">
          {currency}
        </Text>
        <Text size="sm" c="dimmed">
          {CURRENCY_LABEL[currency]}
        </Text>
      </Group>
      {!current || !month ? (
        <Stack gap="xs">
          <Skeleton h={18} />
          <Skeleton h={18} />
          <Skeleton h={18} />
        </Stack>
      ) : (
        <Stack gap={10}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconClockHour4 size={16} color="var(--mantine-color-blue-6)" />
              <Text size="sm">К оплате</Text>
            </Group>
            <Text fw={700} className="tabular">
              {formatMoney(current.unpaid.amount, currency)}
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />
              <Text size="sm">Просрочено</Text>
            </Group>
            <Text fw={700} c={overdue && overdue.count > 0 ? "red" : undefined} className="tabular">
              {formatMoney(current.overdue.amount, currency)}
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconCircleCheck size={16} color="var(--mantine-color-green-6)" />
              <Text size="sm">Оплачено {monthLabel}</Text>
            </Group>
            <Text fw={700} c="green" className="tabular">
              {formatMoney(month.paid.amount, currency)}
            </Text>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { isAdmin, user } = useAuth();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const monthStart = dayjs(today).startOf("month").format("YYYY-MM-DD");
  const monthEnd = dayjs(today).endOf("month").format("YYYY-MM-DD");
  const monthLabel = `в ${MONTHS_PREPOSITIONAL[dayjs(today).month()]}`;

  const summaryAll = useSummary();
  const summaryMonth = useSummary(monthStart, monthEnd);
  const horizon = dayjs(today).add(30, "day").format("YYYY-MM-DD");
  const attention = useOccurrences({ status: "unpaid", to: horizon, sort: "due_date", limit: 50 });

  const byCurrency = (s?: Schemas["SummaryOut"]) =>
    Object.fromEntries((s?.currencies ?? []).map((c) => [c.currency, c])) as Record<Currency, Schemas["CurrencySummaryOut"]>;
  const all = byCurrency(summaryAll.data);
  const month = byCurrency(summaryMonth.data);
  const overdueCount = summaryAll.data?.currencies.reduce((n, c) => n + c.overdue.count, 0) ?? 0;
  const items = attention.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={`Здравствуйте${user?.name ? `, ${user.name.split(" ")[0]}` : ""}!`}
        description={`Сегодня ${dayjs(today).format("D MMMM YYYY, dddd")}`}
      />

      {isAdmin && meta.data && !meta.data.telegram.chat_configured && (
        <Alert color="yellow" icon={<IconBrandTelegram size={18} />} mb="md" title="Telegram не настроен">
          {meta.data.telegram.bot_configured
            ? "Бот подключён, но не указан чат. Добавьте бота в чат, отправьте /chatid и пропишите TELEGRAM_CHAT_ID в .env."
            : "Укажите TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env, чтобы получать напоминания."}
        </Alert>
      )}

      {overdueCount > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="md">
          Есть просроченные платежи: {pluralPeriods(overdueCount)}.{" "}
          <Anchor component={Link} to="/payments?tab=overdue" fw={600}>
            Показать
          </Anchor>
        </Alert>
      )}

      <ErrorAlert error={summaryAll.error ?? attention.error} />

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="xl">
        {(["RUB", "USD", "EUR"] as Currency[]).map((c) => (
          <CurrencyCard key={c} currency={c} current={all[c]} month={month[c]} monthLabel={monthLabel} />
        ))}
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="md">
          <div>
            <Title order={4}>Что и когда оплатить</Title>
            <Text size="sm" c="dimmed">
              Просроченные и ближайшие 30 дней
            </Text>
          </div>
          <Anchor component={Link} to="/payments?tab=unpaid" size="sm">
            Все неоплаченные →
          </Anchor>
        </Group>

        {attention.isLoading ? (
          <Stack>
            <Skeleton h={36} />
            <Skeleton h={36} />
            <Skeleton h={36} />
          </Stack>
        ) : items.length === 0 ? (
          <Stack align="center" py="xl" gap="xs">
            <ThemeIcon size={48} radius="xl" variant="light" color="green">
              <IconConfetti size={26} />
            </ThemeIcon>
            <Text fw={600}>Всё оплачено</Text>
            <Text size="sm" c="dimmed">
              В ближайшие 30 дней платежей нет
            </Text>
          </Stack>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Срок</Table.Th>
                  <Table.Th>Платёж</Table.Th>
                  <Table.Th ta="right">Сумма</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((o) => (
                  <Table.Tr key={o.id}>
                    <Table.Td className="nowrap tabular">{formatDate(o.due_date)}</Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Text size="sm" fw={500}>
                          {o.name}
                        </Text>
                        {o.reminder_sent_at && (
                          <Badge size="xs" variant="light" color="blue" leftSection={<IconBrandTelegram size={10} />}>
                            напомнили
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Money amount={o.amount} currency={o.currency} />
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge occurrence={o} />
                    </Table.Td>
                    <Table.Td>
                      <OccurrenceActions occurrence={o} compact />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </>
  );
}
