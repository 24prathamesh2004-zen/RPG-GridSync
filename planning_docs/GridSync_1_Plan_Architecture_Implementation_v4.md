# RPG GridSync — End-to-End Plan, Architecture and Implementation Guide (v4)

Companion files: `GridSync_2_Data_Points_v4.md` (data points D1–D16) and `GridSync_3_RPG_Site_Register_v4.md` (RPG plants and how they get power).

**Fact labels:** ✔ verified in a public source (links are in files 2 and 3) · ◐ my inference, to confirm · ? unknown. Numbers in this plan are targets or formulas, not results.

---

## 1. The idea in one page

GridSync moves flexible, non-urgent electricity use at RPG plants (CEAT, KEC and others) into windows when power is cheaper and cleaner, without changing output or quality. Results roll up per company and for the Group:

```
Plant shifts a flexible load → plant power bill drops → Group sees predictable flexible demand
→ Procurement buys green / bulk power better → carbon intensity falls → loan KPI improves
```

**What changed in this version:** we cannot rely on internal data at the start. So the product is built in three layers, and the first layer needs only public data.

| Layer | What it gives | Data it needs | Can start now? |
|---|---|---|---|
| **L1 Grid and Tariff Intelligence** | For every RPG plant: today's and tomorrow's price signal, carbon index, best windows, and value per kW of flexibility, from real public data | D1–D7, D13–D16 | **Yes** |
| **L2 Plant Twin** | Each plant's flexible loads, meter data, constraints, power-source mix; recommendations specific to the plant | D8–D11 via forms and CSV uploads | After L1 and a pilot plant says yes |
| **L3 Control and Impact** | Approve-to-run, automation, verified savings, carbon and loan-KPI evidence | L2 plus D12 and plant controls | Later |

---

## 2. What the public research shows about RPG (details in file 3)

- **CEAT** has six India plants (Bhandup, Nashik, Nagpur, Ambernath, Halol, Kanchipuram) ✔. About 49% of its energy is renewable and it targets about 60% after a 59 MW wind-solar hybrid group captive project with CleanMax serving **Halol (Gujarat)** and **Kanchipuram (Tamil Nadu)** ✔. Bhandup and Nashik share a 5 MW captive wind project and have rooftop solar ✔. Chennai has 5 MW rooftop solar ✔.
- **KEC International** has five India plants: towers at Nagpur, Jabalpur, Jaipur; cables at Vadodara and Mysore (now KEC Asian Cables) ✔. Captive solar at Nagpur, Jaipur, Jabalpur, Vadodara; green-power PPAs at multiple factories ✔. FY2024-25 electricity about 56.9 million kWh, about 24% renewable (company-wide) ✔.
- **Other companies:** Raychem RPG (Halol, Vasai, Chakan, Naigaon) and RPG Life Sciences (Ankleshwar, Navi Mumbai) exist ✔ but no power detail was found; Zensar and Harrisons were not assessed.
- **Not public:** plant meter data, load profiles, tariff category, contract demand, PPA terms.

**Consequences for the product**
1. Plants buy power differently, so GridSync uses **three plant archetypes** (section 3).
2. State ToD rules are shifting toward solar-hour rebates, so tariffs are **configuration with effective dates**.
3. Where captive wind or solar exists, the target is **captive-matched consumption**, not only low utility tariff.

---

## 3. Product definition

### 3.1 Plant archetypes
| | Power sources | What the optimiser targets |
|---|---|---|
| **A. Utility only** | Distribution company, ToD tariff | Avoid peak surcharge slots; use rebate slots; respect contract demand |
| **B. Utility + rooftop solar** | A plus on-site solar | A, plus run flexible loads when rooftop output is high |
| **C. Utility + group captive / open access** | A or B plus captive wind-solar or exchange purchase | B, plus follow captive generation and, if exchange-linked, 15-minute prices |

### 3.2 Users and jobs
| User | Job | Screen |
|---|---|---|
| Plant engineer | Know when to run a batch or cycle, safely | Schedule |
| Plant energy manager | Cut the bill, keep data right | Schedule, Loads and data |
| Group Procurement | Know how much flexible demand exists and when | Impact |
| CFO, Treasury, Sustainability (group and each company) | Verified savings, carbon, loan KPI evidence | Impact |
| Group leadership | Is it working? | Overview |

### 3.3 What GridSync does on day one with no plant data
Shows, for each plant, from real public data: current and next-day price signal, carbon index, the best four-hour windows, and the annual value per kW of shifting a flexible load (file 2, section 5). This is what gets shown to a plant to earn the right to ask for their data.

### 3.4 Modes
Advisory (notify) → Approve to run (one tap) → Automated (inside approved limits). Set per load, not per plant.

---

## 4. End-to-end data flow: how data comes in and what happens

```
 ① SOURCES               ② INGEST              ③ STORE & CLEAN        ④ SIGNALS            ⑤ DECIDE
 IEX prices D1,D2   ─┐
 Grid-India D3,D4   ─┤   scheduled pullers      raw files kept          price signal         optimiser
 CEA D5,D6          ─┼─▶ + parsers          ─▶  parsed to 15-min   ─▶  carbon index     ─▶  chooses start times
 State SLDC D13     ─┤   (retry, late flags)    time-series DB          captive index        per load, per plant
 Open-Meteo D7      ─┤                          quality checks          window scores
 Regulator D15      ─┤   manual load                                    baseline load
 Plant D8–D12       ─┘   (forms, CSV, later push)

 ⑥ RECOMMEND ─▶ ⑦ APPROVE ─▶ ⑧ EXECUTE ─▶ ⑨ MEASURE ─▶ ⑩ REPORT
 reason, saving,    plant engineer    advisory: human runs  meter data vs        savings and carbon ledger,
 carbon, confidence  taps approve /   approve-to-run: gateway baseline, per run   firmness, loan KPI evidence,
                    reject + reason   automated: gateway                         group roll-up
```

### 4.1 A day in the life (times are configurable)
| When (IST) | What happens |
|---|---|
| Every 15 min | Pull D2 and D13; check D3; ingest any plant meter files (D8) |
| Hourly | Refresh D7 weather and solar forecast; refresh signals |
| Each morning | Fetch D4 and D5 for the previous day; recalibrate carbon index; data-health report |
| After day-ahead market results | Fetch D1 for next day; recompute next-day price signals |
| Evening | Run the planner for each plant (inputs: signals, D9 loads, D10 plan); produce recommendations; notify plant engineers |
| Night to morning | Recommendations approved or rejected; for automated loads the gateway runs the schedule |
| After each run | Compare actual meter data with baseline; update ledger; record overrides and reasons |
| Monthly | Calibrate carbon index; review forecast error; produce company and group reports |

### 4.2 What if something goes wrong
| Event | Behaviour |
|---|---|
| Source late or missing | Use the fallback in file 2, mark the recommendation lower confidence, show it on Data health |
| Operator override | Respect it instantly, re-plan the rest, record the reason |
| Frequency below 49.90 Hz (if D3 on) | Hold flexible loads that have not started |
| Plant link down | Edge gateway runs the last approved schedule, else the original |
| Production plan changes | Re-plan; notify only if a recommendation changes |

---

## 5. Architecture

### 5.1 Components
```
┌───────────────────────────── EXPERIENCE ─────────────────────────────┐
│ Web app (Overview · Schedule · Impact · Loads and data)  ·  Alerts    │
│ via email, WhatsApp/Teams  ·  Exports (XLSX, PDF)                     │
└───────────────▲──────────────────────────────────────────────────────┘
                │ REST + WebSocket          SSO, roles, audit log
┌───────────────┴──────────────── APPLICATION SERVICES ────────────────┐
│ Plant & tariff config · Load register · Planner/Optimiser ·           │
│ Recommendation & approval workflow · Impact ledger · Reporting        │
└───────▲───────────────────────▲──────────────────────▲───────────────┘
        │                       │                      │
┌───────┴────────┐   ┌──────────┴─────────┐   ┌────────┴───────────────┐
│ SIGNAL ENGINE  │   │ DATA PLATFORM      │   │ AGENT (language model)  │
│ price, carbon, │◀──│ ingestion, parsers,│   │ explain, draft          │
│ captive, window│   │ time-series DB,    │   │ constraints, answer     │
│ forecasts      │   │ raw store, quality │   │ questions; never writes │
└────────────────┘   └──────────▲─────────┘   │ to plant systems        │
                                │             └─────────────────────────┘
     public sources D1–D7, D13–D15       plant uploads D8–D12
                                                   │ later
                                      ┌────────────┴────────────┐
                                      │ SITE EDGE GATEWAY        │
                                      │ OPC UA / Modbus / MQTT   │
                                      │ allow-listed commands,   │
                                      │ local fallback schedule  │
                                      └──────────────────────────┘
```

### 5.2 Suggested technology (a starting point, change to RPG IT standards)
| Need | Suggestion |
|---|---|
| Language | Python for ingestion, signals, optimiser; TypeScript/React for the app |
| Orchestration | Start with a scheduler such as Prefect or Airflow (cron is fine for week 1) |
| Database | PostgreSQL with TimescaleDB for time-series; object storage for raw files |
| Optimiser | OR-Tools CP-SAT or a MILP solver |
| Forecasts | Start with simple models (seasonal averages, gradient boosting) |
| API | FastAPI |
| Dashboards for engineers | Grafana for internal ops views, React app for users |
| Edge (later) | Small industrial gateway with OPC UA and Modbus drivers; outbound-only connection |
| Hosting | Cloud region in India, containers, separate dev, test and production |

### 5.3 Core data model
```
Group ─< Company ─< Plant ─< PowerSource (utility | rooftop | captive | open_access)
                    Plant ─< TariffSchedule (slots, rates, effective_from)
                    Plant ─< FlexLoad ─< LoadRule (window, order, pause, min_gap)
                    Plant ─< MeterReading (15-min)
Source ─< Observation (data_point_id, entity, block_start, value, unit, status, received_at)
Signal (plant, block, price, carbon, captive_idx, window_score, version)
Plan ─< Recommendation (load, from, to, reason, saving, carbon, confidence)
Recommendation ─< ExecutionEvent (recommended, approved, rejected, started, done, overridden)
LedgerEntry (plant, period, baseline_cost, actual_cost, avoided_cost, baseline_co2, actual_co2, method, data_versions)
KPI (company, definition, target, baseline, method)
AuditLog
```

### 5.4 Key calculations
| Item | Method |
|---|---|
| **Price per block** | Utility: tariff slot rate for that block. Exchange-linked: D1 or D2 price plus charges |
| **Carbon index** | D6 factor shaped by hour (lower in sunny hours from D7), calibrated against D4 and D13; labelled modelled |
| **Window score** | `w_price × price + w_carbon × carbon − w_captive × captive_availability + stress penalty` (weights per plant) |
| **Optimiser** | Minimise energy cost + carbon weight × carbon + demand charge, subject to each load's window, order rules, pause rule, minimum gap, contract demand and crew limits |
| **Baseline (counterfactual)** | The load's cost had it run at its original time. Agreed with Finance and the lender before pilot go-live |
| **Avoided cost** | Baseline cost − actual cost, from meter data |
| **Firmness** | Delivered shifted MW ÷ promised shifted MW, rolling 30 days |

### 5.5 Safety and security
- Read-only by default into plant systems.
- Automated control only through a site gateway: allow-listed tags, rate limits, interlock checks, one-click revert, full command log.
- SSO, role-based access (operator, plant manager, company finance, group procurement, admin), audit log of every approval and override.
- Plant data isolated per company; the Group sees aggregates unless the plant allows more.
- The language agent has no write access to any plant system; every constraint it drafts needs human confirmation.

---

## 6. Implementation plan

### 6.1 Phase 0 (weeks 0–2): foundation and first questions
| Task | Output |
|---|---|
| Choose one pilot company and plant to approach (suggest CEAT Halol) | Sponsor and plant champion named |
| Set up repo, environments, database, scheduler | Working skeleton |
| Enter plant register (file 3) as data | D16 loaded |
| Enter tariff configuration for Gujarat, Maharashtra, Tamil Nadu from the regulator orders | D15 loaded with effective dates |
| Send the plant the "first ask" list (file 3, section 7) | Requests tracked |

### 6.2 Phase 1 (weeks 3–6): Grid and Tariff Intelligence (L1), all public data
| Sprint | Build | Done when |
|---|---|---|
| 1 (wk 3–4) | Pullers and parsers for D6, D7, D1, D2; D13 for Gujarat; time-series store; data-health page | 7 days of data arriving unattended; late and missing flagged |
| 2 (wk 5–6) | D4, D5, D14 ingestion; carbon index v1; price and window signals per plant; "value per kW" analysis on 12 months of history; **Grid Signals Console** (Overview and Schedule screens in read-only form) | Senior can see real, today's windows for each RPG plant and the value per kW |

### 6.3 Phase 2 (weeks 7–12): Plant Twin (L2) with one pilot plant
| Sprint | Build | Done when |
|---|---|---|
| 3 (wk 7–8) | Load register form and CSV import (D9); meter CSV import (D8); tariff editor; plant profile and power-source map | Pilot plant's loads and 3 months of meter data loaded |
| 4 (wk 9–10) | Optimiser v1; recommendations with reasons; approve and reject with reason; notifications; shadow mode (recommend, do not require action) | Daily recommendations produced and reviewed by engineers |
| 5 (wk 11–12) | Baseline and savings ledger (draft); live advisory at pilot plant; forecast-accuracy tracking | First measured saving on real meter data, agreed baseline |

### 6.4 Phase 3 (weeks 13–26): Control and Impact (L3), scale
- Edge gateway for one load, approve-to-run, then automated with interlocks and drills.
- Per-company ledger and group roll-up; evidence pack; loan KPI tracking (D12) with agreed carbon method.
- Onboard second plant (CEAT Kanchipuram), then KEC Vadodara; capture captive-matching rules per contract.
- Procurement view: flexible demand by hour and captive coverage.

### 6.5 Team
Product owner, 1–2 data engineers, 1 backend and optimisation engineer, 1 frontend engineer, part-time energy domain expert, plant champion, finance and sustainability contacts.

### 6.6 Pilot design
- **Shadow mode first:** compute what would have been recommended and what it would have saved, without asking the plant to change anything.
- **Then live advisory** on a small set of loads.
- Compare against the agreed baseline; record every override and reason.
- Success: engineers accept most recommendations, measured saving matches expectation, zero output or quality incidents.

---

## 7. Wireframe review: what is missing, by tab

The current wireframe (`GridSync_3_Wireframe_FINAL.html`) shows the idea well but is built around the earlier assumptions. Gaps, by priority (P0 needed for pilot, P1 for scale, P2 later):

### Overview
| Gap | Priority |
|---|---|
| Power-source mix per plant (utility, rooftop, captive, exchange) and archetype tag | P0 |
| Drill-down Group → Company → Plant; date range | P0 |
| "What changed since yesterday" and tomorrow's best windows | P0 |
| Confidence badges and "how was this calculated" on every number | P0 |
| Empty and onboarding states for plants without data | P0 |
| Alerts summary (late data, overrides, constraint breaches) | P1 |

### Schedule
| Gap | Priority |
|---|---|
| Captive and rooftop generation overlay and contract-demand line on the timeline | P0 |
| Reason drawer per recommendation: which signals drove the choice, confidence | P0 |
| Reject or override reason capture; role-based approval | P0 |
| Mode per load, not per plant; execution status (sent, started, completed, verified) | P0 |
| What-if: change a constraint and re-plan | P1 |
| Conflict view when two loads compete for crew or demand | P1 |
| Calendar view and notifications (email, WhatsApp, Teams) | P1 |

### Impact
| Gap | Priority |
|---|---|
| Baseline method shown and selectable; confidence ranges on savings | P0 |
| Per-company ledger with group roll-up | P0 |
| Carbon method selector (location-based, market-based including captive, time-matched) with a clear label | P0 |
| Loan KPI mapped per company, with thresholds and the lender's definition | P0 |
| Assumptions editor for procurement and financing value (kept apart from measured numbers) | P1 |
| Procurement view by hour with captive coverage; export to XLSX and PDF | P1 |
| Evidence pack content and auditor view | P1 |

### Loads and data
| Gap | Priority |
|---|---|
| Plant profile: state, distribution company, tariff category, contract demand, power sources | P0 |
| Tariff schedule editor with effective dates | P0 |
| Onboarding wizard (plant, power sources, tariff, loads, meter upload, confirm) | P0 |
| CSV import with validation and error report | P0 |
| Data-quality inbox: late, missing, suspect, with fallback in use | P0 |
| Source management (schedules, credentials, last parse result), lineage view | P1 |
| Users, roles, audit log | P1 |
| Connector status for gateways (later) | P2 |

### Screens to add
Plant profile and onboarding; Alerts and inbox; Reports; Settings (users, roles, notifications). Keep the main navigation at four items; put these under Loads and data or a top-bar menu.

I did not rebuild the wireframe in this version. It should be updated to match this plan (archetypes, power-source mix, onboarding, data inbox) once you confirm the direction.

---

## 8. Questions you will be asked, with answers

| Question | Answer |
|---|---|
| **How does the plant get its power?** | It differs by plant. Public information shows a mix of utility supply, rooftop solar and group captive wind or solar (file 3). We classify each plant as A, B or C and confirm from the plant's bill and agreements |
| **How does data come in?** | Public data is pulled on schedules (file 2, section 4). Plant data starts as uploads and forms; direct feeds come later. Everything is aligned to 15-minute blocks and tagged fresh, late, estimated or missing |
| **What if a feed is late or wrong?** | Retry, fall back to a safe default, lower the recommendation's confidence, show it in the data inbox, and keep the original file |
| **What do you do with no plant data?** | Layer 1: real public signals and value per kW per plant. That is enough to start the conversation with real numbers |
| **How is carbon calculated?** | Grid emission factor (CEA) shaped by hour from solar forecast, calibrated to public generation data; labelled modelled. Which carbon method counts for loans is decided with Treasury and the lender |
| **How do you handle captive wind-solar?** | The plant profile records the captive source and its matching rules. The optimiser then favours hours of high captive generation. We must confirm the matching and banking rules for each contract |
| **How do you prove savings?** | Meter data against an agreed baseline (the original schedule's cost), per run, with an audit trail |
| **How do you protect production?** | Each load carries its own rules; engineers approve; interlocks and one-click revert for automation; zero-incident target |
| **Who controls machines?** | Nobody in v1. Advisory first; automation only per load after a track record and plant sign-off |
| **What do you need from the plant?** | Bill details, contract demand, 15-minute meter data, flexible-load list and rules, next-day plan (file 2, section 3) |
| **What is the evidence this is worth doing?** | Sizing from public data: value per kW per plant, and KEC's roughly 56.9 million kWh a year as an example of scale. Real value is measured in the pilot |

---

## 9. Risks and open decisions

| Risk or decision | Handling |
|---|---|
| Tariff gap on fixed ToD may be small (reported Gujarat peak surcharge 45 paise; verify) | Compute value per kW from real orders in Sprint 2 before promising savings |
| Captive project status and matching rules unknown | First question to CEAT Procurement and CleanMax |
| Public web sources change or limit access | Raw file storage, parser tests, written permission or data-sharing route where possible |
| Carbon benefit may not count for lender KPIs | Agree method with Treasury and lender before the pilot ends |
| Plant resistance | Show real windows and value first; shadow mode; easy reject; champion at plant |
| Open-Meteo free tier is non-commercial | Budget a paid plan for production |
| JV and subsidiary governance (Raychem, KEC Asian Cables) | Check approvals before onboarding |

**Decisions needed this week:** pilot company and plant; sponsor; whether to approach CEAT Procurement about the CleanMax contract; technology stack and hosting approval; who owns data-sharing with state sources.
