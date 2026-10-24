import { Button, Group, Modal, PasswordInput, Stack, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import type { Schemas, User } from "../api/client";
import { useCreateUser, useUpdateUser } from "../api/hooks";
import { notifyError, notifySuccess } from "./common";

type Props = { opened: boolean; user: User | null; onClose: () => void };

const LOGIN_RE = /^[A-Za-z0-9_.-]{3,64}$/;

export function UserFormModal({ opened, user, onClose }: Props) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setTouched(false);
    setLogin(user?.login ?? "");
    setName(user?.name ?? "");
    setPassword("");
  }, [opened, user]);

  const errors = {
    login: !LOGIN_RE.test(login.trim()) ? "3–64 символа: латиница, цифры, точка, дефис, подчёркивание" : null,
    password:
      !user && password.length < 6
        ? "Минимум 6 символов"
        : user && password && password.length < 6
          ? "Минимум 6 символов"
          : null,
  };

  const submit = async () => {
    setTouched(true);
    if (errors.login || errors.password) return;
    try {
      if (user) {
        const body: Schemas["UserUpdate"] = {};
        if (login.trim().toLowerCase() !== user.login) body.login = login.trim();
        if ((name.trim() || null) !== (user.name || null)) body.name = name.trim() || null;
        if (password) body.password = password;
        if (Object.keys(body).length) await update.mutateAsync({ id: user.id, body });
        notifySuccess(password ? "Пользователь обновлён, его сессии завершены" : "Пользователь обновлён");
      } else {
        await create.mutateAsync({ login: login.trim(), password, name: name.trim() || null });
        notifySuccess(`Пользователь ${login.trim().toLowerCase()} создан`);
      }
      onClose();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={user ? "Изменить пользователя" : "Новый пользователь"} centered>
      <Stack>
        <TextInput
          label="Логин"
          value={login}
          onChange={(e) => setLogin(e.currentTarget.value)}
          error={touched && errors.login}
          required
          data-autofocus
        />
        <TextInput label="Имя" placeholder="Необязательно" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <PasswordInput
          label={user ? "Новый пароль" : "Пароль"}
          description={user ? "Оставьте пустым, чтобы не менять" : undefined}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          error={touched && errors.password}
          required={!user}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} loading={create.isPending || update.isPending}>
            {user ? "Сохранить" : "Создать"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
