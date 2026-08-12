#!/usr/bin/env python3
"""Generate static nationwide municipality turnover data from e-Stat workbooks."""

from __future__ import annotations

import argparse
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests


FILE_URLS = {
    2023: (
        "https://www.e-stat.go.jp/stat-search/file-download"
        "?fileKind=0&statInfId=000040306647"
    ),
    2024: (
        "https://www.e-stat.go.jp/stat-search/file-download"
        "?fileKind=0&statInfId=000040306672"
    ),
    2025: (
        "https://www.e-stat.go.jp/stat-search/file-download"
        "?fileKind=0&statInfId=000040306653"
    ),
    2026: (
        "https://www.e-stat.go.jp/stat-search/file-download"
        "?fileKind=0&statInfId=000040479049"
    ),
}
DATA_YEARS = (2023, 2024, 2025)
USER_AGENT = "Mozilla/5.0 (compatible; MunicipalityTurnoverDataGenerator/1.0)"


def normalize_code6(value: object) -> str | None:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    if not text.isdigit():
        return None
    return text.zfill(6)


def download_workbook(year: int, cache_dir: Path) -> bytes:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{year % 100:02d}-03.xlsx"
    if cache_path.exists():
        return cache_path.read_bytes()

    response = requests.get(
        FILE_URLS[year],
        headers={"User-Agent": USER_AGENT},
        timeout=180,
    )
    response.raise_for_status()
    cache_path.write_bytes(response.content)
    return response.content


def read_workbook(content: bytes) -> pd.DataFrame:
    raw = pd.read_excel(
        io.BytesIO(content),
        header=None,
        dtype=object,
        engine="openpyxl",
    )
    if raw.shape[1] <= 13:
        raise ValueError(f"Unexpected workbook width: {raw.shape[1]}")

    header_rows = raw.index[
        raw.apply(
            lambda row: row.astype(str).str.strip().eq("団体コード").any(),
            axis=1,
        )
    ].tolist()
    if not header_rows:
        raise ValueError("Could not find the municipality-code header row")

    body = raw.iloc[header_rows[0] + 1 :].copy()
    data = pd.DataFrame(
        {
            "code6": body.iloc[:, 0].map(normalize_code6),
            "prefecture": body.iloc[:, 1].astype(str).str.strip(),
            "municipality": body.iloc[:, 2].astype(str).str.strip(),
            "population": pd.to_numeric(body.iloc[:, 5], errors="coerce"),
            "domestic_in": pd.to_numeric(body.iloc[:, 7], errors="coerce"),
            "domestic_out": pd.to_numeric(body.iloc[:, 13], errors="coerce"),
        }
    )
    return data[data["code6"].notna()].copy()


def is_municipality(data: pd.DataFrame) -> pd.Series:
    standard = data["municipality"].str.endswith(("市", "町", "村"))
    tokyo_special_ward = data["prefecture"].eq("東京都") & data[
        "municipality"
    ].str.endswith("区")
    return standard | tokyo_special_ward


def municipality_metrics(
    files: dict[int, pd.DataFrame], year: int
) -> pd.DataFrame:
    population = files[year][is_municipality(files[year])][
        ["code6", "prefecture", "municipality", "population"]
    ].copy()
    flow = files[year + 1][is_municipality(files[year + 1])][
        ["code6", "domestic_in", "domestic_out"]
    ].copy()
    merged = population.merge(flow, on="code6", how="inner", validate="one_to_one")
    # e-Stat includes six Northern Territories villages with zero population.
    # A turnover rate is undefined for them, so they are not displayable records.
    merged = merged[merged["population"] > 0].copy()
    merged["turnover_pct"] = (
        (merged["domestic_in"] + merged["domestic_out"])
        / merged["population"]
        * 100
    )
    return merged


def as_number(value: object, *, integer: bool = False) -> int | float:
    if pd.isna(value):
        raise ValueError("A required numeric value is missing")
    return int(value) if integer else round(float(value), 6)


def build_payload(files: dict[int, pd.DataFrame]) -> dict[str, object]:
    yearly = {year: municipality_metrics(files, year) for year in DATA_YEARS}
    base = yearly[DATA_YEARS[0]][["code6", "prefecture", "municipality"]].copy()

    records: dict[str, dict[str, object]] = {}
    for row in base.itertuples(index=False):
        records[row.code6] = {
            "code": row.code6,
            "prefecture": row.prefecture,
            "name": row.municipality,
            "metrics": {},
        }

    for year, frame in yearly.items():
        for row in frame.itertuples(index=False):
            if row.code6 not in records:
                continue
            records[row.code6]["metrics"][str(year)] = {
                "population": as_number(row.population, integer=True),
                "domestic_in": as_number(row.domestic_in, integer=True),
                "domestic_out": as_number(row.domestic_out, integer=True),
                "turnover_pct": as_number(row.turnover_pct),
            }

    complete = [
        record
        for record in records.values()
        if all(str(year) in record["metrics"] for year in DATA_YEARS)
    ]
    for record in complete:
        metrics = record["metrics"]
        for year in DATA_YEARS:
            current = metrics[str(year)]
            if year == DATA_YEARS[0]:
                current["change_from_previous_pct"] = None
                current["change_from_previous_points"] = None
                continue
            previous = metrics[str(year - 1)]["turnover_pct"]
            current["change_from_previous_pct"] = round(
                (current["turnover_pct"] / previous - 1) * 100, 6
            )
            current["change_from_previous_points"] = round(
                current["turnover_pct"] - previous, 6
            )

    prefectures: dict[str, dict[str, object]] = {}
    for record in complete:
        prefecture_name = record.pop("prefecture")
        prefecture_code = record["code"][:2]
        prefecture = prefectures.setdefault(
            prefecture_code,
            {"code": prefecture_code, "name": prefecture_name, "municipalities": []},
        )
        prefecture["municipalities"].append(record)

    for prefecture in prefectures.values():
        prefecture["municipalities"].sort(key=lambda item: item["code"])

    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "years": list(DATA_YEARS),
        "formula": "(domestic_in + domestic_out) / population * 100",
        "change_formula": "(current_turnover / previous_turnover - 1) * 100",
        "sources": [
            {"file_year": year, "url": FILE_URLS[year]}
            for year in sorted(FILE_URLS)
        ],
        "prefectures": [prefectures[key] for key in sorted(prefectures)],
    }
    return payload


def validate_payload(payload: dict[str, object]) -> None:
    prefectures = payload["prefectures"]
    if len(prefectures) != 47:
        raise ValueError(f"Expected 47 prefectures, found {len(prefectures)}")
    aichi = next(item for item in prefectures if item["name"] == "愛知県")
    if len(aichi["municipalities"]) != 54:
        raise ValueError(
            f"Expected 54 Aichi municipalities, found {len(aichi['municipalities'])}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/turnover.json"),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(".cache/e-stat"),
    )
    args = parser.parse_args()

    files = {
        year: read_workbook(download_workbook(year, args.cache_dir))
        for year in sorted(FILE_URLS)
    }
    payload = build_payload(files)
    validate_payload(payload)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    municipality_count = sum(
        len(prefecture["municipalities"])
        for prefecture in payload["prefectures"]
    )
    print(
        f"Wrote {args.output} with {len(payload['prefectures'])} prefectures "
        f"and {municipality_count} municipalities"
    )


if __name__ == "__main__":
    main()
