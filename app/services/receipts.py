"""Файлы чеков: проверка при загрузке, хранение и выдача.

Принимаем только документы и картинки: PDF, PNG, JPEG, WebP. Тип определяется по содержимому
(сигнатуре), а не по имени или заголовку Content-Type от клиента; расширение имени должно ему
соответствовать. Скрипты, программы, архивы, HTML и SVG отклоняются. Сервер файл никогда не
запускает и не разбирает: он лежит в базе как набор байтов и отдаётся браузеру с жёстким
Content-Type, nosniff и запрещающей политикой CSP.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import PaymentOccurrence, ReceiptFile
from app.services import audit
from app.services.audit import Actor


@dataclass(frozen=True)
class FileKind:
    content_type: str
    extensions: tuple[str, ...]


KINDS = {
    "pdf": FileKind("application/pdf", (".pdf",)),
    "png": FileKind("image/png", (".png",)),
    "jpeg": FileKind("image/jpeg", (".jpg", ".jpeg")),
    "webp": FileKind("image/webp", (".webp",)),
}
ALLOWED_HINT = "PDF, PNG, JPG или WebP"

# Активное содержимое PDF: скрипты, запуск программ, вложенные файлы, формы XFA и отправка данных.
# Имена в PDF можно записать через #xx (например, /J#61vaScript), поэтому перед поиском раскодируем.
_PDF_ACTIVE = re.compile(
    rb"/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z0-9])"
)
_PDF_NAME_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def safe_filename(name: str) -> str:
    """Только имя (без пути и управляющих символов), не длиннее 120 знаков, расширение сохраняется."""
    name = unicodedata.normalize("NFC", name).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip(" .")
    if len(name) > 120:
        stem, dot, ext = name.rpartition(".")
        name = f"{stem[: 119 - len(ext)]}.{ext}" if dot and len(ext) <= 10 else name[:120]
    return name or "receipt"


def validate(filename: str, data: bytes) -> tuple[str, FileKind]:
    """Возвращает (безопасное имя, тип) или бросает ошибку с понятным сообщением."""
    if not data:
        raise ApiError(422, "empty_file", "Файл пустой")
    name = safe_filename(filename)
    kind_key = sniff(data)
    if kind_key is None:
        raise ApiError(415, "unsupported_file_type", f"Можно прикрепить только {ALLOWED_HINT}")
    kind = KINDS[kind_key]
    if not name.lower().endswith(kind.extensions):
        raise ApiError(415, "extension_mismatch",
                       f"Расширение не совпадает с содержимым: это {kind_key.upper()}, "
                       f"ожидается {' или '.join(kind.extensions)}")
    if kind_key == "pdf":
        decoded = _PDF_NAME_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), data)
        if _PDF_ACTIVE.search(decoded):
            raise ApiError(415, "pdf_active_content",
                           "PDF содержит скрипты, вложенные файлы или запуск программ — такой файл прикрепить нельзя")
    return name, kind


def attach(db: Session, actor: Actor, occurrence: PaymentOccurrence, filename: str, data: bytes,
           now: datetime) -> ReceiptFile:
    if occurrence.paid_at is None:
        raise ApiError(409, "not_paid", "Чек прикрепляется к оплате — сначала отметьте платёж оплаченным")
    name, kind = validate(filename, data)
    replaced = occurrence.receipt_file.filename if occurrence.receipt_file else None
    if occurrence.receipt_file is not None:
        db.delete(occurrence.receipt_file)
        db.flush()
    receipt = ReceiptFile(
        occurrence_id=occurrence.id,
        filename=name,
        content_type=kind.content_type,
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
        uploaded_by=actor.user_id,
        uploaded_by_label=actor.label,
        created_at=now,
    )
    db.add(receipt)
    details = {"due_date": occurrence.due_date.isoformat(), "filename": name, "size": len(data),
               "type": kind.content_type, "sha256": receipt.sha256}
    if replaced:
        details["replaced"] = replaced
    audit.record(db, actor, "occurrence.file_attach", "payment_occurrence", occurrence.id, details)
    db.flush()
    db.refresh(occurrence)
    return receipt


def detach(db: Session, actor: Actor, occurrence: PaymentOccurrence) -> bool:
    receipt = occurrence.receipt_file
    if receipt is None:
        return False
    audit.record(db, actor, "occurrence.file_remove", "payment_occurrence", occurrence.id,
                 {"due_date": occurrence.due_date.isoformat(), "filename": receipt.filename,
                  "size": receipt.size, "type": receipt.content_type, "sha256": receipt.sha256})
    db.delete(receipt)
    db.flush()
    db.refresh(occurrence)
    return True
