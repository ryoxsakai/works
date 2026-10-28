# User logo: isolated local integration

The user uploaded root `logo.png` to `claude/universal-app-design-4f5vzj` in commit `ded8ee8e416c31647248b14af2678853bead71f3`. This is not main. Its blob is `bb55d0eec3cebbe866679b7badf355379f6fde99`; SHA256 `d2b96812c576c2e13a0f8eac20e5515fec7c23fda3a4fc0ed79df031cc7be274`.

The actual pixels were inspected: 600×600 RGB PNG, opaque white background, watercolor blue/purple and light “Works” lettering, with built-in white margins. It is not transparent. No pixels, color, ratio or source file are changed. Only that exact asset is copied to `prototype/assets/works-logo.png`; none of the obsolete default branch's application code is merged. Existing main `shared/logo.png` is untouched.

Desktop uses the full square at 160px in the sidebar. Mobile uses the full square at 88px alongside the menu and current feature title, with the account controls in a second header row. Tablet uses 72px. The white background is preserved as a deliberate tile in dark mode; no filters, cropping, generated alternatives or background removal are used. Print omits navigation branding.

Work is isolated in local branch `feat/app-logo-local`, based on the tested stage-3 head. No push, PR, merge or production publication is authorized for this logo integration. The original user commit is not modified.

Validation uses synthetic sessions/data, byte/hash identity, image natural/rendered aspect ratio, mobile 320/390/768 and desktop1440 widths, light/dark visibility, header/content separation, menu access, and the existing shell browser regressions. Physical iPhone and production authenticated QA remain unverified.
