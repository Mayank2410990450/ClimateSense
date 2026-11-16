# Dataset sources and provenance

ClimateSense does not automatically download observations. Users should obtain data from the dataset provider, observe its terms and citation requirements, then import a compatible CSV. Retain the source name, station/grid identifier, original unit, download date, and any transformations in your own record. The current UI records an uploaded filename and marks its origin as user-supplied; it cannot independently verify provenance.

Potential public sources:

- NASA GISTEMP: https://data.giss.nasa.gov/gistemp/
- NOAA Global Historical Climatology Network Monthly (GHCN-M): https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-monthly
- Berkeley Earth data: https://berkeleyearth.org/data/

Provider downloads may be gridded, multi-column, or use provider-specific missing-value conventions. Convert them to one monthly observation per date/location with explicit units before import; do not treat sentinel values as measured temperatures. The importer accepts date/time and temperature aliases listed in the README and reports invalid rows and duplicates removed.

The built-in demo is deterministic synthetic data designed for UI and pipeline testing. It is not sourced from NASA, NOAA, Berkeley Earth, or any station, and must not be used as evidence or presented as real climate measurements.