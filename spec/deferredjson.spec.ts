import { isArray, isPlainObject, isString, range } from "lodash-es";
import { pack } from "msgpackr";
import { DeferredJSON } from "../src/index.js";
import { jest } from "@jest/globals";

describe("DeferredJSON", () => {
  describe.each([
    ["JSON", JSON],
    ["DeferredJSON", DeferredJSON],
  ])("with %s", (_name, Obj) => {
    test("parses objects", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const value = Obj.parse(jsonString);
      expect(value.a).toBe(1);
      expect(value.b.c).toBe(2);
      expect(value.d).toBe(undefined);

      expect("a" in value).toBe(true);
      expect("d" in value).toBe(false);
    });

    test("parses arrays", () => {
      const jsonString = '[1, 2, {"a": 3}]';
      const value = Obj.parse(jsonString);

      expect(value[0]).toBe(1);
      expect(value[1]).toBe(2);
      expect(value[2].a).toBe(3);
      expect(value[3]).toBe(undefined);
    });

    test("reports property descriptors before touching any properties", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const value = Obj.parse(jsonString);

      const descriptor = Object.getOwnPropertyDescriptor(value, "a");
      expect(descriptor!.configurable).toBe(true);
      expect(descriptor!.enumerable).toBe(true);
      expect(descriptor!.value).toBe(1);
    });

    test("reports property descriptors after touching properties", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const value = Obj.parse(jsonString);

      value.a;

      const descriptor = Object.getOwnPropertyDescriptor(value, "a");
      expect(descriptor!.configurable).toBe(true);
      expect(descriptor!.enumerable).toBe(true);
      expect(descriptor!.value).toBe(1);
    });

    test("reports property descriptors after freezing", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const value = Obj.parse(jsonString);

      Object.freeze(value);

      const descriptor = Object.getOwnPropertyDescriptor(value, "a");
      expect(descriptor!.configurable).toBe(false);
      expect(descriptor!.enumerable).toBe(true);
      expect(descriptor!.value).toBe(1);
    });

    test("reports property descriptors for unset properties", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const value = Obj.parse(jsonString);

      const descriptor = Object.getOwnPropertyDescriptor(value, "d");
      expect(descriptor).toBeUndefined();
    });

    test("roundtrips JSON objects back to strings", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const proxy = DeferredJSON.parse(jsonString);

      const output = Obj.stringify(proxy);
      expect(output).toBe(jsonString);
    });

    test("roundtrips JSON arrays back to strings", () => {
      const jsonString = '[1,2,{"a":3}]';
      const proxy = DeferredJSON.parse(jsonString);

      const output = Obj.stringify(proxy);
      expect(output).toBe(jsonString);
    });

    test("roundtrips outer objects with multiple lazy JSON children back to strings", () => {
      const a = DeferredJSON.parse('{"a":1}');
      const b = DeferredJSON.parse('{"b":2}');
      const c = DeferredJSON.parse('{"c":3}');

      const output = Obj.stringify({ a, b, c });
      expect(output).toBe('{"a":{"a":1},"b":{"b":2},"c":{"c":3}}');
    });

    test("roundtrips outer objects with the same lazy child occurring more than once", () => {
      const a = DeferredJSON.parse('{"a":1}');

      const output = Obj.stringify({ one: a, two: a, three: a });
      expect(output).toBe('{"one":{"a":1},"two":{"a":1},"three":{"a":1}}');
    });

    test("parses empty arrays", () => {
      const jsonString = "[]";
      const value = Obj.parse(jsonString);

      expect(value[0]).toBe(undefined);
    });

    test("stringifies more than 10 children", () => {
      const children = range(100).map((i) => Obj.parse(`[${i}, ${i}]`));

      const reparsed = Obj.parse(Obj.stringify(children));
      expect(reparsed).toEqual(children);
    });

    test("reports all object keys, including those named then", () => {
      const jsonString = '{"then": 1}';
      const proxy = Obj.parse(jsonString);
      expect(Object.keys(proxy)).toEqual(["then"]);
    });

    test("reports that objects do not have a .then property then when the JSON doesnt have one", () => {
      const jsonString = "{}";
      const proxy = Obj.parse(jsonString);
      expect("then" in proxy).toBe(false);
      expect(proxy.then).toBe(undefined);
    });
  });

  describe("parsing laziness", () => {
    beforeEach(() => {
      jest.spyOn(JSON, "parse").mockImplementation(() => {
        throw new Error("JSON.parse shouldn't be called");
      });
    });

    test("never calls JSON.parse if no properties are touched, and DeferredJSON.stringify is called", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const proxy = DeferredJSON.parse(jsonString);

      const output = DeferredJSON.stringify(proxy);
      expect(output).toBe(jsonString);
    });

    test("never calls JSON.parse if no properties are touched, and DeferredJSON.stringify is with a wrapper object", () => {
      const jsonString = '{"a":1,"b":{"c":2}}';
      const proxy = DeferredJSON.parse(jsonString);

      const output = DeferredJSON.stringify({ foo: proxy });
      expect(output).toBe('{"foo":{"a":1,"b":{"c":2}}}');
    });

    test("never calls JSON.parse getting the typeof", () => {
      let proxy = DeferredJSON.parse('{"a":1,"b":{"c":2}}');

      expect(typeof proxy).toEqual("object");

      proxy = DeferredJSON.parse('[1,2,{"a":3}]');

      expect(typeof proxy).toEqual("object");
    });

    test("never calls JSON.parse when doing Array.isArray", () => {
      const proxy = DeferredJSON.parse('[1,2,{"a":3}]');

      expect(Array.isArray(proxy)).toEqual(true);
    });

    test("never calls JSON.parse when awaited and doesn't have a .then in the json", async () => {
      let proxy = DeferredJSON.parse('[1,2,{"a":3}]');

      let result = await proxy;
      expect(result).toBe(proxy);

      proxy = DeferredJSON.parse("{}");

      result = await proxy;
      expect(result).toBe(proxy);
    });

    test("never calls JSON.parse when the .then property is inspected", async () => {
      const proxy = DeferredJSON.parse('{"a":3}');

      expect(proxy.then).toBe(undefined);
      expect("then" in proxy).toBe(false);
    });
  });

  test("doesn't proxy JSON strings and just returns them", () => {
    const jsonString = '"hello"';
    const value = DeferredJSON.parse(jsonString);

    expect(value.valueOf()).toBe("hello");
  });

  test("doesn't proxy JSON numbers and just returns them", () => {
    const jsonString = "42";
    const value = DeferredJSON.parse(jsonString);

    expect(value.valueOf()).toBe(42);
  });

  test("doesn't proxy JSON booleans and just returns them", () => {
    let value = DeferredJSON.parse("true");
    expect(value).toBe(true);

    value = DeferredJSON.parse("false");
    expect(value).toBe(false);
  });

  test("doesn't proxy JSON nulls and just returns them", () => {
    const jsonString = "null";
    const value = DeferredJSON.parse(jsonString);

    // When accessing null, it will directly parse null
    expect(value).toBe(null);
  });

  test("can be frozen without error", () => {
    const jsonString = '{"a": 1, "b": {"c": 2}}';
    const proxy = DeferredJSON.parse(jsonString);

    expect(() => Object.freeze(proxy)).not.toThrow();
  });

  test("can be frozen without error once parsed", () => {
    const jsonString = '{"a": 1, "b": {"c": 2}}';
    const proxy = DeferredJSON.parse(jsonString);
    proxy.a;

    expect(() => Object.freeze(proxy)).not.toThrow();
  });

  test("can be frozen without error as part of an outer object", () => {
    const jsonString = '{"a": 1, "b": {"c": 2}}';
    const proxy = DeferredJSON.parse(jsonString);

    const outer = { value: proxy, other: 3 };

    expect(() => Object.freeze(outer)).not.toThrow();
  });

  test("can be frozen without error once parsed as part of an outer object", () => {
    const jsonString = '{"a": 1, "b": {"c": 2}}';
    const proxy = DeferredJSON.parse(jsonString);
    proxy.a;

    const outer = { value: proxy, other: 3 };

    expect(() => Object.freeze(outer)).not.toThrow();
  });

  test("mst's isPlainObject should pass for lazy json objects", () => {
    const jsonString = '{"a":1,"b":{"c":2}}';
    const proxy = DeferredJSON.parse(jsonString);

    expect(mstIsPlainObject(proxy)).toBe(true);
  });

  test("lodash's isPlainObject should pass for lazy json objects", () => {
    const jsonString = '{"a":1,"b":{"c":2}}';
    const proxy = DeferredJSON.parse(jsonString);

    expect(isPlainObject(proxy)).toBe(true);
  });

  test("lodash's isArray should pass for lazy json arrays", () => {
    const jsonString = "[1,2,3]";
    const proxy = DeferredJSON.parse(jsonString);

    expect(isArray(proxy)).toBe(true);
  });

  test("array functions iterate the real elements of the JSON", () => {
    const jsonString = `["foo", "bar"]`;
    const proxy = DeferredJSON.parse(jsonString);

    expect(proxy.every((x: string) => isString(x))).toBe(true);
    expect(proxy.map((x: string) => x.toUpperCase())).toEqual(["FOO", "BAR"]);
  });

  test("DeferredJSONs can be msgpackr'd like normal jsons", () => {
    const jsonString = '{"a":1,"b":{"c":2}}';
    const proxy = DeferredJSON.parse(jsonString);
    const real = JSON.parse(jsonString);
    expect(pack(proxy)).toEqual(pack(real));
  });
});

const plainObjectString = Object.toString();
function mstIsPlainObject(value: any) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto == null) return true;
  const cons = proto.constructor;
  return (cons === null || cons === void 0 ? void 0 : cons.toString()) === plainObjectString;
}
