# IP Address Detector

Compare exit IPs reported by domestic, international, and Cloudflare endpoints, and test Google connectivity in your browser.

[中文文档](./README.zh.md)

## Usage

Serve this directory with a static server or open `index.html` directly (browser cross-origin rules may limit detection). Checks start automatically.

- IPs appear immediately; optional geolocation loads in the background.
- Stop a running check while retaining completed results, or start a new round.
- Retry an individual failed or stopped check without clearing other results.
- Copy an individual IP or all available IP results. Google connectivity is excluded from IP copying.
- Supports IPv4, IPv6, mobile layouts, keyboard controls, and reduced motion.

## Interpreting results

| Check         | Method                                                         |
| ------------- | -------------------------------------------------------------- |
| Domestic      | Race domestic endpoints and accept the first valid IP          |
| International | Race ipinfo, ipify, ip.sb, and other endpoints                 |
| Google        | Probe 204 endpoints for a response; no inferred Google exit IP |
| Cloudflare    | Race trace endpoints and accept the first valid IP             |

Slower competing requests are cancelled after success. Domestic requests have a 6-second timeout; other probes allow 7 seconds and geolocation allows 5 seconds. Timeouts cover both response headers and body consumption.

Summaries count only valid, normalized IPs. Identical IPs do not prove a direct connection; differing IPs do not prove split routing. IPv4/IPv6 pairs are described as dual-stack results. Any failed check marks the result incomplete, without interpreting API errors or browser restrictions as evidence of network blocking.

An opaque Google response hides the HTTP status and cannot prove full service availability. Reported duration measures a detection request, not ICMP ping. Third-party location data may be inaccurate.

## Development

Vanilla JavaScript and CSS with no framework or build step.

- `core.js`: IP validation, normalization, explicit result states, and summaries.
- `browser-utils.js`: response-body timeouts, cancellation signals, and location caching.
- `detectors.js`: parallel probes, first valid responses, and background geolocation.
- `ui-components.js`: cards, summary, and clipboard feedback.
- `ui.js`: application state and rendering.
- `app.js`: detection lifecycle, stopping, individual retries, and events.
- `index.html` / `styles.css`: markup and responsive layout.

Run checks:

```bash
node --test *.test.js
```

To add a source, edit `DOMESTIC_APIS` or `FOREIGN_APIS` in `detectors.js`. Provide a `url` and a `parse` function returning `{ ip, location }`, or use `parseText: true` for plain-text IP responses.

## Privacy

This page has no analytics, ads, or persistent result storage. Requests reach third-party detection services, which see the request's source IP. Geolocation also sends the detected IP to ipinfo.io. Location results are cached only in page memory. Requests omit cookies and referrers; third-party services follow their own privacy policies.

## License

MIT
