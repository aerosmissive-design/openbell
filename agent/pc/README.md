# OpenBell PC CGV Booking Agent

## 1. Install

On Windows, run `install.cmd` once. (Korean Windows: do not rely on `설치.bat` if it shows `'5001' is not recognized`.)

It checks Node.js, installs npm dependencies, and installs the Playwright Chromium browser.

Playwright officially supports Windows and provides `npx playwright install chromium` for the Chromium browser binary.

## 2. Configure

The installer creates `config.env` from `config.env.example`. Fill in:

- `BOOKING_MOVIE`
- `BOOKING_DATE`
- `BOOKING_SHOWTIME`
- `BOOKING_SEAT_COUNT`
- `BOOKING_SEAT_IDS`
- `NAS_WORKER_TOKEN` when the agent is connected to OpenBell APIs

Do not commit real tokens, cookies, or Playwright `storageState` files.

## 3. Run

Run `run-agent.cmd`.

The browser is headed by default (`PLAYWRIGHT_HEADLESS=false`). The flow opens the current CGV movie-booking entry page, selects the configured movie/date/time/seats, fills optional booking fields, advances only through safe non-payment buttons, and stops at `PAYMENT_READY`.

## 4. Hard stop

The agent never clicks a button containing payment/order/purchase/final-payment labels. When the payment stage is detected, it sets the internal stop flag and calls `onPaymentReady`.

If CGV presents a CAPTCHA, login challenge, or a page structure the agent cannot identify, the agent stops instead of attempting to bypass it.

## 5. Current CGV entry

The current CGV movie booking page is `https://cgv.co.kr/cnm/movieBook/movie`. CGV's live booking UI can change, so selectors should be maintained against the current page before unattended use.
