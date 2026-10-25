import { Alert, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCalendarEvent,
  IconCheck,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import type { Currency, Occurrence } from "../api/client";
import { formatMoney, stateView } from "../lib/format";

/** Обёртка страницы: ширина и поля задаются один раз — блоки на всех страницах выровнены одинаково. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="ik-page">{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ik-page-header">
      <div style={{ minWidth: 0 }}>
        <h1 className="ik-page-title">{title}</h1>
        {description && <div className="ik-page-subtitle">{description}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
    </header>
  );
}

/** Секция страницы: заголовок слева, действие справа, 32px от предыдущей секции. */
export function Section({ title, action, children, first }: { title?: ReactNode; action?: ReactNode; children: ReactNode; first?: boolean }) {
  return (
    <section className={first ? undefined : "ik-section"}>
      {(title || action) && (
        <div className="ik-section-head">
          {title && <h2 className="ik-section-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE_ICON: Record<string, ReactNode> = {
  red: <IconAlertCircle size={15} stroke={2} />,
  yellow: <IconClock size={15} stroke={2} />,
  blue: <IconClock size={15} stroke={2} />,
  green: <IconCircleCheck size={15} stroke={2} />,
  gray: <IconCalendarEvent size={15} stroke={2} />,
  planned: <IconCircleDashed size={15} stroke={2} />,
};

const STATE_TONE: Record<string, string> = { red: "red", yellow: "yellow", gray: "gray", green: "green" };

/**
 * Индикатор: иконка + текст нужного оттенка, без плашки и без точки с ореолом.
 * Смысл несут и иконка, и слова — цвет только подсказывает.
 */
export function Pill({ tone = "gray", icon, children }: { tone?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="ik-status" data-tone={tone}>
      {icon ?? TONE_ICON[tone] ?? TONE_ICON.gray}
      <span>{children}</span>
    </span>
  );
}

/** Статус периода: «Просрочено 5 дней», «Через 2 дня», «Оплачено вовремя» — иконкой и текстом. */
export function StatusBadge({ occurrence }: { occurrence: Pick<Occurrence, "state" | "overdue_days" | "days_until_due"> }) {
  const view = stateView(occurrence.state, occurrence);
  return <Pill tone={STATE_TONE[view.color] ?? "gray"}>{view.label}</Pill>;
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Плитка даты, как листок календаря: число крупно, месяц мелко. */
export function DateTile({ date, tone }: { date: string; tone?: "red" | "yellow" }) {
  const d = dayjs(date);
  return (
    <div className="ik-date" data-tone={tone}>
      <span className="ik-date-day">{d.date()}</span>
      <span className="ik-date-month">{MONTHS_SHORT[d.month()]}</span>
    </div>
  );
}

export function IconTile({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <span className="ik-icon-tile" data-tone={tone}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ik-empty">
      <IconTile>{icon}</IconTile>
      <Text fw={600}>{title}</Text>
      {text && (
        <Text size="sm" c="dimmed" maw={360}>
          {text}
        </Text>
      )}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

/** Короткая заметка строкой — вместо крупных цветных алертов. */
export function Notice({ icon, tone, children, action }: { icon: ReactNode; tone?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ik-notice">
      <IconTile tone={tone}>{icon}</IconTile>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
    </div>
  );
}

export function Money({ amount, currency, fw = 600 }: { amount: string | number; currency: Currency; fw?: number }) {
  return (
    <Text span fw={fw} className="tabular nowrap">
      {formatMoney(amount, currency)}
    </Text>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Не удалось загрузить данные" mb="md" radius="lg">
      {error instanceof Error ? error.message : String(error)}
    </Alert>
  );
}

export function notifySuccess(message: string, title?: string) {
  notifications.show({ color: "green", title, message, icon: <IconCheck size={18} />, radius: "lg" });
}

export function notifyError(error: unknown) {
  notifications.show({
    color: "red",
    title: "Ошибка",
    message: error instanceof Error ? error.message : String(error),
    icon: <IconX size={18} />,
    radius: "lg",
  });
}
