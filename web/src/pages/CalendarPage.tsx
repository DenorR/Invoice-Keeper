import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, unwrap, type Currency, type Schemas } from "../api/client";
import { useMeta } from "../api/hooks";
import { ErrorAlert, PageHeader } from "../components/common";
import { useIsMobile } from "../components/OccurrenceList";
import { CURRENCIES, formatMoney, stateView } from "../lib/format";

type Item = Schemas["ForecastItemOut"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

function useForecast(from: string, to: string) {
  return useQuery({
    queryKey: ["forecast", from, to],
    queryFn: () => unwrap(api.GET("/api/v1/payments/forecast", { params: { query: { from, to } } })),
  });
}

function itemColor(item: Item): string {
  if (item.status === "planned") return "gray";
  return item.state ? stateView(item.state, { overdue_days: 0, days_until_due: 0 }).color : "gray";
}

function Chip({ item, onClick }: { item: Item; onClick: () => void }) {
  const color = itemColor(item);
  const label =
    item.status === "paid" ? "оплачено" : item.status === "planned" ? "по графику" : item.state === "overdue" ? "просрочено" : "к оплате";
  return (
    <Tooltip label={`${item.name} · ${formatMoney(item.amount, item.currency)} · ${label}`} withinPortal>
      <UnstyledButton
        onClick={onClick}
        w="100%"
        px={6}
        py={2}
        style={{
          borderRadius: 6,
          borderLeft: `3px solid var(--mantine-color-${color}-6)`,
          background: `var(--mantine-color-${color}-light)`,
          opacity: item.status === "planned" ? 0.75 : 1,
        }}
      >
        <Text size="xs" fw={600} truncate>
          {item.name}
        </Text>
        <Text size="xs" c="dimmed" className="tabular" truncate>
          {formatMoney(item.amount, item.currency)}
        </Text>
      </UnstyledButton>
    </Tooltip>
  );
}

function MonthGrid({ month, items, today }: { month: Dayjs; items: Item[]; today: string }) {
  const navigate = useNavigate();
  const start = month.startOf("month");
  const offset = (start.day() + 6) % 7; // понедельник — первый день
  const gridStart = start.subtract(offset, "day");
  const weeks = Math.ceil((offset + month.daysInMonth()) / 7);
  const byDay = new Map<string, Item[]>();
  for (const item of items) byDay.set(item.due_date, [...(byDay.get(item.due_date) ?? []), item]);

  return (
    <Box style={{ overflowX: "auto" }}>
      <Box miw={720}>
        <SimpleGrid cols={7} spacing={4} mb={4}>
          {WEEKDAYS.map((d) => (
            <Text key={d} size="xs" fw={700} c="dimmed" ta="center">
              {d}
            </Text>
          ))}
        </SimpleGrid>
        <SimpleGrid cols={7} spacing={4}>
          {Array.from({ length: weeks * 7 }).map((_, index) => {
            const day = gridStart.add(index, "day");
            const iso = day.format("YYYY-MM-DD");
            const inMonth = day.month() === month.month();
            const isToday = iso === today;
            return (
              <Box
                key={iso}
                p={6}
                mih={96}
                style={{
                  borderRadius: 8,
                  border: isToday ? "2px solid var(--mantine-color-blue-5)" : "1px solid var(--mantine-color-default-border)",
                  background: inMonth ? "var(--mantine-color-body)" : "transparent",
                  opacity: inMonth ? 1 : 0.45,
                }}
              >
                <Text size="xs" fw={isToday ? 800 : 500} c={isToday ? "blue" : undefined} mb={4}>
                  {day.date()}
                </Text>
                <Stack gap={3}>
                  {(byDay.get(iso) ?? []).map((item) => (
                    <Chip
                      key={`${item.recurring_payment_id}-${item.due_date}`}
                      item={item}
                      onClick={() => navigate(`/payments?tab=all&payment=${item.recurring_payment_id}`)}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })}
        </SimpleGrid>
      </Box>
    </Box>
  );
}

/** На телефоне вместо сетки — список по дням. */
function MonthAgenda({ items, today }: { items: Item[]; today: string }) {
  const navigate = useNavigate();
  if (!items.length) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        В этом месяце платежей нет
      </Text>
    );
  }
  const days = [...new Set(items.map((i) => i.due_date))];
  return (
    <Stack gap="sm">
      {days.map((day) => (
        <div key={day}>
          <Text size="sm" fw={700} c={day === today ? "blue" : undefined} mb={4}>
            {dayjs(day).format("D MMMM, dddd")}
            {day === today ? " — сегодня" : ""}
          </Text>
          <Stack gap={4}>
            {items
              .filter((i) => i.due_date === day)
              .map((item) => (
                <Chip key={`${item.recurring_payment_id}-${item.due_date}`} item={item} onClick={() => navigate(`/payments?tab=all&payment=${item.recurring_payment_id}`)} />
              ))}
          </Stack>
        </div>
      ))}
    </Stack>
  );
}

function TotalsCards({ totals }: { totals: Schemas["ForecastTotalOut"][] }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      {totals.map((t) => (
        <Card key={t.currency} withBorder padding="md">
          <Text fw={700} mb={6}>
            {t.currency}
          </Text>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              План
            </Text>
            <Text fw={700} className="tabular">
              {formatMoney(t.planned.amount, t.currency)}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Оплачено
            </Text>
            <Text fw={600} c="green" className="tabular">
              {formatMoney(t.paid.amount, t.currency)}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Осталось
            </Text>
            <Text fw={600} className="tabular">
              {formatMoney(t.remaining.amount, t.currency)}
            </Text>
          </Group>
        </Card>
      ))}
    </SimpleGrid>
  );
}

function YearBudget({ year }: { year: number }) {
  const data = useForecast(`${year}-01-01`, `${year}-12-31`);
  const table: Record<Currency, number[]> = { RUB: Array(12).fill(0), USD: Array(12).fill(0), EUR: Array(12).fill(0) };
  for (const item of data.data?.items ?? []) table[item.currency][dayjs(item.due_date).month()] += Number(item.amount);

  return (
    <Card withBorder padding="lg">
      <Title order={4} mb={4}>
        Бюджет на {year} год
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Плановые расходы по месяцам, отдельно по каждой валюте (без конвертации)
      </Text>
      {data.isLoading ? (
        <Skeleton h={120} />
      ) : (
        <>
          <Table.ScrollContainer minWidth={900}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Валюта</Table.Th>
                  {MONTHS.map((m) => (
                    <Table.Th key={m} ta="right">
                      {m}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {CURRENCIES.map((c) => (
                  <Table.Tr key={c}>
                    <Table.Td fw={700}>{c}</Table.Td>
                    {table[c].map((value, i) => (
                      <Table.Td key={i} ta="right" className="tabular nowrap">
                        <Text size="xs" c={value ? undefined : "dimmed"}>
                          {value ? formatMoney(value, c).replace(/,00(?=\s)/, "") : "—"}
                        </Text>
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {data.data && (
            <Box mt="md">
              <TotalsCards totals={data.data.totals} />
            </Box>
          )}
        </>
      )}
    </Card>
  );
}

export function CalendarPage() {
  const isMobile = useIsMobile();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const [month, setMonth] = useState(() => dayjs(today).startOf("month"));
  const [view, setView] = useState<"month" | "year">("month");
  const from = month.startOf("month").format("YYYY-MM-DD");
  const to = month.endOf("month").format("YYYY-MM-DD");
  const data = useForecast(from, to);

  return (
    <>
      <PageHeader
        title="Календарь оплат"
        description="Когда и сколько платить: отмеченные оплаты и будущие сроки по графику"
        actions={
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as "month" | "year")}
            data={[
              { value: "month", label: "Месяц" },
              { value: "year", label: "Бюджет на год" },
            ]}
          />
        }
      />

      {view === "year" ? (
        <YearBudget year={month.year()} />
      ) : (
        <Stack>
          <ErrorAlert error={data.error} />
          <Card withBorder padding="lg">
            <Group justify="space-between" mb="md">
              <Group gap="xs">
                <ActionIcon variant="default" onClick={() => setMonth(month.subtract(1, "month"))} aria-label="Предыдущий месяц">
                  <IconChevronLeft size={18} />
                </ActionIcon>
                <ActionIcon variant="default" onClick={() => setMonth(month.add(1, "month"))} aria-label="Следующий месяц">
                  <IconChevronRight size={18} />
                </ActionIcon>
                <Title order={4} tt="capitalize" ml="xs">
                  {month.format("MMMM YYYY")}
                </Title>
              </Group>
              <Group gap={6}>
                <Badge variant="light" color="green">оплачено</Badge>
                <Badge variant="light" color="yellow">скоро</Badge>
                <Badge variant="light" color="red">просрочено</Badge>
                <Badge variant="light" color="gray">по графику</Badge>
              </Group>
            </Group>
            {data.isLoading ? (
              <Skeleton h={480} />
            ) : isMobile ? (
              <MonthAgenda items={data.data?.items ?? []} today={today} />
            ) : (
              <MonthGrid month={month} items={data.data?.items ?? []} today={today} />
            )}
          </Card>
          {data.data && (
            <>
              <Title order={5}>Итоги за месяц</Title>
              <TotalsCards totals={data.data.totals} />
            </>
          )}
        </Stack>
      )}
    </>
  );
}
