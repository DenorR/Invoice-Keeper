import { Alert, Badge, Group, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { Currency, Occurrence } from "../api/client";
import { formatMoney, stateView } from "../lib/format";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
      <Stack gap={4}>
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        )}
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}

export function StatusBadge({ occurrence }: { occurrence: Pick<Occurrence, "state" | "overdue_days" | "days_until_due"> }) {
  const view = stateView(occurrence.state, occurrence);
  return (
    <Badge color={view.color} variant={view.variant} radius="sm" style={{ textTransform: "none" }}>
      {view.label}
    </Badge>
  );
}

export function Money({ amount, currency, fw = 600 }: { amount: string; currency: Currency; fw?: number }) {
  return (
    <Text span fw={fw} className="tabular nowrap">
      {formatMoney(amount, currency)}
    </Text>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Не удалось загрузить данные" mb="md">
      {error instanceof Error ? error.message : String(error)}
    </Alert>
  );
}

export function notifySuccess(message: string, title?: string) {
  notifications.show({ color: "green", title, message, icon: <IconCheck size={18} /> });
}

export function notifyError(error: unknown) {
  notifications.show({
    color: "red",
    title: "Ошибка",
    message: error instanceof Error ? error.message : String(error),
    icon: <IconX size={18} />,
  });
}
