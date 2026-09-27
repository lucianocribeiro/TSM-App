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
| `lora/Lora.woff2` | 84,884 | `8a90e10f20e05c612cd125d2db9f9e5322f2ffdea059e4f1fd1ac9d7002e3117` |
| `lora/Lora-Italic.woff2` | 91,520 | `7e902610277314557ff22a7be1c44166142585c28033c0c8fdd095c1a5657df4` |
| `cormorant-garamond/CormorantGaramond-latin-latinext.woff2` | 105,840 | `a1b9b3e84458a82d6ae61bfce53456c575d830dca7bc52589032a70ef38738ee` |

## Tools

Python 3.14.0, fontTools 4.66.0, brotli 1.2.0 (`pip install fonttools==4.66.0 brotli==1.2.0` in a throwaway virtualenv; nothing tool-related is committed).

## Commands used

Lora: conversion to woff2 only, with no subsetting and no renaming. For each of `Lora[wght].ttf` and `Lora-Italic[wght].ttf`:

```python
from fontTools.ttLib import TTFont
t = TTFont("Lora[wght].ttf")          # or "Lora-Italic[wght].ttf"
t.flavor = "woff2"
t.save("lora/Lora.woff2")             # or "lora/Lora-Italic.woff2"
```

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
- **Lora** reserves the name "Lora" (see `lora/OFL.txt`). A Modified Version may not use that name without permission. The intent is that Lora is only converted to woff2, which the OFL FAQ allows under the same name when the original font data is unchanged except for WOFF compression.
- **Open item:** the verification below found one change beyond compression in the committed Lora files: the `head.modified` timestamp. Until that is resolved (re-conversion or renaming, pending a decision), the "only converted" claim does not strictly hold for the committed files.

## Verification of the Lora files

Method: decode each committed woff2 with fontTools and compare it with the upstream TTF: tables present, raw table bytes after decoding, glyph count and names, character map, `fvar` axes, and every `name` record.

Result for both `Lora.woff2` and `Lora-Italic.woff2`:

| Check | Result |
|---|---|
| Tables present | Same set; none dropped or added |
| Raw table bytes | Identical for every table except `head` |
| Glyph count / names | 892 / 889, identical order and names |
| Character map | Identical (778 characters) |
| `fvar` axes | Identical (`wght` 400, 400, 700) |
| `name` table | Identical, all records: family "Lora", "Version 3.008", copyright with Reserved Font Name "Lora" |
| `head.flags` | 3 → 2051: bit 11 set. The WOFF2 format requires it when a font is transformed/compressed; fontTools sets it for every woff2 output. |
| `head.checkSumAdjustment` | Recomputed, because the `head` bytes changed |
| `head.modified` | Changed to the conversion time (3785327317 → 3873368739 in `Lora.woff2`; 3785327319 → 3873368739 in the italic). fontTools rewrites it by default (`recalcTimestamp=True`). **Not required by WOFF2: a change beyond compression.** |

Consequence: re-running the Lora command yields a different `head.modified`, so those files are not byte-reproducible. A conversion with `TTFont(path, recalcTimestamp=False)` leaves only the two WOFF2-mandated `head` changes (`flags` bit 11 and `checkSumAdjustment`). This was checked but not applied, pending the decision above.

Cormorant Garamond reproduces exactly: running the command above on the upstream file gives the committed file's SHA-256, and `head.modified` equals upstream.

## How to reproduce and verify

1. Download the upstream files at the commits listed above, for example `https://raw.githubusercontent.com/google/fonts/<commit>/ofl/lora/Lora%5Bwght%5D.ttf`, and check `git hash-object <file>` against the blob column.
2. In a throwaway virtualenv, install the tools above and run the commands.
3. Cormorant Garamond: `shasum -a 256` must match the committed file.
4. Lora: decode both files with fontTools and compare tables and `name` records as described above. Every table matches except the `head` fields listed (and `head.modified` will be the new conversion time).
