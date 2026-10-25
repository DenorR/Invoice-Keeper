import { ActionIcon, Skeleton, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconBrandTelegram, IconExternalLink, IconFileTypePdf, IconInbox, IconMessage, IconPhoto } from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import type { Occurrence } from "../api/client";
import { fileExt, formatBytes, formatDate, pluralDays, safeHttpUrl, weekday } from "../lib/format";
import { EmptyState, Money, StatusBadge } from "./common";
import { PayCheck } from "./OccurrenceActions";

export type OccurrenceGroup = { key: string; title?: string; items: Occurrence[] };

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 48em)") ?? false;
}

const MONTHS_GEN = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function shortDate(iso: string): string {
  const d = dayjs(iso);
  return `${d.date()} ${MONTHS_GEN[d.month()]}, ${weekday(iso)}`;
}

/** Срок словами: «просрочено 5 дней», «сегодня», «через 2 дня». */
function relative(o: Occurrence): ReactNode {
  if (o.state === "overdue") return <span data-sep data-tone="red">просрочено {pluralDays(o.overdue_days)}</span>;
  if (o.state === "due_today") return <span data-sep data-tone="today">сегодня</span>;
  if (o.days_until_due === 1) return <span data-sep>завтра</span>;
  if (o.days_until_due !== null && o.days_until_due !== undefined && o.days_until_due > 0) return <span data-sep>через {pluralDays(o.days_until_due)}</span>;
  return null;
}

function Meta({ o, withRelative }: { o: Occurrence; withRelative: boolean }) {
  if (o.paid_at) {
    return (
      <>
        <span>{shortDate(o.due_date)}</span>
        <span data-sep>оплачено {formatDate(o.paid_at)}{o.paid_by?.label ? `, ${o.paid_by.label}` : ""}</span>
        {o.paid_via === "telegram" && <IconBrandTelegram size={13} />}
        {!o.payment_active && <span data-sep>платёж прекращён</span>}
        <CommentPart o={o} />
      </>
    );
  }
  const rel = withRelative ? relative(o) : null;
  return (
    <>
      <span>{shortDate(o.due_date)}</span>
      {rel}
      {!o.payment_active && <span data-sep>платёж прекращён</span>}
      {o.reminder_sent_at && (
        <Tooltip label={`Напоминание отправлено в Telegram ${formatDate(o.reminder_sent_at)}`}>
          <span style={{ display: "inline-flex" }} aria-label="напоминание отправлено">
            <IconBrandTelegram size={13} />
          </span>
        </Tooltip>
      )}
    </>
  );
}

/** Комментарий к оплате — в конце подписи; длинный сокращается, целиком — во всплывающей подсказке. */
function CommentPart({ o }: { o: Occurrence }) {
  if (!o.comment) return null;
  return (
    <Tooltip label={o.comment} multiline maw={320} style={{ whiteSpace: "pre-wrap" }}>
      <span data-sep className="ik-item-comment">
        <IconMessage size={13} />
        {o.comment.replace(/\s+/g, " ")}
      </span>
    </Tooltip>
  );
}

/**
 * Чек к оплате — между суммой и статусом: ярлык файла с расширением («PDF», «JPG») и значок ссылки.
 * Открываются прямо из строки; имя и размер файла — во всплывающей подсказке.
 */
export function ReceiptLinks({ o }: { o: Occurrence }) {
  const url = safeHttpUrl(o.receipt_url);
  const file = o.receipt_file;
  // контейнер есть всегда — чтобы у всех строк была одна сетка и суммы стояли ровным столбцом
  return (
    <div className="ik-item-receipts">
      {file && (
        <Tooltip label={`Чек: ${file.filename} · ${formatBytes(file.size)}`}>
          <a className="ik-file-chip" href={file.url} target="_blank" rel="noopener" aria-label={`Открыть чек ${file.filename}`}>
            {file.content_type === "application/pdf" ? <IconFileTypePdf size={15} /> : <IconPhoto size={15} />}
            {fileExt(file.filename, file.content_type)}
          </a>
        </Tooltip>
      )}
      {url && (
        <Tooltip label="Ссылка на чек">
          <ActionIcon component="a" href={url} target="_blank" rel="noopener noreferrer" variant="subtle" color="gray" size={30} aria-label="Открыть ссылку на чек">
            <IconExternalLink size={17} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Строка периода: кружок-отметка · название и срок · сумма [· статус].
 * Статус показываем, только когда его не видно из контекста (например, в общем списке на странице «Платежи»).
 */
export function OccurrenceRow({ o, showStatus = false }: { o: Occurrence; showStatus?: boolean }) {
  return (
    <div className="ik-item" data-status={showStatus || undefined} data-inactive={o.payment_active ? undefined : ""}>
      <PayCheck occurrence={o} />
      <div className="ik-item-main" style={{ minWidth: 0 }}>
        <div className="ik-item-title" title={o.name}>
          {o.name}
        </div>
        <div className="ik-item-meta">
          <Meta o={o} withRelative={!showStatus} />
        </div>
      </div>
      <div className="ik-item-amount">
        <Money amount={o.amount} currency={o.currency} fw={650} />
      </div>
      <ReceiptLinks o={o} />
      {showStatus && (
        <div className="ik-item-status">
          <StatusBadge occurrence={o} />
        </div>
      )}
    </div>
  );
}

export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="ik-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ik-item">
          <Skeleton h={24} w={24} circle />
          <div>
            <Skeleton h={12} w="55%" mb={8} />
            <Skeleton h={10} w="35%" />
          </div>
          <Skeleton h={12} w={72} />
        </div>
      ))}
    </div>
  );
}

/** Плоский список строк (страница «Платежи»). */
export function OccurrenceList({ items, loading, empty }: { items: Occurrence[]; loading?: boolean; empty?: ReactNode }) {
  if (loading) return <RowsSkeleton />;
  if (!items.length) return <>{empty ?? <EmptyState icon={<IconInbox size={22} />} title="Ничего не найдено" />}</>;
  return (
    <div className="ik-list" style={{ padding: 6 }}>
      {items.map((o) => (
        <OccurrenceRow key={o.id} o={o} showStatus />
      ))}
    </div>
  );
}
