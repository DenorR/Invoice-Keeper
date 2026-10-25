import { Alert, Box, Button, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconBellRinging, IconCoins, IconUsersGroup } from "@tabler/icons-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../auth";
import { AezaLogo, AezaMark } from "../components/Brand";

const FEATURES: { icon: ReactNode; text: string }[] = [
  { icon: <IconBellRinging size={20} stroke={2} />, text: "Напоминание в Telegram заранее: за сколько дней — решаете вы" },
  { icon: <IconCoins size={20} stroke={2} />, text: "RUB, USD и EUR — итоги отдельно по каждой валюте" },
  { icon: <IconUsersGroup size={20} stroke={2} />, text: "Администратор заводит платежи, команда отмечает оплату" },
];

function BrandPanel() {
  return (
    <aside className="login-brand">
      <AezaMark className="login-brand-watermark" aria-hidden />
      <AezaLogo height={40} variant="solid" style={{ alignSelf: "flex-start", position: "relative" }} />
      <Stack gap="lg" style={{ position: "relative" }}>
        <div className="login-brand-title">
          Invoice
          <br />
          Keeper
        </div>
        <Text size="lg" fw={500} maw={420}>
          Регулярные платежи без просрочек: аренда, серверы, подписки.
        </Text>
        <Stack gap="sm" mt="xs">
          {FEATURES.map((f) => (
            <Group key={f.text} gap="sm" wrap="nowrap">
              {f.icon}
              <Text fw={500}>{f.text}</Text>
            </Group>
          ))}
        </Stack>
      </Stack>
      <Text size="sm" fw={700} style={{ fontFamily: "var(--mantine-font-family-headings)", letterSpacing: "0.04em" }}>
        AÉZA · RND HACKATHON
      </Text>
    </aside>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <BrandPanel />
      <main className="login-form">
        <Box w="100%" maw={400}>
          {/* На узком экране голубой панели нет — логотип над формой */}
          <Stack align="center" gap="sm" mb="xl" hiddenFrom="md">
            <AezaLogo height={36} />
            <Text fw={700} size="lg" ff="heading">
              Invoice Keeper
            </Text>
          </Stack>
          <Paper withBorder shadow="sm" p="xl" radius="lg">
            <form onSubmit={submit}>
              <Stack>
                <Stack gap={4} mb="xs">
                  <Title order={2}>Вход в панель</Title>
                  <Text c="dimmed" size="sm">
                    Логин и пароль выдаёт администратор
                  </Text>
                </Stack>
                {error && (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} p="sm">
                    {error}
                  </Alert>
                )}
                <TextInput
                  label="Логин"
                  value={username}
                  onChange={(e) => setUsername(e.currentTarget.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
                <PasswordInput
                  label="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  autoComplete="current-password"
                  required
                />
                <Button type="submit" loading={loading} fullWidth mt="xs" size="md">
                  Войти
                </Button>
              </Stack>
            </form>
          </Paper>
        </Box>
      </main>
    </div>
  );
}
