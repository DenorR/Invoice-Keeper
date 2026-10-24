import { ActionIcon, Anchor, Badge, Button, Card, Group, Skeleton, Stack, Switch, Table, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconBrandTelegram, IconPencil, IconPlayerStop, IconPlus, IconRepeat } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useState } from "react";
import { Link } from "react-router";
import type { RecurringPayment } from "../api/client";
import { useDeleteRecurring, useMeta, useRecurring } from "../api/hooks";
import { useAuth } from "../auth";
import { ErrorAlert, Money, PageHeader, StatusBadge, notifyError, notifySuccess } from "../components/common";
import { useIsMobile } from "../components/OccurrenceList";
import { PaymentFormModal } from "../components/PaymentFormModal";
import { FREQUENCY_LABEL, formatDate, pluralPayments, weekday } from "../lib/format";

function StateBadge({ p }: { p: RecurringPayment }) {
  if (!p.is_active)
    return (
      <Badge variant="outline" color="gray">
        Прекращён {formatDate(p.deleted_at)}
      </Badge>
    );
  if (p.overdue_count > 0) return <Badge color="red">Просрочено: {pluralPayments(p.overdue_count)}</Badge>;
  if (p.next_occurrence) return <StatusBadge occurrence={p.next_occurrence} />;
  return (
    <Badge color="green" variant="light">
      Оплачено
    </Badge>
  );
}

/** Когда бот напомнит о ближайшем неоплаченном сроке. */
function ReminderInfo({ p, today, remindDays, telegramOn }: { p: RecurringPayment; today: string; remindDays: number; telegramOn: boolean }) {
  const next = p.next_occurrence;
  if (!p.is_active || !next) return <Text size="sm" c="dimmed">—</Text>;
  if (!telegramOn && !next.reminder_sent_at)
    return (
      <Text size="sm" c="dimmed">
        Telegram не настроен
      </Text>
    );
  if (next.reminder_sent_at)
    return (
      <Group gap={4} wrap="nowrap">
        <IconBrandTelegram size={14} color="var(--mantine-color-blue-5)" />
        <Text size="sm">отправлено {formatDate(next.reminder_sent_at)}</Text>
      </Group>
    );
  const when = dayjs(next.due_date).subtract(remindDays, "day").format("YYYY-MM-DD");
  return <Text size="sm">{when <= today ? "в ближайшую минуту" : `${formatDate(when)}, ${weekday(when)}`}</Text>;
}

export function RecurringPage() {
  const { isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const remindDays = meta.data?.reminder_days_before ?? 3;
  const [showStopped, setShowStopped] = useState(false);
  const recurring = useRecurring(showStopped);
  const remove = useDeleteRecurring();
  const [editing, setEditing] = useState<RecurringPayment | null>(null);
  const [formOpened, setFormOpened] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFormOpened(true);
  };
  const openEdit = (payment: RecurringPayment) => {
    setEditing(payment);
    setFormOpened(true);
  };
  const stop = (payment: RecurringPayment) =>
    modals.openConfirmModal({
      title: `Прекратить «${payment.name}»?`,
      children: (
        <Text size="sm">
          Новых сроков и напоминаний по этому платежу больше не будет. Уже отмеченные оплаты сохранятся в истории.
        </Text>
      ),
      labels: { confirm: "Прекратить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await remove.mutateAsync(payment.id);
          notifySuccess(`Платёж «${payment.name}» прекращён`);
        } catch (error) {
          notifyError(error);
        }
      },
    });

  const items = recurring.data ?? [];

  const adminActions = (p: RecurringPayment) =>
    p.is_active && (
      <Group gap={4} justify="flex-end" wrap="nowrap">
        <Tooltip label="Изменить">
          <ActionIcon variant="subtle" onClick={() => openEdit(p)} aria-label="Изменить">
            <IconPencil size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Прекратить">
          <ActionIcon variant="subtle" color="red" onClick={() => stop(p)} aria-label="Прекратить">
            <IconPlayerStop size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );

  return (
    <>
      <PageHeader
        title="Регулярные платежи"
        description="Что и как часто нужно платить: аренда, подписки, серверы. По ним система сама создаёт сроки оплаты"
        actions={
          <>
            <Switch label="Показать прекращённые" checked={showStopped} onChange={(e) => setShowStopped(e.currentTarget.checked)} />
            {isAdmin && (
              <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
                Добавить платёж
              </Button>
            )}
          </>
        }
      />

      <ErrorAlert error={recurring.error} />

      {isMobile ? (
        <Stack gap="xs">
          {recurring.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={110} />)}
          {items.map((p) => (
            <Card key={p.id} withBorder padding="sm" style={{ opacity: p.is_active ? 1 : 0.65 }}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Anchor component={Link} to={`/payments?tab=all&payment=${p.id}`} fw={700} size="sm">
                  {p.name}
                </Anchor>
                <Money amount={p.amount} currency={p.currency} />
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                {FREQUENCY_LABEL[p.frequency]}
                {p.is_active && p.next_due_date ? ` · ближайшая оплата ${formatDate(p.next_due_date)}` : ""}
              </Text>
              <Group justify="space-between" mt="xs">
                <StateBadge p={p} />
                {isAdmin && adminActions(p)}
              </Group>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={900}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Название</Table.Th>
                  <Table.Th ta="right">Сумма</Table.Th>
                  <Table.Th>Периодичность</Table.Th>
                  <Table.Th>Ближайшая оплата</Table.Th>
                  <Table.Th>Напоминание</Table.Th>
                  <Table.Th>Состояние</Table.Th>
                  {isAdmin && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {recurring.isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <Table.Tr key={i}>
                      <Table.Td colSpan={7}>
                        <Skeleton h={24} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                {items.map((p) => (
                  <Table.Tr key={p.id} className={p.is_active ? undefined : "row-muted"}>
                    <Table.Td>
                      <Tooltip label="Показать все сроки этого платежа">
                        <Anchor component={Link} to={`/payments?tab=all&payment=${p.id}`} fw={600} size="sm">
                          {p.name}
                        </Anchor>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Money amount={p.amount} currency={p.currency} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{FREQUENCY_LABEL[p.frequency]}</Text>
                    </Table.Td>
                    <Table.Td className="nowrap tabular">
                      {p.is_active && p.next_due_date ? `${formatDate(p.next_due_date)}, ${weekday(p.next_due_date)}` : "—"}
                    </Table.Td>
                    <Table.Td>
                      <ReminderInfo p={p} today={today} remindDays={remindDays} telegramOn={Boolean(meta.data?.telegram.chat_configured)} />
                    </Table.Td>
                    <Table.Td>
                      <StateBadge p={p} />
                    </Table.Td>
                    {isAdmin && <Table.Td>{adminActions(p)}</Table.Td>}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {!recurring.isLoading && items.length === 0 && (
        <Stack align="center" py={48} gap={6}>
          <IconRepeat size={36} color="var(--mantine-color-gray-5)" />
          <Text fw={600}>Регулярных платежей пока нет</Text>
          {isAdmin ? (
            <Button variant="light" onClick={openCreate} leftSection={<IconPlus size={16} />}>
              Добавить первый платёж
            </Button>
          ) : (
            <Text size="sm" c="dimmed">
              Их добавляет администратор
            </Text>
          )}
        </Stack>
      )}

      {isAdmin && <PaymentFormModal opened={formOpened} payment={editing} onClose={() => setFormOpened(false)} />}
    </>
  );
}
