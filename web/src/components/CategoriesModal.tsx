import { ActionIcon, Button, Group, Modal, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCheck, IconFolder, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { Schemas } from "../api/client";
import { useCategories, useCategoryMutations } from "../api/hooks";
import { pluralPayments } from "../lib/format";
import { notifyError, notifySuccess } from "./common";

type Category = Schemas["CategoryOut"];

/** Категории (группы) регулярных платежей: добавить, переименовать, удалить. Только для администратора. */
export function CategoriesModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const categories = useCategories();
  const { create } = useCategoryMutations();
  const [name, setName] = useState("");

  const add = async () => {
    const value = name.trim();
    if (!value) return;
    try {
      await create.mutateAsync(value);
      setName("");
      notifySuccess(`Категория «${value}» добавлена — перенесите в неё платежи галочками и кнопкой «В категорию»`);
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Категории платежей" centered>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Группы вроде «Офис», «Серверы», «Подписки». В списке платежей каждую группу можно свернуть или развернуть и работать
          только с ней.
        </Text>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <TextInput
              placeholder="Новая категория"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={100}
              style={{ flex: 1 }}
              aria-label="Название новой категории"
              data-autofocus
            />
            <Button type="submit" leftSection={<IconPlus size={16} />} loading={create.isPending} disabled={!name.trim()}>
              Добавить
            </Button>
          </Group>
        </form>
        {(categories.data ?? []).length > 0 && (
          <div className="ik-cat-list">
            {(categories.data ?? []).map((c) => (
              <CategoryRow key={c.id} category={c} />
            ))}
          </div>
        )}
      </Stack>
    </Modal>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const { rename, remove } = useCategoryMutations();
  const [value, setValue] = useState(category.name);
  const changed = value.trim() !== category.name && value.trim() !== "";

  const save = async () => {
    if (!changed) return;
    try {
      await rename.mutateAsync({ id: category.id, name: value.trim() });
      notifySuccess(`Категория переименована: «${value.trim()}»`);
    } catch (error) {
      notifyError(error);
      setValue(category.name);
    }
  };

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: `Удалить категорию «${category.name}»?`,
      children: (
        <Text size="sm">
          {category.payments_count
            ? `${pluralPayments(category.payments_count)} останутся, но без категории.`
            : "В ней нет активных платежей."}
        </Text>
      ),
      labels: { confirm: "Удалить", cancel: "Отмена" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await remove.mutateAsync(category.id);
          notifySuccess(`Категория «${category.name}» удалена`);
        } catch (error) {
          notifyError(error);
        }
      },
    });

  return (
    <div className="ik-cat-row">
      <IconFolder size={18} stroke={1.75} className="ik-cat-icon" />
      <TextInput
        variant="unstyled"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setValue(category.name);
        }}
        maxLength={100}
        aria-label={`Название категории «${category.name}»`}
        style={{ flex: 1 }}
      />
      <Text size="xs" c="dimmed" className="nowrap">
        {category.payments_count ? pluralPayments(category.payments_count) : "пусто"}
      </Text>
      {changed && (
        <Tooltip label="Сохранить название">
          <ActionIcon variant="subtle" color="green" onClick={() => void save()} loading={rename.isPending} aria-label="Сохранить название">
            <IconCheck size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Удалить категорию">
        <ActionIcon variant="subtle" color="red" onClick={confirmDelete} aria-label={`Удалить категорию «${category.name}»`}>
          <IconTrash size={16} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}
