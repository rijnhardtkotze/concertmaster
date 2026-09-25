import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PATHS } from "../src/lib/config.ts";
import { Event } from "../src/lib/schema.ts";

type Node = Record<string, unknown>;
interface Shape {
  types: string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Shape>;
  items?: Shape;
}

/** Reduce a JSON Schema node to the parts both representations must agree on. */
function shape(node: Node): Shape {
  const variants = (node.anyOf as Node[] | undefined) ?? [node];
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

describe("Zod schema mirrors event-schema.json", () => {
  it("has the same properties, required lists, types and enums at every level", () => {
    const json = JSON.parse(fs.readFileSync(PATHS.eventSchema, "utf8")) as Node;
    const zod = z.toJSONSchema(Event, { io: "input" }) as Node;
    expect(shape(zod)).toEqual(shape(json));
  });
});
