import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { ApiError, UNAUTHORIZED_EVENT, api, unwrap, type User } from "./api/client";
import { keys } from "./api/hooks";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<User | null> {
  try {
    return await unwrap(api.GET("/api/v1/auth/me"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe, retry: false, staleTime: Infinity });

  /** Сменить текущего пользователя и выбросить данные прежней сессии (подписка на «me» сохраняется). */
  const switchUser = useCallback(
    (next: User | null) => {
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.me[0] });
      qc.setQueryData(keys.me, next);
    },
    [qc],
  );

  useEffect(() => {
    const onUnauthorized = () => {
      if (qc.getQueryData(keys.me)) switchUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc, switchUser]);

  const login = useCallback(
    async (loginValue: string, password: string) => {
      const result = await unwrap(api.POST("/api/v1/auth/login", { body: { login: loginValue, password } }));
      switchUser(result.user);
    },
    [switchUser],
  );

  const logout = useCallback(async () => {
    try {
      await unwrap(api.POST("/api/v1/auth/logout"));
    } finally {
      switchUser(null);
    }
  }, [switchUser]);

  const user = me.data ?? null;
  return (
    <AuthContext.Provider value={{ user, isLoading: me.isLoading, isAdmin: user?.role === "admin", login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}
