# 全国市町村・人口新陳代謝率ビューア

全国47都道府県・2023〜2025年の人口新陳代謝率を表示する、バックエンド不要の静的Webアプリです。

都道府県・年・新陳代謝率8%以上の条件に加え、市・町・村の自治体区分を個別に表示／非表示にできます。東京都の特別区は「市」に含めます。

## 表示する

リポジトリ直下でローカルHTTPサーバーを起動します。

```bash
uv run python -m http.server 4175
```

ブラウザで `http://127.0.0.1:4175/` を開いてください。`index.html` を直接開くと、ブラウザの制約によりJSONを読み込めません。

## データを再生成する

```bash
uv sync
uv run python scripts/generate_turnover_data.py
```

e-Statの公式Excelを `.cache/e-stat/` に保存し、`data/turnover.json` を生成します。対象年を追加するときは、`scripts/generate_turnover_data.py` の `FILE_URLS` と `DATA_YEARS` を更新します。

新陳代謝率は `(国内転入 + 国内転出) / 年初人口 × 100`、前年比は `(当年率 / 前年率 - 1) × 100` です。
