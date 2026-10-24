# syntax=docker/dockerfile:1
# Веб-панель уже собрана в app/static (cd web && npm run build), поэтому Node при сборке не нужен.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1     PYTHONUNBUFFERED=1     PIP_NO_CACHE_DIR=1     PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini openapi.yaml ./
COPY migrations ./migrations
COPY app ./app

RUN useradd --system --uid 1000 appuser && mkdir -p /app/data && chown appuser /app/data
USER appuser

EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s   CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/v1/openapi.json', timeout=4)"
CMD ["python", "-m", "app"]
