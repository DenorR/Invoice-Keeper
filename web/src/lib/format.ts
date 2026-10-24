import dayjs from "dayjs";
import type { Currency, Frequency, Occurrence, OccurrenceState } from "../api/client";

export const CURRENCIES: Currency[] = ["RUB", "USD", "EUR"];

export const CURRENCY_LABEL: Record<Currency, string> = {
  RUB: "Рубли",
  USD: "Доллары",
  EUR: "Евро",
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Еженедельно",
  monthly: "Ежемесячно",
  quarterly: "Ежеквартально",
  yearly: "Ежегодно",
};

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: string | number, currency: Currency): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency, minimumFractionDigits: 2 });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(Number(amount));
}

export function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format("DD.MM.YYYY") : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dayjs(value).format("DD.MM.YYYY HH:mm") : "—";
}

export function pluralDays(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = "дней";
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "дня";
  return `${abs} ${word}`;
}

export function pluralPeriods(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} период`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} периода`;
  return `${n} периодов`;
}

type StateView = { color: string; variant: "filled" | "light" | "outline"; label: string };

export function stateView(
  state: OccurrenceState,
  o: Pick<Occurrence, "overdue_days" | "days_until_due">,
): StateView {
  switch (state) {
    case "overdue":
      return { color: "red", variant: "filled", label: `Просрочено ${pluralDays(o.overdue_days)}` };
    case "due_today":
      return { color: "orange", variant: "filled", label: "Срок сегодня" };
    case "due_soon":
      return { color: "yellow", variant: "light", label: `Через ${pluralDays(o.days_until_due ?? 0)}` };
    case "upcoming":
      return { color: "gray", variant: "light", label: `Через ${pluralDays(o.days_until_due ?? 0)}` };
    case "paid_on_time":
      return { color: "green", variant: "light", label: "Оплачено вовремя" };
    case "paid_late":
      return { color: "orange", variant: "light", label: `Оплачено с опозданием ${pluralDays(o.overdue_days)}` };
  }
}

export function toISODate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return dayjs(value).format("YYYY-MM-DD");
}

/** Ссылка безопасна для href, только если это http(s): никаких javascript:, data: и т. п. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
