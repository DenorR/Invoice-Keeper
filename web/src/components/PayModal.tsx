import { Alert, Button, Chip, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCalendar, IconInfoCircle } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import type { Occurrence } from "../api/client";
import { useMeta, useUpdateOccurrence } from "../api/hooks";
import { formatDate, formatMoney, pluralDays } from "../lib/format";
import { notifyError, notifySuccess } from "./common";

export type PayMode = "pay" | "edit";

type Props = {
  occurrence: Occurrence | null;
  mode: PayMode;
  onClose: () => void;
};

/** Отметка оплаты или исправление фактической даты. Дата не может быть позже сегодняшней. */
export function PayModal({ occurrence, mode, onClose }: Props) {
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const update = useUpdateOccurrence();
  const [paidAt, setPaidAt] = useState<string | null>(today);
  const [receipt, setReceipt] = useState("");

  useEffect(() => {
    if (occurrence) {
      setPaidAt(mode === "edit" && occurrence.paid_at ? occurrence.paid_at : today);
      setReceipt(occurrence.receipt_url ?? "");
    }
  }, [occurrence, mode, today]);

  if (!occurrence) return null;

  const lateDays = paidAt ? dayjs(paidAt).diff(dayjs(occurrence.due_date), "day") : 0;

  const submit = async () => {
    if (!paidAt) return;
    const receiptValue = receipt.trim();
    try {
      await update.mutateAsync({
        id: occurrence.id,
        body:
          mode === "pay"
            ? { paid: true, paid_at: paidAt, ...(receiptValue ? { receipt_url: receiptValue } : {}) }
            : { paid_at: paidAt, receipt_url: receiptValue || null },
      });
      notifySuccess(
        mode === "pay"
          ? `${occurrence.name}: оплата за ${formatDate(occurrence.due_date)} отмечена`
          : `${occurrence.name}: фактическая дата изменена на ${formatDate(paidAt)}`,
      );
      onClose();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Modal opened onClose={onClose} title={mode === "pay" ? "Отметить оплату" : "Исправить дату оплаты"} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
      <Stack>
        <div>
          <Text fw={600}>{occurrence.name}</Text>
          <Text size="sm" c="dimmed">
            Срок {formatDate(occurrence.due_date)} · {formatMoney(occurrence.amount, occurrence.currency)}
          </Text>
          {mode === "edit" && (
            <Text size="xs" c="dimmed" mt={4}>
              Срок оплаты не меняется — пересчитается только просрочка.
            </Text>
          )}
        </div>
        <DatePickerInput
          label="Фактическая дата оплаты"
          leftSection={<IconCalendar size={16} />}
          value={paidAt}
          onChange={setPaidAt}
          maxDate={today}
          valueFormat="DD.MM.YYYY"
          required
          data-autofocus
        />
        <Group gap="xs">
          <Chip size="xs" checked={paidAt === today} onChange={() => setPaidAt(today)}>
            Сегодня
          </Chip>
          {occurrence.due_date <= today && occurrence.due_date !== today && (
            <Chip size="xs" checked={paidAt === occurrence.due_date} onChange={() => setPaidAt(occurrence.due_date)}>
              В день срока ({formatDate(occurrence.due_date)})
            </Chip>
          )}
        </Group>
        {paidAt && lateDays > 0 ? (
          <Alert color="orange" icon={<IconInfoCircle size={16} />} p="xs">
            Оплата позже срока — будет отмечена просрочка {pluralDays(lateDays)}.
          </Alert>
        ) : (
          paidAt && (
            <Alert color="green" icon={<IconInfoCircle size={16} />} p="xs">
              Оплата в срок — без просрочки.
            </Alert>
          )
        )}
        <TextInput
          label="Ссылка на чек или платёжку"
          placeholder="https://…"
          description="Необязательно"
          value={receipt}
          onChange={(e) => setReceipt(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={update.isPending} disabled={!paidAt}>
            {mode === "pay" ? "Отметить оплату" : "Сохранить"}
          </Button>
        </Group>
      </Stack>
      </form>
    </Modal>
  );
}
