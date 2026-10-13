"""Descarrega as séries e gera data/series.json.

Fontes:
  - Weekly Oil Bulletin (Comissão Europeia): preços semanais de Portugal, EUR/1000 l
  - FRED: Brent diário em USD/barril (DCOILBRENTEU)

Se alguma coisa falhar ou os dados parecerem errados, o script termina com erro
e NÃO toca no ficheiro existente.
"""
import csv
import io
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "dados" / "semanal.json"

BULLETIN_PAGE = "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU"

# Colunas do Boletim (procuradas pelo nome do cabeçalho, não pela posição)
COLUMNS = {
    "Prices with taxes": {
        "gasolina": "PT_price_with_tax_euro95",
        "gasoleo": "PT_price_with_tax_diesel",
    },
    "Prices wo taxes": {
        "gasolina_sem_imp": "PT_price_wo_tax_euro95",
        "gasoleo_sem_imp": "PT_price_wo_tax_diesel",
    },
}

MIN_WEEKS = 1000  # o histórico tem ~1090 semanas desde 2005
MAX_STALE_DAYS = 28  # a última semana não pode ser mais antiga do que isto


def http_get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "combustiveis-site/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# --- Oil Bulletin -----------------------------------------------------------

def find_bulletin_url():
    """O nome do ficheiro e o link mudam; procura-o na página do Boletim."""
    html = http_get(BULLETIN_PAGE).decode("utf-8", errors="replace")
    links = re.findall(r'href="([^"]+\.xlsx[^"]*)"', html, flags=re.I)
    links = [l for l in links if "history" in l.lower()]
    if not links:
        raise RuntimeError("Link do Excel de histórico não encontrado na página do Boletim")
    return urljoin(BULLETIN_PAGE, links[0].replace("&amp;", "&"))


def parse_bulletin(xlsx_bytes):
    """Devolve {data: {campo: €/l}} para as semanas do Boletim."""
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    weeks = {}
    for sheet, fields in COLUMNS.items():
        rows = list(wb[sheet].iter_rows(values_only=True))
        header = rows[0]
        idx = {}
        for field, name in fields.items():
            if name not in header:
                raise RuntimeError(f"Coluna {name} não encontrada em '{sheet}'")
            idx[field] = header.index(name)
        for row in rows:
            if not isinstance(row[0], datetime):  # salta cabeçalhos e "Notes:"
                continue
            for field, i in idx.items():
                v = row[i]
                if isinstance(v, (int, float)) and v > 0:
                    weeks.setdefault(row[0].date(), {})[field] = round(v / 1000, 4)
    wb.close()
    return weeks


# --- FRED e BCE ---------------------------------------------------------------

def parse_fred(csv_bytes):
    """{data: USD/barril}; ignora feriados (valor vazio ou '.')."""
    out = {}
    for row in csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))):
        raw = (row.get("DCOILBRENTEU") or "").strip()
        if raw in ("", "."):
            continue
        out[date.fromisoformat(row["observation_date"] if "observation_date" in row else row["DATE"])] = float(raw)
    return out


# --- Montagem -----------------------------------------------------------------

def build_series(bulletin, brent_usd):
    weeks = []
    for monday in sorted(bulletin):
        week_days = [monday + timedelta(days=n) for n in range(7)]  # segunda a domingo
        usd = [brent_usd[d] for d in week_days if d in brent_usd]
        weeks.append({
            "date": monday.isoformat(),
            "brent_usd": round(sum(usd) / len(usd), 2) if usd else None,
            "gasolina": bulletin[monday].get("gasolina"),
            "gasoleo": bulletin[monday].get("gasoleo"),
            "gasolina_sem_imp": bulletin[monday].get("gasolina_sem_imp"),
            "gasoleo_sem_imp": bulletin[monday].get("gasoleo_sem_imp"),
        })
    return weeks


def validate(weeks):
    if len(weeks) < MIN_WEEKS:
        raise RuntimeError(f"Só {len(weeks)} semanas (esperado >= {MIN_WEEKS})")
    last = date.fromisoformat(weeks[-1]["date"])
    if (date.today() - last).days > MAX_STALE_DAYS:
        raise RuntimeError(f"Última semana ({last}) demasiado antiga")
    for w in weeks:
        for k in ("gasolina", "gasoleo"):
            v = w[k]
            if v is None or not 0.5 < v < 4:
                raise RuntimeError(f"{k} fora do intervalo plausível em {w['date']}: {v}")
        if w["brent_usd"] is not None and not 5 < w["brent_usd"] < 300:
            raise RuntimeError(f"Brent fora do intervalo plausível em {w['date']}: {w['brent_usd']}")
    with_brent = [w for w in weeks if w["brent_usd"] is not None]
    if len(with_brent) < len(weeks) * 0.95:
        raise RuntimeError("Demasiadas semanas sem Brent")


def main():
    bulletin_url = find_bulletin_url()
    print("Boletim:", bulletin_url)
    bulletin = parse_bulletin(http_get(bulletin_url))
    brent_usd = parse_fred(http_get(FRED_URL))
    print(f"Semanas: {len(bulletin)} | Brent: {len(brent_usd)} dias")

    weeks = build_series(bulletin, brent_usd)
    validate(weeks)

    payload = {
        "units": {"combustiveis": "EUR/litro (médias nacionais, segunda-feira)",
                  "brent_usd": "USD/barril (média da semana)"},
        "sources": {
            "combustiveis": "Weekly Oil Bulletin, Comissão Europeia",
            "brent": "FRED (série DCOILBRENTEU, origem EIA)",
        },
        "weeks": weeks,
    }
    # Só reescreve se os dados mudaram, para não gerar commits inúteis
    if OUT.exists() and json.loads(OUT.read_text(encoding="utf-8")).get("weeks") == weeks:
        print("Sem alterações.")
        return
    payload["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(OUT)
    print(f"Escrito {OUT} ({len(weeks)} semanas, última {weeks[-1]['date']})")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERRO:", e, file=sys.stderr)
        sys.exit(1)
