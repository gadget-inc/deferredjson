# `DeferredJSON` ![test](https://github.com/gadget-inc/deferredjson/actions/workflows/test.yml/badge.svg?branch=main&event=push) ![bundle size](https://img.shields.io/bundlephobia/min/deferredjson)

`DeferredJSON` offers a drop in replacement for `JSON.stringify` and `JSON.parse` that defers parsing until the data is actually needed. If you happen to serialize a DeferredJSON instance later to a string without ever touching it, than neither the parse nor stringify needs to happen, and DeferredJSON can just feed out the already serialized contents stored at the start.

`DeferredJSON` works by returning a `Proxy` object that parses on demand the first time a value is accessed. `DeferredJSON` works with any incoming JSON value, including serialized arrays, objects, and primitive values.

Also handy is that `DeferredJSON` serialization can interpolate several nested lazy JSON objects into an outer one when stringifing. If you are returning an outer object (say a REST API response) where one field on each record is a potentially-large JSON object, you can use `DeferredJSON` for those large objects, but still rely on `DeferredJSON.stringify` to avoid the cost of deserializing-and-re-serializing each little object in the payload.

## Background

A lot of nodejs programs serve up JSON data to a client, and to do that, some in-memory datastructure has to get serialized. Usually, you have to pay the price of serializing an entire JSON tree, which is an [event-loop-blocking](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) operation. If the JSON is very large, this event loop block can become a major issue.

But, a lot of the time, the JSON a program is serving is available in an _already serialized JSON_ form. It could be bytes in a file, or a `json` or `jsonb` field in Postgres, or incoming bytes from a request. If you already have JSON that you trust is valid in string form, it is wasteful to parse it, never touch it, and then serialize it again.

`DeferredJSON` helps with this performance issue in this specific situation by deferring the parsing of your existing serialized JSON until the last possible moment. If you do need to access data within the JSON, `DeferredJSON` will parse it on demand. But, if you never need to access the data, `DeferredJSON` will never parse it, and can feed out the already serialized contents as is.

## Usage

### Parsing

Use `DeferredJSON.parse` instead of `JSON.parse`, that's all. `DeferredJSON.parse` will return a `Proxy` object that should act just like a normal JSON object.

```typescript
const obj = DeferredJSON.parse(`{"foo": "bar"}`);
// no parsing has happened yet
obj.foo; // "bar"
// object is now parsed and quacks the same as if JSON.parse was used
```

There's a few optimizations `DeferredJSON.parse` makes to be aware of:

- if the serialized JSON is a scalar value like a number or a boolean, it isn't wrapped in a `DeferredJSON` proxy, since parsing it is so cheap.
- if the JSON is still unparsed, and it is awaited by accessing the `.then` property, the JSON won't be deserialized, and instead the whole JSON will be returned. This means that if the `.then` property is actually a string inside the JSON that you care about, you need to forcibly parse the JSON to access it. This is a good thing, since it means you can still blindly await your `DeferredJSON`s and not worry about eagerly forcing parsing for no reason other than some async function baloney.

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

### Performance

`DeferredJSON` is written with high-performance node.js apps in mind and does its best to add as little overhead as possible, but there is some. When accessing keys of a `DeferredJSON` object, there is a small amount of overhead added to go through the proxy for each property access at the root-level node that is parsed. If you need absolutely no overhead in accessing the data you are parsing, then don't use `DeferredJSON`.

For serialization, `DeferredJSON` also adds some small overhead. `DeferredJSON` still uses the JS VM's `JSON.stringify` under the hood to get maximum performance and all the optimizations baked in there, but then does a second pass over the serialized string to interpolate if needed. This adds some overhead, but for JSON objects of any size, the performance is still much better than doing the whole parse and re-serializing of the objects in question.
