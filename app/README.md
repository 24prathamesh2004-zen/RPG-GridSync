# GridSync Features, Calculations, and Data Limits

The app currently operates as a **planning and advisory model**, not an energy measurement or verification system. It combines plant setup information, tariff assumptions, exchange prices where available, and modeled carbon/weather profiles to suggest times to run flexible loads. **No current page calculates savings from plant meter readings.**

## Command Center

The Command Center is the daily situational view: choose a plant, inspect its 15-minute price/carbon profile, review registered power sources and frequency context, and open the schedule queue.

- **Price:** IEX prices are used when returned; EnergyMap is configured as a backup. If neither gives usable prices, the app generates a time-of-day tariff estimate. Missing blocks can also use the plant’s base tariff.
- **Carbon:** It starts from an annual CEA factor for the plant’s region and multiplies it by a fixed hour-of-day shape. For example, a western-region factor of 0.82 kg CO₂/kWh multiplied by the midday shape factor of 0.68 gives about 0.558 kg CO₂/kWh. That is a model, not a live plant or grid meter reading.
- **Best four-hour window:** It takes 16 consecutive 15-minute blocks, averages their combined scores, and chooses the lowest-scoring window. The score combines normalized daily price and carbon with an assumed captive-renewable availability factor. Weather-based solar/wind availability is a proxy, not measured generation.
- **Power-source mix:** This is based on the plant register’s source types. The display does not show measured contribution or actual generation by source.
- **Attention and pending recommendations:** These are prompts and recommendation records, not additional measured insights.

## Schedule

Schedule is the operational decision queue, one plant at a time. It shows the recommended start/end time, estimated saving and carbon reduction, confidence, and human approval status.

- **Time selection:** The optimizer compares the signal scores for candidate load windows against configured load duration and time constraints. It greedily schedules larger energy loads first. The schedule map prevents modeled recommendations from overlapping beyond an approximate contract-demand limit.
- **Cost estimate:** approximately  
  `load kW × run hours × (assumed baseline price − recommended-window price)`.  
  The baseline is an assumed “worse” window, not the plant’s actual current schedule or bill.
- **Carbon estimate:** approximately  
  `load kW × run hours × (assumed baseline carbon intensity − recommended-window carbon intensity)`.  
  Both carbon values are modeled.
- **Approve / reject / complete:** These record workflow decisions. “Complete” means a user marked the recommendation complete; it does **not** mean the app confirmed the load ran or measured its consumption. The daily job generates recommendations at its configured time, and manual generation fills missing recommendations for that date.

Treat the dollar and carbon values as **scenario estimates**, not realized savings.

## GridSync Agent

The global GridSync Agent is available across the application. It reads registered plant, tariff, signal, meter, supplier, savings-ledger, and schedule data through server-side tools. It distinguishes modeled estimates from recorded meter or ledger data. Schedule-change and approval proposals require Automated mode and explicit confirmation; confirmation creates or updates a recommendation for human review and never operates equipment.

## What Meter Data Would Change

With interval meter readings, the app could compare actual kWh and demand against a documented baseline for the same load and time period. That would support verified cost and carbon calculations. The application stores meter readings and the Agent can report their availability, but schedule completion is not itself proof that a load ran or that savings were measured.
