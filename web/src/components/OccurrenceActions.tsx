import { ActionIcon, Button, Group, Menu, Tooltip, UnstyledButton } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconCheck, IconFileTypePdf, IconPencil, IconPhoto, IconReceipt } from "@tabler/icons-react";
import { useState } from "react";
import type { Occurrence } from "../api/client";
import { useUpdateOccurrence } from "../api/hooks";
import { formatDate, safeHttpUrl } from "../lib/format";
import { popFrom } from "../theme";
import { notifyError, notifySuccess } from "./common";
import { PayModal, type PayMode } from "./PayModal";

function useUnpay(occurrence: Occurrence) {
  const update = useUpdateOccurrence();
  return () =>
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
}

/**
 * Кружок-отметка в начале строки — как галочка в списке задач.
 * Не оплачено: нажатие открывает окно оплаты (дата, чек). Оплачено: меню «исправить дату / чек / отменить».
 */
export function PayCheck({ occurrence }: { occurrence: Occurrence }) {
  const [mode, setMode] = useState<PayMode | null>(null);
  const unpay = useUnpay(occurrence);
  const receiptUrl = safeHttpUrl(occurrence.receipt_url);
  const paid = occurrence.status === "paid";
  const tone = occurrence.state === "overdue" ? "red" : occurrence.state === "due_today" ? "yellow" : undefined;

  return (
    <>
      {paid ? (
        <Menu position="bottom-start" width={230} transitionProps={{ transition: popFrom("top left"), duration: 150 }}>
          <Menu.Target>
            <UnstyledButton className="ik-check" data-paid="" aria-label={`Оплачено ${formatDate(occurrence.paid_at)}: действия`}>
              <IconCheck size={14} stroke={3} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Оплачено {formatDate(occurrence.paid_at)}</Menu.Label>
            <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setMode("edit")}>
              Изменить: дата, чек, комментарий
            </Menu.Item>
            {occurrence.receipt_file && (
              <Menu.Item
                component="a"
                href={occurrence.receipt_file.url}
                target="_blank"
                rel="noopener"
                leftSection={occurrence.receipt_file.content_type === "application/pdf" ? <IconFileTypePdf size={16} /> : <IconPhoto size={16} />}
              >
                Открыть файл чека
              </Menu.Item>
            )}
            {receiptUrl && (
              <Menu.Item component="a" href={receiptUrl} target="_blank" rel="noopener noreferrer" leftSection={<IconReceipt size={16} />}>
                Открыть ссылку на чек
              </Menu.Item>
            )}
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconArrowBackUp size={16} />} onClick={unpay}>
              Отменить оплату
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ) : (
        <Tooltip label="Отметить оплату">
          <UnstyledButton className="ik-check" data-tone={tone} aria-label={`Отметить оплату: ${occurrence.name}`} onClick={() => setMode("pay")}>
            <IconCheck size={14} stroke={3} />
          </UnstyledButton>
        </Tooltip>
      )}
      <PayModal occurrence={mode ? occurrence : null} mode={mode ?? "pay"} onClose={() => setMode(null)} />
    </>
  );
}

/** Кнопки для места, где есть простор (панель дня в календаре): «Отметить оплату» / исправить / отменить. */
export function OccurrenceActions({ occurrence, compact = false }: { occurrence: Occurrence; compact?: boolean }) {
  const [mode, setMode] = useState<PayMode | null>(null);
  const unpay = useUnpay(occurrence);
  const receiptUrl = safeHttpUrl(occurrence.receipt_url);

  return (
    <>
      <Group gap={6} wrap="nowrap" justify="flex-end">
        {occurrence.receipt_file && (
          <Tooltip label={`Файл чека: ${occurrence.receipt_file.filename}`}>
            <ActionIcon component="a" href={occurrence.receipt_file.url} target="_blank" rel="noopener" variant="subtle" color="gray" aria-label="Файл чека">
              {occurrence.receipt_file.content_type === "application/pdf" ? <IconFileTypePdf size={18} /> : <IconPhoto size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {receiptUrl && (
          <Tooltip label="Ссылка на чек">
            <ActionIcon component="a" href={receiptUrl} target="_blank" rel="noopener noreferrer" variant="subtle" color="gray" aria-label="Чек">
              <IconReceipt size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {occurrence.status === "unpaid" ? (
          <Button size={compact ? "compact-sm" : "xs"} variant="default" leftSection={<IconCheck size={14} stroke={2.5} />} onClick={() => setMode("pay")}>
            Отметить оплату
          </Button>
        ) : (
          <>
            <Tooltip label="Изменить: дата, чек, комментарий">
              <ActionIcon variant="subtle" color="gray" onClick={() => setMode("edit")} aria-label="Изменить оплату">
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
