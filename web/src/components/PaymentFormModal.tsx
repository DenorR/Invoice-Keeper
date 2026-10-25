import { Alert, Button, Collapse, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconBrandTelegram, IconCalendar, IconInfoCircle } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import type { Currency, Frequency, RecurringPayment, Schemas } from "../api/client";
import { useCategories, useCreateRecurring, useMeta, useUpdateRecurring } from "../api/hooks";
import { CURRENCIES, FREQUENCY_LABEL, REMIND_MAX, REMIND_MIN, formatDate, pluralDays } from "../lib/format";
import { notifyError, notifySuccess } from "./common";

type Props = {
  opened: boolean;
  payment: RecurringPayment | null; // null — создание
  onClose: () => void;
  /** Дата первого срока для нового платежа (например, день, выбранный в календаре). */
  initialDate?: string | null;
};

const CURRENCY_SYMBOL: Record<Currency, string> = { RUB: "₽", USD: "$", EUR: "€" };

export function PaymentFormModal({ opened, payment, onClose, initialDate }: Props) {
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const globalDays = meta.data?.reminder_days_before ?? 3;
  const categories = useCategories();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();

  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | string>("");
  const [currency, setCurrency] = useState<Currency>("RUB");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [touched, setTouched] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [ownRemind, setOwnRemind] = useState(false);
  const [remindInput, setRemindInput] = useState<number | string>("");

  useEffect(() => {
    if (!opened) return;
    setTouched(false);
    if (payment) {
      setName(payment.name);
      setAmount(Number(payment.amount));
      setCurrency(payment.currency);
      setDueDate(payment.next_due_date ?? today);
      setFrequency(payment.frequency);
      setCategoryId(payment.category_id !== null ? String(payment.category_id) : null);
      setOwnRemind(payment.remind_days !== null);
      setRemindInput(payment.remind_days ?? globalDays);
    } else {
      setName("");
      setAmount("");
      setCurrency("RUB");
      setDueDate(initialDate ?? today);
      setFrequency("monthly");
      setCategoryId(null);
      setOwnRemind(false);
      setRemindInput(globalDays);
    }
    // globalDays не в зависимостях: иначе фоновое обновление настроек сбросило бы введённое
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, payment, today, initialDate]);

  const amountNumber = typeof amount === "number" ? amount : Number(String(amount).replace(",", "."));
  const remindNumber = typeof remindInput === "number" ? remindInput : Number(remindInput);
  const ownRemindDays = ownRemind ? remindNumber : null;
  const remindDays = ownRemindDays ?? globalDays;
  const errors = {
    name: !name.trim() ? "Укажите название" : null,
    amount: !amountNumber || amountNumber <= 0 ? "Сумма должна быть больше нуля" : null,
    dueDate: !dueDate ? "Укажите дату" : payment && dueDate < today ? "Дата не может быть в прошлом" : null,
    remind: ownRemind && !(Number.isInteger(remindNumber) && remindNumber >= REMIND_MIN && remindNumber <= REMIND_MAX) ? `От ${REMIND_MIN} до ${REMIND_MAX} дней` : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const daysLeft = dueDate ? dayjs(dueDate).diff(dayjs(today), "day") : null;

  const submit = async () => {
    setTouched(true);
    if (hasErrors || !dueDate) return;
    const amountValue = amountNumber.toFixed(2);
    try {
      if (payment) {
        const body: Schemas["RecurringPaymentUpdate"] = {};
        if (name.trim() !== payment.name) body.name = name.trim();
        if (amountValue !== payment.amount) body.amount = amountValue;
        if (currency !== payment.currency) body.currency = currency;
        if (dueDate !== payment.next_due_date) body.next_due_date = dueDate;
        if (frequency !== payment.frequency) body.frequency = frequency;
        if (ownRemindDays !== payment.remind_days) body.remind_days = ownRemindDays;
        const nextCategory = categoryId ? Number(categoryId) : null;
        if (nextCategory !== payment.category_id) body.category_id = nextCategory;
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        await update.mutateAsync({ id: payment.id, body });
        notifySuccess(`Платёж «${name.trim()}» обновлён`);
      } else {
        await create.mutateAsync({
          name: name.trim(),
          amount: amountValue,
          currency,
          next_due_date: dueDate,
          frequency,
          ...(ownRemindDays !== null ? { remind_days: ownRemindDays } : {}),
          ...(categoryId ? { category_id: Number(categoryId) } : {}),
        });
        const telegramOn = meta.data?.telegram.chat_configured;
        const remindOn = dayjs(dueDate).subtract(remindDays, "day").format("YYYY-MM-DD");
        notifySuccess(
          !telegramOn
            ? "Telegram не настроен — напоминание не отправится, но платёж виден в панели"
            : daysLeft !== null && daysLeft <= remindDays
              ? "Срок близко — напоминание придёт в Telegram прямо сейчас"
              : `Напоминание придёт в Telegram ${formatDate(remindOn)}`,
          `Платёж «${name.trim()}» добавлен`,
        );
      }
      onClose();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={payment ? "Изменить регулярный платёж" : "Новый регулярный платёж"} centered size="md">
      <Stack>
        <TextInput
          label="Название"
          placeholder="Например, аренда офиса"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          error={touched && errors.name}
          required
          data-autofocus
        />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Валюта
          </Text>
          <SegmentedControl
            fullWidth
            value={currency}
            onChange={(v) => setCurrency(v as Currency)}
            data={CURRENCIES.map((c) => ({ value: c, label: `${c} ${CURRENCY_SYMBOL[c]}` }))}
          />
        </div>
        <NumberInput
          label="Сумма"
          placeholder="0,00"
          value={amount}
          onChange={setAmount}
          decimalScale={2}
          decimalSeparator=","
          thousandSeparator=" "
          min={0}
          hideControls
          rightSection={<Text c="dimmed" size="sm">{CURRENCY_SYMBOL[currency]}</Text>}
          error={touched && errors.amount}
          required
        />
        <Group grow align="flex-start">
          <DatePickerInput
            label="Дата ближайшей оплаты"
            leftSection={<IconCalendar size={16} />}
            value={dueDate}
            onChange={setDueDate}
            valueFormat="DD.MM.YYYY"
            minDate={payment ? today : undefined}
            error={touched && errors.dueDate}
            required
          />
          <Select
            label="Периодичность"
            value={frequency}
            onChange={(v) => v && setFrequency(v as Frequency)}
            data={(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))}
            allowDeselect={false}
          />
        </Group>

        {(categories.data ?? []).length > 0 && (
          <Select
            label="Категория"
            placeholder="Без категории"
            data={(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
            clearable
            searchable
            nothingFoundMessage="Нет такой категории"
          />
        )}

        <div>
          <Text size="sm" fw={500} mb={4}>
            Напоминание в Telegram
          </Text>
          <SegmentedControl
            fullWidth
            value={ownRemind ? "own" : "global"}
            onChange={(v) => setOwnRemind(v === "own")}
            data={[
              { value: "global", label: `Как в настройках · ${pluralDays(globalDays)}` },
              { value: "own", label: "Свой срок" },
            ]}
          />
          <Collapse expanded={ownRemind} transitionDuration={260}>
            <Group gap="sm" mt="sm" align="flex-start" wrap="nowrap">
              <NumberInput
                aria-label="За сколько дней до срока напоминать"
                value={remindInput}
                onChange={setRemindInput}
                min={REMIND_MIN}
                max={REMIND_MAX}
                allowDecimal={false}
                allowNegative={false}
                w={110}
                rightSection={<Text size="sm" c="dimmed">дн.</Text>}
                rightSectionWidth={40}
                error={touched && errors.remind}
              />
              <Text size="sm" c="dimmed" mt={8}>
                до срока — только для этого платежа
              </Text>
            </Group>
          </Collapse>
        </div>

        {daysLeft !== null && daysLeft < 0 && !payment && (
          <Alert color="yellow" icon={<IconInfoCircle size={16} />} p="xs">
            Дата в прошлом: все сроки до сегодняшнего дня появятся как просроченные (их можно сразу отметить оплаченными).
          </Alert>
        )}
        {daysLeft !== null && daysLeft >= 0 && daysLeft <= remindDays && meta.data?.telegram.chat_configured && (
          <Alert color="blue" icon={<IconBrandTelegram size={16} />} p="xs">
            {daysLeft === 0 ? "Срок сегодня" : `До срока ${pluralDays(daysLeft)}`} — напоминание в Telegram уйдёт сразу
            после сохранения.
          </Alert>
        )}
        {payment && (
          <Text size="xs" c="dimmed">
            Изменения коснутся будущих неоплаченных сроков. Уже оплаченные и прошлые остаются как были.
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={create.isPending || update.isPending}>
            {payment ? "Сохранить" : "Добавить платёж"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
