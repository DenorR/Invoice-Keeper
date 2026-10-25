import { ActionIcon, Badge, Button, Card, Group, Table, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconLock, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { User } from "../api/client";
import { useDeleteUser, useUsers } from "../api/hooks";
import { ErrorAlert, PageHeader, notifyError, notifySuccess } from "../components/common";
import { UserFormModal } from "../components/UserFormModal";
import { formatDate } from "../lib/format";

export function UsersPage() {
  const users = useUsers();
  const remove = useDeleteUser();
  const [editing, setEditing] = useState<User | null>(null);
  const [opened, setOpened] = useState(false);

  const confirmDelete = (user: User) =>
    modals.openConfirmModal({
      title: `Удалить пользователя ${user.login}?`,
      children: <Text size="sm">Пользователь потеряет доступ к панели. Его отметки об оплате сохранятся.</Text>,
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await remove.mutateAsync(user.id);
          notifySuccess(`Пользователь ${user.login} удалён`);
        } catch (error) {
          notifyError(error);
        }
      },
    });

  return (
    <>
      <PageHeader
        title="Пользователи"
        description="Пользователи видят платежи и отмечают оплату. Администратор задаётся в .env"
        actions={
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setOpened(true);
            }}
          >
            Добавить пользователя
          </Button>
        }
      />
      <ErrorAlert error={users.error} />
      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={600}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Логин</Table.Th>
                <Table.Th>Имя</Table.Th>
                <Table.Th>Роль</Table.Th>
                <Table.Th>Создан</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(users.data ?? []).map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td fw={600}>{u.login}</Table.Td>
                  <Table.Td>{u.name || "—"}</Table.Td>
                  <Table.Td>
                    {u.role === "admin" ? (
                      <Badge color="navy" variant="dot">
                        Администратор
                      </Badge>
                    ) : (
                      <Badge color="blue" variant="dot">
                        Пользователь
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td className="tabular">{formatDate(u.created_at)}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      {u.managed_by_env ? (
                        <Tooltip label="Учётная запись администратора задаётся в .env и не изменяется через панель">
                          <Group gap={4} c="dimmed">
                            <IconLock size={16} />
                            <Text size="xs">из .env</Text>
                          </Group>
                        </Tooltip>
                      ) : (
                        <>
                          <Tooltip label="Изменить">
                            <ActionIcon
                              variant="subtle"
                              aria-label="Изменить"
                              onClick={() => {
                                setEditing(u);
                                setOpened(true);
                              }}
                            >
                              <IconPencil size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Удалить">
                            <ActionIcon variant="subtle" color="red" aria-label="Удалить" onClick={() => confirmDelete(u)}>
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      <UserFormModal opened={opened} user={editing} onClose={() => setOpened(false)} />
    </>
  );
}
