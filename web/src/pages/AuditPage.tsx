import { Badge, Card, Code, Group, Pagination, Select, Stack, Table, Text } from "@mantine/core";
import { useIsMobile } from "../components/OccurrenceList";
import { useState } from "react";
import type { AuditEntry } from "../api/client";
import { useAudit } from "../api/hooks";
import { ErrorAlert, PageHeader } from "../components/common";
import { formatDate, formatDateTime } from "../lib/format";

const PAGE_SIZE = 50;

const ACTIONS: Record<string, { label: string; color: string }> = {
  "auth.login": { label: "Вход", color: "blue" },
  "auth.login_failed": { label: "Неудачный вход", color: "red" },
  "auth.logout": { label: "Выход", color: "gray" },
  "recurring.create": { label: "Платёж создан", color: "teal" },
  "recurring.update": { label: "Платёж изменён", color: "yellow" },
  "recurring.delete": { label: "Платёж прекращён", color: "red" },
  "occurrence.pay": { label: "Оплата отмечена", color: "green" },
  "occurrence.unpay": { label: "Оплата отменена", color: "orange" },
  "occurrence.correct_date": { label: "Дата оплаты исправлена", color: "yellow" },
  "occurrence.receipt": { label: "Чек прикреплён", color: "cyan" },
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
];

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
      return [d.name && `название: «${d.name.from}» → «${d.name.to}»`, d.amount && `сумма: ${d.amount.from} → ${d.amount.to}`, d.schedule && `график: с ${iso(d.schedule.to.next_due_date)}`]
        .filter(Boolean)
        .join("; ");
    case "recurring.delete":
      return `«${d.name}»`;
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

export function AuditPage() {
  const isMobile = useIsMobile();
  const [action, setAction] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const audit = useAudit({ action: action ?? undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const total = audit.data?.total ?? 0;

  return (
    <>
      <PageHeader title="Журнал действий" description="Входы в систему и все изменения платежей и пользователей" />
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
            {(audit.data?.items ?? []).map((entry) => {
              const view = ACTIONS[entry.action] ?? { label: entry.action, color: "gray" };
              return (
                <Card key={entry.id} withBorder padding="xs">
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Badge color={view.color} variant="light" style={{ textTransform: "none" }}>
                      {view.label}
                    </Badge>
                    <Text size="xs" c="dimmed" className="nowrap tabular">
                      {formatDateTime(entry.at)}
                    </Text>
                  </Group>
                  <Text size="sm" mt={4}>
                    <Code>{entry.actor_label}</Code> {describe(entry)}
                  </Text>
                </Card>
              );
            })}
          </Stack>
        ) : (
        <Table.ScrollContainer minWidth={800}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Время</Table.Th>
                <Table.Th>Кто</Table.Th>
                <Table.Th>Событие</Table.Th>
                <Table.Th>Подробности</Table.Th>
                <Table.Th>IP</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(audit.data?.items ?? []).map((entry) => {
                const view = ACTIONS[entry.action] ?? { label: entry.action, color: "gray" };
                return (
                  <Table.Tr key={entry.id}>
                    <Table.Td className="nowrap tabular">{formatDateTime(entry.at)}</Table.Td>
                    <Table.Td>
                      <Code>{entry.actor_label}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={view.color} variant="light" style={{ textTransform: "none" }}>
                        {view.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed" lineClamp={2}>
                        {describe(entry)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {entry.ip ?? "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
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
