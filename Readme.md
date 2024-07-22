# `DeferredJSON` ![test](https://github.com/gadget-inc/deferredjson/actions/workflows/test.yml/badge.svg?branch=main&event=push) ![bundle size](https://img.shields.io/bundlephobia/min/deferredjson)

`DeferredJSON` offers a drop in replacement for `JSON.stringify` and `JSON.parse` that defers parsing until the parsed result is actually needed. If you re-stringify without ever accessing the data, the parsing can be fully avoided and performance greatly improved.

`DeferredJSON` works by returning a `Proxy` object that parses on demand the first time a value is accessed, and storing the incoming serialized string of JSON for later use. Then later when `DeferredJSON.stringify` is used, any deferreds within the serialized tree re-use that incoming serialized string, avoiding the cost of re-serializing.

`DeferredJSON` works with any incoming JSON value, including serialized arrays, objects, and primitive values.

Also handy is that `DeferredJSON` serialization can interpolate several nested lazy JSON objects into an outer one when stringifing. If you are returning an outer object (say a REST API response) where one field on each record is a potentially-large JSON object, you can use `DeferredJSON` for those large objects, but still rely on `DeferredJSON.stringify` to avoid the cost of deserializing-and-re-serializing each little object in the payload.

## Background

A lot of nodejs programs serve up JSON data to a client, and to do that, some in-memory datastructure has to get serialized. Usually, you have to pay the price of serializing an entire JSON tree, which is an [event-loop-blocking](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) operation. If the JSON is very large, this event loop block can become a major issue.

But a lot of the time, programs are serving JSON that started its life in an _already serialized string_ form. It could be bytes in a file, or a `json` or `jsonb` field in Postgres, or incoming bytes from a request. If you already have a JSON string that you trust is valid, it is wasteful to parse it, never touch it, and then serialize it again.

`DeferredJSON` helps with this performance issue in this specific situation by deferring the parsing of your existing serialized JSON until the last possible moment. If you do need to access data within the JSON, `DeferredJSON` will parse it on demand, incurring the same performance penalty as a normal `JSON.parse`. But, if you never end up accessing the deserialized data, `DeferredJSON` will never parse it, and can feed out the already serialized contents as is.

### Performance

`DeferredJSON` is written with high-performance node.js apps in mind and does its best to add as little overhead as possible, but there is some. When accessing keys of a `DeferredJSON` object, there is a small amount of overhead added to go through the proxy for each property access at the root-level node that is parsed. If you need absolutely no overhead in accessing the data you are parsing, then don't use `DeferredJSON`.

For serialization, `DeferredJSON` also adds some small overhead. `DeferredJSON` still uses the JS VM's high-performance `JSON.stringify` under the hood take advantage of all the optimizations baked in there, but then does a second pass over the serialized string to interpolate if needed. This adds some overhead, but for JSON objects of any size, the performance is still much better than doing the whole parse and re-serializing of the objects in question.

`DeferredJSON` was extracted out of [Gadget](https://gadget.dev) where it made a major performance difference for the JSON responses Gadget serves up.

Here's the results of the benchmark at `spec/deferredjson.bench.ts`:

| Task Name                                                                            | ops/sec   | Average Time (ns)  | Margin | Samples |
| ------------------------------------------------------------------------------------ | --------- | ------------------ | ------ | ------- |
| JSON stringifying after no touching                                                  | 4,257     | 234867.73648732144 | ±0.61% | 426     |
| JSON stringifying after touching                                                     | 4,037     | 247650.98478534434 | ±1.47% | 404     |
| JSON stringifying outer object containing several child parses                       | 873,536   | 1144.7716234727998 | ±0.53% | 87354   |
| JSON stringifying outer object containing several large child parses                 | 1,371     | 729038.3482324905  | ±0.98% | 138     |
| JSON stringifying outer object containing several large touched child parses         | 1,452     | 688475.1752631305  | ±0.77% | 146     |
| JSON iterating all keys                                                              | 7,599     | 131594.6274682095  | ±0.61% | 760     |
| DeferredJSON stringifying after no touching                                          | 1,128,805 | 885.89238811691    | ±0.73% | 112881  |
| DeferredJSON stringifying after touching                                             | 8,643     | 115694.12126706514 | ±3.30% | 865     |
| DeferredJSON stringifying outer object containing several child parses               | 431,193   | 2319.1457362033443 | ±0.74% | 43120   |
| DeferredJSON stringifying outer object containing several large child parses         | 226,622   | 4412.6266394405075 | ±1.81% | 22663   |
| DeferredJSON stringifying outer object containing several large touched child parses | 4,110     | 243299.04503035315 | ±1.08% | 412     |
| DeferredJSON iterating all keys                                                      | 1,788     | 559064.4635301728  | ±0.75% | 179     |

## Usage

### Parsing

Use `DeferredJSON.parse` instead of `JSON.parse` -- that's all. `DeferredJSON.parse` will return a `Proxy` object that acts just like a normal JSON object.

```typescript
const obj = DeferredJSON.parse(`{"foo": "bar"}`);
// no parsing has happened yet

obj.foo; // triggers parsing of the string and returns "bar"
// object is now parsed and quacks the same as if JSON.parse was used
```

It can also be beneficial to register `DeferredJSON.parse` as the default JSON parser for libraries you use for parsing JSON. For example, you can register it as the default JSON parser for the `pg` Postgres client library like so:

```typescript
import { types } from "pg";

types.setTypeParser(types.builtins.JSON, DeferredJSON.parse);
types.setTypeParser(types.builtins.JSONB, DeferredJSON.parse);
```

There's a few optimizations `DeferredJSON.parse` makes to be aware of:

- unlike `JSON.parse`, if the string is invalid JSON, it won't throw an error until the first time the inner JSON is accessed.
- if the serialized JSON is a scalar value like a number or a boolean, it isn't wrapped in a `DeferredJSON` proxy and instead is eagerly deserialized and returned. Benchmarks showed proxying these simple scalars not to be worth it since parsing it is so cheap.
- if the JSON is still unparsed, and it is awaited by accessing the `.then` property, the JSON **won't** be deserialized. Instead the whole JSON will be returned. This means that if the `.then` property is actually a string inside the JSON that you care about, you need to forcibly parse the JSON to access it. This is a good thing, since it means you can still blindly await your `DeferredJSON`s and not worry about eagerly forcing parsing for no reason other than some async function baloney.

### Serializing

Use `DeferredJSON.stringify` instead of `JSON.stringify`. `DeferredJSON.stringify` will return a string of serialized JSON the same way `JSON.stringify` does, but if possible, it will interpolate already serialized strings that are handy into the final output.

```typescript
const obj = DeferredJSON.parse(`{"foo": "bar"}`);
DeferredJSON.stringify(obj);
// `{"foo":"bar"}`
```

`DeferredJSON.stringify` can re-use serialized JSON deep within the tree you are serializing. You _don't_ need to pass a `DeferredJSON` object to `DeferredJSON.stringify`, it will work with any JSON-stringifiable value, including those that contain `DeferredJSON` objects deep within them.

```typescript
const obj = DeferredJSON.parse(`{"foo": "bar"}`);
const response = {
  data: obj,
  other: "stuff",
};
DeferredJSON.stringify(response);
// `{"data":{"foo":"bar"},"other":"stuff"}`
```
