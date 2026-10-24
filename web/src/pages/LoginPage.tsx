import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import { IconAlertCircle, IconFileInvoice } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";

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
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" radius="lg" w="100%" maw={400}>
        <form onSubmit={submit}>
          <Stack>
            <Stack gap={6} align="center" mb="xs">
              <ThemeIcon size={52} radius="lg">
                <IconFileInvoice size={30} />
              </ThemeIcon>
              <Title order={2}>Invoice Keeper</Title>
              <Text c="dimmed" size="sm" ta="center">
                Регулярные платежи без просрочек
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
            <Button type="submit" loading={loading} fullWidth mt="xs">
              Войти
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
