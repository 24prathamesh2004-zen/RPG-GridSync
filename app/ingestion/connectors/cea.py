"""CEA grid emission factor connector — D6.

Source: CEA CO2 Baseline Database (annual PDF).
https://cea.nic.in/wp-content/uploads/baseline/2024/01/User_Guide__Version_19.0.pdf

Grid emission factors by regional grid (Southern, Western, Northern, etc.)
in tCO2/MWh. We store the latest known values and update them when a new
CEA report is loaded.

D6 values are annual constants; no live API. They are loaded as
configuration and stored as Observations.
"""
from __future__ import annotations

# CEA CO2 Baseline Database v19 (2023 data, released Jan 2024)
# Grid-level combined margin emission factors in kgCO2/kWh (= tCO2/MWh × 1)
# Source: Table in User Guide v19
# States → regional grids:
#   Southern: Tamil Nadu, Karnataka, Andhra Pradesh, Telangana, Kerala
#   Western:  Maharashtra, Gujarat, Madhya Pradesh, Rajasthan, Chhattisgarh
#   Northern: Uttar Pradesh, Haryana, Delhi, Punjab, Himachal Pradesh, J&K
#   Eastern:  West Bengal, Bihar, Odisha, Jharkhand
#   NE:       Assam, Meghalaya, etc.

CEA_EMISSION_FACTORS_KG_PER_KWH: dict[str, float] = {
    "Southern": 0.722,
    "Western":  0.820,
    "Northern": 0.822,
    "Eastern":  0.895,
    "NE":       0.595,
    "default":  0.820,  # Western grid (covers most RPG plants)
}

STATE_TO_GRID: dict[str, str] = {
    "Gujarat":          "Western",
    "Maharashtra":      "Western",
    "Madhya Pradesh":   "Western",
    "Rajasthan":        "Western",
    "Tamil Nadu":       "Southern",
    "Karnataka":        "Southern",
    "Andhra Pradesh":   "Southern",
    "Telangana":        "Southern",
    "Kerala":           "Southern",
    "West Bengal":      "Eastern",
    "Odisha":           "Eastern",
    "Bihar":            "Eastern",
    "Jharkhand":        "Eastern",
    "Uttar Pradesh":    "Northern",
    "Delhi":            "Northern",
    "Punjab":           "Northern",
    "Haryana":          "Northern",
}

# Hourly shape factor: how much the grid carbon intensity varies by hour
# relative to the daily average (1.0 = average, < 1 = cleaner, > 1 = dirtier)
# Solar hours (9–16 IST) are cleaner; early evening (17–21 IST) is dirtier.
HOUR_CARBON_SHAPE: list[float] = [
    1.05, 1.05, 1.05, 1.05, 1.05, 1.02,  # 0–5 (night, coal dominant)
    0.98, 0.92, 0.85, 0.78, 0.72, 0.70,  # 6–11 (solar ramp-up)
    0.68, 0.70, 0.72, 0.80, 0.90, 1.02,  # 12–17 (solar peak then drop)
    1.10, 1.12, 1.10, 1.08, 1.06, 1.05,  # 18–23 (evening peak, dirtiest)
]


def get_emission_factor(state: str) -> float:
    """Return annual average grid emission factor for a state in kgCO2/kWh."""
    grid = STATE_TO_GRID.get(state, "default")
    return CEA_EMISSION_FACTORS_KG_PER_KWH.get(grid, CEA_EMISSION_FACTORS_KG_PER_KWH["default"])


def get_hourly_carbon_index(state: str, hour_ist: int) -> float:
    """Return modelled carbon intensity for a specific hour in kgCO2/kWh.

    Shapes the annual average factor by the time-of-day solar profile.
    Labelled 'modelled' — not a measured real-time value.
    """
    base = get_emission_factor(state)
    shape = HOUR_CARBON_SHAPE[hour_ist % 24]
    return round(base * shape, 4)
