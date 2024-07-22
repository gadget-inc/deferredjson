import { range } from "lodash-es";
import { DeferredJSON } from "src/index.js";
import { Bench } from "tinybench";
import { markdownTable } from "markdown-table";

let bench = new Bench({ time: 100 });
const largeJSON: Record<string, any> = {};
for (const i of range(1000)) {
  if (i % 3 == 0) {
    largeJSON[`${i}`] = i;
  } else if (i % 3 == 1) {
    largeJSON[`${i}`] = {
      inventoryCount: i,
      foo: Date.now(),
    };
  } else {
    largeJSON[`${i}`] = [i, i, i, i, i, i];
  }
}
const json = JSON.stringify(largeJSON);

for (const { name, impl } of [
  { name: "JSON", impl: JSON },
  { name: "DeferredJSON", impl: DeferredJSON },
]) {
  bench = bench
    .add(`${name} stringifying after no touching`, async () => {
      const value = impl.parse(json);
      impl.stringify(value);
    })
    .add(`${name} stringifying after touching`, async () => {
      const value = impl.parse(json);
      value["0"];
      impl.stringify(value);
    })
    .add(`${name} stringifying outer object containing several child parses`, async () => {
      const a = impl.parse('{"a":1}');
      const b = impl.parse('{"b":2}');
      const c = impl.parse('{"c":3}');
      impl.stringify({ foo: "bar", a, b, c, baz: "qux" });
    })
    .add(`${name} stringifying outer object containing several large child parses`, async () => {
      const a = DeferredJSON.parse(json);
      const b = impl.parse(json);
      const c = impl.parse(json);
      impl.stringify({ foo: "bar", a, b, c, baz: "qux" });
    })
    .add(`${name} stringifying outer object containing several large touched child parses`, async () => {
      const a = DeferredJSON.parse(json);
      const b = impl.parse(json);
      const c = impl.parse(json);
      b.foo;
      c.foo;
      impl.stringify({ foo: "bar", a, b, c, baz: "qux" });
    })
    .add(`${name} iterating all keys`, async () => {
      const value = impl.parse(json);
      for (const key in value) {
        value[key];
      }
    });
}

await bench.warmup();
await bench.run();

const table = bench.table();
const columns = Object.keys(table[0]!);
console.log(markdownTable([columns, ...table.map((row) => columns.map((column) => String(row![column])))]));
