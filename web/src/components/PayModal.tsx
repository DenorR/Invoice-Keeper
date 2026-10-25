import { ActionIcon, Alert, Button, Chip, FileInput, Group, Modal, Stack, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCalendar, IconExternalLink, IconFileTypePdf, IconInfoCircle, IconPaperclip, IconPhoto, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import type { Occurrence } from "../api/client";
import { useMeta, useReceiptFile, useUpdateOccurrence } from "../api/hooks";
import { formatBytes, formatDate, formatMoney, pluralDays } from "../lib/format";
import { notifyError, notifySuccess } from "./common";

export type PayMode = "pay" | "edit";

type Props = {
  occurrence: Occurrence | null;
  mode: PayMode;
  onClose: () => void;
};

/** Что можно прикрепить — проверяется и здесь (чтобы сразу подсказать), и на сервере (по содержимому файла). */
const RECEIPT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp";
const RECEIPT_EXT = /\.(pdf|png|jpe?g|webp)$/i;
const COMMENT_MAX = 1000;

/** Отметка оплаты или её правка: фактическая дата (не позже сегодня), чек ссылкой или файлом, комментарий. */
export function PayModal({ occurrence: incoming, mode, onClose }: Props) {
  // Окно всегда смонтировано и открывается через opened — так Mantine проигрывает плавное появление и исчезновение.
  // Пока окно закрывается, показываем последний период, чтобы содержимое не пропало раньше анимации.
  const last = useRef(incoming);
  if (incoming) last.current = incoming;
  const occurrence = incoming ?? last.current;
  return (
    <Modal opened={Boolean(incoming)} onClose={onClose} title={mode === "pay" ? "Отметить оплату" : "Изменить оплату"} centered>
      {occurrence && <PayForm occurrence={occurrence} incoming={incoming} mode={mode} onClose={onClose} />}
    </Modal>
  );
}

function PayForm({ occurrence, incoming, mode, onClose }: { occurrence: Occurrence; incoming: Occurrence | null; mode: PayMode; onClose: () => void }) {
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const uploadsEnabled = meta.data?.uploads_enabled ?? true;
  const maxMb = meta.data?.upload_max_mb ?? 10;
  const update = useUpdateOccurrence();
  const receiptFile = useReceiptFile();
  const [paidAt, setPaidAt] = useState<string | null>(today);
  const [receipt, setReceipt] = useState("");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);

  useEffect(() => {
    if (incoming) {
      setPaidAt(mode === "edit" && incoming.paid_at ? incoming.paid_at : today);
      setReceipt(incoming.receipt_url ?? "");
      setComment(incoming.comment ?? "");
      setFile(null);
      setRemoveFile(false);
    }
  }, [incoming, mode, today]);

  const lateDays = paidAt ? dayjs(paidAt).diff(dayjs(occurrence.due_date), "day") : 0;
  const fileError = !file
    ? null
    : !RECEIPT_EXT.test(file.name)
      ? "Можно только PDF, PNG, JPG или WebP"
      : file.size > maxMb * 1024 * 1024
        ? `Файл больше ${maxMb} МБ`
        : file.size === 0
          ? "Файл пустой"
          : null;
  const existing = occurrence.receipt_file && !removeFile ? occurrence.receipt_file : null;
  const busy = update.isPending || receiptFile.upload.isPending || receiptFile.remove.isPending;

  const submit = async () => {
    if (!paidAt || fileError) return;
    const receiptValue = receipt.trim();
    const commentValue = comment.trim();
    try {
      await update.mutateAsync({
        id: occurrence.id,
        body:
          mode === "pay"
            ? {
                paid: true,
                paid_at: paidAt,
                ...(receiptValue ? { receipt_url: receiptValue } : {}),
                ...(commentValue ? { comment: commentValue } : {}),
              }
            : { paid_at: paidAt, receipt_url: receiptValue || null, comment: commentValue || null },
      });
    } catch (error) {
      notifyError(error);
      return;
    }
    // оплата уже сохранена; файл — отдельным запросом, и его ошибка не должна теряться
    try {
      if (removeFile && occurrence.receipt_file && !file) await receiptFile.remove.mutateAsync(occurrence.id);
      if (file) await receiptFile.upload.mutateAsync({ id: occurrence.id, file });
    } catch (error) {
      notifyError(error);
      notifySuccess("Оплата сохранена, но файл не прикрепился — попробуйте ещё раз через «Изменить оплату»");
      onClose();
      return;
    }
    notifySuccess(
      mode === "pay"
        ? `${occurrence.name}: оплата за ${formatDate(occurrence.due_date)} отмечена`
        : `${occurrence.name}: оплата за ${formatDate(occurrence.due_date)} обновлена`,
    );
    onClose();
  };

  return (
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
          <Alert color="yellow" icon={<IconInfoCircle size={16} />} p="xs">
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

        {existing && !file ? (
          <div>
            <Text size="sm" fw={500} mb={4}>
              Файл чека
            </Text>
            <div className="ik-file">
              <span className="ik-file-icon" aria-hidden>
                {existing.content_type === "application/pdf" ? <IconFileTypePdf size={18} /> : <IconPhoto size={18} />}
              </span>
              <div className="ik-file-name">
                <Text size="sm" fw={500} truncate>
                  {existing.filename}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatBytes(existing.size)}
                  {existing.uploaded_by ? ` · ${existing.uploaded_by}` : ""}
                </Text>
              </div>
              <Tooltip label="Открыть">
                <ActionIcon component="a" href={existing.url} target="_blank" rel="noopener" variant="subtle" color="gray" aria-label="Открыть файл чека">
                  <IconExternalLink size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Убрать файл">
                <ActionIcon variant="subtle" color="red" onClick={() => setRemoveFile(true)} aria-label="Убрать файл чека">
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </div>
            {uploadsEnabled && (
              <FileInput
                mt={6}
                size="xs"
                variant="unstyled"
                accept={RECEIPT_ACCEPT}
                placeholder="Заменить другим файлом…"
                leftSection={<IconPaperclip size={14} />}
                value={file}
                onChange={setFile}
              />
            )}
          </div>
        ) : uploadsEnabled ? (
          <FileInput
            label="Файл чека"
            description={`PDF, PNG, JPG или WebP, до ${maxMb} МБ`}
            placeholder="Выбрать файл"
            accept={RECEIPT_ACCEPT}
            leftSection={<IconPaperclip size={16} />}
            value={file}
            onChange={(f) => {
              setFile(f);
              setRemoveFile(false);
            }}
            clearable
            error={fileError}
          />
        ) : (
          <Text size="xs" c="dimmed">
            Прикрепление файлов отключено администратором — можно указать ссылку на чек.
          </Text>
        )}
        {removeFile && occurrence.receipt_file && !file && (
          <Text size="xs" c="dimmed">
            Файл «{occurrence.receipt_file.filename}» будет удалён после сохранения.{" "}
            <Text span size="xs" c="blue" style={{ cursor: "pointer" }} onClick={() => setRemoveFile(false)}>
              Вернуть
            </Text>
          </Text>
        )}

        <Textarea
          label="Комментарий"
          placeholder="Например: оплачено с карты офиса, счёт №15"
          autosize
          minRows={2}
          maxRows={6}
          maxLength={COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.currentTarget.value)}
          description={comment.length > COMMENT_MAX - 100 ? `${comment.length} / ${COMMENT_MAX}` : undefined}
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={busy} disabled={!paidAt || Boolean(fileError)}>
            {mode === "pay" ? "Отметить оплату" : "Сохранить"}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
