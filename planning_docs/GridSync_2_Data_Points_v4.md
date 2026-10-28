# RPG GridSync — Data Points (v4, public-data-first)

Sixteen data points, **D1–D16**. D1–D12 keep the IDs used earlier. D13–D16 are new, added after researching how RPG plants actually buy power (see `GridSync_3_RPG_Site_Register_v4.md`).

**Link status:** ✔ = page or file was found while researching. *Home* = official organisation site, exact data page to be confirmed in Sprint 1. Check each publisher's terms before commercial use and before automated collection.

**Principle:** public data (D1–D7, D13–D16) is enough to build and demo the first product layer with real numbers. Plant data (D8–D12) comes from the plant through simple uploads first, direct integration later.

---

## 1. Master list

| ID | Data point | Type | Cadence | Free source | Needed for v0 (public-only build)? |
|---|---|---|---|---|---|
| D1 | Day-ahead market price | Public | 15-min blocks, daily | IEX India | Yes |
| D2 | Real-time market price | Public | 15-min blocks | IEX India | Yes |
| D3 | Grid frequency | Public | ~1 min | Grid-India; SLDCs | Optional |
| D4 | Generation by source, power supply position | Public | Daily | Grid-India | Yes |
| D5 | Plant-wise thermal, nuclear, hydro generation | Public | Daily | CEA / NPP portal | Yes |
| D6 | Grid emission factor | Public | Annual | CEA CO2 Baseline Database | Yes |
| D7 | Weather and solar forecast | Public | Hourly | Open-Meteo | Yes |
| D8 | Plant meter readings | Plant | 15 min | Plant meter / utility portal | No (upload later) |
| D9 | Flexible load register | Plant | On change | Plant engineers | No (form later) |
| D10 | Production plan | Plant | Daily | ERP / MES | No |
| D11 | Plant tariff category, contract demand, power-source mix | Plant | On change | Bill, utility agreement, PPAs | Partly (public tariff rules via D15) |
| D12 | Loan KPI and baseline | Company | Per facility | Treasury | No |
| **D13** | State grid data: demand, generation, renewable generation, frequency | Public | ~15 min | State SLDC websites | Yes (Gujarat, Maharashtra, Tamil Nadu first) |
| **D14** | Company disclosures: BRSR, annual reports, press releases | Public | Annual / event | NSE, BSE, company sites | Yes |
| **D15** | State tariff orders and ToD rules | Public | Annual, revised by orders | State regulators | Yes |
| **D16** | Plant register (location, state, utility, power-source mix) | Public + plant | On change | File 3, then plant confirmation | Yes |

---

## 2. Public data points, in detail

### D1 Day-ahead market price
- **Publisher:** IEX India. Home: https://www.iexindia.com (Market Data → Day-Ahead Market).
- **Content:** market clearing price for each 15-minute block of the next day, with volumes.
- **Format / access:** web tables and downloadable files. Confirm download format and terms.
- **Latency:** published once the day-ahead market clears. Confirm the daily time and treat it as configurable.
- **Use:** price signal for plants that buy on the exchange or open access; group procurement insight; training data for price forecasts.
- **Fallback:** the plant's ToD tariff (D15/D11).
- **Store:** `block_start_ist, price_rs_per_mwh, volume_mwh, market, received_at`.

### D2 Real-time market price
- **Publisher:** IEX India. ✔ https://www.iexindia.com/market-data/real-time-market/market-snapshot
- **Content:** market clearing price in 15-minute blocks; the page states 15-minute block data is available from 1 April 2022.
- **Use:** intraday adjustment; price model training; history for back-testing.
- **Fallback:** last D1 value.

### D3 Grid frequency (optional)
- **Publisher:** Grid-India (home https://grid-india.in) and state SLDC sites. ✔ History, 1-second, Dec 2020–Jun 2023: https://data.mendeley.com/datasets/bvwh9d6227/3
- **Content:** system frequency in Hz.
- **Use:** safety rule only: do not start a flexible load while frequency is below 49.90 Hz. The Gujarat Grid Code 2026 keeps the band at 49.90–50.05 Hz ✔ (https://www.constructionworld.in/energy-infrastructure/power-and-renewable-energy/gujarat-notifies-2026-grid-code-for-renewable-integration/98622).
- **Fallback:** skip the rule.

### D4 Generation by source, power supply position
- **Publisher:** Grid-India daily power supply position report. ✔ Sample file: https://report.grid-india.in/ReportData/Daily%20Report/PSP%20Report/2023-2024/June%202023/07.06.23_NLDC_PSP.pdf (newer files follow the same folder pattern on report.grid-india.in).
- **Content:** previous-day generation by source (coal, gas, hydro, nuclear, wind, solar and others), demand met, shortages.
- **Format:** PDF. Needs a parser; keep the raw PDF and alert if the layout changes.
- **Use:** monthly calibration of the carbon index; renewable-share trend.
- **Fallback:** last known mix.

### D5 Plant-wise thermal, nuclear, hydro generation
- **Publisher:** CEA daily generation report on the National Power Portal. ✔ Example: https://npp.gov.in/public-reports/cea/daily/dgr/06-06-2026/dgr1-2026-06-06.pdf (date appears twice in the path; change it for other days).
- **Content:** actual versus programme generation per station, daily. Excludes renewables.
- **Use:** "power generation plant data" view; check against D4; identify outages.
- **Fallback:** skip.

### D6 Grid emission factor
- **Publisher:** CEA CO2 Baseline Database. ✔ User guide v19: https://cea.nic.in/wp-content/uploads/baseline/2024/01/User_Guide__Version_19.0.pdf (use the newest version on cea.nic.in).
- **Content:** average and combined-margin grid emission factors (tCO2/MWh), by grid.
- **Use:** base of the carbon index; Scope 2 reporting (location-based).
- **Fallback:** previous year.

### D7 Weather and solar forecast
- **Publisher:** Open-Meteo. ✔ https://open-meteo.com/en/docs. Free for non-commercial use, no key; commercial use needs a paid plan. Alternative: India Meteorological Department (https://mausam.imd.gov.in, home).
- **Content:** hourly temperature, cloud cover, solar radiation, wind speed, for any latitude and longitude, forecast and history.
- **Use:** solar and wind availability near each plant (proxy for rooftop and captive output); cooling-load effects; solar dip in the carbon index.
- **Fallback:** last forecast, then seasonal average.

### D13 State grid data (SLDC)
- **Publishers:** state load despatch centres. Gujarat home: https://www.sldcguj.com (confirm). Maharashtra, Tamil Nadu, Madhya Pradesh, Rajasthan, Karnataka: each state SLDC site. The Karnataka SLDC portal shows state demand, generation and frequency at about 15-minute resolution ✔ (described at https://huggingface.co/datasets/happyman11/Karnataka-SLDC).
- **Content:** state demand, state generation, renewable generation (where shown), frequency, drawal.
- **Format:** web dashboards (scraping) or downloadable reports. Each state differs.
- **Use:** local stress signal and state-level wind-solar profile, which is the best free proxy for a captive hybrid project's output pattern.
- **Fallback:** national data (D4).
- **Note:** scraping needs written permission or a documented data-sharing route; ask the SLDC.

### D14 Company disclosures
- **Publishers:** NSE and BSE filings, company investor pages. ✔ KEC BRSR FY2024-25: https://nsearchives.nseindia.com/corporate/KEC_17072025173341_SEIntimation_BRSR.pdf
- **Content:** annual electricity use split renewable and non-renewable (in GJ), emissions, targets, plant lists, PPAs and captive projects, loan and rating documents.
- **Use:** top-down sizing of savings per company; baseline for carbon; facts for the site register.
- **Convert:** kWh = GJ ÷ 0.0036. KEC FY2024-25: 204,815 GJ ≈ 56.9 million kWh, about 24% renewable.
- **Limit:** company-wide, not plant-wise; includes project sites for EPC companies.

### D15 State tariff orders and ToD rules
- **Publishers:** state regulators: GERC, MERC, TNERC, MPERC, RERC, KERC (home pages: https://www.gercin.org, ✔ https://merc.gov.in, https://www.tnerc.gov.in, https://www.mperc.in, https://rerc.rajasthan.gov.in, https://kerc.karnataka.gov.in; confirm each) and the distribution companies.
- **Content:** HT-industrial energy and demand charges; ToD slots and surcharge or rebate; fuel and power purchase adjustment; open access and captive charges.
- **Format:** PDF orders. Read once per year and enter as **configuration with effective dates**, never as code.
- **Trend to design for:** ToD is moving toward solar-hour rebates ✔ (sources in file 3, section 6).
- **Reported Gujarat figures (verify in the GERC order):** FY27 order for another Gujarat distribution company adds 45 paise per unit in morning and evening peaks ✔; a vendor blog reports ₹0.40 night rebate and ₹4.3 per unit HT energy charge.

### D16 Plant register
- **Content:** per plant: company, name, state, latitude and longitude, distribution company, archetype (A/B/C), known power sources, status of confirmation.
- **Source:** `GridSync_3_RPG_Site_Register_v4.md` first; plants confirm and correct it during onboarding.

---

## 3. Plant and company data points (what to ask for, and the simplest way to get it)

| ID | Minimum needed | Simplest first route | Later route |
|---|---|---|---|
| D8 | 15-minute kWh (and kW, kVAh, power factor) for the main incomer; sub-meters for flexible loads if available | CSV export from the plant's energy system or the utility consumer portal | Meter gateway, SCADA/EMS, MQTT or OPC UA |
| D9 | For each flexible load: name, kW, run hours, earliest start, latest finish, order rules, can it pause, minimum gap | Web form or Excel template filled with plant engineers | Imported from MES |
| D10 | Next-day batch or shift plan | Daily email or upload | ERP/MES feed |
| D11 | Utility, tariff category, contract demand, ToD slots in force, captive/open-access/PPA details and how energy is matched | Copy from the electricity bill and agreements | Contract data store |
| D12 | Loan KPI, target, baseline year, carbon method accepted | Treasury note | Governed KPI definition in the app |

**CSV templates**

`meter_15min.csv`: `plant_id, block_start_ist, kwh, kw_avg, kvah, power_factor`

`flex_loads.csv`: `plant_id, load_id, name, kw, run_hours, earliest_start, latest_finish, can_pause, min_gap_hours, must_follow_load_id, notes`

`production_plan.csv`: `plant_id, date, load_id, planned_start, planned_end, quantity, owner`

`tariff_config.yaml`: per plant: `utility, category, effective_from, slots: [{name, from, to, rs_per_kwh_or_pct_adjust}], demand_charge, contract_demand_kva, captive: {type, share, matching: "15min"|"other", banking: ...}`

---

## 4. How data flows (cadence and handling)

Everything is stored in **15-minute blocks (IST)** with its original timestamp.

| Source | How it arrives | Schedule (configurable) | If late | If missing |
|---|---|---|---|---|
| D1 | Pull | Once daily after market results | Retry every 10 min for 2 h | Use plant ToD |
| D2 | Pull | Every 15 min | Retry next cycle | Use last D1 value |
| D3, D13 | Pull (scrape or download) | Every 1 to 15 min | Retry, mark late | Skip rule or use national data |
| D4, D5 | Pull PDF | Once each morning | Retry hourly until noon | Last known mix |
| D6, D15 | Manual load | Annual, on new order | n/a | Previous version |
| D7 | Pull API | Hourly | Retry | Last forecast |
| D8 | Upload now; push later | Daily upload now; every 15 min later | Mark late; wait up to 60 min | Estimate from the same hours on recent days, flag estimated |
| D9, D10, D11 | Form or file | On change | n/a | Last version |
| D14 | Manual or semi-automatic | On new filing | n/a | n/a |

**Fields on every record:** `data_point_id, entity (plant or area), block_start_ist, received_at, value, unit, status (fresh | late | estimated | suspect | missing), source_version`.

**Quality rules:** range checks (price within market limits, frequency 49–51 Hz, non-negative generation); flat-line and spike detection; unit and time-zone check at ingestion; PDF layout change alarm; duplicates and revisions kept as versions.

**Raw storage:** keep every original file (PDF, CSV, JSON) untouched, then parse. This gives an audit trail.

---

## 5. Signals built from the data

| Signal | Formula or method | Inputs |
|---|---|---|
| **Price signal (utility)** | ToD tariff for the block (base charge ± slot adjustment) | D15, D11 |
| **Price signal (exchange)** | D1 or D2 price per block plus applicable charges | D1, D2, D15 |
| **Carbon index (modelled)** | D6 average factor × hour shape. Hour shape: lower in sunny hours using D7 radiation, calibrated monthly against the solar share from D4 and D13. Labelled "modelled" | D4, D6, D7, D13 |
| **Captive availability index** | Hourly wind-solar profile for the plant's state (D13), or modelled from D7 near the plant, scaled to captive capacity | D7, D13, D16 |
| **Stress flag** | Frequency below 49.90 Hz, or state demand near its recent high | D3, D13 |
| **Window score per hour** | Weighted: lower price, lower carbon, higher captive availability, no stress | all signals, per plant archetype |
| **Plant baseline load** | History of D8 with calendar and D10 | D8, D10 |

**Value per kW of flexibility (needs only public data):** for any plant, take a standard 100 kW load running 4 hours. Compare its cost at the typical time with the cheapest 4-hour window each day over the past 12 months, using D15 (and D1/D2 where exchange-linked). The result, in ₹ per kW per year, is real and can be shown before any plant data exists. Multiply by the plant's actual flexible kW once D9 arrives.

---

## 6. Data governance and legal checklist
- Record the terms of use for each source; keep a note of permission for automated collection.
- Open-Meteo: non-commercial free tier only; plan a paid plan for production.
- PDF sources can change layout without notice; keep parsers versioned and tested.
- Plant data belongs to the plant; the group sees aggregates unless permission is given.
- Do not scrape faster than the site allows; cache results; identify the client.
- Keep a lineage record: which data version each recommendation used.

---

## 7. Build priority

| Priority | Data points | Sprint |
|---|---|---|
| 1 | D15, D16, D6, D7 | 1 |
| 2 | D1, D2, D13 (Gujarat first) | 1 to 2 |
| 3 | D4, D5, D14 | 2 to 3 |
| 4 | D8, D9, D11 (CSV and forms) | 3 to 4 |
| 5 | D10, D12, D3 | 5 onward |
