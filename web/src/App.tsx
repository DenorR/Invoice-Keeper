import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Center,
  Group,
  Loader,
  Menu,
  NavLink as MantineNavLink,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCalendarMonth,
  IconChevronDown,
  IconFileInvoice,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconRepeat,
  IconReceipt2,
  IconSun,
  IconUsers,
  IconApi,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth";
import { AuditPage } from "./pages/AuditPage";
import { CalendarPage } from "./pages/CalendarPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OccurrencesPage } from "./pages/OccurrencesPage";
import { RecurringPage } from "./pages/RecurringPage";
import { UsersPage } from "./pages/UsersPage";

type NavItem = { to: string; label: string; icon: ReactNode; adminOnly?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Главная", icon: <IconLayoutDashboard size={18} /> },
  { to: "/payments", label: "Платежи", icon: <IconReceipt2 size={18} /> },
  { to: "/recurring", label: "Регулярные платежи", icon: <IconRepeat size={18} /> },
  { to: "/calendar", label: "Календарь", icon: <IconCalendarMonth size={18} /> },
  { to: "/users", label: "Пользователи", icon: <IconUsers size={18} />, adminOnly: true },
  { to: "/audit", label: "Журнал действий", icon: <IconHistory size={18} />, adminOnly: true },
];

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  return (
    <Tooltip label={scheme === "dark" ? "Светлая тема" : "Тёмная тема"}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Переключить тему"
        onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}
      >
        {scheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <Menu position="bottom-end" width={220}>
      <Menu.Target>
        <UnstyledButton>
          <Group gap={8}>
            <Stack gap={0} align="flex-end" visibleFrom="xs">
              <Text size="sm" fw={600} lh={1.2}>
                {user.name || user.login}
              </Text>
              <Text size="xs" c="dimmed" lh={1.2}>
                {user.role === "admin" ? "Администратор" : "Пользователь"}
              </Text>
            </Stack>
            <IconChevronDown size={16} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Вы вошли как {user.login}</Menu.Label>
        <Menu.Item component="a" href="/api/v1/docs" target="_blank" leftSection={<IconApi size={16} />}>
          Документация API
        </Menu.Item>
        <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => void logout()}>
          Выйти
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const { isAdmin } = useAuth();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <ThemeIcon size={34} radius="md" variant="filled">
              <IconFileInvoice size={20} />
            </ThemeIcon>
            <Text fw={800} size="lg">
              Invoice Keeper
            </Text>
            {isAdmin && (
              <Badge variant="light" color="grape" visibleFrom="sm">
                admin
              </Badge>
            )}
          </Group>
          <Group gap="sm" wrap="nowrap">
            <ColorSchemeToggle />
            <UserMenu />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
          <MantineNavLink
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === "/"}
            label={item.label}
            leftSection={item.icon}
            className="nav-link"
            active={item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)}
            onClick={close}
            style={{ borderRadius: "var(--mantine-radius-md)" }}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/payments" element={<OccurrencesPage />} />
        <Route path="/recurring" element={<RecurringPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/users" element={<AdminOnly><UsersPage /></AdminOnly>} />
        <Route path="/audit" element={<AdminOnly><AuditPage /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
