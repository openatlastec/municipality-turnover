"use strict";

const DATA_URL = "data/turnover.json";
const SVG_NS = "http://www.w3.org/2000/svg";
const numberFormatter = new Intl.NumberFormat("ja-JP");

const state = {
  data: null,
  prefecture: null,
  year: null,
  thresholdOnly: false,
  selectedMunicipalityCode: null,
};

const elements = {
  prefectureInput: document.querySelector("#prefecture-input"),
  prefectureList: document.querySelector("#prefecture-list"),
  prefectureError: document.querySelector("#prefecture-error"),
  yearSelect: document.querySelector("#year-select"),
  thresholdToggle: document.querySelector("#threshold-toggle"),
  dataMeta: document.querySelector("#data-meta"),
  status: document.querySelector("#status"),
  turnoverChart: document.querySelector("#turnover-chart"),
  changeChart: document.querySelector("#change-chart"),
  summaryCount: document.querySelector("#summary-count"),
  summaryRegion: document.querySelector("#summary-region"),
  summaryAverage: document.querySelector("#summary-average"),
  summaryTopValue: document.querySelector("#summary-top-value"),
  summaryTopName: document.querySelector("#summary-top-name"),
  summaryChange: document.querySelector("#summary-change"),
  summaryChangePeriod: document.querySelector("#summary-change-period"),
  detailHeading: document.querySelector("#detail-heading"),
  detailPopulation: document.querySelector("#detail-population"),
  detailIn: document.querySelector("#detail-in"),
  detailOut: document.querySelector("#detail-out"),
  detailTurnover: document.querySelector("#detail-turnover"),
  detailChange: document.querySelector("#detail-change"),
  detailPoints: document.querySelector("#detail-points"),
};

function svgElement(tag, attributes = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (text !== null) node.textContent = text;
  return node;
}

function formatPercent(value, digits = 2, signed = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function formatPoints(value) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} pt`;
}

function shortMunicipalityName(name) {
  return name.replace(/^.+郡(?=.+[町村]$)/, "");
}

function setStatus(message = "") {
  elements.status.hidden = !message;
  elements.status.textContent = message;
}

function findPrefecture(name) {
  const normalized = name.trim();
  return state.data.prefectures.find((item) => item.name === normalized) || null;
}

function visibleMunicipalities() {
  if (!state.prefecture || !state.year) return [];
  const yearKey = String(state.year);
  return state.prefecture.municipalities
    .filter((item) => item.metrics[yearKey])
    .filter(
      (item) =>
        !state.thresholdOnly || item.metrics[yearKey].turnover_pct >= 8,
    )
    .sort(
      (first, second) =>
        second.metrics[yearKey].turnover_pct - first.metrics[yearKey].turnover_pct,
    );
}

function renderSummary(municipalities) {
  const metrics = municipalities.map((item) => item.metrics[String(state.year)]);
  elements.summaryCount.textContent = `${municipalities.length} 市町村`;
  elements.summaryRegion.textContent = `${state.prefecture.name}・${state.year}年`;

  if (!metrics.length) {
    elements.summaryAverage.textContent = "—";
    elements.summaryTopValue.textContent = "—";
    elements.summaryTopName.textContent = "該当なし";
    elements.summaryChange.textContent = "—";
    elements.summaryChangePeriod.textContent = "—";
    return;
  }

  const average = metrics.reduce((sum, item) => sum + item.turnover_pct, 0) / metrics.length;
  elements.summaryAverage.textContent = formatPercent(average);
  elements.summaryTopValue.textContent = formatPercent(metrics[0].turnover_pct);
  elements.summaryTopName.textContent = municipalities[0].name;

  const changes = metrics
    .map((item) => item.change_from_previous_pct)
    .filter((value) => value !== null);
  if (changes.length) {
    const averageChange = changes.reduce((sum, value) => sum + value, 0) / changes.length;
    elements.summaryChange.textContent = formatPercent(averageChange, 2, true);
    elements.summaryChangePeriod.textContent = `${state.year - 1} → ${state.year}`;
  } else {
    elements.summaryChange.textContent = "—";
    elements.summaryChangePeriod.textContent = "前年データなし";
  }
}

function addGrid(svg, width, height, left, right, maxValue, signed = false) {
  const plotWidth = width - left - right;
  const ticks = signed ? 6 : 5;
  for (let index = 0; index <= ticks; index += 1) {
    const ratio = index / ticks;
    const x = left + plotWidth * ratio;
    svg.append(
      svgElement("line", {
        x1: x,
        x2: x,
        y1: 28,
        y2: height - 12,
        stroke: "#dedbd1",
        "stroke-width": 1,
      }),
    );
    const value = signed ? -maxValue + ratio * maxValue * 2 : ratio * maxValue;
    svg.append(
      svgElement(
        "text",
        { x, y: 19, "text-anchor": "middle", fill: "#69736f", "font-size": 12 },
        `${value.toFixed(0)}%`,
      ),
    );
  }
}

function addRowInteraction(group, municipality) {
  group.classList.add("chart-row");
  group.setAttribute("tabindex", "0");
  group.setAttribute("role", "button");
  group.setAttribute("aria-label", `${municipality.name}の詳細を表示`);
  const select = () => {
    state.selectedMunicipalityCode = municipality.code;
    renderDetails(municipality);
  };
  group.addEventListener("click", select);
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
}

function renderTurnoverChart(municipalities) {
  elements.turnoverChart.replaceChildren();
  if (!municipalities.length) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "条件に該当する市町村がありません。8%以上の絞り込みを解除してください。";
    elements.turnoverChart.append(message);
    return;
  }

  const width = 1040;
  const left = 190;
  const right = 92;
  const rowHeight = 38;
  const top = 32;
  const height = top + municipalities.length * rowHeight + 12;
  const maxRate = Math.ceil(
    Math.max(...municipalities.map((item) => item.metrics[String(state.year)].turnover_pct)) /
      5,
  ) * 5;
  const plotWidth = width - left - right;
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${state.prefecture.name}${state.year}年の市町村別人口新陳代謝率`,
  });
  addGrid(svg, width, height, left, right, maxRate);

  municipalities.forEach((municipality, index) => {
    const metric = municipality.metrics[String(state.year)];
    const y = top + index * rowHeight;
    const group = svgElement("g");
    addRowInteraction(group, municipality);
    group.append(svgElement("rect", { class: "bar-background", x: 0, y, width, height: rowHeight, fill: "transparent" }));
    group.append(
      svgElement(
        "text",
        { x: left - 14, y: y + 24, "text-anchor": "end", fill: "#18201e", "font-size": 13 },
        shortMunicipalityName(municipality.name),
      ),
    );
    const barWidth = (metric.turnover_pct / maxRate) * plotWidth;
    group.append(
      svgElement("rect", {
        class: "bar",
        x: left,
        y: y + 7,
        width: Math.max(barWidth, 2),
        height: 22,
        rx: 4,
        fill: "#176b53",
      }),
    );
    group.append(
      svgElement(
        "text",
        { x: left + barWidth + 9, y: y + 23, fill: "#18201e", "font-size": 12, "font-weight": 700 },
        formatPercent(metric.turnover_pct),
      ),
    );
    group.append(
      svgElement(
        "title",
        {},
        `${municipality.name}\n人口 ${numberFormatter.format(metric.population)}人\n転入 ${numberFormatter.format(metric.domestic_in)}人 / 転出 ${numberFormatter.format(metric.domestic_out)}人`,
      ),
    );
    svg.append(group);
  });
  elements.turnoverChart.append(svg);
}

function renderChangeChart(municipalities) {
  elements.changeChart.replaceChildren();
  const yearKey = String(state.year);
  const hasPrevious = state.year !== Math.min(...state.data.years);
  if (!hasPrevious) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = `${state.year}年は収録期間の最初の年のため、前年からの変化率はありません。`;
    elements.changeChart.append(message);
    return;
  }
  if (!municipalities.length) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "表示対象がありません。";
    elements.changeChart.append(message);
    return;
  }

  const width = 1040;
  const left = 190;
  const right = 92;
  const rowHeight = 38;
  const top = 32;
  const height = top + municipalities.length * rowHeight + 12;
  const changes = municipalities.map((item) => item.metrics[yearKey].change_from_previous_pct);
  const maxMagnitude = Math.max(5, Math.ceil(Math.max(...changes.map(Math.abs)) / 5) * 5);
  const plotWidth = width - left - right;
  const center = left + plotWidth / 2;
  const halfWidth = plotWidth / 2;
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${state.prefecture.name}${state.year - 1}年から${state.year}年の人口新陳代謝率変化`,
  });
  addGrid(svg, width, height, left, right, maxMagnitude, true);
  svg.append(svgElement("line", { x1: center, x2: center, y1: 28, y2: height - 12, stroke: "#18201e", "stroke-width": 1.3 }));

  municipalities.forEach((municipality, index) => {
    const metric = municipality.metrics[yearKey];
    const change = metric.change_from_previous_pct;
    const y = top + index * rowHeight;
    const barWidth = (Math.abs(change) / maxMagnitude) * halfWidth;
    const x = change >= 0 ? center : center - barWidth;
    const group = svgElement("g");
    addRowInteraction(group, municipality);
    group.append(svgElement("rect", { class: "bar-background", x: 0, y, width, height: rowHeight, fill: "transparent" }));
    group.append(
      svgElement(
        "text",
        { x: left - 14, y: y + 24, "text-anchor": "end", fill: "#18201e", "font-size": 13 },
        shortMunicipalityName(municipality.name),
      ),
    );
    group.append(
      svgElement("rect", {
        class: "bar",
        x,
        y: y + 7,
        width: Math.max(barWidth, 2),
        height: 22,
        rx: 4,
        fill: change >= 0 ? "#2f6c82" : "#c95348",
      }),
    );
    group.append(
      svgElement(
        "text",
        {
          x: change >= 0 ? x + barWidth + 8 : x - 8,
          y: y + 23,
          "text-anchor": change >= 0 ? "start" : "end",
          fill: "#18201e",
          "font-size": 12,
          "font-weight": 700,
        },
        formatPercent(change, 1, true),
      ),
    );
    svg.append(group);
  });
  elements.changeChart.append(svg);
}

function renderDetails(municipality) {
  const metric = municipality.metrics[String(state.year)];
  elements.detailHeading.textContent = `${municipality.name}・${state.year}年`;
  elements.detailPopulation.textContent = `${numberFormatter.format(metric.population)} 人`;
  elements.detailIn.textContent = `${numberFormatter.format(metric.domestic_in)} 人`;
  elements.detailOut.textContent = `${numberFormatter.format(metric.domestic_out)} 人`;
  elements.detailTurnover.textContent = formatPercent(metric.turnover_pct);
  elements.detailChange.textContent = formatPercent(metric.change_from_previous_pct, 2, true);
  elements.detailPoints.textContent = formatPoints(metric.change_from_previous_points);
}

function render() {
  if (!state.prefecture || !state.year) return;
  setStatus();
  const municipalities = visibleMunicipalities();
  renderSummary(municipalities);
  renderTurnoverChart(municipalities);
  renderChangeChart(municipalities);

  const selected = municipalities.find(
    (item) => item.code === state.selectedMunicipalityCode,
  );
  if (selected) {
    renderDetails(selected);
  } else if (municipalities.length) {
    state.selectedMunicipalityCode = municipalities[0].code;
    renderDetails(municipalities[0]);
  } else {
    state.selectedMunicipalityCode = null;
    elements.detailHeading.textContent = "表示対象がありません";
    [
      elements.detailPopulation,
      elements.detailIn,
      elements.detailOut,
      elements.detailTurnover,
      elements.detailChange,
      elements.detailPoints,
    ].forEach((element) => { element.textContent = "—"; });
  }
}

function applyPrefectureInput() {
  const prefecture = findPrefecture(elements.prefectureInput.value);
  if (!prefecture) {
    elements.prefectureError.textContent = "候補から正しい都道府県名を選んでください。";
    return;
  }
  elements.prefectureError.textContent = "";
  state.prefecture = prefecture;
  state.selectedMunicipalityCode = null;
  render();
}

function bindEvents() {
  elements.prefectureInput.addEventListener("change", applyPrefectureInput);
  elements.prefectureInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyPrefectureInput();
  });
  elements.yearSelect.addEventListener("change", () => {
    state.year = Number(elements.yearSelect.value);
    state.selectedMunicipalityCode = null;
    render();
  });
  elements.thresholdToggle.addEventListener("change", () => {
    state.thresholdOnly = elements.thresholdToggle.checked;
    state.selectedMunicipalityCode = null;
    render();
  });
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();

    state.data.prefectures.forEach((prefecture) => {
      const option = document.createElement("option");
      option.value = prefecture.name;
      elements.prefectureList.append(option);
    });
    state.data.years.forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = `${year}年`;
      elements.yearSelect.append(option);
    });
    elements.yearSelect.disabled = false;

    state.year = Math.max(...state.data.years);
    state.prefecture = findPrefecture("愛知県") || state.data.prefectures[0];
    elements.yearSelect.value = String(state.year);
    elements.prefectureInput.value = state.prefecture.name;
    const generatedDate = new Date(state.data.generated_at).toLocaleDateString("ja-JP");
    elements.dataMeta.textContent = `${state.data.years[0]}〜${state.year}年・${generatedDate}生成`;
    render();
  } catch (error) {
    console.error(error);
    setStatus(
      "データを読み込めませんでした。index.htmlを直接開かず、ローカルHTTPサーバーから表示してください。",
    );
    elements.dataMeta.textContent = "データ読込エラー";
  }
}

initialize();
