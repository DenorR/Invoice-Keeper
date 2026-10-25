import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  Drawer,
  Group,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { MonthPicker } from "@mantine/dates";
import { IconArrowRight, IconCalendar, IconCalendarOff, IconChevronDown, IconChevronLeft, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api, unwrap, type Currency, type Occurrence, type Schemas } from "../api/client";
import { useMeta, useOccurrences } from "../api/hooks";
import { useAuth } from "../auth";
import { EmptyState, ErrorAlert, Money, PageHeader, Pill, Section, StatusBadge } from "../components/common";
import { OccurrenceActions } from "../components/OccurrenceActions";
import { useIsMobile } from "../components/OccurrenceList";
import { PaymentFormModal } from "../components/PaymentFormModal";
import { CURRENCIES, formatDate, formatCompact, formatMoney, pluralDays, pluralPayments } from "../lib/format";
import { EASE_OUT, popFrom } from "../theme";

type Item = Schemas["ForecastItemOut"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MAX_CHIPS = 2;

function useForecast(from: string, to: string) {
  return useQuery({
    queryKey: ["forecast", from, to],
    queryFn: () => unwrap(api.GET("/api/v1/payments/forecast", { params: { query: { from, to } } })),
  });
}

/** Цвет точки: смысл тот же, что у статусов в списке платежей. */
function itemColor(item: Item): string {
  if (item.status === "planned") return "var(--mantine-color-gray-5)";
  if (item.status === "paid") return "var(--mantine-color-green-filled)";
  if (item.state === "overdue") return "var(--mantine-color-red-filled)";
  if (item.state === "due_today") return "var(--mantine-color-yellow-filled)";
  if (item.state === "due_soon") return "var(--mantine-color-yellow-filled)";
  return "var(--mantine-color-blue-filled)";
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortMoney(amount: string, currency: Currency) {
  return formatMoney(amount, currency).replace(/,00(?=\s|$)/, "");
}

function groupByDay(items: Item[]) {
  const map = new Map<string, Item[]>();
  for (const item of items) map.set(item.due_date, [...(map.get(item.due_date) ?? []), item]);
  return map;
}

// ─── сетка месяца ───
function MonthGrid({
  month,
  dir,
  byDay,
  today,
  selected,
  onSelect,
}: {
  month: Dayjs;
  dir: "next" | "prev" | null;
  byDay: Map<string, Item[]>;
  today: string;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const start = month.startOf("month");
  const offset = (start.day() + 6) % 7; // понедельник — первый день
  const gridStart = start.subtract(offset, "day");
  const weeks = Math.ceil((offset + month.daysInMonth()) / 7);

  return (
    <>
      <div className="cal-weekdays">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      {/* key по месяцу: при смене месяца сетка въезжает с той стороны, куда листаем */}
      <div key={month.format("YYYY-MM")} className="cal-grid cal-anim" data-dir={dir ?? undefined}>
        {Array.from({ length: weeks * 7 }).map((_, index) => {
          const day = gridStart.add(index, "day");
          const iso = day.format("YYYY-MM-DD");
          const items = byDay.get(iso) ?? [];
          const label = `${day.format("D MMMM, dddd")}: ${items.length ? pluralPayments(items.length) : "платежей нет"}`;
          return (
            <UnstyledButton
              key={iso}
              className="cal-day"
              data-outside={day.month() !== month.month() || undefined}
              data-today={iso === today || undefined}
              data-weekend={day.day() === 0 || day.day() === 6 || undefined}
              data-selected={iso === selected || undefined}
              onClick={() => onSelect(iso)}
              aria-label={label}
            >
              <span className="cal-day-num">{day.date()}</span>
              {items.slice(0, MAX_CHIPS).map((item) => (
                <span
                  key={`${item.recurring_payment_id}-${item.due_date}`}
                  className="cal-chip"
                  data-planned={item.status === "planned" || undefined}
                  style={{ ["--chip-color" as string]: itemColor(item) }}
                >
                  <span className="cal-chip-name">{item.name}</span>
                  <span className="cal-chip-amount">{shortMoney(item.amount, item.currency)}</span>
                </span>
              ))}
              {items.length > MAX_CHIPS && <span className="cal-more">ещё {items.length - MAX_CHIPS}</span>}
              {items.length > 0 && (
                <span className="cal-dots" aria-hidden>
                  {items.slice(0, 4).map((item) => (
                    <span key={`${item.recurring_payment_id}-d`} style={{ ["--chip-color" as string]: itemColor(item) }} />
                  ))}
                </span>
              )}
            </UnstyledButton>
          );
        })}
      </div>
    </>
  );
}

// ─── панель дня ───
function relativeDay(iso: string, today: string) {
  const diff = dayjs(iso).diff(dayjs(today), "day");
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === -1) return "вчера";
  return diff > 0 ? `через ${pluralDays(diff)}` : `${pluralDays(-diff)} назад`;
}

function DayTotals({ items }: { items: { amount: string; currency: Currency }[] }) {
  const sums = new Map<Currency, number>();
  for (const i of items) sums.set(i.currency, (sums.get(i.currency) ?? 0) + Number(i.amount));
  return (
    <Group gap="xs">
      {CURRENCIES.filter((c) => sums.has(c)).map((c) => (
        <span key={c} className="day-total">
          <span className="ik-currency">{c}</span> {formatMoney(sums.get(c)!, c)}
        </span>
      ))}
    </Group>
  );
}

function OccurrenceCard({ o, index }: { o: Occurrence; index: number }) {
  return (
    <div className="day-item" style={{ ["--i" as string]: index }}>
      <div className="day-item-top">
        <Text fw={600} size="sm" lineClamp={2}>
          {o.name}
        </Text>
        <Money amount={o.amount} currency={o.currency} fw={650} />
      </div>
      <div className="day-item-bottom">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <StatusBadge occurrence={o} />
          {o.paid_at && (
            <Text size="xs" c="dimmed">
              Оплачено {formatDate(o.paid_at)}
              {o.paid_by?.label ? ` · ${o.paid_by.label}` : ""}
              {o.paid_via === "telegram" ? " · через Telegram" : ""}
            </Text>
          )}
        </div>
        <OccurrenceActions occurrence={o} compact />
      </div>
      <Anchor component={Link} to={`/payments?tab=all&payment=${o.recurring_payment_id}`} size="xs" c="dimmed" className="day-item-link">
        Все сроки этого платежа <IconArrowRight size={12} />
      </Anchor>
    </div>
  );
}

function PlannedCard({ item, index }: { item: Item; index: number }) {
  return (
    <div className="day-item" style={{ ["--i" as string]: index }}>
      <div className="day-item-top">
        <Text fw={600} size="sm" lineClamp={2}>
          {item.name}
        </Text>
        <Money amount={item.amount} currency={item.currency} fw={650} />
      </div>
      <div className="day-item-bottom">
        <Pill tone="planned">По графику</Pill>
        <Text size="xs" c="dimmed" ta="right">
          Период появится ближе к сроку
        </Text>
      </div>
      <Anchor component={Link} to={`/payments?tab=all&payment=${item.recurring_payment_id}`} size="xs" c="dimmed" className="day-item-link">
        Все сроки этого платежа <IconArrowRight size={12} />
      </Anchor>
    </div>
  );
}

function DayDetails({ day, today, planned, onAdd }: { day: string; today: string; planned: Item[]; onAdd?: () => void }) {
  const occurrences = useOccurrences({ from: day, to: day, sort: "due_date", limit: 100 });
  const list = occurrences.data?.items ?? [];
  const all = [...list, ...planned];

  if (occurrences.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton h={96} radius="lg" />
        <Skeleton h={96} radius="lg" />
      </div>
    );
  }
  if (!all.length) {
    return (
      <EmptyState
        icon={<IconCalendarOff size={22} />}
        title="В этот день платежей нет"
        text={onAdd ? "Можно завести регулярный платёж с первым сроком в этот день." : undefined}
        action={
          onAdd ? (
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={onAdd}>
              Добавить платёж на эту дату
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="ik-label" style={{ marginBottom: 8 }}>
          {pluralPayments(all.length)} · итого
        </div>
        <DayTotals items={all} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((o, i) => (
          <OccurrenceCard key={o.id} o={o} index={i} />
        ))}
        {planned.map((item, i) => (
          <PlannedCard key={`${item.recurring_payment_id}-${item.due_date}`} item={item} index={list.length + i} />
        ))}
      </div>
      {day < today && list.some((o) => o.status === "unpaid") && (
        <Text size="xs" c="dimmed">
          Оплатили вовремя, но отметили позже? В окне оплаты укажите фактическую дату — просрочка пересчитается.
        </Text>
      )}
    </div>
  );
}

// ─── итоги ───
function MonthTotals({ items }: { items: Item[] }) {
  const rows = CURRENCIES.map((c) => {
    const mine = items.filter((i) => i.currency === c);
    const planned = mine.reduce((n, i) => n + Number(i.amount), 0);
    const paid = mine.filter((i) => i.status === "paid").reduce((n, i) => n + Number(i.amount), 0);
    return { c, planned, paid, left: planned - paid, count: mine.length };
  });
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      {rows.map((r) => (
        <Card key={r.c} padding={0} className="ik-total">
          <div className="ik-total-body">
            <div className="ik-total-head">
              <span className="ik-total-currency">{r.c}</span>
              <Text size="xs" c="dimmed">
                {r.count ? pluralPayments(r.count) : "нет платежей"}
              </Text>
            </div>
            <div className="ik-num ik-total-value" title={formatMoney(r.planned, r.c)} style={{ ["--len" as string]: formatMoney(r.planned, r.c).length }}>
              {formatMoney(r.planned, r.c)}
            </div>
            <div className="ik-progress">
              <span style={{ transform: `scaleX(${r.planned ? r.paid / r.planned : 0})` }} />
            </div>
          </div>
          <dl className="ik-total-rows">
            <div>
              <dt>Оплачено</dt>
              <dd>{formatMoney(r.paid, r.c)}</dd>
            </div>
            <div>
              <dt>Осталось</dt>
              <dd>{formatMoney(r.left, r.c)}</dd>
            </div>
          </dl>
        </Card>
      ))}
    </SimpleGrid>
  );
}

function BudgetValue({ value }: { value: number }) {
  const { value: number, unit } = formatCompact(value);
  return (
    <span className="budget-value">
      {number}
      {unit && <small>{unit}</small>}
    </span>
  );
}

/**
 * Бюджет на год: 12 месяцев равной ширины (table-layout: fixed), суммы компактно, точная — в подсказке.
 * Под суммой тонкая полоска: доля от самого дорогого месяца в этой валюте. Текущий месяц подсвечен.
 */
function YearBudget({ year, onYear, today }: { year: number; onYear: (y: number) => void; today: string }) {
  const data = useForecast(`${year}-01-01`, `${year}-12-31`);
  const table: Record<Currency, number[]> = { RUB: Array(12).fill(0), USD: Array(12).fill(0), EUR: Array(12).fill(0) };
  for (const item of data.data?.items ?? []) table[item.currency][dayjs(item.due_date).month()] += Number(item.amount);
  const currentMonth = dayjs(today).year() === year ? dayjs(today).month() : -1;

  return (
    <>
      <Card padding={0}>
        <div className="cal-toolbar">
          <Group gap={6}>
            <ActionIcon.Group>
              <ActionIcon variant="default" size={36} onClick={() => onYear(year - 1)} aria-label="Предыдущий год">
                <IconChevronLeft size={18} />
              </ActionIcon>
              <ActionIcon variant="default" size={36} onClick={() => onYear(year + 1)} aria-label="Следующий год">
                <IconChevronRight size={18} />
              </ActionIcon>
            </ActionIcon.Group>
            <span className="ik-block-title" style={{ marginLeft: 6 }}>
              Бюджет на {year} год
            </span>
          </Group>
          <Text size="sm" c="dimmed">
            Плановые расходы по месяцам, каждая валюта отдельно
          </Text>
        </div>
        {data.isLoading ? (
          <Skeleton h={160} m="md" />
        ) : (
          <div className="budget-scroll">
            <table className="budget">
              <colgroup>
                <col className="budget-cur" />
                {MONTHS.map((m) => (
                  <col key={m} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th />
                  {MONTHS.map((m, i) => (
                    <th key={m} data-current={i === currentMonth || undefined}>
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CURRENCIES.map((c) => {
                  const max = Math.max(...table[c]);
                  return (
                    <tr key={c}>
                      <th scope="row">
                        <span className="ik-total-currency">{c}</span>
                      </th>
                      {table[c].map((value, i) => (
                        <td key={i} data-current={i === currentMonth || undefined} title={value ? formatMoney(value, c) : undefined}>
                          {value ? (
                            <>
                              <BudgetValue value={value} />
                              <span className="budget-bar" style={{ ["--w" as string]: `${Math.max(6, (value / max) * 100)}%` }} />
                            </>
                          ) : (
                            <span className="budget-empty">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data.data && (
        <Section title="Итоги за год">
          <MonthTotals items={data.data.items} />
        </Section>
      )}
    </>
  );
}

// ─── страница ───
export function CalendarPage() {
  const isMobile = useIsMobile();
  const { isAdmin } = useAuth();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const [month, setMonth] = useState(() => dayjs(today).startOf("month"));
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const [view, setView] = useState<"month" | "year">("month");
  const [pickerOpened, setPickerOpened] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);

  // В сетке видны и края соседних месяцев — берём прогноз на весь видимый диапазон.
  const offset = (month.startOf("month").day() + 6) % 7;
  const gridStart = month.startOf("month").subtract(offset, "day");
  const gridEnd = gridStart.add(Math.ceil((offset + month.daysInMonth()) / 7) * 7 - 1, "day");
  const data = useForecast(gridStart.format("YYYY-MM-DD"), gridEnd.format("YYYY-MM-DD"));
  const items = data.data?.items ?? [];
  const byDay = useMemo(() => groupByDay(items), [items]);
  const monthItems = items.filter((i) => dayjs(i.due_date).isSame(month, "month"));

  const goTo = (target: Dayjs) => {
    const next = target.startOf("month");
    if (next.isSame(month, "month")) return;
    setDir(next.isAfter(month) ? "next" : "prev");
    setMonth(next);
  };

  const selectedPlanned = selected ? (byDay.get(selected) ?? []).filter((i) => i.status === "planned") : [];

  return (
    <>
      <PageHeader
        title="Календарь"
        description="Когда и сколько платить: отмеченные оплаты и будущие сроки по графику"
        actions={
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as "month" | "year")}
            transitionDuration={320}
            transitionTimingFunction={EASE_OUT}
            data={[
              { value: "month", label: "Месяц" },
              { value: "year", label: "Бюджет на год" },
            ]}
          />
        }
      />

      {view === "year" ? (
        <YearBudget year={month.year()} onYear={(y) => goTo(month.year(y))} today={today} />
      ) : (
        <>
          <ErrorAlert error={data.error} />
          <Card padding={0} style={{ overflow: "hidden" }}>
            <div className="cal-toolbar">
              <Group gap={6} wrap="nowrap">
                <Popover
                  opened={pickerOpened}
                  onChange={setPickerOpened}
                  position="bottom-start"
                  transitionProps={{ transition: popFrom("top left"), duration: 160 }}
                >
                  <Popover.Target>
                    <UnstyledButton
                      className="cal-title-btn"
                      onClick={() => setPickerOpened((o) => !o)}
                      data-expanded={pickerOpened || undefined}
                      aria-label="Выбрать месяц и год"
                    >
                      <IconCalendar size={18} stroke={1.75} />
                      {month.format("MMMM YYYY")}
                      <IconChevronDown size={16} stroke={1.75} />
                    </UnstyledButton>
                  </Popover.Target>
                  <Popover.Dropdown p="sm">
                    <MonthPicker
                      value={month.format("YYYY-MM-DD")}
                      defaultDate={month.format("YYYY-MM-DD")}
                      onChange={(v) => {
                        if (v) goTo(dayjs(v));
                        setPickerOpened(false);
                      }}
                    />
                  </Popover.Dropdown>
                </Popover>
                <ActionIcon.Group>
                  <Tooltip label="Предыдущий месяц">
                    <ActionIcon variant="default" size={36} onClick={() => goTo(month.subtract(1, "month"))} aria-label="Предыдущий месяц">
                      <IconChevronLeft size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Следующий месяц">
                    <ActionIcon variant="default" size={36} onClick={() => goTo(month.add(1, "month"))} aria-label="Следующий месяц">
                      <IconChevronRight size={18} />
                    </ActionIcon>
                  </Tooltip>
                </ActionIcon.Group>
                {!dayjs(today).isSame(month, "month") && (
                  <Button variant="default" h={36} onClick={() => goTo(dayjs(today))}>
                    Сегодня
                  </Button>
                )}
              </Group>
              <Group gap={6} visibleFrom="md">
                <Pill tone="red">просрочено</Pill>
                <Pill tone="yellow">скоро</Pill>
                <Pill tone="blue">к оплате</Pill>
                <Pill tone="green">оплачено</Pill>
                <Pill tone="planned">по графику</Pill>
              </Group>
            </div>
            {data.isLoading && !data.data ? (
              <Skeleton h={isMobile ? 360 : 640} radius={0} />
            ) : (
              <MonthGrid month={month} dir={dir} byDay={byDay} today={today} selected={selected} onSelect={setSelected} />
            )}
          </Card>

          <Section title="Итоги за месяц" action={<Text size="sm" c="dimmed">без конвертации валют</Text>}>
            <MonthTotals items={monthItems} />
          </Section>
        </>
      )}

      <Drawer
        opened={Boolean(selected)}
        onClose={() => setSelected(null)}
        position={isMobile ? "bottom" : "right"}
        size={isMobile ? "85%" : 440}
        radius={isMobile ? "lg" : 0}
        overlayProps={{ backgroundOpacity: 0.25, blur: 0 }}
        title={
          selected && (
            <div>
              <Text fw={700} ff="heading" size="lg">
                {capitalize(dayjs(selected).format("dddd, D MMMM"))}
              </Text>
              <Text size="sm" c="dimmed">
                {relativeDay(selected, today)}
              </Text>
            </div>
          )
        }
        styles={{ header: { borderBottom: "1px solid var(--ik-border)" }, body: { paddingTop: 16 } }}
      >
        {selected && (
          <DayDetails
            key={selected}
            day={selected}
            today={today}
            planned={selectedPlanned}
            onAdd={isAdmin && selected >= today ? () => setCreateDate(selected) : undefined}
          />
        )}
      </Drawer>

      {isAdmin && <PaymentFormModal opened={Boolean(createDate)} payment={null} initialDate={createDate} onClose={() => setCreateDate(null)} />}
    </>
  );
}
