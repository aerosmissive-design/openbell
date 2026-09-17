# CGV Playwright Booking Agent

The PC agent is structured as a non-payment booking runner: movie -> date/time -> seats -> booking information -> payment stage.

The final payment/order action is intentionally not implemented. When the payment stage is detected, the agent sets an internal hard-stop and emits `onPaymentReady`.

CGV's current web booking entry is `https://cgv.co.kr/cnm/movieBook/movie`. Playwright locators should prefer role/text/label-based selectors and be updated against the live CGV DOM when the site changes.

Authentication should use a local Playwright storage state file. Never commit that file because it can contain session cookies.
