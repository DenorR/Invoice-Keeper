"""Файлы чеков, комментарии к оплате и категории платежей."""

from urllib.parse import quote

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import ADMIN, create_payment, login, occurrences

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def paid_occurrence(client, headers):
    payment = create_payment(client, headers, next_due_date="2026-10-20")
    occ = occurrences(client, headers, recurring_payment_id=payment["id"])[0]
    response = client.patch(f"/api/v1/payment-occurrences/{occ['id']}", headers=headers, json={"paid": True})
    assert response.status_code == 200, response.text
    return occ["id"]


def upload(client, headers, occ_id, data, filename, content_type="application/octet-stream"):
    return client.put(f"/api/v1/payment-occurrences/{occ_id}/receipt-file", content=data,
                      headers={**headers, "Content-Type": content_type, "X-File-Name": quote(filename)})


# --- файлы чеков ---------------------------------------------------------------


def test_upload_and_open_pdf(client, admin, user):
    occ_id = paid_occurrence(client, admin)
    response = upload(client, user, occ_id, PDF, "Чек ноябрь.pdf", "application/pdf")
    assert response.status_code == 200, response.text
    receipt = response.json()["receipt_file"]
    assert receipt["filename"] == "Чек ноябрь.pdf" and receipt["content_type"] == "application/pdf"
    assert receipt["size"] == len(PDF) and receipt["uploaded_by"] == "ivan"

    file = client.get(receipt["url"], headers=admin)
    assert file.status_code == 200 and file.content == PDF
    assert file.headers["content-type"] == "application/pdf"
    assert file.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in file.headers["content-security-policy"]
    assert file.headers["content-disposition"].startswith("inline;") and "UTF-8''" in file.headers["content-disposition"]
    # в списке платежей файл виден, а содержимое не передаётся
    listed = next(o for o in occurrences(client, admin) if o["id"] == occ_id)
    assert listed["receipt_file"]["filename"] == "Чек ноябрь.pdf"


def test_image_is_sandboxed(client, admin):
    occ_id = paid_occurrence(client, admin)
    assert upload(client, admin, occ_id, PNG, "scan.png").status_code == 200
    file = client.get(f"/api/v1/payment-occurrences/{occ_id}/receipt-file", headers=admin)
    assert file.headers["content-type"] == "image/png"
    assert "sandbox" in file.headers["content-security-policy"]


def test_dangerous_and_unknown_files_are_rejected(client, admin):
    occ_id = paid_occurrence(client, admin)
    cases = [
        (b"MZ\x90\x00" + b"\x00" * 60, "setup.exe", "unsupported_file_type"),
        (b"#!/bin/sh\nrm -rf /\n", "run.sh", "unsupported_file_type"),
        (b"<html><script>alert(1)</script></html>", "check.html", "unsupported_file_type"),
        (b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "check.svg", "unsupported_file_type"),
        (b"PK\x03\x04" + b"\x00" * 30, "check.zip", "unsupported_file_type"),
        (b"MZ\x90\x00", "check.pdf", "unsupported_file_type"),  # переименованная программа
        (PDF, "check.exe", "extension_mismatch"),
        (PNG, "check.pdf", "extension_mismatch"),
        (PDF.replace(b"/Catalog", b"/Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), "js.pdf", "pdf_active_content"),
        (PDF.replace(b"/Catalog", b"/Catalog /OpenAction << /S /J#61vaScript >>"), "hex.pdf", "pdf_active_content"),
        (PDF.replace(b"/Catalog", b"/Catalog /AA << /O << /S /Launch /F (cmd.exe) >> >>"), "launch.pdf", "pdf_active_content"),
        (PDF.replace(b"/Catalog", b"/Catalog /Names << /EmbeddedFiles 2 0 R >>"), "embedded.pdf", "pdf_active_content"),
    ]
    for data, name, code in cases:
        response = upload(client, admin, occ_id, data, name)
        assert response.status_code == 415, (name, response.text)
        assert response.json()["error"]["code"] == code, name
    empty = upload(client, admin, occ_id, b"", "empty.pdf")
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "empty_file"
    assert client.get(f"/api/v1/payment-occurrences/{occ_id}/receipt-file", headers=admin).status_code == 404


def test_file_size_limit(settings, clock, notifier):
    app = create_app(settings.model_copy(update={"upload_max_mb": 1}), clock=clock, notifier=notifier,
                     start_background=False)
    with TestClient(app) as client:
        admin = login(client, *ADMIN)
        occ_id = paid_occurrence(client, admin)
        big = PDF + b"0" * (1024 * 1024)
        response = upload(client, admin, occ_id, big, "big.pdf")
        assert response.status_code == 413 and response.json()["error"]["code"] == "file_too_large"
        assert upload(client, admin, occ_id, PDF + b"0" * 1000, "ok.pdf").status_code == 200


def test_filename_is_sanitized_and_file_replaced_then_removed(client, admin):
    occ_id = paid_occurrence(client, admin)
    first = upload(client, admin, occ_id, PDF, "../../etc/\x00passwd.pdf").json()["receipt_file"]
    assert first["filename"] == "passwd.pdf"
    second = upload(client, admin, occ_id, JPEG, "photo.JPG").json()["receipt_file"]
    assert second["filename"] == "photo.JPG" and second["content_type"] == "image/jpeg"

    assert client.delete(f"/api/v1/payment-occurrences/{occ_id}/receipt-file", headers=admin).status_code == 204
    assert client.get(f"/api/v1/payment-occurrences/{occ_id}/receipt-file", headers=admin).status_code == 404
    actions = [e["action"] for e in client.get("/api/v1/audit-log", headers=admin).json()["items"]]
    assert actions.count("occurrence.file_attach") == 2 and "occurrence.file_remove" in actions
    attached = client.get("/api/v1/audit-log", headers=admin, params={"action": "occurrence.file_attach"}).json()["items"][0]
    assert attached["details"]["sha256"] == second["sha256"] and attached["details"]["type"] == "image/jpeg"


def test_receipt_only_for_paid_period(client, admin):
    payment = create_payment(client, admin, next_due_date="2026-10-26")
    occ = occurrences(client, admin, recurring_payment_id=payment["id"])[0]
    response = upload(client, admin, occ["id"], PDF, "check.pdf")
    assert response.status_code == 409 and response.json()["error"]["code"] == "not_paid"


def test_admin_can_disable_uploads(client, admin, user):
    occ_id = paid_occurrence(client, admin)
    assert upload(client, user, occ_id, PDF, "check.pdf").status_code == 200

    off = client.patch("/api/v1/settings", headers=admin, json={"uploads_enabled": False})
    assert off.status_code == 200 and off.json()["uploads_enabled"] is False
    assert client.get("/api/v1/meta", headers=user).json()["uploads_enabled"] is False
    blocked = upload(client, user, occ_id, PDF, "other.pdf")
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "uploads_disabled"
    # уже прикреплённое по-прежнему открывается
    assert client.get(f"/api/v1/payment-occurrences/{occ_id}/receipt-file", headers=user).status_code == 200

    client.patch("/api/v1/settings", headers=admin, json={"uploads_enabled": True})
    assert upload(client, user, occ_id, PDF, "other.pdf").status_code == 200
    assert client.patch("/api/v1/settings", headers=admin, json={}).status_code == 422


# --- комментарии ---------------------------------------------------------------


def test_comment_on_payment(client, admin, user):
    occ_id = paid_occurrence(client, admin)
    url = f"/api/v1/payment-occurrences/{occ_id}"
    response = client.patch(url, headers=user, json={"comment": "  Оплачено с карты офиса\nсчёт №15  "})
    assert response.status_code == 200 and response.json()["comment"] == "Оплачено с карты офиса\nсчёт №15"
    assert client.patch(url, headers=user, json={"comment": ""}).json()["comment"] is None
    assert client.patch(url, headers=user, json={"comment": "x" * 1001}).status_code == 422
    assert client.patch(url, headers=user, json={"comment": "bell\x07"}).status_code == 422
    entry = client.get("/api/v1/audit-log", headers=admin, params={"action": "occurrence.comment"}).json()["items"]
    assert len(entry) == 2


# --- категории -----------------------------------------------------------------


def test_categories_crud_and_filters(client, admin, user):
    servers = client.post("/api/v1/categories", headers=admin, json={"name": "Серверы"})
    assert servers.status_code == 201, servers.text
    servers = servers.json()
    dup = client.post("/api/v1/categories", headers=admin, json={"name": "серверы"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "category_exists"
    office = client.post("/api/v1/categories", headers=admin, json={"name": "Офис"}).json()

    vps = create_payment(client, admin, name="VPS", category_id=servers["id"])
    assert vps["category_id"] == servers["id"] and vps["category_name"] == "Серверы"
    rent = create_payment(client, admin, name="Аренда")
    assert rent["category_id"] is None
    bad = client.post("/api/v1/recurring-payments", headers=admin, json={
        "name": "X", "amount": "1.00", "currency": "RUB", "next_due_date": "2026-11-01", "category_id": 999})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "category_not_found"

    listed = {c["name"]: c["payments_count"] for c in client.get("/api/v1/categories", headers=user).json()}
    assert listed == {"Офис": 0, "Серверы": 1}
    in_servers = occurrences(client, user, category_id=servers["id"])
    assert {o["name"] for o in in_servers} == {"VPS"} and in_servers[0]["category_name"] == "Серверы"
    assert {o["name"] for o in occurrences(client, user, category_id=0)} == {"Аренда"}

    moved = client.post("/api/v1/recurring-payments/bulk/category", headers=admin,
                        json={"ids": [vps["id"], rent["id"]], "category_id": office["id"]})
    assert moved.json() == {"changed": [vps["id"], rent["id"]], "unchanged": []}

    # у прекращённого платежа категорию менять можно, остальное — нет
    client.delete(f"/api/v1/recurring-payments/{rent['id']}", headers=admin)
    url = f"/api/v1/recurring-payments/{rent['id']}"
    assert client.patch(url, headers=admin, json={"category_id": None}).json()["category_id"] is None
    assert client.patch(url, headers=admin, json={"name": "y"}).status_code == 409

    renamed = client.patch(f"/api/v1/categories/{office['id']}", headers=admin, json={"name": "Офис и связь"})
    assert renamed.json()["name"] == "Офис и связь"
    assert client.delete(f"/api/v1/categories/{office['id']}", headers=admin).status_code == 204
    assert client.get(f"/api/v1/recurring-payments/{vps['id']}", headers=admin).json()["category_id"] is None
    assert client.post("/api/v1/categories", headers=user, json={"name": "Z"}).status_code == 403
