import { ActionIcon, Anchor, Badge, Button, Card, Group, Skeleton, Stack, Switch, Table, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPencil, IconPlayerStop, IconPlus, IconRepeat } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import type { RecurringPayment } from "../api/client";
import { useDeleteRecurring, useRecurring } from "../api/hooks";
import { useAuth } from "../auth";
import { ErrorAlert, Money, PageHeader, StatusBadge, notifyError, notifySuccess } from "../components/common";
import { PaymentFormModal } from "../components/PaymentFormModal";
import { FREQUENCY_LABEL, formatDate, pluralPeriods } from "../lib/format";

export function RecurringPage() {
  const { isAdmin } = useAuth();
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
          Новые периоды и напоминания больше не появятся. История оплат сохранится и останется в списке платежей.
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

  return (
    <>
      <PageHeader
        title="Регулярные платежи"
        description="Аренда, подписки, серверы и другие периодические расходы"
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

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Название</Table.Th>
                <Table.Th ta="right">Сумма</Table.Th>
                <Table.Th>Периодичность</Table.Th>
                <Table.Th>Ближайшая оплата</Table.Th>
                <Table.Th>Состояние</Table.Th>
                {isAdmin && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recurring.isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <Table.Tr key={i}>
                    <Table.Td colSpan={6}>
                      <Skeleton h={24} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              {items.map((p) => (
                <Table.Tr key={p.id} className={p.is_active ? undefined : "row-muted"}>
                  <Table.Td>
                    <Anchor component={Link} to={`/payments?payment=${p.id}`} fw={600} size="sm">
                      {p.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Money amount={p.amount} currency={p.currency} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{FREQUENCY_LABEL[p.frequency]}</Text>
                  </Table.Td>
                  <Table.Td className="nowrap tabular">{p.is_active ? formatDate(p.next_due_date) : "—"}</Table.Td>
                  <Table.Td>
                    {!p.is_active ? (
                      <Badge variant="outline" color="gray">
                        Прекращён {formatDate(p.deleted_at)}
                      </Badge>
                    ) : p.overdue_count > 0 ? (
                      <Badge color="red">Просрочено: {pluralPeriods(p.overdue_count)}</Badge>
                    ) : p.next_occurrence ? (
                      <StatusBadge occurrence={p.next_occurrence} />
                    ) : (
                      <Badge color="green" variant="light">
                        Оплачено
                      </Badge>
                    )}
                  </Table.Td>
                  {isAdmin && (
                    <Table.Td>
                      {p.is_active && (
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
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {!recurring.isLoading && items.length === 0 && (
          <Stack align="center" py={48} gap={6}>
            <IconRepeat size={36} color="var(--mantine-color-gray-5)" />
            <Text fw={600}>Регулярных платежей пока нет</Text>
            {isAdmin && (
              <Button variant="light" onClick={openCreate} leftSection={<IconPlus size={16} />}>
                Добавить первый платёж
              </Button>
            )}
          </Stack>
        )}
      </Card>

      {isAdmin && <PaymentFormModal opened={formOpened} payment={editing} onClose={() => setFormOpened(false)} />}
    </>
  );
}
