# Browser-only USB2000 interface

Verified in Chrome on this Apple Silicon Mac with USB2000 serial USB2E142 on 2026-09-28: device permission/selection, opening and claiming its USB interface, reading factory wavelength calibration, live 2048-pixel spectra, changing exposure from 10 to 20 ms, and downloading CSV and PNG. Downloaded CSV contents were checked. Full physical dark/reference/reflectance validation and Windows hardware testing remain outstanding.

## Open

Open the GitHub Pages site in Chrome or Edge as a standalone tab (not embedded in the course LMS). Click Connect spectrometer and choose Ocean Optics USB2000. Only one tab or application can use the instrument at a time. Close the Python acquisition app first. Pause before saving matched CSV and plot files. Disconnect releases the device and clears calibration captures.

This directory is a standalone static website: `index.html` and `usb2000.mjs`. Acquisition and calculations run entirely in the browser; there are no Python acquisition endpoints or cloud uploads. The local Python HTTP server only serves the files for this test. For student distribution, host these files on an HTTPS website; students then need no local web server or Python installation. GitHub Pages serves the repository root over HTTPS.

For local development, from this directory run `python3 -m http.server 8765 --bind 127.0.0.1`. The original Python app remains in the parent directory as a fallback; do not run both acquisition paths simultaneously.

## Platform scope

- Chrome on macOS: tested with the original USB2000, VID 2457 / PID 1002.
- Chrome/Edge on Windows: not yet tested. A compatible WinUSB driver association may require one-time setup, which a website cannot install.
- Other models, including USB2000+, are deliberately excluded because packet formats differ.
- WebUSB requires a secure context (HTTPS or localhost) and a device permission granted through the browser chooser. Browser or organization policies can disable it.

## Protocol and calculation

The browser reads EEPROM slots 0–4 for serial number and wavelength polynomial; it does not write EEPROM or firmware. Commands initialize the device, choose normal trigger mode, set exposure in integer milliseconds, query calibration, and request spectra. USB2000 output has 64 low bytes followed by 64 high bytes per 64-pixel block; high bytes are masked to 4 bits. The calibration and decoding follow the protocol implemented in python-seabreeze 2.11.0:

- https://github.com/ap--/python-seabreeze/blob/main/src/seabreeze/pyseabreeze/devices.py
- https://github.com/ap--/python-seabreeze/blob/main/src/seabreeze/pyseabreeze/features/spectrometer.py
- https://github.com/ap--/python-seabreeze/blob/main/src/seabreeze/pyseabreeze/features/eeprom.py
- https://developer.chrome.com/docs/capabilities/usb

Five scans are averaged for dark and reference. Exposure changes clear both. Relative reflectance is 100*(sample-dark)/(reference-dark), with the same weak-reference and saturation masking as the Python prototype. No automatic dark-count or nonlinearity correction is enabled. Data remains in memory until downloaded. Closing/reloading loses unsaved data and captures.

## Tests

Run `node test.mjs` for packet decoding, reflectance masking, and exposure validation tests. These are software checks, separate from the real Chrome hardware test above.
