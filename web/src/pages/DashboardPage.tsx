import { Alert, Anchor, Badge, Button, Card, CloseButton, Group, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconAlertTriangle,
  IconBell,
  IconBrandTelegram,
  IconCalendarEvent,
  IconCircleCheck,
  IconClockHour4,
  IconConfetti,
  IconHelpCircle,
  IconPlus,
  IconRepeat,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Currency, Occurrence, Schemas } from "../api/client";
import { useMeta, useOccurrences, useSummary } from "../api/hooks";
import { useAuth } from "../auth";
import { ErrorAlert, PageHeader } from "../components/common";
import { OccurrenceList, useIsMobile, type OccurrenceGroup } from "../components/OccurrenceList";
import { PaymentFormModal } from "../components/PaymentFormModal";
import { CURRENCIES, CURRENCY_LABEL, formatMoney, pluralPayments } from "../lib/format";

const MONTHS_PREPOSITIONAL = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

const HELP_KEY = "ik:help-dismissed";

function readHelpDismissed(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === "1";
  } catch {
    return false;
  }
}

function HowItWorks({ remindDays, onClose }: { remindDays: number; onClose: () => void }) {
  const steps = [
    { icon: <IconRepeat size={18} />, color: "blue", title: "Платёж добавлен", text: "Администратор заводит регулярный платёж: сумму, валюту, дату и периодичность." },
    { icon: <IconBell size={18} />, color: "yellow", title: `За ${remindDays} дня — напоминание`, text: "Бот пишет в Telegram-чат: что, сколько и до какого числа оплатить." },
    { icon: <IconCircleCheck size={18} />, color: "green", title: "Оплатили — отметьте", text: "Кнопка «Оплачено» здесь или прямо в Telegram. Дату можно поправить." },
    { icon: <IconClockHour4 size={18} />, color: "grape", title: "Дальше — следующий месяц", text: "Сразу появляется следующий срок. Не оплатили вовремя — платёж станет просроченным." },
  ];
  return (
    <Card withBorder padding="lg" mb="lg">
      <Group justify="space-between" mb="md">
        <Title order={4}>Как это работает</Title>
        <CloseButton onClick={onClose} aria-label="Скрыть подсказку" />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {steps.map((s, i) => (
          <Group key={s.title} align="flex-start" wrap="nowrap" gap="sm">
            <ThemeIcon variant="light" color={s.color} size={36} radius="xl">
              {s.icon}
            </ThemeIcon>
            <div>
              <Text fw={700} size="sm">
                {i + 1}. {s.title}
              </Text>
              <Text size="sm" c="dimmed">
                {s.text}
              </Text>
            </div>
          </Group>
        ))}
      </SimpleGrid>
      <Group justify="flex-end" mt="md">
        <Button variant="light" size="xs" onClick={onClose}>
          Понятно
        </Button>
      </Group>
    </Card>
  );
}

function GroupTitle({ icon, color, text }: { icon: ReactNode; color: string; text: string }) {
  return (
    <Group gap={6} c={color} component="span">
      {icon}
      <Text span fw={700} size="sm" c={color === "gray" ? "dimmed" : color}>
        {text}
      </Text>
    </Group>
  );
}

function TelegramStatus({ meta, isAdmin }: { meta: Schemas["MetaOut"]; isAdmin: boolean }) {
  const tg = meta.telegram;
  if (tg.chat_configured) {
    return (
      <Group gap={6} mb="md">
        <IconBrandTelegram size={16} color="var(--mantine-color-blue-5)" />
        <Text size="sm" c="dimmed">
          Напоминания приходят в Telegram за {meta.reminder_days_before} дня до срока
          {tg.bot_username ? (
            <>
              {" "}— бот{" "}
              <Anchor href={`https://t.me/${tg.bot_username}`} target="_blank" rel="noopener noreferrer">
                @{tg.bot_username}
              </Anchor>
            </>
          ) : null}
        </Text>
      </Group>
    );
  }
  if (!isAdmin) return null;
  return (
    <Alert color="yellow" icon={<IconBrandTelegram size={18} />} mb="md" title="Напоминания в Telegram не настроены">
      {tg.bot_configured
        ? "Бот подключён, но не выбран чат. Добавьте бота в рабочую группу — он сам пришлёт строку TELEGRAM_CHAT_ID для файла .env."
        : "Создайте бота у @BotFather и укажите TELEGRAM_BOT_TOKEN в файле .env, затем добавьте бота в рабочую группу."}
    </Alert>
  );
}

function CurrencyCard({
  currency,
  overdue,
  upcoming,
  paid,
  monthLabel,
}: {
  currency: Currency;
  overdue?: Schemas["TotalOut"];
  upcoming?: Schemas["TotalOut"];
  paid?: Schemas["TotalOut"];
  monthLabel: string;
}) {
  const loaded = overdue && upcoming && paid;
  const rows = loaded
    ? [
        { icon: <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />, label: "Просрочено", value: overdue, color: overdue.count ? "red" : undefined },
        { icon: <IconClockHour4 size={16} color="var(--mantine-color-blue-6)" />, label: "Оплатить за 30 дней", value: upcoming, color: undefined },
        { icon: <IconCircleCheck size={16} color="var(--mantine-color-green-6)" />, label: `Оплачено в ${monthLabel}`, value: paid, color: "green" },
      ]
    : [];
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <Text fw={800}>{currency}</Text>
        <Text size="xs" c="dimmed">
          {CURRENCY_LABEL[currency]}
        </Text>
      </Group>
      {!loaded ? (
        <Stack gap="xs">
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
        </Stack>
      ) : (
        <Stack gap={8}>
          {rows.map((r) => (
            <Group key={r.label} justify="space-between" wrap="nowrap" gap="xs">
              <Group gap={6} wrap="nowrap">
                {r.icon}
                <Text size="sm">{r.label}</Text>
              </Group>
              <Text fw={700} c={r.color} className="tabular nowrap">
                {formatMoney(r.value.amount, currency)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { isAdmin, user } = useAuth();
  const isMobile = useIsMobile();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const remindDays = meta.data?.reminder_days_before ?? 3;
  const in7 = dayjs(today).add(7, "day").format("YYYY-MM-DD");
  const in30 = dayjs(today).add(30, "day").format("YYYY-MM-DD");
  const monthLabel = MONTHS_PREPOSITIONAL[dayjs(today).month()];

  const [helpHidden, setHelpHidden] = useState(readHelpDismissed);
  const [createOpened, setCreateOpened] = useState(false);
  const hideHelp = () => {
    setHelpHidden(true);
    try {
      localStorage.setItem(HELP_KEY, "1");
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  };

  const summaryAll = useSummary();
  const summaryNext = useSummary(today, in30);
  const summaryMonth = useSummary(
    dayjs(today).startOf("month").format("YYYY-MM-DD"),
    dayjs(today).endOf("month").format("YYYY-MM-DD"),
  );
  const todo = useOccurrences({ status: "unpaid", to: in30, sort: "due_date", limit: 100 });

  const pick = (s: Schemas["SummaryOut"] | undefined, c: Currency) => s?.currencies.find((x) => x.currency === c);
  const overdueCount = summaryAll.data?.currencies.reduce((n, c) => n + c.overdue.count, 0) ?? 0;

  const items: Occurrence[] = todo.data?.items ?? [];
  const groups: OccurrenceGroup[] = [
    { key: "overdue", title: <GroupTitle icon={<IconAlertTriangle size={16} />} color="red" text="Просрочено" />, items: items.filter((o) => o.due_date < today) },
    { key: "week", title: <GroupTitle icon={<IconBell size={16} />} color="orange" text="Ближайшие 7 дней" />, items: items.filter((o) => o.due_date >= today && o.due_date <= in7) },
    { key: "later", title: <GroupTitle icon={<IconCalendarEvent size={16} />} color="gray" text="Позже, до 30 дней" />, items: items.filter((o) => o.due_date > in7) },
  ];

  const todoCard = (
    <Card withBorder padding={isMobile ? "sm" : 0} mb="lg" bg={isMobile ? "transparent" : undefined} style={isMobile ? { border: 0 } : undefined}>
      <Group justify="space-between" p={isMobile ? 0 : "md"} pb={isMobile ? "sm" : 0} wrap="wrap" gap="xs">
        <div>
          <Title order={4}>Что и когда оплатить</Title>
          <Text size="sm" c="dimmed">
            Неоплаченные платежи: просроченные и на ближайшие 30 дней
          </Text>
        </div>
        <Anchor component={Link} to="/payments" size="sm">
          Все платежи →
        </Anchor>
      </Group>
      <OccurrenceList
        groups={groups}
        loading={todo.isLoading}
        empty={
          <Stack align="center" py="xl" gap="xs">
            <ThemeIcon size={48} radius="xl" variant="light" color="green">
              <IconConfetti size={26} />
            </ThemeIcon>
            <Text fw={600}>Всё оплачено</Text>
            <Text size="sm" c="dimmed">
              В ближайшие 30 дней платежей нет
            </Text>
          </Stack>
        }
      />
    </Card>
  );

  return (
    <>
      <PageHeader
        title={`Здравствуйте${user?.name ? `, ${user.name.split(" ")[0]}` : ""}!`}
        description={`Сегодня ${dayjs(today).format("D MMMM YYYY, dddd")}`}
        actions={
          <>
            {helpHidden && (
              <Button variant="subtle" size="xs" leftSection={<IconHelpCircle size={16} />} onClick={() => setHelpHidden(false)}>
                Как это работает
              </Button>
            )}
            {isAdmin && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpened(true)}>
                Добавить платёж
              </Button>
            )}
          </>
        }
      />

      {!helpHidden && <HowItWorks remindDays={remindDays} onClose={hideHelp} />}
      {meta.data && <TelegramStatus meta={meta.data} isAdmin={isAdmin} />}

      {overdueCount > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="md" title={`Просрочено: ${pluralPayments(overdueCount)}`}>
          Срок оплаты уже прошёл. Оплатите и отметьте «Оплачено» — или исправьте дату, если оплата была вовремя.
        </Alert>
      )}

      <ErrorAlert error={summaryAll.error ?? todo.error} />

      {todoCard}

      <Group justify="space-between" mb="xs">
        <Title order={5}>Итоги по валютам</Title>
        <Badge variant="light" color="gray" style={{ textTransform: "none" }}>
          без конвертации
        </Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {CURRENCIES.map((c) => (
          <CurrencyCard
            key={c}
            currency={c}
            overdue={pick(summaryAll.data, c)?.overdue}
            upcoming={pick(summaryNext.data, c)?.unpaid}
            paid={pick(summaryMonth.data, c)?.paid}
            monthLabel={monthLabel}
          />
        ))}
      </SimpleGrid>

      {isAdmin && <PaymentFormModal opened={createOpened} payment={null} onClose={() => setCreateOpened(false)} />}
    </>
  );
}
