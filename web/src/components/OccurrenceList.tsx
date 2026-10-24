import { Badge, Card, Group, Skeleton, Stack, Table, Text, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconBrandTelegram, IconInbox } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { Occurrence } from "../api/client";
import { formatDate, weekday } from "../lib/format";
import { Money, StatusBadge } from "./common";
import { OccurrenceActions } from "./OccurrenceActions";

export type OccurrenceGroup = { key: string; title: ReactNode; items: Occurrence[] };

type Props = {
  groups: OccurrenceGroup[];
  loading?: boolean;
  /** Колонки «Дата оплаты» и «Отметил» — для истории. */
  showPaidInfo?: boolean;
  empty?: ReactNode;
};

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 48em)") ?? false;
}

function DueDate({ o }: { o: Occurrence }) {
  return (
    <Text size="sm" className="nowrap tabular">
      {formatDate(o.due_date)}{" "}
      <Text span size="xs" c="dimmed">
        {weekday(o.due_date)}
      </Text>
    </Text>
  );
}

function NameCell({ o }: { o: Occurrence }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="sm" fw={600} lineClamp={2}>
        {o.name}
      </Text>
      {!o.payment_active && (
        <Badge size="xs" variant="outline" color="gray">
          прекращён
        </Badge>
      )}
      {o.reminder_sent_at && o.status === "unpaid" && (
        <Tooltip label={`Напоминание отправлено в Telegram ${formatDate(o.reminder_sent_at)}`}>
          <IconBrandTelegram size={16} color="var(--mantine-color-blue-5)" style={{ flexShrink: 0 }} />
        </Tooltip>
      )}
    </Group>
  );
}

function PaidInfo({ o }: { o: Occurrence }) {
  if (!o.paid_at) return null;
  return (
    <Text size="xs" c="dimmed">
      Оплачено {formatDate(o.paid_at)}
      {o.paid_by?.label ? ` · ${o.paid_by.label}` : ""}
      {o.paid_via === "telegram" ? " · через Telegram" : ""}
    </Text>
  );
}

function MobileCard({ o }: { o: Occurrence }) {
  return (
    <Card withBorder padding="sm" radius="md" style={{ opacity: o.payment_active ? 1 : 0.65 }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <NameCell o={o} />
        <Money amount={o.amount} currency={o.currency} />
      </Group>
      <Group justify="space-between" mt={6} gap="xs">
        <Text size="sm" c="dimmed" className="tabular">
          срок {formatDate(o.due_date)}, {weekday(o.due_date)}
        </Text>
        <StatusBadge occurrence={o} />
      </Group>
      {o.paid_at && (
        <div style={{ marginTop: 4 }}>
          <PaidInfo o={o} />
        </div>
      )}
      <Group justify="flex-end" mt="xs">
        <OccurrenceActions occurrence={o} />
      </Group>
    </Card>
  );
}

export function OccurrenceList({ groups, loading, showPaidInfo = false, empty }: Props) {
  const isMobile = useIsMobile();
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const showTitles = groups.length > 1 || groups.some((g) => g.title);

  if (loading) {
    return (
      <Stack gap="xs" p={isMobile ? 0 : "md"}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} h={isMobile ? 96 : 36} />
        ))}
      </Stack>
    );
  }

  if (total === 0) {
    return (
      <>
        {empty ?? (
          <Stack align="center" py={48} gap={4}>
            <IconInbox size={36} color="var(--mantine-color-gray-5)" />
            <Text fw={600}>Ничего не найдено</Text>
          </Stack>
        )}
      </>
    );
  }

  if (isMobile) {
    return (
      <Stack gap="md">
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <Stack key={g.key} gap="xs">
              {showTitles && g.title && <div>{g.title}</div>}
              {g.items.map((o) => (
                <MobileCard key={o.id} o={o} />
              ))}
            </Stack>
          ))}
      </Stack>
    );
  }

  const columns = showPaidInfo ? 7 : 5;
  return (
    <Table.ScrollContainer minWidth={showPaidInfo ? 880 : 640}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={130}>Срок</Table.Th>
            <Table.Th>Платёж</Table.Th>
            <Table.Th ta="right">Сумма</Table.Th>
            <Table.Th>Статус</Table.Th>
            {showPaidInfo && <Table.Th>Дата оплаты</Table.Th>}
            {showPaidInfo && <Table.Th>Отметил</Table.Th>}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups
            .filter((g) => g.items.length)
            .map((g) => [
              showTitles && g.title ? (
                <Table.Tr key={`group-${g.key}`} style={{ background: "var(--mantine-color-default-hover)" }}>
                  <Table.Td colSpan={columns} py={6}>
                    {g.title}
                  </Table.Td>
                </Table.Tr>
              ) : null,
              ...g.items.map((o) => (
                <Table.Tr key={o.id} className={o.payment_active ? undefined : "row-muted"}>
                  <Table.Td>
                    <DueDate o={o} />
                  </Table.Td>
                  <Table.Td>
                    <NameCell o={o} />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Money amount={o.amount} currency={o.currency} />
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge occurrence={o} />
                  </Table.Td>
                  {showPaidInfo && <Table.Td className="nowrap tabular">{formatDate(o.paid_at)}</Table.Td>}
                  {showPaidInfo && (
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {o.paid_by?.label ?? "—"}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <OccurrenceActions occurrence={o} compact />
                  </Table.Td>
                </Table.Tr>
              )),
            ])}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
