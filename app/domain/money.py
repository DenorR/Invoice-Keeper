from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

CENT = Decimal("0.01")


class Currency(StrEnum):
    RUB = "RUB"
    USD = "USD"
    EUR = "EUR"


CURRENCY_SYMBOLS = {Currency.RUB: "₽", Currency.USD: "$", Currency.EUR: "€"}


def to_minor(amount: Decimal) -> int:
    """Сумма в копейках/центах. В БД храним целые числа, чтобы не терять точность."""
    return int((amount * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def from_minor(minor: int) -> Decimal:
    return (Decimal(minor) / 100).quantize(CENT)


def format_amount(minor: int, currency: str) -> str:
    """85000.5 RUB → «85 000,50 ₽»."""
    value = from_minor(minor)
    integer, _, fraction = f"{value:.2f}".partition(".")
    grouped = f"{int(integer):,}".replace(",", " ")
    symbol = CURRENCY_SYMBOLS.get(Currency(currency), currency)
    return f"{grouped},{fraction} {symbol}"
