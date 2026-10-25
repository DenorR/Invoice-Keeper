import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Center,
  Group,
  Loader,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconApi,
  IconCalendarMonth,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconReceipt2,
  IconRepeat,
  IconSelector,
  IconSettings,
  IconSun,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import { useSummary } from "./api/hooks";
import { useAuth } from "./auth";
import { AezaLogo, AezaMark } from "./components/Brand";
import { useIsMobile } from "./components/OccurrenceList";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OccurrencesPage } from "./pages/OccurrencesPage";
import { RecurringPage } from "./pages/RecurringPage";
import { UsersPage } from "./pages/UsersPage";
import { popFrom } from "./theme";

type NavItem = { to: string; label: string; icon: ReactNode; adminOnly?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Главная", icon: <IconLayoutDashboard size={18} stroke={1.75} /> },
  { to: "/payments", label: "Платежи", icon: <IconReceipt2 size={18} stroke={1.75} /> },
  { to: "/recurring", label: "Регулярные платежи", icon: <IconRepeat size={18} stroke={1.75} /> },
  { to: "/calendar", label: "Календарь", icon: <IconCalendarMonth size={18} stroke={1.75} /> },
  { to: "/users", label: "Пользователи", icon: <IconUsers size={18} stroke={1.75} />, adminOnly: true },
  { to: "/audit", label: "Журнал действий", icon: <IconHistory size={18} stroke={1.75} />, adminOnly: true },
  { to: "/settings", label: "Настройки", icon: <IconSettings size={18} stroke={1.75} />, adminOnly: true },
];

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  return (
    <Tooltip label={scheme === "dark" ? "Светлая тема" : "Тёмная тема"}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size={36}
        aria-label="Переключить тему"
        onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}
      >
        {scheme === "dark" ? <IconSun size={18} stroke={1.75} /> : <IconMoon size={18} stroke={1.75} />}
      </ActionIcon>
    </Tooltip>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const isAdmin = user.role === "admin";
  const title = user.name || user.login;
  const role = isAdmin ? "Администратор" : "Пользователь";
  return (
    <Menu position="top-start" width={240} transitionProps={{ transition: popFrom("bottom left"), duration: 150 }}>
      <Menu.Target>
        <UnstyledButton className="ik-user" style={{ flex: 1, minWidth: 0 }}>
          <Avatar color="gray" radius="md" size={32}>
            {(user.name || user.login).slice(0, 1).toUpperCase()}
          </Avatar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600} lh={1.25} truncate>
              {title}
            </Text>
            <Text size="xs" c="dimmed" lh={1.25} truncate>
              {title === role ? user.login : role}
            </Text>
          </div>
          <IconSelector size={16} color="var(--mantine-color-dimmed)" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Вы вошли как {user.login}</Menu.Label>
        <Menu.Item component="a" href="/api/v1/docs" target="_blank" leftSection={<IconApi size={16} />}>
          Документация API
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => void logout()}>
          Выйти
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const summary = useSummary();
  const overdue = summary.data?.currencies.reduce((n, c) => n + c.overdue.count, 0) ?? 0;

  return (
    <div className="ik-sidebar">
      <div className="ik-brand">
        <AezaLogo height={22} style={{ alignSelf: "flex-start" }} />
        <span className="ik-brand-name">Invoice Keeper</span>
      </div>
      <nav className="ik-nav" aria-label="Разделы">
        {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => {
          const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className="ik-nav-item"
              data-active={active || undefined}
              onClick={onNavigate}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.to === "/payments" && overdue > 0 && (
                <span className="ik-nav-count" title={`Просрочено: ${overdue}`}>
                  {overdue}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="ik-sidebar-footer">
        <Group gap={4} wrap="nowrap">
          <UserMenu />
          <ColorSchemeToggle />
        </Group>
      </div>
    </div>
  );
}

// боковая панель и мобильная шапка — матовое стекло поверх фонового свечения
const GLASS_BAR = {
  background: "var(--ik-glass-bg)",
  borderColor: "var(--ik-glass-stroke)",
  backdropFilter: "blur(36px)",
  WebkitBackdropFilter: "blur(36px)",
} as const;

function Layout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const isMobile = useIsMobile();
  const location = useLocation();
  const scroller = useRef<HTMLDivElement>(null);
  // прокручивается область контента, а не окно — при переходе на другую страницу возвращаемся наверх
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <AppShell
      header={{ height: 56, collapsed: !isMobile }}
      navbar={{ width: 248, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding={0}
      styles={{ navbar: GLASS_BAR, header: GLASS_BAR }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} size="sm" aria-label="Меню" />
            <AezaMark height={26} />
            <Text fw={700} ff="heading">
              Invoice Keeper
            </Text>
          </Group>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <Sidebar onNavigate={close} />
      </AppShell.Navbar>

      <AppShell.Main>
        <div ref={scroller} className="ik-scroll">
          <div key={location.pathname} className="ik-page ik-page-enter">
            {children}
          </div>
        </div>
      </AppShell.Main>
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
        <Route path="/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
