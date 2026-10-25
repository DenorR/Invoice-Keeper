import { ActionIcon, Anchor, Button, Card, Popover, Skeleton, Stack, Text, VisuallyHidden } from "@mantine/core";
import {
  IconArrowRight,
  IconBell,
  IconBrandTelegram,
  IconCircleCheck,
  IconClockHour4,
  IconCurrencyDollar,
  IconCurrencyEuro,
  IconCurrencyRuble,
  IconHelpCircle,
  IconPlus,
  IconRepeat,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Currency, Occurrence, Schemas } from "../api/client";
import { useMeta, useOccurrences, useSummary } from "../api/hooks";
import { useAuth } from "../auth";
import { ErrorAlert, IconTile, Notice, PageHeader, Pill, Section } from "../components/common";
import { OccurrenceRow, RowsSkeleton, useIsMobile } from "../components/OccurrenceList";
import { PaymentFormModal } from "../components/PaymentFormModal";
import { CURRENCIES, formatMoney, pluralDays } from "../lib/format";
import { popFrom } from "../theme";

const MONTHS_PREPOSITIONAL = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

function HowItWorks({ remindDays }: { remindDays: number }) {
  const isMobile = useIsMobile();
  const steps: { icon: ReactNode; tone: string; title: string; text: string }[] = [
    { icon: <IconRepeat size={16} />, tone: "blue", title: "Платёж добавлен", text: "Администратор заводит сумму, валюту, дату и периодичность." },
    { icon: <IconBell size={16} />, tone: "yellow", title: `За ${pluralDays(remindDays)} — напоминание`, text: "Бот пишет в Telegram-чат: что, сколько и до какого числа." },
    { icon: <IconCircleCheck size={16} />, tone: "green", title: "Оплатили — отметьте", text: "Кнопкой здесь или прямо в Telegram. Дату можно поправить." },
    { icon: <IconClockHour4 size={16} />, tone: undefined as unknown as string, title: "Следующий период", text: "Сразу появляется новый срок. Не оплатили вовремя — просрочка." },
  ];
  return (
    <Popover width={340} position="bottom-end" transitionProps={{ transition: popFrom("top right"), duration: 160 }}>
      <Popover.Target>
        {isMobile ? (
          <ActionIcon variant="default" size={36} aria-label="Как это работает">
            <IconHelpCircle size={18} stroke={1.75} />
          </ActionIcon>
        ) : (
          <Button variant="default" leftSection={<IconHelpCircle size={18} stroke={1.75} />}>
            Как это работает
          </Button>
        )}
      </Popover.Target>
      <Popover.Dropdown p="md">
        <Stack gap="md">
          {steps.map((s) => (
            <div key={s.title} style={{ display: "flex", gap: 12 }}>
              <IconTile tone={s.tone}>{s.icon}</IconTile>
              <div>
                <Text size="sm" fw={600}>
                  {s.title}
                </Text>
                <Text size="sm" c="dimmed">
                  {s.text}
                </Text>
              </div>
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

type Total = Schemas["TotalOut"];

const CURRENCY_ICON: Record<Currency, ReactNode> = {
  RUB: <IconCurrencyRuble size={15} stroke={2} />,
  USD: <IconCurrencyDollar size={15} stroke={2} />,
  EUR: <IconCurrencyEuro size={15} stroke={2} />,
};

const wholeFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const centsFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Сумма без знака валюты (знак — в иконке слева); копейки, только если они есть: «85 000», «54,9» → «54,90». */
function plainAmount(amount: number) {
  return (Number.isInteger(amount) ? wholeFormat : centsFormat).format(amount);
}

/**
 * Карточка-показатель (по мотивам metric card): справа — точечная сетка с лёгким цветным градиентом,
 * крупное число с плотным трекингом, сверху справа — индикатор (иконка + текст),
 * снизу — суммы столбиком: на каждую валюту своя строка со значком, чтобы длинные числа не уезжали за край.
 */
function StatCard({
  to,
  accent,
  title,
  indicator,
  count,
  totals,
  footLabel,
}: {
  to: string;
  accent: "red" | "blue" | "green" | "neutral";
  title: string;
  indicator: ReactNode;
  count?: number;
  totals?: Partial<Record<Currency, Total>>;
  footLabel: string;
}) {
  const loading = count === undefined || !totals;
  return (
    <Card component={Link} to={to} className="ik-metric" padding={0} data-accent={accent}>
      <div className="ik-metric-art" aria-hidden />
      <div className="ik-metric-body">
        <div className="ik-metric-head">
          <h3 className="ik-metric-title">{title}</h3>
          <span className="ik-metric-indicator">{indicator}</span>
        </div>
        {loading ? (
          <Skeleton h={52} w={90} mt="auto" />
        ) : (
          <div className="ik-metric-value">
            {count}
            <span className="ik-metric-unit">{pluralWord(count ?? 0, "платёж", "платежа", "платежей")}</span>
          </div>
        )}
      </div>
      <div className="ik-metric-foot">
        <span className="ik-metric-foot-label">{footLabel}</span>
        <dl className="ik-metric-sums">
          {CURRENCIES.map((c) => {
            const amount = Number(totals?.[c]?.amount ?? 0);
            return (
              <div key={c} className="ik-metric-sum" data-empty={!amount || undefined}>
                <dt className="ik-cur-icon" title={c}>
                  {CURRENCY_ICON[c]}
                  <VisuallyHidden>{c}</VisuallyHidden>
                </dt>
                <dd title={amount ? formatMoney(amount, c) : undefined}>{loading ? "…" : amount ? plainAmount(amount) : "—"}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Card>
  );
}

function pluralWord(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Колонка доски: свой заголовок, количество и суммы; список внутри ограничен по высоте и прокручивается. */
function Column({ title, tone, items, loading, empty, allLink }: { title: string; tone: "red" | "yellow" | "blue"; items: Occurrence[]; loading: boolean; empty: string; allLink: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  const update = useCallback(() => {
    const el = body.current;
    if (el) setFade(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(update, [items, update]);

  const sums = CURRENCIES.map((c) => {
    const mine = items.filter((o) => o.currency === c);
    return mine.length ? formatMoney(mine.reduce((n, o) => n + Number(o.amount), 0), c) : null;
  }).filter(Boolean);

  return (
    <section className="ik-col ik-glass" data-tone={tone}>
      <header className="ik-col-head">
        <div className="ik-col-title">
          {title}
          <span className="ik-col-count">{loading ? "" : items.length}</span>
        </div>
        <div className="ik-col-sums">{sums.length ? sums.join(" · ") : "—"}</div>
      </header>
      {loading ? (
        <RowsSkeleton count={3} />
      ) : items.length ? (
        <>
          <div ref={body} className="ik-col-body" data-scrollable={fade || undefined} onScroll={update}>
            {items.map((o) => (
              <OccurrenceRow key={o.id} o={o} />
            ))}
          </div>
          {items.length > 6 && (
            <Link to={allLink} className="ik-col-foot">
              Все {items.length} <IconArrowRight size={14} />
            </Link>
          )}
        </>
      ) : (
        <div className="ik-col-empty">{empty}</div>
      )}
    </section>
  );
}

function TelegramLine({ meta }: { meta: Schemas["MetaOut"] }) {
  const tg = meta.telegram;
  if (!tg.chat_configured) return null;
  return (
    <>
      {" · "}
      <IconBrandTelegram size={14} style={{ verticalAlign: "-2px" }} /> напоминания за {pluralDays(meta.reminder_days_before)}
      {tg.bot_username && (
        <>
          {" "}
          в{" "}
          <Anchor href={`https://t.me/${tg.bot_username}`} target="_blank" rel="noopener noreferrer" inherit>
            @{tg.bot_username}
          </Anchor>
        </>
      )}
    </>
  );
}

function byCurrency(s: Schemas["SummaryOut"] | undefined, key: "overdue" | "unpaid" | "paid") {
  if (!s) return undefined;
  return Object.fromEntries(s.currencies.map((c) => [c.currency, c[key]])) as Partial<Record<Currency, Total>>;
}

function countOf(s: Schemas["SummaryOut"] | undefined, key: "overdue" | "unpaid" | "paid") {
  return s?.currencies.reduce((n, c) => n + c[key].count, 0);
}

export function DashboardPage() {
  const { isAdmin } = useAuth();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const remindDays = meta.data?.reminder_days_before ?? 3;
  const in7 = dayjs(today).add(7, "day").format("YYYY-MM-DD");
  const in30 = dayjs(today).add(30, "day").format("YYYY-MM-DD");
  const [createOpened, setCreateOpened] = useState(false);

  const summaryAll = useSummary();
  const summaryNext = useSummary(today, in30);
  const summaryMonth = useSummary(dayjs(today).startOf("month").format("YYYY-MM-DD"), dayjs(today).endOf("month").format("YYYY-MM-DD"));
  const todo = useOccurrences({ status: "unpaid", to: in30, sort: "due_date", limit: 100 });

  const items: Occurrence[] = todo.data?.items ?? [];
  const overdueItems = items.filter((o) => o.due_date < today);
  const weekItems = items.filter((o) => o.due_date >= today && o.due_date <= in7);
  const laterItems = items.filter((o) => o.due_date > in7);
  const overdueCount = countOf(summaryAll.data, "overdue");
  const tg = meta.data?.telegram;

  return (
    <>
      <PageHeader
        title="Сегодня"
        description={
          <>
            {dayjs(today).format("dddd, D MMMM")}
            {meta.data && <TelegramLine meta={meta.data} />}
          </>
        }
        actions={
          <>
            <HowItWorks remindDays={remindDays} />
            {isAdmin && (
              <Button leftSection={<IconPlus size={16} stroke={2.25} />} onClick={() => setCreateOpened(true)}>
                Добавить платёж
              </Button>
            )}
          </>
        }
      />

      {isAdmin && tg && !tg.chat_configured && (
        <div style={{ marginBottom: 24 }}>
          <Notice icon={<IconBrandTelegram size={18} />}>
            <Text size="sm" fw={600}>
              Напоминания в Telegram не настроены
            </Text>
            <Text size="sm" c="dimmed">
              {tg.bot_configured
                ? "Бот подключён, но чат не выбран: добавьте бота в рабочую группу и укажите TELEGRAM_CHAT_ID в .env."
                : "Укажите TELEGRAM_BOT_TOKEN в .env и добавьте бота в рабочую группу."}
            </Text>
          </Notice>
        </div>
      )}

      <ErrorAlert error={summaryAll.error ?? todo.error} />

      <div className="ik-stats">
        <StatCard
          to="/payments?tab=overdue"
          accent={overdueCount ? "red" : "neutral"}
          title="Просрочено"
          indicator={
            overdueCount ? (
              <Pill tone="red">нужно оплатить</Pill>
            ) : (
              <Pill tone="green">всё вовремя</Pill>
            )
          }
          count={overdueCount}
          totals={byCurrency(summaryAll.data, "overdue")}
          footLabel="Сумма просрочки"
        />
        <StatCard
          to="/payments"
          accent="blue"
          title="К оплате"
          indicator={<Pill tone="blue">30 дней</Pill>}
          count={countOf(summaryNext.data, "unpaid")}
          totals={byCurrency(summaryNext.data, "unpaid")}
          footLabel="Сумма к оплате"
        />
        <StatCard
          to="/payments?tab=paid"
          accent="green"
          title="Оплачено"
          indicator={<Pill tone="green">в {MONTHS_PREPOSITIONAL[dayjs(today).month()]}</Pill>}
          count={countOf(summaryMonth.data, "paid")}
          totals={byCurrency(summaryMonth.data, "paid")}
          footLabel="Сумма оплат"
        />
      </div>

      <Section
        title="Ближайшие платежи"
        action={
          <Anchor component={Link} to="/payments" size="sm" fw={500} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            Все платежи <IconArrowRight size={14} />
          </Anchor>
        }
      >
        <div className="ik-board">
          <Column title="Просрочено" tone="red" items={overdueItems} loading={todo.isLoading} empty="Просрочек нет — всё вовремя" allLink="/payments?tab=overdue" />
          <Column title="Ближайшие 7 дней" tone="yellow" items={weekItems} loading={todo.isLoading} empty="На этой неделе платить нечего" allLink={`/payments?from=${today}&to=${in7}`} />
          <Column title="Позже, до 30 дней" tone="blue" items={laterItems} loading={todo.isLoading} empty="Дальше пока пусто" allLink={`/payments?from=${dayjs(in7).add(1, "day").format("YYYY-MM-DD")}&to=${in30}`} />
        </div>
      </Section>

      {isAdmin && <PaymentFormModal opened={createOpened} payment={null} onClose={() => setCreateOpened(false)} />}
    </>
  );
}
