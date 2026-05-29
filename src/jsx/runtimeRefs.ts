import {
  RUNTIME_API_NAMES,
  type RuntimeApiName,
  type RuntimePlacement
} from "./protocol";

/**
 * Host-realm helpers for the `runtime` ref mechanism.
 *
 * The `exposed` factory receives a `runtime` object whose properties are opaque
 * *ref tokens* — one per JSX runtime API. The host drops them anywhere in the
 * object tree it returns (alongside real host values). zushi then walks that
 * tree, pulls the tokens out into a list of {@link RuntimePlacement}s, and the
 * in-VM runtime installs the real functions at those paths — so the tokens
 * never need to cross the VM boundary.
 */

/** Marks an object as a runtime ref token; the value is the API name. */
const RUNTIME_REF = Symbol("zushi.runtimeRef");

/** The shape of the `runtime` object handed to the `exposed` factory. */
export type RuntimeRefs = Record<RuntimeApiName, unknown>;

/** Build the `runtime` ref object exposed to the host's `exposed` factory. */
export function makeRuntimeRefs(): RuntimeRefs {
  const refs = {} as Record<RuntimeApiName, unknown>;
  for (const name of RUNTIME_API_NAMES) {
    refs[name] = Object.freeze({ [RUNTIME_REF]: name });
  }
  return refs;
}

function isRuntimeRef(v: any): v is { [RUNTIME_REF]: RuntimeApiName } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v[RUNTIME_REF] === "string"
  );
}

function isPlainObject(v: any): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/**
 * Walk `tree` in place: collect every runtime ref into a placement list and
 * delete it from the tree (so only real host values are left to marshal).
 * Recurses through plain objects and arrays only — never into class instances,
 * functions, Date, Promise, etc.
 */
export function extractPlacements(tree: any): RuntimePlacement[] {
  const out: RuntimePlacement[] = [];
  const visit = (node: any, path: string[]) => {
    if (!isPlainObject(node) && !Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (isRuntimeRef(val)) {
        out.push({ path: [...path, key], name: val[RUNTIME_REF] });
        delete node[key];
      } else if (isPlainObject(val) || Array.isArray(val)) {
        visit(val, [...path, key]);
      }
    }
  };
  visit(tree, []);
  return out;
}
