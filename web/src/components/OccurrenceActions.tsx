import { ActionIcon, Button, Group, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconCheck, IconPencil, IconReceipt } from "@tabler/icons-react";
import { useState } from "react";
import type { Occurrence } from "../api/client";
import { useUpdateOccurrence } from "../api/hooks";
import { formatDate } from "../lib/format";
import { notifyError, notifySuccess } from "./common";
import { PayModal, type PayMode } from "./PayModal";

/** Кнопки «Оплачено» / «Исправить дату» / «Отменить оплату» для строки периода. */
export function OccurrenceActions({ occurrence, compact = false }: { occurrence: Occurrence; compact?: boolean }) {
  const [mode, setMode] = useState<PayMode | null>(null);
  const update = useUpdateOccurrence();

  const unpay = () =>
    modals.openConfirmModal({
      title: "Отменить оплату?",
      children: `${occurrence.name}, срок ${formatDate(occurrence.due_date)}. Фактическая дата оплаты будет очищена.`,
      labels: { confirm: "Отменить оплату", cancel: "Не отменять" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await update.mutateAsync({ id: occurrence.id, body: { paid: false } });
          notifySuccess(`${occurrence.name}: отметка об оплате снята`);
        } catch (error) {
          notifyError(error);
        }
      },
    });

  return (
    <>
      <Group gap={6} wrap="nowrap" justify="flex-end">
        {occurrence.receipt_url && (
          <Tooltip label="Чек / платёжка">
            <ActionIcon component="a" href={occurrence.receipt_url} target="_blank" variant="subtle" aria-label="Чек">
              <IconReceipt size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {occurrence.status === "unpaid" ? (
          <Button size={compact ? "compact-sm" : "xs"} leftSection={<IconCheck size={14} />} onClick={() => setMode("pay")}>
            Оплачено
          </Button>
        ) : (
          <>
            <Tooltip label="Исправить фактическую дату">
              <ActionIcon variant="subtle" onClick={() => setMode("edit")} aria-label="Исправить дату">
                <IconPencil size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Отменить оплату">
              <ActionIcon variant="subtle" color="red" onClick={unpay} aria-label="Отменить оплату">
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
      </Group>
      <PayModal occurrence={mode ? occurrence : null} mode={mode ?? "pay"} onClose={() => setMode(null)} />
    </>
  );
}
