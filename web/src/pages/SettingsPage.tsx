import { Button, Card, Chip, Group, NumberInput, Skeleton, Switch, Text } from "@mantine/core";
import { IconBellRinging, IconBrandTelegram, IconPaperclip } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMeta, useRecurring, useSettings, useUpdateSettings } from "../api/hooks";
import { ErrorAlert, Notice, PageHeader, Section, notifyError, notifySuccess } from "../components/common";
import { REMIND_MAX, REMIND_MIN, pluralDays } from "../lib/format";

const PRESETS = [3, 5, 7, 10, 14, 30];

/** Настройки администратора: пока это окно напоминания в Telegram. */
export function SettingsPage() {
  const settings = useSettings();
  const meta = useMeta();
  const update = useUpdateSettings();
  const recurring = useRecurring();
  const saved = settings.data?.reminder_days_before;
  const [days, setDays] = useState<number | string>("");

  useEffect(() => {
    if (saved !== undefined) setDays(saved);
  }, [saved]);

  const value = typeof days === "number" ? days : Number(days);
  const valid = Number.isInteger(value) && value >= REMIND_MIN && value <= REMIND_MAX;
  const changed = valid && value !== saved;
  const own = (recurring.data ?? []).filter((p) => p.remind_days !== null);
  const tg = meta.data?.telegram;

  // переключатель меняется сразу, не дожидаясь ответа сервера; при ошибке возвращается назад
  const [uploadsDraft, setUploadsDraft] = useState<boolean | null>(null);
  const uploadsOn = uploadsDraft ?? settings.data?.uploads_enabled ?? true;
  const toggleUploads = async (enabled: boolean) => {
    setUploadsDraft(enabled);
    try {
      await update.mutateAsync({ uploads_enabled: enabled });
      notifySuccess(enabled ? "К оплатам снова можно прикреплять файлы чеков" : "Новые файлы прикрепить нельзя, уже прикреплённые открываются", "Настройки сохранены");
    } catch (error) {
      notifyError(error);
    } finally {
      setUploadsDraft(null);
    }
  };

  const save = async () => {
    try {
      await update.mutateAsync({ reminder_days_before: value });
      notifySuccess(`Бот будет напоминать за ${pluralDays(value)} до срока`, "Настройки сохранены");
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <>
      <PageHeader title="Настройки" description="Когда бот напоминает о платежах в Telegram" />
      <ErrorAlert error={settings.error} />

      {tg && !tg.chat_configured && (
        <div style={{ marginBottom: 24 }}>
          <Notice icon={<IconBrandTelegram size={18} />}>
            <Text size="sm" fw={600}>
              Telegram пока не настроен
            </Text>
            <Text size="sm" c="dimmed">
              Настройка сохранится и начнёт работать, как только в .env появятся TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
            </Text>
          </Notice>
        </div>
      )}

      <Card padding={0} className="ik-settings">
        <div className="ik-settings-body">
          <div className="ik-settings-head">
            <span className="ik-settings-icon" aria-hidden>
              <IconBellRinging size={20} stroke={1.75} />
            </span>
            <div>
              <h2 className="ik-block-title" style={{ margin: 0 }}>
                За сколько дней напоминать
              </h2>
              <Text size="sm" c="dimmed" mt={4}>
                Действует для всех платежей, у которых не задан свой срок. Свой срок ставится в карточке платежа.
              </Text>
            </div>
          </div>

          {settings.isLoading ? (
            <Skeleton h={76} />
          ) : (
            <div className="ik-settings-controls">
              <NumberInput
                label="Дней до срока"
                value={days}
                onChange={setDays}
                min={REMIND_MIN}
                max={REMIND_MAX}
                allowDecimal={false}
                allowNegative={false}
                clampBehavior="strict"
                w={160}
                rightSection={<Text size="sm" c="dimmed">дн.</Text>}
                rightSectionWidth={44}
                error={!valid && days !== "" ? `От ${REMIND_MIN} до ${REMIND_MAX}` : null}
              />
              <div>
                <Text size="sm" fw={500} mb={6}>
                  Быстрый выбор
                </Text>
                <Chip.Group value={String(value)} onChange={(v) => setDays(Number(v))}>
                  <Group gap={6}>
                    {PRESETS.map((n) => (
                      <Chip key={n} value={String(n)} size="sm" variant="light">
                        {pluralDays(n)}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </div>
            </div>
          )}

          <Text size="sm" c="dimmed">
            {valid
              ? `Например, о платеже со сроком 20-го бот напишет ${20 - value > 0 ? `${20 - value}-го` : "заранее, в прошлом месяце"}. Если срок уже ближе — напомнит сразу.`
              : `Укажите число дней от ${REMIND_MIN} до ${REMIND_MAX}: напоминать позже чем за ${pluralDays(REMIND_MIN)} нельзя.`}
          </Text>
        </div>
        <div className="ik-settings-foot">
          <Text size="xs" c="dimmed">
            По умолчанию — {pluralDays(settings.data?.reminder_days_default ?? 3)} (REMINDER_DAYS_BEFORE в .env)
          </Text>
          <Group gap="xs">
            {changed && (
              <Button variant="default" onClick={() => setDays(saved ?? 3)}>
                Отменить
              </Button>
            )}
            <Button onClick={save} disabled={!changed} loading={update.isPending}>
              Сохранить
            </Button>
          </Group>
        </div>
      </Card>

      <Card padding={0} className="ik-settings" mt="lg">
        <div className="ik-settings-body">
          <div className="ik-settings-head">
            <span className="ik-settings-icon" aria-hidden>
              <IconPaperclip size={20} stroke={1.75} />
            </span>
            <div style={{ flex: 1 }}>
              <h2 className="ik-block-title" style={{ margin: 0 }}>
                Файлы чеков
              </h2>
              <Text size="sm" c="dimmed" mt={4}>
                К оплате можно прикрепить PDF, PNG, JPG или WebP до {settings.data?.upload_max_mb ?? 10} МБ. Тип проверяется по
                содержимому файла: программы, скрипты, архивы и PDF со скриптами отклоняются.
              </Text>
            </div>
          </div>
          {settings.isLoading ? (
            <Skeleton h={24} w={260} />
          ) : (
            <Switch
              label="Разрешить прикреплять файлы"
              description="Если выключить, уже прикреплённые файлы по-прежнему открываются"
              checked={uploadsOn}
              onChange={(e) => void toggleUploads(e.currentTarget.checked)}
            />
          )}
        </div>
      </Card>

      <Section title="Платежи со своим сроком напоминания">
        <Card padding={0}>
          {recurring.isLoading ? (
            <Skeleton h={48} m="md" />
          ) : own.length === 0 ? (
            <Text size="sm" c="dimmed" p="lg">
              Таких нет — для всех платежей действует общая настройка.
            </Text>
          ) : (
            own.map((p) => (
              <div key={p.id} className="ik-settings-row">
                <Link to={`/payments?tab=all&payment=${p.id}`} className="ik-link ik-item-title">
                  {p.name}
                </Link>
                <Text size="sm" fw={600} className="nowrap">
                  за {pluralDays(p.remind_days_effective)}
                </Text>
              </div>
            ))
          )}
        </Card>
      </Section>
    </>
  );
}
