import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";
import { LabelValueGrid } from "./LabelValueGrid";
import { Select } from "./Select";
import { TextArea } from "./TextArea";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

describe("accent labels", () => {
  it("the token is the original 10.5px label x 1.3, bold, and wraps", () => {
    expect(css).toMatch(/--text-label: 14px;/);
    const utility = css.match(/@utility label-accent \{([^}]*)\}/)?.[1] ?? "";
    expect(utility).toMatch(/font-size: var\(--text-label\);/);
    expect(utility).toMatch(/font-weight: 700;/);
    expect(utility).toMatch(/color: var\(--accent-deep\);/);
    expect(utility).toMatch(/overflow-wrap: break-word;/);
  });

  it.each([
    ["Field", <Field key="f" label="CUIL" />, /<label[^>]*class="label-accent"[^>]*>CUIL</],
    ["Select", <Select key="s" label="Área" options={[]} />, /<label[^>]*class="label-accent"[^>]*>Área</],
    ["TextArea", <TextArea key="t" label="Motivo" />, /<label[^>]*class="label-accent"[^>]*>Motivo</],
    [
      "LabelValueGrid",
      <LabelValueGrid key="g" items={[{ key: "cuil", label: "CUIL", value: "20-1" }]} />,
      /<dt class="label-accent">CUIL</,
    ],
  ])("%s renders its label with label-accent", (_name, element, pattern) => {
    expect(renderToStaticMarkup(element)).toMatch(pattern);
  });
});
