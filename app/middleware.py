"""Заголовки безопасности для всех ответов (действуют и локально, и за Caddy)."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Веб-панель: скрипты только свои (никаких inline-скриптов и сторонних доменов) — основная защита от XSS.
# Стили inline разрешены: Mantine задаёт CSS-переменные через <style>.
PANEL_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])

# Swagger UI грузит свои скрипты и стили с jsDelivr и использует inline-скрипт инициализации.
DOCS_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
])

COMMON_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, docs_prefix: str, api_prefix: str):
        super().__init__(app)
        self.docs_prefix = docs_prefix
        self.api_prefix = api_prefix

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        path = request.url.path
        for name, value in COMMON_HEADERS.items():
            response.headers.setdefault(name, value)
        response.headers.setdefault(
            "Content-Security-Policy", DOCS_CSP if path.startswith(self.docs_prefix) else PANEL_CSP
        )
        if path.startswith(self.api_prefix) and not path.startswith(self.docs_prefix):
            # ответы API содержат данные пользователя — не кэшируем ни в браузере, ни на прокси
            response.headers.setdefault("Cache-Control", "no-store")
        return response
