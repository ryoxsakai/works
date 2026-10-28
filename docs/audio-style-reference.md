# Audio styling reference for Works

Reference read on 2026-10-28; source commit `b8aa92a920689c28bd6f3d32e634182d5a9300a0` (2026-09-07).

- [CNAME](https://github.com/ryoxsakai/textaudio/blob/b8aa92a920689c28bd6f3d32e634182d5a9300a0/CNAME) contains `audio.lrnr.jp`, establishing the repository/domain relationship.
- [Actual inline CSS](https://github.com/ryoxsakai/textaudio/blob/b8aa92a920689c28bd6f3d32e634182d5a9300a0/index.html) was read from the repository. This is source inspection, not live-screen inspection or proof of the currently deployed commit.
- Direct public-page reading failed: execution-environment CONNECT tunnel returned HTTP 403 (`curl` exit 56); web open reported the URL unavailable. No access-control workaround was attempted.

| Aspect | Audio CSS observed | Prior Works integration | Applied local policy |
|---|---|---|---|
| Accent | `#5B8DEF`; 135° blue to `#8B7FE8` gradient | Command blue `#2563eb`, no saturated gradient | Preserve Works command blue; use audio gradient as a 3px decorative header strip |
| Soft gradient | `#EAF1FE` to `#EDE8FD` | Existing Works `#dbeafe` to `#ede9fe` | Use audio's softer gradient for the home welcome panel |
| Surface | White cards, `#F3F7FC` background | White cards, `#f7f9fd` background | Adopt `#F3F7FC` behind white surfaces |
| Text/border | `#28324A` / `#DCE6F4` | `#17283e` / `#d6dfed` | Adopt audio body text and decorative border; retain stronger control borders |
| Shadow | Low-opacity blue (`rgba(80,120,200,.08)`) | Mostly borders | Apply subtle shadow to feature cards only |
| Muted/action contrast | Muted `#95A3BA`, light primary `#5B8DEF` | Darker muted `#53647b`, stronger command blue | Keep Works values for normal text and action contrast |
| Header image | Gradient overlay and `bg.png`, white text | Plain header | Do not copy background imagery; retain plain, readable action header |
| Dark mode | No dark-mode CSS found in the inspected inline stylesheet | Explicit dark palette | Retain Works dark palette; the decorative strip stays separate from text backgrounds |

Calculated white-background contrast for the source colors: audio primary 3.23:1, purple 3.33:1, muted 2.55:1; Works command blue 5.17:1. Therefore the saturated audio gradient is decorative, not the background of small white action text. This is an integration decision for Works, not a full accessibility audit of Audio.

No fonts, images, JavaScript, storage, third-party calls or dependencies are copied from Audio. Works retains zoom support, reduced-motion handling, 48px control targets, navigation labels, safe-area spacing and its existing authentication/API behavior.

Validation: build reproducibility, existing unit/browser regressions, exact computed header-gradient endpoints/height, light/dark navigation/save contrast and mobile/desktop screenshots. Live audio appearance and physical iPhone QA remain unverified. Stage 3 remains local pending publication approval.
