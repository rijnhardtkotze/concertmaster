import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PATHS } from "../src/lib/config.ts";
import { ExtractedPerformance } from "../src/lib/extraction-schema.ts";

type Node = Record<string, unknown>;
interface Shape {
  types: string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Shape>;
  items?: Shape;
  variants?: Shape[];
}

/**
 * Reduce a JSON Schema node to the parts both representations must agree on.
 * A union of objects (a Programme item is a Work or an interval) keeps each
 * object variant apart; any other union (a nullable field) folds into one shape.
 */
function shape(node: Node): Shape {
  const variants = ((node.anyOf ?? node.oneOf) as Node[] | undefined) ?? [node];
  const objects = variants.filter((v) => v.type === "object");
  if (objects.length > 1) {
    const rest = variants.filter((v) => v.type !== "object");
    const all = [...objects.map((o) => shape(o)), ...rest.map((r) => shape(r))];
    return { types: [...new Set(all.flatMap((a) => a.types))].sort(), variants: all.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  }
  const types = new Set<string>();
  const enums = new Set<unknown>();
  let properties: Record<string, Shape> | undefined;
  let required: string[] | undefined;
  let items: Shape | undefined;
  for (const v of variants) {
    const t = v.type ?? (v.const !== undefined ? typeof v.const : undefined);
    for (const x of Array.isArray(t) ? t : [t]) if (x) types.add(x === "integer" ? "number" : String(x));
    for (const e of (v.enum as unknown[] | undefined) ?? []) if (e !== null) enums.add(e);
    if (v.const !== undefined) enums.add(v.const);
    if (v.properties) {
      properties = Object.fromEntries(Object.entries(v.properties as Record<string, Node>).map(([k, p]) => [k, shape(p)]));
      required = [...((v.required as string[]) ?? [])].sort();
    }
    if (v.items) items = shape(v.items as Node);
  }
  return {
    types: [...types].sort(),
    ...(enums.size ? { enum: [...enums].sort() } : {}),
    ...(properties ? { properties, required } : {}),
    ...(items ? { items } : {}),
  };
}

describe("Zod extraction schema mirrors event-schema.json", () => {
  it("has the same properties, required lists, types and enums at every level", () => {
    const json = JSON.parse(fs.readFileSync(PATHS.eventSchema, "utf8")) as Node;
    const zod = z.toJSONSchema(ExtractedPerformance, { io: "input" }) as Node;
    expect(shape(zod)).toEqual(shape(json));
  });
});
