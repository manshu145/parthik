# PWA icons

`app/manifest.ts` references `icon-192.png` and `icon-512.png` here.

These are **not committed yet** because they must be generated from the real
Parthik logo, which is still pending brand direction from the product owner
(see the open item in `docs/DEVELOPMENT_PLAN.md` §10).

Required once the logo exists:

| File                   | Size    | Purpose         |
| ---------------------- | ------- | --------------- |
| `icon-192.png`         | 192×192 | maskable        |
| `icon-512.png`         | 512×512 | maskable        |
| `apple-touch-icon.png` | 180×180 | iOS home screen |
| `favicon.ico`          | 32×32   | browser tab     |

Until then the manifest resolves but the icons 404, so the app is not yet
installable. That is deliberate and tracked rather than filled with placeholder
artwork that could reach production.
