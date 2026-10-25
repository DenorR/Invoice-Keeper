import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  Checkbox,
  CloseButton,
  Collapse,
  Menu,
  Skeleton,
  Switch,
  Text,
  Tooltip,
  Transition,
  UnstyledButton,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconBellRinging,
  IconBrandTelegram,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconList,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRepeat,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { RecurringPayment } from "../api/client";
import { useBulkRecurring, useCategories, useDeleteRecurring, useMeta, useRecurring, useRestoreRecurring } from "../api/hooks";
import { useAuth } from "../auth";
import { EmptyState, ErrorAlert, Money, PageHeader, Pill, StatusBadge, notifyError, notifySuccess } from "../components/common";
import { CategoriesModal } from "../components/CategoriesModal";
import { PaymentFormModal } from "../components/PaymentFormModal";
import { FREQUENCY_LABEL, formatDate, pluralDays, pluralPayments, weekday } from "../lib/format";
import { EASE_OUT, popFrom } from "../theme";

const TONES = ["blue", "navy", "green", "gray"];

type Group = { id: number; name: string; items: RecurringPayment[] };

// Свёрнутые группы — удобство конкретного человека: храним в браузере, без хранилища всё просто развёрнуто
const COLLAPSED_KEY = "ik:recurring:collapsed";
function loadCollapsed(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}
function saveCollapsed(ids: Set<number>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* хранилище недоступно — состояние просто не запомнится */
  }
}

function StateBadge({ p }: { p: RecurringPayment }) {
  if (!p.is_active) return <Pill tone="planned">Прекращён {formatDate(p.deleted_at)}</Pill>;
  if (p.overdue_count > 0) return <Pill tone="red">Просрочено: {pluralPayments(p.overdue_count)}</Pill>;
  if (p.next_occurrence) return <StatusBadge occurrence={p.next_occurrence} />;
  return <Pill tone="green">Оплачено</Pill>;
}

/** Когда бот напомнит о ближайшем неоплаченном сроке (с учётом своего окна платежа). */
function reminderText(p: RecurringPayment, today: string, telegramOn: boolean) {
  const next = p.next_occurrence;
  if (!p.is_active || !next) return null;
  if (next.reminder_sent_at) return `напомнили ${formatDate(next.reminder_sent_at)}`;
  if (!telegramOn) return null; // о ненастроенном Telegram говорит заметка на главной — не повторяем в каждой строке
  const when = dayjs(next.due_date).subtract(p.remind_days_effective, "day").format("YYYY-MM-DD");
  return when <= today ? "напоминание вот-вот уйдёт" : `напомним ${formatDate(when)}`;
}

export function RecurringPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const meta = useMeta();
  const today = meta.data?.today ?? dayjs().format("YYYY-MM-DD");
  const telegramOn = Boolean(meta.data?.telegram.chat_configured);
  const [showStopped, setShowStopped] = useState(false);
  const recurring = useRecurring(showStopped);
  const remove = useDeleteRecurring();
  const restore = useRestoreRecurring();
  const bulk = useBulkRecurring();
  const [editing, setEditing] = useState<RecurringPayment | null>(null);
  const [formOpened, setFormOpened] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<number>>(loadCollapsed);
  const [categoriesOpened, setCategoriesOpened] = useState(false);
  const categories = useCategories();
  const cats = categories.data ?? [];

  const items = recurring.data ?? [];
  const activeCount = items.filter((p) => p.is_active).length;
  const chosen = items.filter((p) => selected.has(p.id));
  const chosenActive = chosen.filter((p) => p.is_active);
  const chosenStopped = chosen.filter((p) => !p.is_active);
  const allChecked = items.length > 0 && chosen.length === items.length;

  // группы показываем, как только появилась хотя бы одна категория; «Без категории» — в конце
  const grouped = cats.length > 0;
  const known = new Set(cats.map((c) => c.id));
  const groups: Group[] = grouped
    ? [
        ...cats.map((c) => ({ id: c.id, name: c.name, items: items.filter((p) => p.category_id === c.id) })),
        { id: 0, name: "Без категории", items: items.filter((p) => p.category_id === null || !known.has(p.category_id)) },
      ].filter((g) => g.id !== 0 || g.items.length > 0)
    : [];
  const toggleGroup = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  const toggleMany = (ids: number[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // выбор хранит только видимые строки: прекращённые пропадают, если скрыть их переключателем
  useEffect(() => {
    const visible = new Set((recurring.data ?? []).map((p) => p.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [recurring.data]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(items.map((p) => p.id)));

  const runBulk = async (action: "stop" | "restore", list: RecurringPayment[]) => {
    try {
      const result = await bulk.mutateAsync({ action, ids: list.map((p) => p.id) });
      notifySuccess(
        action === "stop"
          ? "Новых сроков и напоминаний по ним не будет, история оплат сохранена"
          : "График продолжается с сегодняшнего дня",
        `${action === "stop" ? "Прекращено" : "Возобновлено"}: ${pluralPayments(result.changed.length)}`,
      );
      setSelected(new Set());
    } catch (error) {
      notifyError(error);
    }
  };
  const stopSelected = () =>
    modals.openConfirmModal({
      title: `Прекратить ${pluralPayments(chosenActive.length)}?`,
      children: (
        <>
          <Text size="sm">Новых сроков и напоминаний по ним больше не будет. Уже отмеченные оплаты сохранятся в истории.</Text>
          <Text size="sm" c="dimmed" mt="xs">
            {chosenActive.slice(0, 5).map((p) => `«${p.name}»`).join(", ")}
            {chosenActive.length > 5 && ` и ещё ${chosenActive.length - 5}`}
          </Text>
        </>
      ),
      labels: { confirm: "Прекратить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: () => runBulk("stop", chosenActive),
    });
  const moveSelected = async (categoryId: number | null, label: string) => {
    try {
      const result = await bulk.mutateAsync({ action: "category", ids: chosen.map((p) => p.id), categoryId });
      notifySuccess(`${pluralPayments(result.changed.length)} → ${label}`, "Категория изменена");
      setSelected(new Set());
      if (categoryId !== null && collapsed.has(categoryId)) toggleGroup(categoryId);
    } catch (error) {
      notifyError(error);
    }
  };
  const restoreOne = async (payment: RecurringPayment) => {
    try {
      await restore.mutateAsync(payment.id);
      notifySuccess("График продолжается с сегодняшнего дня", `Платёж «${payment.name}» возобновлён`);
    } catch (error) {
      notifyError(error);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpened(true);
  };
  const openEdit = (payment: RecurringPayment) => {
    setEditing(payment);
    setFormOpened(true);
  };
  const stop = (payment: RecurringPayment) =>
    modals.openConfirmModal({
      title: `Прекратить «${payment.name}»?`,
      children: (
        <Text size="sm">
          Новых сроков и напоминаний по этому платежу больше не будет. Уже отмеченные оплаты сохранятся в истории.
        </Text>
      ),
      labels: { confirm: "Прекратить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await remove.mutateAsync(payment.id);
          notifySuccess(`Платёж «${payment.name}» прекращён`);
        } catch (error) {
          notifyError(error);
        }
      },
    });

  const renderRow = (p: RecurringPayment) => {
    const reminder = reminderText(p, today, telegramOn);
    return (
      <div
        key={p.id}
        className="ik-rec-row"
        data-selectable={isAdmin || undefined}
        data-selected={selected.has(p.id) || undefined}
        data-inactive={p.is_active ? undefined : ""}
      >
        {isAdmin && (
          <Checkbox
            className="ik-rec-check"
            size="sm"
            checked={selected.has(p.id)}
            onChange={() => toggle(p.id)}
            aria-label={`Выбрать «${p.name}»`}
          />
        )}
        <span className="ik-monogram" data-tone={TONES[p.id % TONES.length]} aria-hidden>
          {p.name.trim().slice(0, 1).toUpperCase()}
        </span>
        <div className="ik-rec-main">
          <Link to={`/payments?tab=all&payment=${p.id}`} className="ik-item-title ik-link" title="Все сроки этого платежа">
            {p.name}
          </Link>
          <div className="ik-item-meta">
            <span>{FREQUENCY_LABEL[p.frequency]}</span>
            {p.is_active && p.next_due_date && (
              <span data-sep>
                ближайший срок {formatDate(p.next_due_date)}, {weekday(p.next_due_date)}
              </span>
            )}
            {reminder && (
              <span data-sep style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconBrandTelegram size={13} /> {reminder}
              </span>
            )}
            {p.is_active && p.remind_days !== null && (
              <Tooltip label="Свой срок напоминания: общая настройка на этот платёж не действует">
                <span data-sep style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <IconBellRinging size={13} /> за {pluralDays(p.remind_days)}
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="ik-item-amount">
          <Money amount={p.amount} currency={p.currency} fw={650} />
        </div>
        <div className="ik-rec-state">
          <StateBadge p={p} />
        </div>
        <div className="ik-rec-menu">
          {isAdmin && !p.is_active ? (
            <Menu position="bottom-end" width={220} transitionProps={{ transition: popFrom("top right"), duration: 150 }}>
              <Menu.Target>
                <Tooltip label="Действия">
                  <ActionIcon variant="subtle" color="gray" size={34} aria-label={`Действия: ${p.name}`}>
                    <IconDots size={18} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPlayerPlay size={16} />} onClick={() => void restoreOne(p)}>
                  Возобновить
                </Menu.Item>
                <Menu.Item leftSection={<IconList size={16} />} onClick={() => navigate(`/payments?tab=all&payment=${p.id}`)}>
                  Все сроки
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : isAdmin && p.is_active ? (
            <Menu position="bottom-end" width={220} transitionProps={{ transition: popFrom("top right"), duration: 150 }}>
              <Menu.Target>
                <Tooltip label="Действия">
                  <ActionIcon variant="subtle" color="gray" size={34} aria-label={`Действия: ${p.name}`}>
                    <IconDots size={18} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => openEdit(p)}>
                  Изменить
                </Menu.Item>
                <Menu.Item leftSection={<IconList size={16} />} onClick={() => navigate(`/payments?tab=all&payment=${p.id}`)}>
                  Все сроки
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconPlayerStop size={16} />} onClick={() => stop(p)}>
                  Прекратить
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </div>
      </div>
    );
  };

  const renderGroup = (g: Group) => {
    const ids = g.items.map((p) => p.id);
    const picked = ids.filter((id) => selected.has(id)).length;
    const open = !collapsed.has(g.id);
    return (
      <section key={g.id} className="ik-group" data-open={open || undefined}>
        <div className="ik-group-head" data-selectable={isAdmin || undefined}>
          {isAdmin && (
            <Checkbox
              size="sm"
              checked={ids.length > 0 && picked === ids.length}
              indeterminate={picked > 0 && picked < ids.length}
              disabled={!ids.length}
              onChange={() => toggleMany(ids, picked < ids.length)}
              aria-label={`Выбрать все в группе «${g.name}»`}
            />
          )}
          <UnstyledButton className="ik-group-toggle" onClick={() => toggleGroup(g.id)} aria-expanded={open}>
            <IconChevronRight size={16} stroke={2} className="ik-group-chevron" />
            <span className="ik-group-name">{g.name}</span>
            <span className="ik-group-count">{g.items.length}</span>
          </UnstyledButton>
          <Anchor component={Link} to={`/payments?tab=all&category=${g.id}`} size="xs" c="dimmed" className="ik-group-link">
            Сроки группы →
          </Anchor>
        </div>
        <Collapse expanded={open} transitionDuration={260} transitionTimingFunction={EASE_OUT}>
          {g.items.length ? (
            g.items.map(renderRow)
          ) : (
            <Text size="sm" c="dimmed" className="ik-group-empty">
              {isAdmin ? "Пока пусто: отметьте платежи галочками и нажмите «В категорию»." : "Пока пусто."}
            </Text>
          )}
        </Collapse>
      </section>
    );
  };

  return (
    <>
      <PageHeader
        title="Регулярные платежи"
        description="Что и как часто платить: аренда, подписки, серверы. По ним система сама создаёт сроки"
        actions={
          isAdmin && (
            <Button leftSection={<IconPlus size={16} stroke={2.25} />} onClick={openCreate}>
              Добавить платёж
            </Button>
          )
        }
      />

      <ErrorAlert error={recurring.error} />

      <Card padding={0}>
        <div className="ik-toolbar ik-rec-toolbar" style={{ justifyContent: "space-between" }}>
          <div className="ik-rec-toolbar-left">
            {isAdmin && items.length > 0 && (
              <Checkbox
                size="sm"
                checked={allChecked}
                indeterminate={chosen.length > 0 && !allChecked}
                onChange={toggleAll}
                aria-label={allChecked ? "Снять выделение" : "Выбрать все"}
              />
            )}
            <Text size="sm" c="dimmed">
              {recurring.isLoading
                ? "Загрузка…"
                : chosen.length
                  ? `Выбрано: ${chosen.length} из ${items.length}`
                  : `Активных: ${activeCount}`}
            </Text>
          </div>
          <div className="ik-rec-toolbar-right">
            {isAdmin && (
              <Button variant="subtle" color="gray" size="compact-sm" leftSection={<IconFolder size={16} />} onClick={() => setCategoriesOpened(true)}>
                Категории
              </Button>
            )}
            <Switch label="Показать прекращённые" checked={showStopped} onChange={(e) => setShowStopped(e.currentTarget.checked)} size="sm" />
          </div>
        </div>

        {recurring.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="ik-rec-row" data-selectable={isAdmin || undefined}>
              {isAdmin && <Skeleton h={18} w={18} radius={4} />}
              <Skeleton h={40} w={40} radius={11} />
              <div className="ik-rec-main">
                <Skeleton h={12} w="40%" mb={8} />
                <Skeleton h={10} w="25%" />
              </div>
              <Skeleton h={12} w={90} />
              <Skeleton h={22} w={140} radius="xl" />
              <span />
            </div>
          ))}

        {grouped ? groups.map(renderGroup) : items.map(renderRow)}

        {!recurring.isLoading && items.length === 0 && (
          <EmptyState
            icon={<IconRepeat size={22} />}
            title="Регулярных платежей пока нет"
            text={isAdmin ? "Добавьте аренду, сервер или подписку — сроки и напоминания появятся сами." : "Их добавляет администратор."}
            action={
              isAdmin ? (
                <Button variant="default" onClick={openCreate} leftSection={<IconPlus size={16} />}>
                  Добавить первый платёж
                </Button>
              ) : undefined
            }
          />
        )}
      </Card>

      {isAdmin && (
        <Transition mounted={chosen.length > 0} transition={popFrom("bottom")} duration={260} exitDuration={180} timingFunction={EASE_OUT}>
          {(style) => (
            <div className="ik-bulk" style={style} role="toolbar" aria-label="Действия с выбранными платежами">
              <span className="ik-bulk-count">Выбрано: {pluralPayments(chosen.length)}</span>
              <div className="ik-bulk-actions">
                <Button
                  color="red"
                  size="sm"
                  leftSection={<IconPlayerStop size={16} />}
                  disabled={!chosenActive.length}
                  loading={bulk.isPending && bulk.variables?.action === "stop"}
                  onClick={stopSelected}
                >
                  Прекратить{chosenActive.length && chosenStopped.length ? ` (${chosenActive.length})` : ""}
                </Button>
                <Button
                  color="green"
                  size="sm"
                  leftSection={<IconPlayerPlay size={16} />}
                  disabled={!chosenStopped.length}
                  loading={bulk.isPending && bulk.variables?.action === "restore"}
                  onClick={() => void runBulk("restore", chosenStopped)}
                >
                  Возобновить{chosenActive.length && chosenStopped.length ? ` (${chosenStopped.length})` : ""}
                </Button>
                <Menu position="top" width={240} transitionProps={{ transition: popFrom("bottom"), duration: 200 }}>
                  <Menu.Target>
                    <Button size="sm" variant="default" leftSection={<IconFolder size={16} />} loading={bulk.isPending && bulk.variables?.action === "category"}>
                      В категорию
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {cats.map((c) => (
                      <Menu.Item key={c.id} leftSection={<IconFolder size={16} />} onClick={() => void moveSelected(c.id, `«${c.name}»`)}>
                        {c.name}
                      </Menu.Item>
                    ))}
                    {cats.length > 0 && (
                      <Menu.Item onClick={() => void moveSelected(null, "без категории")}>Без категории</Menu.Item>
                    )}
                    {cats.length > 0 && <Menu.Divider />}
                    <Menu.Item leftSection={<IconFolderPlus size={16} />} onClick={() => setCategoriesOpened(true)}>
                      Новая категория…
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
              <CloseButton aria-label="Снять выделение" onClick={() => setSelected(new Set())} />
            </div>
          )}
        </Transition>
      )}

      {isAdmin && <PaymentFormModal opened={formOpened} payment={editing} onClose={() => setFormOpened(false)} />}
      {isAdmin && <CategoriesModal opened={categoriesOpened} onClose={() => setCategoriesOpened(false)} />}
    </>
  );
}
