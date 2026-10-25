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

const compactFormatters = {
  cents: new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  whole: new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }),
  short: new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }),
  shortWhole: new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 0 }),
};

/**
 * Число для тесной ячейки (валюта подписана рядом): «49,90», «15», «9 999», «85» + «тыс.», «977» + «млн».
 * Не длиннее пяти знаков, поэтому столбцы одинаковой ширины не переполняются; точная сумма — в подсказке.
 */
export function formatCompact(amount: string | number): { value: string; unit: string } {
  const value = Number(amount);
  const abs = Math.abs(value);
  if (abs < 1_000) return { value: (Number.isInteger(value) ? compactFormatters.whole : compactFormatters.cents).format(value), unit: "" };
  if (abs < 10_000) return { value: compactFormatters.whole.format(value), unit: "" };
  // «133,6 млн» → «134 млн»: дробь оставляем, только пока в целой части меньше трёх знаков
  const parts = compactFormatters.short.formatToParts(value);
  const integer = parts.filter((p) => p.type === "integer").map((p) => p.value).join("");
  const chosen = integer.length >= 3 ? compactFormatters.shortWhole.formatToParts(value) : parts;
  return {
    value: chosen.filter((p) => p.type !== "compact" && p.type !== "literal").map((p) => p.value).join(""),
    unit: chosen.find((p) => p.type === "compact")?.value ?? "",
  };
}

export function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format("DD.MM.YYYY") : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dayjs(value).format("DD.MM.YYYY HH:mm") : "—";
}

/** Расширение файла для ярлыка: «PDF», «JPG», «PNG», «WEBP». */
export function fileExt(filename: string, contentType?: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toUpperCase() : "";
  if (ext === "JPEG") return "JPG";
  return ext || (contentType?.split("/")[1] ?? "файл").toUpperCase();
}

/** Размер файла: «812 КБ», «2,4 МБ». */
export function formatBytes(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

/** Окно напоминания: меньше 3 дней нельзя (так требует кейс), больше года — бессмысленно. */
export const REMIND_MIN = 3;
export const REMIND_MAX = 365;

export function pluralDays(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = "дней";
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "дня";
  return `${abs} ${word}`;
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
      return { color: "yellow", variant: "filled", label: "Срок сегодня" };
    case "due_soon":
      return { color: "yellow", variant: "filled", label: o.days_until_due === 1 ? "Завтра" : `Через ${pluralDays(o.days_until_due ?? 0)}` };
    case "upcoming":
      return { color: "gray", variant: "light", label: `Через ${pluralDays(o.days_until_due ?? 0)}` };
    case "paid_on_time":
      return { color: "green", variant: "light", label: "Оплачено вовремя" };
    case "paid_late":
      return { color: "yellow", variant: "light", label: `Оплачено с опозданием ${pluralDays(o.overdue_days)}` };
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

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function weekday(value: string): string {
  return WEEKDAYS_SHORT[dayjs(value).day()];
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function pluralPayments(n: number): string {
  return `${n} ${plural(n, "платёж", "платежа", "платежей")}`;
}
