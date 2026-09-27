# Self-hosted fonts: provenance and verification

The two families used by Mi TSM are committed here and loaded with `next/font/local` in `src/app/layout.tsx`. The build never fetches from Google Fonts. Both families are under the SIL Open Font License 1.1; each family's `OFL.txt` sits beside its files, copied unchanged from upstream.

The loader configures the fallback stack `system-ui, sans-serif` for both families. The e2e screenshots show the self-hosted fonts in use, not the fallback.

## Upstream source

Repository: [google/fonts](https://github.com/google/fonts). Each file was downloaded from `main` and is byte-identical to upstream: its git blob hash matches the blob at the listed commit. That commit is the last one to touch the file. The files are unchanged at `main` `23e54b51ddffbc7713c583748e3bd86f62b1fa4a` (2026-09-24), where this was verified.

| Family | Upstream path | Commit (last change) | Git blob | Font version |
|---|---|---|---|---|
| Lora | `ofl/lora/Lora[wght].ttf` | `b4c417dfee46b06751f094f0362b2d7a7e8c5eb3` (2023-12-14) | `ee1914c3746140523de2940d267ec2215bd85d5b` | Version 3.008 |
| Lora | `ofl/lora/Lora-Italic[wght].ttf` | `b4c417dfee46b06751f094f0362b2d7a7e8c5eb3` (2023-12-14) | `e973ccf7e5c69a831090c729a0dc2c592f42f4cc` | Version 3.008 |
| Lora | `ofl/lora/OFL.txt` | `a33db997991ea02c1857c84338dfd07801a94328` (2022-07-28) | `d0ce7fe062e60eaa92c4af3ee1bebe81c5141b4e` | — |
| Cormorant Garamond | `ofl/cormorantgaramond/CormorantGaramond[wght].ttf` | `5fcfd99f2fa4422991d29f4adae3f2f4b774f058` (2025-01-09) | `d992a83ce525c330fad3a19087746bcb2dc038ee` | Version 4.001 |
| Cormorant Garamond | `ofl/cormorantgaramond/OFL.txt` | `6a386aadc0a33dd3d810b833d9c5105345cbb0e6` (2022-07-05) | `507d70f4565352dbfcf2dfc9b42eb092b57c0be8` | — |

Both are variable fonts (`wght` axis): Lora 400–700 (normal and italic), Cormorant Garamond 300–700.

## Committed files

| File | Bytes | SHA-256 |
|---|---|---|
| `lora/Lora.woff2` | 85,096 | `7c514f026f03de1b0fc344c0c0f0df141fcf16b6f9ab672db191908ba740dab6` |
| `lora/Lora-Italic.woff2` | 91,636 | `6cda7d220aebc862d9de3cdbd6e5068b64477aca6f284dbb1ca6e00114744faf` |
| `cormorant-garamond/CormorantGaramond-latin-latinext.woff2` | 105,840 | `a1b9b3e84458a82d6ae61bfce53456c575d830dca7bc52589032a70ef38738ee` |

## Tools

Python 3.14.0, fontTools 4.66.0, brotli 1.2.0 (`pip install fonttools==4.66.0 brotli==1.2.0` in a throwaway virtualenv; nothing tool-related is committed).

## Commands used

Lora: conversion to woff2 only, with no subsetting and no renaming. The upstream timestamp is kept (`recalcTimestamp=False`). For each of `Lora[wght].ttf` and `Lora-Italic[wght].ttf`:

```python
from fontTools.ttLib import TTFont
t = TTFont("Lora[wght].ttf", recalcTimestamp=False)   # or "Lora-Italic[wght].ttf"
t.flavor = "woff2"
t.save("lora/Lora.woff2")                             # or "lora/Lora-Italic.woff2"
```

The output is byte-reproducible: running the command twice gives the SHA-256 values in the table above.

Cormorant Garamond: subset to the latin and latin-ext ranges Google Fonts uses (taken from its CSS for this family), keeping every layout feature:

```sh
pyftsubset "CormorantGaramond[wght].ttf" \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" \
  --layout-features='*' \
  --flavor=woff2 \
  --output-file=cormorant-garamond/CormorantGaramond-latin-latinext.woff2
```

Result: 546 mapped characters, `wght` 300–700, 34 GSUB features kept (including `liga`, `dlig`, `smcp`, `onum`, `tnum`).

## Licence position

- **Cormorant Garamond** reserves no font name, so subsetting it is allowed under the OFL. The name is unchanged.
- **Lora** reserves the name "Lora" (see `lora/OFL.txt`). A Modified Version may not use that name without permission. Lora is only converted to woff2, which the OFL FAQ allows under the same name when the original font data is unchanged except for WOFF compression. The verification below shows exactly that: the decoded font is identical to upstream apart from the two `head` fields the WOFF2 format itself sets. **The Reserved Font Name claim holds.**
- The earlier open item is closed. The first conversion (2026-09-27) had rewritten `head.modified` to the conversion time. The files were re-converted from the same upstream blobs with `recalcTimestamp=False`, and `head.modified` now equals upstream.

## Verification of the Lora files

Method: decode each committed woff2 with fontTools and compare it with the upstream TTF: tables present, raw table bytes after decoding, every `head` field, glyph count and names, character map, `fvar` axes, and every `name` record.

Result for both `Lora.woff2` and `Lora-Italic.woff2`:

| Check | Result |
|---|---|
| Tables present | Same 19 tables (`GDEF GPOS GSUB HVAR OS/2 STAT cmap fvar gasp glyf gvar head hhea hmtx loca maxp name post prep`); none dropped or added |
| Raw table bytes after decoding | Identical for all 18 tables other than `head` |
| `head.modified` | Identical to upstream (3785327317 upright, 3785327319 italic) |
| `head.flags` | 3 → 2051: only bit 11 set. The WOFF2 format requires it for transformed/compressed data. |
| `head.checkSumAdjustment` | Recomputed (2785491919 → 785211443 upright; 1091437551 → 1435097187 italic), because bit 11 changes the `head` bytes |
| Every other `head` field | Identical |
| Glyph count / names | 892 / 889, identical order and names |
| Character map | Identical (778 characters) |
| `fvar` axes | Identical (`wght` 400, 400, 700) |
| `name` table | Identical, all records (29 upright, 33 italic): family "Lora", "Version 3.008", copyright with Reserved Font Name "Lora" |

Conclusion: the only differences are the two `head` fields the WOFF2 format sets. The font data is otherwise unchanged from upstream.

Cormorant Garamond reproduces exactly: running the command above on the upstream file gives the committed file's SHA-256, and `head.modified` equals upstream.

## How to reproduce and verify

1. Download the upstream files at the commits listed above, for example `https://raw.githubusercontent.com/google/fonts/<commit>/ofl/lora/Lora%5Bwght%5D.ttf`, and check `git hash-object <file>` against the blob column.
2. In a throwaway virtualenv, install the tools above and run the commands.
3. `shasum -a 256` must match the committed files, for Lora and Cormorant Garamond.
4. Lora: decode both files with fontTools and compare them with upstream as described above. Every table matches except `head.flags` (bit 11) and `head.checkSumAdjustment`.
