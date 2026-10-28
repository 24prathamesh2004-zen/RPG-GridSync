# RPG Group — Plants and How They Get Power (public information only)

Research date: 15 Oct 2026. Everything below comes from public documents (company filings, press releases, trade press). No internal RPG data was used.

**Status key:** ✔ found in a public source (link given) · ◐ my inference, confirm · ? not found publicly.

---

## 1. Companies in scope

| Company | Business | Industrial plants in India (public) | GridSync priority | Why |
|---|---|---|---|---|
| **CEAT** | Tyres | 6: Bhandup (Mumbai), Nashik, Nagpur, Ambernath (CEAT Specialty Tyres), Halol, Kanchipuram (Chennai) ✔ | **High** | Large electricity use, process loads (mixing, curing, compressors, cooling), active renewable-power programme |
| **KEC International** (cables now in **KEC Asian Cables Ltd**) | Power T&D EPC, towers, cables | 5: towers at Nagpur, Jabalpur, Jaipur; cables at Vadodara, Mysore ✔ | **High** | Induction and electric furnaces, galvanizing, cable lines; captive solar at four plants |
| **Raychem RPG** (50:50 JV with TE Connectivity) | Cable accessories, power equipment | Halol (Gujarat); Vasai, Chakan, Naigaon (Maharashtra) ✔ | Medium | JV, so check governance and consent before onboarding. No public power data found |
| **RPG Life Sciences** | Pharma | Ankleshwar, Gujarat (formulations); Navi Mumbai (API) ✔ | Low to medium | Regulated (GMP) processes limit flexibility. No public power data found |
| **Zensar** | IT services | Offices (not researched) | Low | No process loads; HVAC only |
| **Harrisons Malayalam** | Plantations | Kerala estates (not researched) | Not assessed | No public power data found in this pass |

Sources: RPG Group structure (https://en.wikipedia.org/wiki/RPG_Group, https://rpggroup.com/about-us); CEAT plants (https://autocarpro.in/news-national/ceat-opens-new-plant-in-tamil-nadu-plans-additional-rs-4-000-crore-investment-by-2030-55536); KEC plants (https://en.wikipedia.org/wiki/KEC_International, KEC BRSR below); Raychem RPG (https://cxotoday.com/press-release/raychem-rpg-achieves-significant-milestone-to-facilitate-faster-execution-in-electricity-distribution-projects-with-its-make-india-initiative/); RPG Life Sciences (https://rpglifesciences.com/website/our_brand.php).

---

## 2. CEAT, plant by plant

| Plant | State | What public sources say about power | Likely archetype (section 5) |
|---|---|---|---|
| **Bhandup, Mumbai** | Maharashtra | Rooftop solar. Shares 5 MW captive wind (Cleanwin Energy, Maharashtra) with Nashik; CEAT holds 26% to qualify as captive ✔ (2021). Distribution utility not confirmed: Mumbai has several licensees ? | C |
| **Nashik** | Maharashtra | Same as Bhandup: rooftop solar plus 5 MW captive wind ✔ | C |
| **Nagpur** | Maharashtra | No plant-specific power detail found ? | ◐ A or B |
| **Ambernath** (CEAT Specialty Tyres, subsidiary) | Maharashtra | No plant-specific power detail found ? Separate legal entity | ◐ A or B |
| **Halol** | Gujarat | At setup (2009) power came from the state electricity board's local substation 500 m away ✔. Jan 2026: ~59 MW wind-solar hybrid projects with CleanMax under **group captive** serve Halol and Kanchipuram; CEAT subscribes up to 26% of each project company; ~135.8 million units a year expected ✔. Whether the projects are already generating is unknown ? | C |
| **Kanchipuram (Chennai)** | Tamil Nadu | 5 MW rooftop solar, with plans for another 5 MW rooftop and a 10 MW group captive solar plant ✔ (undated article). Also in the CleanMax hybrid project above ✔ | C |

**CEAT company level:** about 49% of total energy from renewable sources, expected to reach about 60% with the CleanMax projects; goal of fully renewable by 2030 ✔ (https://mercomindia.com/ceat-to-augment-clean-power-use-from-cleanmaxs-59-mw-wind-solar-projects). An aggregator shows 47.66% of 4.37 million GJ for the latest year (https://tracenable.com/company/ceat/energy-management); treat the exact figure as approximate. "Energy" includes fuels, not only electricity.

Other sources: CleanMax project (https://pv-magazine-india.com/2026/01/14/ceat-partners-with-cleanmax-for-59-mw-hybrid-wind-solar-projects-for-captive-use); Cleanwin captive wind (https://mobilityoutlook.com/news/ceat-acquires-26-stake-in-cleanwin-energy-to-get-clean-power-on-captive-basis); Chennai solar (https://www.motorindiaonline.in/ceat-chennai-plant-setting-the-standard-for-smart-and-efficient-tyre-manufacturing/); Halol power at setup (https://tyrepress.com/2009/01/foundation-stone-laid-at-new-ceat-plant).

---

## 3. KEC International, plant by plant

| Plant | State | Product | What public sources say about power |
|---|---|---|---|
| **Nagpur** | Maharashtra | Towers | Captive solar installed or enhanced ✔. Zinc recovery electric heating furnace ✔ |
| **Jabalpur** | Madhya Pradesh | Towers | Captive solar ✔. Capacity being expanded ✔ |
| **Jaipur** | Rajasthan | Towers and steel structures | Rooftop solar ✔. Capacity expanded ✔ |
| **Vadodara** | Gujarat | Cables, conductors | About 70% renewable energy; rooftop solar installed ✔. Aluminium conductor and railway conductor lines ✔ |
| **Mysore** | Karnataka | Cables | About 96% renewable energy ✔ |

**KEC company level (FY2024-25 BRSR):**
- Electricity use: 49,212 GJ renewable plus 155,603 GJ non-renewable, about **56.9 million kWh**, of which about **24% renewable**. These figures cover the whole company including project sites, so plant-level splits are not public.
- Power purchase agreements for green power have been signed across multiple factory locations ✔.
- Electric heating and induction furnaces are used in bending, zinc recovery and cable melting ✔, which are candidate flexible loads.
- The cables business moved into the wholly owned subsidiary **KEC Asian Cables Limited** on 1 Jan 2025 ✔, so it is a separate entity for loans and reporting.

Sources: KEC BRSR FY2024-25 (https://nsearchives.nseindia.com/corporate/KEC_17072025173341_SEIntimation_BRSR.pdf); cable plant renewable shares (https://www.wirecable.in/?p=34429); plant list (https://en.wikipedia.org/wiki/KEC_International).

---

## 4. What the public sources let us conclude

1. **RPG plants do not all buy power the same way.** Expect a mix of utility supply, rooftop solar, group captive wind or solar, and green PPAs. This changes what GridSync should optimise at each plant.
2. **Several plants are in states where ToD rules are changing** toward cheaper solar hours. The tariff must be configurable, with effective dates, never hard-coded.
3. **Where power comes from captive wind or solar, the best time to run a flexible load is when that generation is high**, not only when the utility tariff is low.
4. **Plant-level meter data, load profiles, tariff category, contract demand and PPA terms are not public.** They are the first things to request, and the product must work without them on day one (see plan, section 3).

---

## 5. Plant archetypes (used in the plan and the wireframe)

| Archetype | Power sources | What GridSync optimises | Examples (to confirm) |
|---|---|---|---|
| **A. Utility only** | State distribution company on a ToD tariff | Move flexible load out of peak surcharge periods and into rebate periods; stay under contract demand | Nagpur and Ambernath (CEAT), KEC towers (before captive solar) |
| **B. Utility + rooftop solar** | A plus on-site solar | Also move load into sunny hours to use own solar | Chennai (CEAT), KEC Jaipur, Vadodara |
| **C. Utility + group captive or open access** | A or B plus wind-solar hybrid or exchange purchase | Also move load to hours of high captive generation (cheaper, cleaner); where bought on the exchange, follow 15-minute prices | Halol and Kanchipuram (CEAT), Bhandup and Nashik (CEAT) |

How captive energy is matched to consumption and what happens to unused energy depend on the state and the contract. Confirm per plant (15-minute block matching, banking rules, charges).

---

## 6. State context for the plants above

| State | Plants | Regulator | Likely distribution company (confirm from bill) | State grid operator data | Notes from public sources |
|---|---|---|---|---|---|
| **Gujarat** | CEAT Halol; KEC Vadodara; Raychem Halol; RPG Life Sciences Ankleshwar | GERC | MGVCL for Halol and Vadodara ◐ | SLDC Gujarat publishes real-time state data (home: https://www.sldcguj.com, confirm) | Gujarat Grid Code 2026 uses 15-minute scheduling and a 49.90–50.05 Hz band ✔ (https://www.constructionworld.in/energy-infrastructure/power-and-renewable-energy/gujarat-notifies-2026-grid-code-for-renewable-integration/98622). Another Gujarat distribution company's FY27 order adds 45 paise per unit during morning and evening peaks ✔ (https://solarquarter.com/2026/03/27/gerc-issues-ugvcl-tariff-order-for-fy27-projects-%e2%82%b9906-crore-surplus-and-introduces-green-tariff/). A vendor blog reports HT industrial energy charge flat at ₹4.3 per unit and a ₹0.40 night rebate; verify in the GERC order ✔ (https://bridgewaypower.in/blog/gujarat-gerc-ht-tariff-2026-27) |
| **Maharashtra** | CEAT Bhandup, Nashik, Nagpur, Ambernath; KEC Nagpur; Raychem Vasai, Chakan, Naigaon; RPG Life Sciences Navi Mumbai | MERC | MSEDCL for most; Mumbai varies ◐ | State load despatch centre (MSLDC) | MERC's 5-year tariff orders from FY2025-26 introduced revised ToD with solar-hour rebates; the published press note covers Tata Power's Mumbai distribution business ✔ (https://merc.gov.in/wp-content/uploads/2025/03/Press-Note_MYT-Order_TPC_English.pdf). A trade circular says the MSEDCL order cuts average HT-industry prices by about 15% in FY2025-26 ✔ (https://dcciapune.org/wp-content/uploads/2025/04/GENERAL-CIRCULAR-No-107.pdf). The exact HT-industrial ToD slots and rates must be read from the MSEDCL order |
| **Tamil Nadu** | CEAT Kanchipuram | TNERC | State distribution company ◐ | TN SLDC | Not researched in detail |
| **Madhya Pradesh** | KEC Jabalpur | MPERC | ◐ | MP SLDC | Not researched |
| **Rajasthan** | KEC Jaipur | RERC | ◐ | Rajasthan SLDC | Not researched |
| **Karnataka** | KEC Mysore | KERC | Mysore distribution company ◐ | Karnataka SLDC publishes ~15-minute state data ✔ (https://huggingface.co/datasets/happyman11/Karnataka-SLDC describes it) | Not researched |

National rule behind the trend: ToD tariffs for commercial and industrial consumers above 10 kW were mandated from 1 April 2024, and states are introducing solar-hour rebates through tariff proceedings (https://www.dailyexcelsior.com/understanding-tod-rebates-and-surcharges-in-jks-new-power-tariff/, https://powerpeakdigest.com/tgerc-rules-solar-hour-rebates-require-full-tariff-process/).

---

## 7. Unknowns to close in the first two weeks (ask, do not guess)

| Unknown | Who knows | Why it matters |
|---|---|---|
| Distribution company, tariff category, contract demand per plant | Plant energy manager, electricity bill | Price signal and demand limit |
| Whether the CleanMax and Cleanwin projects supply power today, and how energy is matched (15-minute blocks, banking) | CEAT Procurement, CleanMax | Defines the optimisation target at Halol and Kanchipuram |
| Rooftop solar capacity and metering | Plant | Self-consumption target |
| 15-minute meter data and who can export it | Plant, utility portal | Baseline and savings proof |
| Flexible loads and their rules | Plant engineers | The core input |
| Loan KPI definitions, carbon method accepted by lenders | Treasury, Sustainability | Whether carbon shifting counts |

---

## 8. Suggested pilot order

1. **CEAT Halol** (Gujarat): archetype C, strong public information, large process loads.
2. **CEAT Kanchipuram** (Tamil Nadu): archetype C with rooftop solar, shares the CleanMax project with Halol.
3. **KEC Vadodara** (Gujarat): archetype B, electric melting and heating loads, high renewable share, so the price signal matters more than carbon.
