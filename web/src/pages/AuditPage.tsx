import { Anchor, Badge, Button, Card, Code, Collapse, Group, Loader, Pagination, Select, Stack, Table, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconChevronRight, IconExternalLink, IconFileTypePdf, IconPhoto, IconTrash } from "@tabler/icons-react";
import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import type { AuditEntry } from "../api/client";
import { useAudit, useOccurrence, useReceiptFile } from "../api/hooks";
import { ErrorAlert, PageHeader, notifyError, notifySuccess } from "../components/common";
import { useIsMobile } from "../components/OccurrenceList";
import { fileExt, formatBytes, formatDate, formatDateTime, pluralDays, safeHttpUrl } from "../lib/format";
import { EASE_OUT } from "../theme";

const PAGE_SIZE = 50;

const ACTIONS: Record<string, { label: string; color: string }> = {
  "auth.login": { label: "Вход", color: "blue" },
  "auth.login_failed": { label: "Неудачный вход", color: "red" },
  "auth.logout": { label: "Выход", color: "gray" },
  "recurring.create": { label: "Платёж создан", color: "teal" },
  "recurring.update": { label: "Платёж изменён", color: "yellow" },
  "recurring.delete": { label: "Платёж прекращён", color: "red" },
  "recurring.restore": { label: "Платёж возобновлён", color: "teal" },
  "settings.update": { label: "Настройки изменены", color: "yellow" },
  "occurrence.pay": { label: "Оплата отмечена", color: "green" },
  "occurrence.unpay": { label: "Оплата отменена", color: "yellow" },
  "occurrence.correct_date": { label: "Дата оплаты исправлена", color: "yellow" },
  "occurrence.receipt": { label: "Ссылка на чек", color: "cyan" },
  "occurrence.file_attach": { label: "Чек прикреплён", color: "green" },
  "occurrence.file_remove": { label: "Чек удалён", color: "gray" },
  "occurrence.comment": { label: "Комментарий к оплате", color: "gray" },
  "category.create": { label: "Категория создана", color: "teal" },
  "category.update": { label: "Категория переименована", color: "yellow" },
  "category.delete": { label: "Категория удалена", color: "red" },
  "reminder.sent": { label: "Напоминание в Telegram", color: "indigo" },
  "user.create": { label: "Пользователь создан", color: "teal" },
  "user.update": { label: "Пользователь изменён", color: "yellow" },
  "user.delete": { label: "Пользователь удалён", color: "red" },
};

const FILTERS = [
  { value: "auth.", label: "Авторизация" },
  { value: "recurring.", label: "Регулярные платежи" },
  { value: "occurrence.", label: "Оплаты" },
  { value: "reminder.", label: "Напоминания" },
  { value: "user.", label: "Пользователи" },
  { value: "settings.", label: "Настройки" },
  { value: "category.", label: "Категории" },
];

const remindLabel = (v: unknown) => (typeof v === "number" ? `за ${pluralDays(v)}` : "как в настройках");

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : String(v ?? "—"));

function describe(entry: AuditEntry): string {
  const d = (entry.details ?? {}) as Record<string, any>;
  switch (entry.action) {
    case "auth.login":
      return "вход в панель";
    case "auth.login_failed":
      return "неверный логин или пароль";
    case "auth.logout":
      return "выход из панели";
    case "user.create":
      return `логин ${d.login}`;
    case "user.delete":
      return `логин ${d.login}`;
    case "user.update":
      return [d.login && `логин: ${d.login.from} → ${d.login.to}`, d.name && `имя: ${d.name.from ?? "—"} → ${d.name.to ?? "—"}`, d.password && "пароль изменён"]
        .filter(Boolean)
        .join("; ");
    case "recurring.update":
      return [d.name && `название: «${d.name.from}» → «${d.name.to}»`, d.amount && `сумма: ${d.amount.from} → ${d.amount.to}`, d.schedule && `график: с ${iso(d.schedule.to.next_due_date)}`, d.remind_days && `напоминание: ${remindLabel(d.remind_days.from)} → ${remindLabel(d.remind_days.to)}`, d.category_id && "категория изменена"]
        .filter(Boolean)
        .join("; ");
    case "recurring.delete":
    case "recurring.restore":
      return `«${d.name}»`;
    case "settings.update":
      if (d.reminder_days_before) return `напоминать за ${pluralDays(d.reminder_days_before.to)} (было ${pluralDays(d.reminder_days_before.from)})`;
      if (d.uploads_enabled) return d.uploads_enabled.to ? "загрузка файлов чеков включена" : "загрузка файлов чеков отключена";
      return "";
    case "occurrence.file_attach":
      return `срок ${iso(d.due_date)}: «${d.filename}», ${Math.max(1, Math.round(Number(d.size) / 1024))} КБ${d.replaced ? `, заменил «${d.replaced}»` : ""}`;
    case "occurrence.file_remove":
      return `срок ${iso(d.due_date)}: «${d.filename}»`;
    case "occurrence.comment":
      return `срок ${iso(d.due_date)}: ${d.comment ? `«${d.comment}»` : "комментарий удалён"}`;
    case "category.create":
    case "category.delete":
      return `«${d.name}»${d.payments ? `, платежей без категории: ${d.payments}` : ""}`;
    case "category.update":
      return `«${d.name?.from}» → «${d.name?.to}»`;
    case "occurrence.receipt":
      return d.url ? `ссылка: ${d.url}` : "ссылка удалена";
    case "occurrence.pay":
    case "occurrence.unpay":
    case "occurrence.correct_date":
      return `срок ${iso(d.due_date)}${d.from ? `, было ${iso(d.from)}` : ""}${d.to ? `, стало ${iso(d.to)}` : ""}${d.via === "telegram" ? " (кнопкой в Telegram)" : ""}`;
    case "recurring.create":
      return `«${d.name}»: ${d.amount} ${d.currency}, первая оплата ${iso(d.next_due_date)}`;
    case "reminder.sent":
      return `срок ${(d.due_dates as string[] | undefined)?.map(iso).join(", ")}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d, null, 0) : "";
  }
}

// ─── группировка: оплата и то, что приложили к ней в том же действии ───

/** Что приложили к оплате (чек ссылкой или файлом, комментарий) — показываем внутри записи «Оплата отмечена». */
const PAY_EXTRAS = new Set(["occurrence.file_attach", "occurrence.receipt", "occurrence.comment"]);
// окно, в котором приложенное считается частью той же оплаты (окно оплаты отправляет файл сразу следом)
const MERGE_WINDOW_MS = 5 * 60 * 1000;

type LogRow = { key: number; main: AuditEntry; extras: AuditEntry[] };

function groupRows(items: AuditEntry[]): LogRow[] {
  const claimed = new Set<number>();
  const extrasOf = new Map<number, AuditEntry[]>();
  for (const pay of items) {
    if (pay.action !== "occurrence.pay") continue;
    const payAt = new Date(pay.at).getTime();
    const extras = items.filter((e) => {
      if (claimed.has(e.id) || !PAY_EXTRAS.has(e.action) || e.entity_id !== pay.entity_id || e.actor_label !== pay.actor_label) return false;
      const delta = new Date(e.at).getTime() - payAt;
      return e.id > pay.id && delta >= 0 && delta <= MERGE_WINDOW_MS;
    });
    extras.forEach((e) => claimed.add(e.id));
    extrasOf.set(pay.id, extras);
  }
  return items.filter((e) => !claimed.has(e.id)).map((e) => ({ key: e.id, main: e, extras: extrasOf.get(e.id) ?? [] }));
}

function extrasSummary(extras: AuditEntry[]): string {
  return extras
    .map((e) => {
      const d = (e.details ?? {}) as Record<string, any>;
      if (e.action === "occurrence.file_attach") return `прикреплён чек (${fileExt(String(d.filename ?? ""), d.type)})`;
      if (e.action === "occurrence.receipt") return d.url ? "ссылка на чек" : "";
      if (e.action === "occurrence.comment") return d.comment ? "с комментарием" : "";
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

/** Короткая строка для таблицы; подробности — в раскрывающейся части. */
function summary(row: LogRow): string {
  const { main } = row;
  const d = (main.details ?? {}) as Record<string, any>;
  if (main.action === "occurrence.file_attach") return `срок ${iso(d.due_date)} · прикреплён чек (${fileExt(String(d.filename ?? ""), d.type)})`;
  if (main.action === "occurrence.file_remove") return `срок ${iso(d.due_date)} · файл чека удалён`;
  const extra = extrasSummary(row.extras);
  return extra ? `${describe(main)} · ${extra}` : describe(main);
}

// ─── раскрытая запись ───

const ENTITY_LABEL: Record<string, string> = {
  payment_occurrence: "Платёж (период)",
  recurring_payment: "Регулярный платёж",
  user: "Пользователь",
  category: "Категория",
  settings: "Настройки",
};

function LogDetails({ row }: { row: LogRow }) {
  const entries = [row.main, ...row.extras];
  const fileEntry = entries.find((e) => e.action === "occurrence.file_attach" || e.action === "occurrence.file_remove");
  const comment = row.extras.find((e) => e.action === "occurrence.comment") ?? (row.main.action === "occurrence.comment" ? row.main : null);
  const link = entries.find((e) => e.action === "occurrence.receipt");
  const commentText = (comment?.details as Record<string, any> | null)?.comment as string | undefined;
  const linkUrl = safeHttpUrl((link?.details as Record<string, any> | null)?.url);

  return (
    <div className="ik-log-details">
      <dl className="ik-log-facts">
        <div>
          <dt>Когда</dt>
          <dd className="tabular">{formatDateTime(row.main.at)}</dd>
        </div>
        <div>
          <dt>Кто</dt>
          <dd>
            <Code>{row.main.actor_label}</Code>
          </dd>
        </div>
        <div>
          <dt>IP</dt>
          <dd>{row.main.ip ?? "—"}</dd>
        </div>
        {row.main.entity && (
          <div>
            <dt>Объект</dt>
            <dd>
              {ENTITY_LABEL[row.main.entity] ?? row.main.entity}
              {row.main.entity_id ? ` №${row.main.entity_id}` : ""}
            </dd>
          </div>
        )}
      </dl>

      {fileEntry && <FileFact entry={fileEntry} />}
      {commentText && (
        <div className="ik-log-block">
          <Text size="xs" c="dimmed" mb={4}>
            Комментарий
          </Text>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {commentText}
          </Text>
        </div>
      )}
      {linkUrl && (
        <div className="ik-log-block">
          <Text size="xs" c="dimmed" mb={4}>
            Ссылка на чек
          </Text>
          <Anchor href={linkUrl} target="_blank" rel="noopener noreferrer" size="sm" style={{ wordBreak: "break-all" }}>
            {linkUrl}
          </Anchor>
        </div>
      )}

      <details className="ik-log-raw">
        <summary>Технические подробности</summary>
        {entries.map((e) => (
          <pre key={e.id}>
            {e.action} · №{e.id}
            {"\n"}
            {JSON.stringify(e.details ?? {}, null, 2)}
          </pre>
        ))}
      </details>
    </div>
  );
}

/** Файл из записи журнала: имя, расширение, размер; если он всё ещё прикреплён — открыть или удалить с сервера. */
function FileFact({ entry }: { entry: AuditEntry }) {
  const d = (entry.details ?? {}) as Record<string, any>;
  const occurrenceId = entry.entity_id ?? 0;
  const occurrence = useOccurrence(occurrenceId, entry.action === "occurrence.file_attach" && occurrenceId > 0);
  const { remove } = useReceiptFile();
  const current = occurrence.data?.receipt_file ?? null;
  // тот ли это файл, что прикреплён сейчас: по отпечатку, а у старых записей без него — по имени и размеру
  const same = current && (d.sha256 ? current.sha256 === d.sha256 : current.filename === d.filename && current.size === d.size);
  const isPdf = d.type === "application/pdf" || String(d.filename).toLowerCase().endsWith(".pdf");

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: "Удалить файл чека с сервера?",
      children: (
        <Text size="sm">
          «{String(d.filename)}» будет удалён без возможности восстановления. Отметка об оплате и остальные данные останутся.
        </Text>
      ),
      labels: { confirm: "Удалить файл", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await remove.mutateAsync(occurrenceId);
          notifySuccess(`Файл «${String(d.filename)}» удалён с сервера`);
        } catch (error) {
          notifyError(error);
        }
      },
    });

  return (
    <div className="ik-log-block">
      <Text size="xs" c="dimmed" mb={6}>
        {entry.action === "occurrence.file_remove" ? "Удалённый файл чека" : "Файл чека"}
      </Text>
      <div className="ik-file">
        <span className="ik-file-icon" aria-hidden>
          {isPdf ? <IconFileTypePdf size={18} /> : <IconPhoto size={18} />}
        </span>
        <div className="ik-file-name">
          <Text size="sm" fw={500} truncate>
            {String(d.filename ?? "—")}
          </Text>
          <Text size="xs" c="dimmed">
            {fileExt(String(d.filename ?? ""), d.type)} · {formatBytes(Number(d.size ?? 0))}
            {d.replaced ? ` · заменил «${d.replaced}»` : ""}
          </Text>
        </div>
        {entry.action === "occurrence.file_attach" &&
          (occurrence.isLoading ? (
            <Loader size="xs" />
          ) : same && current ? (
            <Group gap={6} wrap="nowrap">
              <Button component="a" href={current.url} target="_blank" rel="noopener" size="compact-sm" variant="default" leftSection={<IconExternalLink size={14} />}>
                Открыть
              </Button>
              <Button size="compact-sm" color="red" leftSection={<IconTrash size={14} />} onClick={confirmDelete} loading={remove.isPending}>
                Удалить с сервера
              </Button>
            </Group>
          ) : (
            <Text size="xs" c="dimmed" ta="right">
              {current ? `Заменён: сейчас прикреплён «${current.filename}»` : "Уже удалён с сервера"}
            </Text>
          ))}
      </div>
    </div>
  );
}

// ─── страница ───

export function AuditPage() {
  const isMobile = useIsMobile();
  const [action, setAction] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  // раскрытую однажды запись держим смонтированной, чтобы она плавно сворачивалась, а не исчезала
  const [mounted, setMounted] = useState<Set<number>>(() => new Set());
  const audit = useAudit({ action: action ?? undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const total = audit.data?.total ?? 0;
  const rows = useMemo(() => groupRows(audit.data?.items ?? []), [audit.data]);

  const toggle = (key: number) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const onKey = (key: number) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(key);
    }
  };
  const badge = (row: LogRow) => {
    const view = ACTIONS[row.main.action] ?? { label: row.main.action, color: "gray" };
    return (
      <Badge color={view.color} variant="dot" style={{ textTransform: "none" }}>
        {view.label}
      </Badge>
    );
  };
  const details = (row: LogRow) => (
    <Collapse expanded={open.has(row.key)} transitionDuration={260} transitionTimingFunction={EASE_OUT}>
      {mounted.has(row.key) && <LogDetails row={row} />}
    </Collapse>
  );

  return (
    <>
      <PageHeader title="Журнал действий" description="Входы в систему и все изменения. Нажмите на запись, чтобы увидеть подробности" />
      <ErrorAlert error={audit.error} />
      <Card withBorder padding={0}>
        <Group p="md">
          <Select
            placeholder="Все события"
            data={FILTERS}
            value={action}
            onChange={(v) => {
              setAction(v);
              setPage(1);
              setOpen(new Set());
            }}
            clearable
            w={240}
          />
          <Text size="sm" c="dimmed" ml="auto">
            Записей: {total}
          </Text>
        </Group>
        {isMobile ? (
          <Stack gap="xs" px="sm" pb="sm">
            {rows.map((row) => (
              <Card key={row.key} withBorder padding="xs" className="ik-log-card" data-open={open.has(row.key) || undefined}>
                <div role="button" tabIndex={0} aria-expanded={open.has(row.key)} onClick={() => toggle(row.key)} onKeyDown={onKey(row.key)} className="ik-log-toggle">
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    {badge(row)}
                    <Text size="xs" c="dimmed" className="nowrap tabular">
                      {formatDateTime(row.main.at)}
                    </Text>
                  </Group>
                  <Text size="sm" mt={4}>
                    <Code>{row.main.actor_label}</Code> {summary(row)}
                  </Text>
                </div>
                {details(row)}
              </Card>
            ))}
          </Stack>
        ) : (
          <Table.ScrollContainer minWidth={800}>
            <Table verticalSpacing="xs" className="ik-log-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={28} />
                  <Table.Th>Время</Table.Th>
                  <Table.Th>Кто</Table.Th>
                  <Table.Th>Событие</Table.Th>
                  <Table.Th>Подробности</Table.Th>
                  <Table.Th>IP</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Fragment key={row.key}>
                    <Table.Tr
                      className="ik-log-row"
                      data-open={open.has(row.key) || undefined}
                      tabIndex={0}
                      aria-expanded={open.has(row.key)}
                      onClick={() => toggle(row.key)}
                      onKeyDown={onKey(row.key)}
                    >
                      <Table.Td>
                        <IconChevronRight size={15} className="ik-log-chevron" />
                      </Table.Td>
                      <Table.Td className="nowrap tabular">{formatDateTime(row.main.at)}</Table.Td>
                      <Table.Td>
                        <Code>{row.main.actor_label}</Code>
                      </Table.Td>
                      <Table.Td>{badge(row)}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed" lineClamp={2}>
                          {summary(row)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {row.main.ip ?? "—"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr className="ik-log-detail-row" data-open={open.has(row.key) || undefined}>
                      <Table.Td colSpan={6} p={0}>
                        {details(row)}
                      </Table.Td>
                    </Table.Tr>
                  </Fragment>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {total > PAGE_SIZE && (
          <Group justify="center" p="md">
            <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </Card>
    </>
  );
}
