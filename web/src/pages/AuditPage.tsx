import { Badge, Card, Code, Group, Pagination, Select, Table, Text } from "@mantine/core";
import { useState } from "react";
import type { AuditEntry } from "../api/client";
import { useAudit } from "../api/hooks";
import { ErrorAlert, PageHeader } from "../components/common";
import { formatDateTime } from "../lib/format";

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

function describe(entry: AuditEntry): string {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "occurrence.pay":
    case "occurrence.unpay":
    case "occurrence.correct_date":
      return `срок ${d.due_date}${d.from ? `, было ${d.from}` : ""}${d.to ? `, стало ${d.to}` : ""}${d.via === "telegram" ? " (через Telegram)" : ""}`;
    case "recurring.create":
      return `${d.name}: ${d.amount} ${d.currency}, с ${d.next_due_date}`;
    case "reminder.sent":
      return `сроки: ${(d.due_dates as string[] | undefined)?.join(", ")}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d, null, 0) : "";
  }
}

export function AuditPage() {
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
        {total > PAGE_SIZE && (
          <Group justify="center" p="md">
            <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </Card>
    </>
  );
}
