const prefix = "__lzjs";
const quotedPrefix = '"' + prefix;

export const kIsLazyJSON = Symbol("lazy-json/isLazyJSON");
export const kIsParsed = Symbol("lazy-json/isParsed");

/**
 * Lazy version of JSON.parse that only actually deserializes a JSON string when properties on the JSON string are accessed.
 * If we're just passing this value through JS land and don't actually need to touch it, there's a fast path that can re-serialize the JSON string right as output without parsing and re-stringifying it
 */
export const LazyJSON = {
  parse: (jsonString: string): any => {
    const isObject = jsonString.startsWith("{");
    const isArray = jsonString.startsWith("[");
    if (!(isObject || isArray)) {
      return JSON.parse(jsonString);
    }

    let parsed: any | null = null;
    const target = isArray ? [] : {};

    const parse = () => {
      parsed = LazyJSON.actuallyParse(jsonString);
      if (isArray) {
        // for arrays only, we do a shallow copy after parsing so that things like obj.map work, as they iterate the target without going through the proxy
        for (const key in parsed) {
          (target as any)[key] = parsed[key];
        }
      }
    };

    const handlers: ProxyHandler<any> = {
      get(_target, property, _receiver) {
        if (property === "toJSON") {
          // the toJSON of a lazy json object returns a special sigil that is replaced at the end of stringification if being stringified by LazyJSON.stringify
          return () => {
            if (LazyJSON.snipper) {
              return LazyJSON.snipper.getSigil(jsonString);
            } else {
              if (!parsed) parse();
              return parsed;
            }
          };
        } else if (property === kIsLazyJSON) {
          return true;
        } else if (property === kIsParsed) {
          return !!parsed;
        } else if (property == "then") {
          if (!parsed) {
            // avoid eagerly parsing when LazyJSON values are awaited
            return undefined;
          }
        }
        if (!parsed) parse();
        return Reflect.get(parsed, property, parsed);
      },
      has(_target, property) {
        if (property === "toJSON" || property === kIsLazyJSON || property === kIsParsed) {
          return true;
        } else if (property == "then") {
          if (!parsed) {
            // avoid eagerly parsing when LazyJSON values are awaited
            return false;
          }
        }
        if (!parsed) parse();
        return Reflect.has(parsed, property);
      },
      set(_target, property, value, receiver) {
        Reflect.set(parsed, property, value, receiver);
        return Reflect.set(target, property, value, receiver);
      },
      deleteProperty(target, property) {
        Reflect.deleteProperty(parsed, property);
        return Reflect.deleteProperty(target, property);
      },
      defineProperty(_target, property, attributes) {
        Reflect.defineProperty(target, property, attributes);
        return Reflect.defineProperty(parsed, property, attributes);
      },
      ownKeys(_target) {
        if (!parsed) parse();
        return Reflect.ownKeys(parsed);
      },
      preventExtensions(target) {
        if (!parsed) parse();

        // upon freezing, ensure that the keys reported by the target match the keys of the parsed object
        // this avoids violating the proxy trap's invariants and this error message: 'ownKeys' on proxy: trap returned extra keys but proxy target is non-extensible
        if (isObject && !Object.isFrozen(target)) {
          for (const key in parsed) {
            target[key] = parsed[key];
          }
        }

        Reflect.preventExtensions(parsed);
        return Reflect.preventExtensions(target);
      },
      getOwnPropertyDescriptor(_target, property) {
        if (!parsed) parse();
        return Reflect.getOwnPropertyDescriptor(parsed, property);
      },
    };

    return new Proxy(target, handlers);
  },
  stringify(value: any) {
    const oldSnipper = LazyJSON.snipper;
    const snipper = new Snipper();
    LazyJSON.snipper = snipper;
    try {
      let string = JSON.stringify(value);

      if (snipper.snippets) {
        const processed: string[] = [];
        const segments = string.split(quotedPrefix);
        if (!segments[0].startsWith(quotedPrefix)) {
          processed.push(segments.shift()!);
        }

        for (const segment of segments) {
          let idChars = "";
          for (let i = 0; i < segment.length; i++) {
            const char = segment[i];
            if (char === '"') break;
            idChars += char;
          }
          const value = snipper.snippets[idChars];
          processed.push(value);
          processed.push(segment.slice(idChars.length + 1));
        }

        string = processed.join("");
      }
      return string;
    } finally {
      LazyJSON.snipper = oldSnipper;
    }
  },
  snipper: null as Snipper | null,
  // function to do the real JSON parsing, but split out so we can mock it in tests
  actuallyParse: JSON.parse,
};

class Snipper {
  snippets: Record<string, string> | null = null;
  counter = 0;

  getSigil(value: string) {
    const id = this.counter++;
    if (!this.snippets) {
      this.snippets = {};
    }
    this.snippets[id] = value;
    return prefix + id;
  }
}
