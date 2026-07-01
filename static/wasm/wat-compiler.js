var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.js
var wat_compiler_exports = {};
__export(wat_compiler_exports, {
  FunctionContext: () => FunctionContext,
  GlobalContext: () => GlobalContext,
  ModuleBuilder: () => ModuleBuilder,
  compile: () => compile,
  default: () => make,
  parse: () => parse,
  tokenize: () => tokenize
});
module.exports = __toCommonJS(wat_compiler_exports);

// lib/const.js
var BYTE = {
  "type.i32": 127,
  "type.i64": 126,
  "type.f32": 125,
  "type.f64": 124,
  "type.void": 64,
  "type.func": 96,
  "type.funcref": 112,
  "section.custom": 0,
  "section.type": 1,
  "section.import": 2,
  "section.function": 3,
  "section.table": 4,
  "section.memory": 5,
  "section.global": 6,
  "section.export": 7,
  "section.start": 8,
  "section.element": 9,
  "section.code": 10,
  "section.data": 11,
  "import.func": 0,
  "import.table": 1,
  "import.memory": 2,
  "import.global": 3,
  "export.function": 0,
  "export.table": 1,
  "export.memory": 2,
  "export.global": 3,
  "global.const": 0,
  "global.var": 1,
  "global.mut": 1,
  "limits.min": 0,
  "limits.minmax": 1,
  "limits.shared": 3
};
var opCodes = [
  "unreachable",
  "nop",
  "block",
  "loop",
  "if",
  "else",
  ,
  ,
  ,
  ,
  ,
  "end",
  "br",
  "br_if",
  "br_table",
  "return",
  "call",
  "call_indirect",
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  "drop",
  "select",
  ,
  ,
  ,
  ,
  "local.get",
  "local.set",
  "local.tee",
  "global.get",
  "global.set",
  ,
  ,
  ,
  "i32.load",
  "i64.load",
  "f32.load",
  "f64.load",
  "i32.load8_s",
  "i32.load8_u",
  "i32.load16_s",
  "i32.load16_u",
  "i64.load8_s",
  "i64.load8_u",
  "i64.load16_s",
  "i64.load16_u",
  "i64.load32_s",
  "i64.load32_u",
  "i32.store",
  "i64.store",
  "f32.store",
  "f64.store",
  "i32.store8",
  "i32.store16",
  "i64.store8",
  "i64.store16",
  "i64.store32",
  "memory.size",
  "memory.grow",
  "i32.const",
  "i64.const",
  "f32.const",
  "f64.const",
  "i32.eqz",
  "i32.eq",
  "i32.ne",
  "i32.lt_s",
  "i32.lt_u",
  "i32.gt_s",
  "i32.gt_u",
  "i32.le_s",
  "i32.le_u",
  "i32.ge_s",
  "i32.ge_u",
  "i64.eqz",
  "i64.eq",
  "i64.ne",
  "i64.lt_s",
  "i64.lt_u",
  "i64.gt_s",
  "i64.gt_u",
  "i64.le_s",
  "i64.le_u",
  "i64.ge_s",
  "i64.ge_u",
  "f32.eq",
  "f32.ne",
  "f32.lt",
  "f32.gt",
  "f32.le",
  "f32.ge",
  "f64.eq",
  "f64.ne",
  "f64.lt",
  "f64.gt",
  "f64.le",
  "f64.ge",
  "i32.clz",
  "i32.ctz",
  "i32.popcnt",
  "i32.add",
  "i32.sub",
  "i32.mul",
  "i32.div_s",
  "i32.div_u",
  "i32.rem_s",
  "i32.rem_u",
  "i32.and",
  "i32.or",
  "i32.xor",
  "i32.shl",
  "i32.shr_s",
  "i32.shr_u",
  "i32.rotl",
  "i32.rotr",
  "i64.clz",
  "i64.ctz",
  "i64.popcnt",
  "i64.add",
  "i64.sub",
  "i64.mul",
  "i64.div_s",
  "i64.div_u",
  "i64.rem_s",
  "i64.rem_u",
  "i64.and",
  "i64.or",
  "i64.xor",
  "i64.shl",
  "i64.shr_s",
  "i64.shr_u",
  "i64.rotl",
  "i64.rotr",
  "f32.abs",
  "f32.neg",
  "f32.ceil",
  "f32.floor",
  "f32.trunc",
  "f32.nearest",
  "f32.sqrt",
  "f32.add",
  "f32.sub",
  "f32.mul",
  "f32.div",
  "f32.min",
  "f32.max",
  "f32.copysign",
  "f64.abs",
  "f64.neg",
  "f64.ceil",
  "f64.floor",
  "f64.trunc",
  "f64.nearest",
  "f64.sqrt",
  "f64.add",
  "f64.sub",
  "f64.mul",
  "f64.div",
  "f64.min",
  "f64.max",
  "f64.copysign",
  "i32.wrap_i64",
  "i32.trunc_f32_s",
  "i32.trunc_f32_u",
  "i32.trunc_f64_s",
  "i32.trunc_f64_u",
  "i64.extend_i32_s",
  "i64.extend_i32_u",
  "i64.trunc_f32_s",
  "i64.trunc_f32_u",
  "i64.trunc_f64_s",
  "i64.trunc_f64_u",
  "f32.convert_i32_s",
  "f32.convert_i32_u",
  "f32.convert_i64_s",
  "f32.convert_i64_u",
  "f32.demote_f64",
  "f64.convert_i32_s",
  "f64.convert_i32_u",
  "f64.convert_i64_s",
  "f64.convert_i64_u",
  "f64.promote_f32",
  "i32.reinterpret_f32",
  "i64.reinterpret_f64",
  "f32.reinterpret_i32",
  "f64.reinterpret_i64"
];
var alias = {
  "get_local": "local.get",
  "set_local": "local.set",
  "tee_local": "local.tee",
  "get_global": "global.get",
  "set_global": "global.set",
  "i32.trunc_s/f32": "i32.trunc_f32_s",
  "i32.trunc_u/f32": "i32.trunc_f32_u",
  "i32.trunc_s/f64": "i32.trunc_f64_s",
  "i32.trunc_u/f64": "i32.trunc_f64_u",
  "i64.extend_s/i32": "i64.extend_i32_s",
  "i64.extend_u/i32": "i64.extend_i32_u",
  "i64.trunc_s/f32": "i64.trunc_f32_s",
  "i64.trunc_u/f32": "i64.trunc_f32_u",
  "i64.trunc_s/f64": "i64.trunc_f64_s",
  "i64.trunc_u/f64": "i64.trunc_f64_u",
  "f32.convert_s/i32": "f32.convert_i32_s",
  "f32.convert_u/i32": "f32.convert_i32_u",
  "f32.convert_s/i64": "f32.convert_i64_s",
  "f32.convert_u/i64": "f32.convert_i64_u",
  "f32.demote/f64": "f32.demote_f64",
  "f64.convert_s/i32": "f64.convert_i32_s",
  "f64.convert_u/i32": "f64.convert_i32_u",
  "f64.convert_s/i64": "f64.convert_i64_s",
  "f64.convert_u/i64": "f64.convert_i64_u",
  "f64.promote/f32": "f64.promote_f32"
};
for (const [i, op] of opCodes.entries()) {
  if (op != null) {
    BYTE[op] = i;
  }
}
BYTE["i32.trunc_sat_f32_s"] = [252, 0];
BYTE["i32.trunc_sat_f32_u"] = [252, 1];
BYTE["i32.trunc_sat_f64_s"] = [252, 2];
BYTE["i32.trunc_sat_f64_u"] = [252, 3];
BYTE["i64.trunc_sat_f32_s"] = [252, 4];
BYTE["i64.trunc_sat_f32_u"] = [252, 5];
BYTE["i64.trunc_sat_f64_s"] = [252, 6];
BYTE["i64.trunc_sat_f64_u"] = [252, 7];
BYTE["memory.init"] = [252, 8];
BYTE["data.drop"] = [252, 9];
BYTE["memory.copy"] = [252, 10];
BYTE["memory.fill"] = [252, 11];
BYTE["table.init"] = [252, 12];
BYTE["elem.drop"] = [252, 13];
BYTE["table.copy"] = [252, 14];
BYTE["table.grow"] = [252, 15];
BYTE["table.size"] = [252, 16];
BYTE["table.fill"] = [252, 17];
for (const name in alias) {
  const i = opCodes.indexOf(alias[name]);
  BYTE[name] = i;
}
var INSTR = {};
for (const op in BYTE) {
  INSTR[op] = wrap_instr(op);
  const [group, method] = op.split(".");
  if (method != null) {
    BYTE[group] = BYTE[group] ?? {};
    BYTE[group][method] = BYTE[op];
    INSTR[group] = INSTR[group] ?? {};
    INSTR[group][method] = wrap_instr(op);
  }
}
var ALIGN = {
  "i32.load": 4,
  "i64.load": 8,
  "f32.load": 4,
  "f64.load": 8,
  "i32.load8_s": 1,
  "i32.load8_u": 1,
  "i32.load16_s": 2,
  "i32.load16_u": 2,
  "i64.load8_s": 1,
  "i64.load8_u": 1,
  "i64.load16_s": 2,
  "i64.load16_u": 2,
  "i64.load32_s": 4,
  "i64.load32_u": 4,
  "i32.store": 4,
  "i64.store": 8,
  "f32.store": 4,
  "f64.store": 8,
  "i32.store8": 1,
  "i32.store16": 2,
  "i64.store8": 1,
  "i64.store16": 2,
  "i64.store32": 4
};

// lib/leb128.js
function* bigint(n) {
  n = to_int64(n);
  while (true) {
    const byte = Number(n & 0x7Fn);
    n >>= 7n;
    if (n === 0n && (byte & 64) === 0 || n === -1n && (byte & 64) !== 0) {
      yield byte;
      break;
    }
    yield byte | 128;
  }
}
function* int(value) {
  let byte = 0;
  const size = Math.ceil(Math.log2(Math.abs(value)));
  const negative = value < 0;
  let more = true;
  while (more) {
    byte = value & 127;
    value = value >> 7;
    if (negative) {
      value = value | -(1 << size - 7);
    }
    if (value == 0 && (byte & 64) == 0 || value == -1 && (byte & 64) == 64) {
      more = false;
    } else {
      byte = byte | 128;
    }
    yield byte;
  }
}
function* uint(value, pad = 0) {
  if (value < 0)
    throw new TypeError("uint value must be positive, received: " + value);
  let byte = 0;
  do {
    byte = value & 127;
    value = value >> 7;
    if (value != 0 || pad > 0) {
      byte = byte | 128;
    }
    yield byte;
    pad--;
  } while (value != 0 || pad > -1);
}
var byteView = new DataView(new BigInt64Array(1).buffer);
function to_int64(value) {
  byteView.setBigInt64(0, value);
  return byteView.getBigInt64(0);
}
function* f32(value) {
  byteView.setFloat32(0, value);
  for (let i = 4; i--; )
    yield byteView.getUint8(i);
}
function* f64(value) {
  byteView.setFloat64(0, value);
  for (let i = 8; i--; )
    yield byteView.getUint8(i);
}
function hex2float(input) {
  input = input.toUpperCase();
  const splitIndex = input.indexOf("P");
  let mantissa, exponent;
  if (splitIndex !== -1) {
    mantissa = input.substring(0, splitIndex);
    exponent = parseInt(input.substring(splitIndex + 1));
  } else {
    mantissa = input;
    exponent = 0;
  }
  const dotIndex = mantissa.indexOf(".");
  if (dotIndex !== -1) {
    let integerPart = parseInt(mantissa.substring(0, dotIndex), 16);
    const sign = Math.sign(integerPart);
    integerPart = sign * integerPart;
    const fractionLength = mantissa.length - dotIndex - 1;
    const fractionalPart = parseInt(mantissa.substring(dotIndex + 1), 16);
    const fraction = fractionLength > 0 ? fractionalPart / Math.pow(16, fractionLength) : 0;
    if (sign === 0) {
      if (fraction === 0) {
        mantissa = sign;
      } else {
        if (Object.is(sign, -0)) {
          mantissa = -fraction;
        } else {
          mantissa = fraction;
        }
      }
    } else {
      mantissa = sign * (integerPart + fraction);
    }
  } else {
    mantissa = parseInt(mantissa, 16);
  }
  return mantissa * (splitIndex !== -1 ? Math.pow(2, exponent) : 1);
}
var F32_SIGN = 2147483648;
var F32_NAN = 2139095040;
function* nanbox32(input) {
  let value = parseInt(input.split("nan:")[1]);
  value |= F32_NAN;
  if (input[0] === "-")
    value |= F32_SIGN;
  byteView.setInt32(0, value);
  for (let i = 4; i--; )
    yield byteView.getUint8(i);
}
var F64_SIGN = 0x8000000000000000n;
var F64_NAN = 0x7ff0000000000000n;
function* nanbox64(input) {
  let value = BigInt(input.split("nan:")[1]);
  value |= F64_NAN;
  if (input[0] === "-")
    value |= F64_SIGN;
  byteView.setBigInt64(0, value);
  for (let i = 8; i--; )
    yield byteView.getUint8(i);
}

// lib/binary.js
(function(l) {
  function m() {
  }
  function k(a, c) {
    a = void 0 === a ? "utf-8" : a;
    c = void 0 === c ? { fatal: false } : c;
    if (-1 === r.indexOf(a.toLowerCase()))
      throw new RangeError("Failed to construct 'TextDecoder': The encoding label provided ('" + a + "') is invalid.");
    if (c.fatal)
      throw Error("Failed to construct 'TextDecoder': the 'fatal' option is unsupported.");
  }
  function t(a) {
    return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("utf-8");
  }
  function u(a) {
    var c = URL.createObjectURL(new Blob([a], { type: "text/plain;charset=UTF-8" }));
    try {
      var f = new XMLHttpRequest();
      f.open("GET", c, false);
      f.send();
      return f.responseText;
    } catch (e) {
      return q(a);
    } finally {
      URL.revokeObjectURL(c);
    }
  }
  function q(a) {
    for (var c = 0, f = Math.min(65536, a.length + 1), e = new Uint16Array(f), h = [], d = 0; ; ) {
      var b = c < a.length;
      if (!b || d >= f - 1) {
        h.push(String.fromCharCode.apply(null, e.subarray(0, d)));
        if (!b)
          return h.join("");
        a = a.subarray(c);
        d = c = 0;
      }
      b = a[c++];
      if (0 === (b & 128))
        e[d++] = b;
      else if (192 === (b & 224)) {
        var g = a[c++] & 63;
        e[d++] = (b & 31) << 6 | g;
      } else if (224 === (b & 240)) {
        g = a[c++] & 63;
        var n = a[c++] & 63;
        e[d++] = (b & 31) << 12 | g << 6 | n;
      } else if (240 === (b & 248)) {
        g = a[c++] & 63;
        n = a[c++] & 63;
        var v = a[c++] & 63;
        b = (b & 7) << 18 | g << 12 | n << 6 | v;
        65535 < b && (b -= 65536, e[d++] = b >>> 10 & 1023 | 55296, b = 56320 | b & 1023);
        e[d++] = b;
      }
    }
  }
  if (l.TextEncoder && l.TextDecoder)
    return false;
  var r = ["utf-8", "utf8", "unicode-1-1-utf-8"];
  Object.defineProperty(m.prototype, "encoding", { value: "utf-8" });
  m.prototype.encode = function(a, c) {
    c = void 0 === c ? { stream: false } : c;
    if (c.stream)
      throw Error("Failed to encode: the 'stream' option is unsupported.");
    c = 0;
    for (var f = a.length, e = 0, h = Math.max(
      32,
      f + (f >>> 1) + 7
    ), d = new Uint8Array(h >>> 3 << 3); c < f; ) {
      var b = a.charCodeAt(c++);
      if (55296 <= b && 56319 >= b) {
        if (c < f) {
          var g = a.charCodeAt(c);
          56320 === (g & 64512) && (++c, b = ((b & 1023) << 10) + (g & 1023) + 65536);
        }
        if (55296 <= b && 56319 >= b)
          continue;
      }
      e + 4 > d.length && (h += 8, h *= 1 + c / a.length * 2, h = h >>> 3 << 3, g = new Uint8Array(h), g.set(d), d = g);
      if (0 === (b & 4294967168))
        d[e++] = b;
      else {
        if (0 === (b & 4294965248))
          d[e++] = b >>> 6 & 31 | 192;
        else if (0 === (b & 4294901760))
          d[e++] = b >>> 12 & 15 | 224, d[e++] = b >>> 6 & 63 | 128;
        else if (0 === (b & 4292870144))
          d[e++] = b >>> 18 & 7 | 240, d[e++] = b >>> 12 & 63 | 128, d[e++] = b >>> 6 & 63 | 128;
        else
          continue;
        d[e++] = b & 63 | 128;
      }
    }
    return d.slice ? d.slice(0, e) : d.subarray(0, e);
  };
  Object.defineProperty(k.prototype, "encoding", { value: "utf-8" });
  Object.defineProperty(k.prototype, "fatal", { value: false });
  Object.defineProperty(k.prototype, "ignoreBOM", { value: false });
  var p = q;
  "function" === typeof Buffer && Buffer.from ? p = t : "function" === typeof Blob && "function" === typeof URL && "function" === typeof URL.createObjectURL && (p = u);
  k.prototype.decode = function(a, c) {
    c = void 0 === c ? { stream: false } : c;
    if (c.stream)
      throw Error("Failed to decode: the 'stream' option is unsupported.");
    a = a instanceof Uint8Array ? a : a.buffer instanceof ArrayBuffer ? new Uint8Array(a.buffer) : new Uint8Array(a);
    return p(a);
  };
  l.TextEncoder = m;
  l.TextDecoder = k;
})("undefined" !== typeof window ? window : "undefined" !== typeof global ? global : globalThis);
function wrap_instr(code) {
  return function(args, exprs) {
    return instr(
      code,
      args != null && !Array.isArray(args) ? [args] : args,
      exprs != null && !Array.isArray(exprs) ? [exprs] : exprs
    );
  };
}
var encoding = {
  "f64.const": f64,
  "f32.const": f32
};
function* instr(code, args = [], exprs = []) {
  for (let expr of exprs) {
    switch (typeof expr) {
      case "number":
        yield expr;
        break;
      default:
        yield* expr;
        break;
    }
  }
  yield* Array.isArray(BYTE[code]) ? BYTE[code] : [BYTE[code]];
  for (let arg of args) {
    switch (typeof arg) {
      case "bigint":
        yield* bigint(arg);
        break;
      case "number":
        yield* (encoding[code] ?? int)(arg);
        break;
      default:
        yield* arg;
    }
  }
}
var encoder = new TextEncoder("utf-8");
function utf8(s) {
  return [...encoder.encode(s)];
}
function header() {
  return [...utf8("\0asm"), 1, 0, 0, 0];
}
function section(type, data) {
  return [BYTE.section[type], ...uint(data.length), ...data];
}
function vector(items) {
  return [...uint(items.length), ...items.flat()];
}
function locals(items) {
  const out = [];
  let curr = [];
  let prev;
  for (const type of items) {
    if (type !== prev && curr.length) {
      out.push([...uint(curr.length), BYTE.type[curr[0]]]);
      curr = [];
    }
    curr.push(type);
    prev = type;
  }
  if (curr.length)
    out.push([...uint(curr.length), BYTE.type[curr[0]]]);
  return out;
}
function limits(min, max, shared) {
  if (shared != null) {
    return [BYTE.limits.shared, ...uint(min), ...uint(max)];
  } else if (max != null) {
    return [BYTE.limits.minmax, ...uint(min), ...uint(max)];
  } else {
    return [BYTE.limits.min, ...uint(min)];
  }
}
section.type = function(types) {
  return section(
    "type",
    vector(types.map(([params, results]) => [
      BYTE.type.func,
      ...vector(params.map((x) => BYTE.type[x])),
      ...vector(results.map((x) => BYTE.type[x]))
    ]))
  );
};
section.import = function(imported) {
  return section(
    "import",
    vector(imported.map(([mod, field, type, desc]) => [
      ...vector(utf8(mod)),
      ...vector(utf8(field)),
      BYTE.import[type],
      ...{
        "func": () => desc.map((idx) => [...uint(idx)]),
        "memory": () => limits(...desc)
      }[type]()
    ]))
  );
};
section.function = function(funcs) {
  return section(
    "function",
    vector(funcs.map(
      (func) => [...uint(func)]
    ))
  );
};
section.table = function(tables) {
  return section(
    "table",
    vector(tables.map(
      ([type, min, max]) => [BYTE.type[type], ...limits(min, max)]
    ))
  );
};
section.memory = function(memories) {
  return section(
    "memory",
    vector(memories.map(
      ([min, max]) => limits(min, max)
    ))
  );
};
section.global = function(globals) {
  return section(
    "global",
    vector(globals.map(
      ([mut, valtype, expr]) => [BYTE.type[valtype], BYTE.global[mut], ...expr, BYTE.end]
    ))
  );
};
section.export = function(exports) {
  return section(
    "export",
    vector(exports.map(
      ([name, type, idx]) => [...vector(utf8(name)), BYTE.export[type], ...uint(idx)]
    ))
  );
};
section.start = function(func_idx) {
  return section("start", [...uint(func_idx)]);
};
section.element = function(elements) {
  return section(
    "element",
    vector(elements.map(
      ([table_idx, offset_idx_expr, funcs]) => [...uint(table_idx), ...offset_idx_expr, BYTE.end, ...vector(funcs)]
    ))
  );
};
section.code = function(funcs) {
  return section(
    "code",
    vector(funcs.map(
      ([func_locals, func_body]) => vector([...vector(locals(func_locals)), ...func_body, BYTE.end])
    ))
  );
};
section.data = function(data) {
  return section(
    "data",
    vector(data.map(
      ([mem_idx, offset_idx_expr, bytes]) => [...uint(mem_idx), ...offset_idx_expr, BYTE.end, ...vector(bytes)]
    ))
  );
};

// lib/builder.js
var ByteArray = class extends Array {
  log = [];
  write(array, annotation) {
    this.log.push(array, annotation);
    this.push(...array);
    return this;
  }
  get buffer() {
    return new Uint8Array(this);
  }
};
var ModuleBuilder = class {
  types = [];
  imports = [];
  tables = [];
  memories = [];
  globals = [];
  exports = [];
  starts = "";
  elements = [];
  codes = [];
  datas = [];
  constructor(data) {
    if (data)
      Object.assign(this, data);
  }
  get funcs() {
    return this.codes.filter((func) => !func.imported);
  }
  ensureType(params, results) {
    const type_sig = [params.join(" "), results.join(" ")].join();
    const idx = this.types.indexOf(type_sig);
    if (idx >= 0)
      return idx;
    return this.types.push(type_sig) - 1;
  }
  getGlobalIndexOf(name) {
    return this.globals.find((glob) => glob.name === name).idx;
  }
  getFunc(name) {
    return this.codes.find((func) => func.name === name);
  }
  getMemory(name) {
    return this.memories.find((mem) => mem.name === name);
  }
  getType(name) {
    return this.types[name];
  }
  type(name, params, results) {
    this.types[name] = this.ensureType(params, results);
    return this;
  }
  import(type, name, mod, field, params, results) {
    if (type === "func") {
      const func = this._func(name, params, results, [], [], false, true);
      this.imports.push({ mod, field, type, desc: [func.type_idx] });
    } else if (type === "memory") {
      this.imports.push({ mod, field, type, desc: params });
    }
    return this;
  }
  table(type, min, max) {
    this.tables.push({ type, min, max });
    return this;
  }
  memory(name, min, max) {
    this.memories.push({ name, min, max });
    return this;
  }
  global(name, mut, valtype, expr) {
    const global_idx = this.globals.length;
    this.globals.push({ idx: global_idx, name, valtype, mut, expr });
    return this;
  }
  export(type, name, export_name) {
    this.exports.push({ type, name, export_name });
    return this;
  }
  start(name) {
    this.starts = name;
    return this;
  }
  elem(offset_idx_expr, codes) {
    this.elements.push({ offset_idx_expr, codes });
    return this;
  }
  _func(name, params = [], results = [], locals2 = [], body = [], exported = false, imported = false) {
    const type_idx = this.ensureType(params, results);
    const func_idx = this.codes.length;
    const func = { idx: func_idx, name, type_idx, locals: locals2, body, imported };
    this.codes.push(func);
    if (exported) {
      this.export("func", name, name);
    }
    return func;
  }
  func(...args) {
    this._func(...args);
    return this;
  }
  data(offset_idx_expr, bytes) {
    this.datas.push({ offset_idx_expr, bytes });
    return this;
  }
  build({ metrics = true } = {}) {
    //!time 'module build'
    const bytes = new ByteArray();
    bytes.write(header());
    if (this.types.length) {
      bytes.write(section.type(
        this.types.map(
          (type) => type.split(",").map((x) => x.split(" ").filter(Boolean))
        )
      ));
    }
    if (this.imports.length) {
      bytes.write(section.import(
        this.imports.map(
          (imp) => [imp.mod, imp.field, imp.type, imp.desc]
        )
      ));
    }
    if (this.funcs.length) {
      bytes.write(section.function(
        this.funcs.map(
          (func) => func.type_idx
        )
      ));
    }
    if (this.elements.length) {
      bytes.write(section.table(
        this.tables.map(
          (table) => [table.type, table.min, table.max]
        )
      ));
    }
    if (this.memories.length) {
      bytes.write(section.memory(
        this.memories.map(
          (mem) => [mem.min, mem.max]
        )
      ));
    }
    if (this.globals.length) {
      bytes.write(section.global(
        this.globals.map(
          (glob) => [glob.mut, glob.valtype, glob.expr]
        )
      ));
    }
    if (this.exports.length) {
      bytes.write(section.export(
        this.exports.map(
          (exp) => exp.type === "func" ? [exp.export_name, exp.type, this.getFunc(exp.name).idx] : exp.type === "memory" ? [exp.export_name, exp.type, this.getMemory(exp.name).idx] : exp.type === "global" ? [exp.export_name, exp.type, this.getGlobalIndexOf(exp.name)] : []
        )
      ));
    }
    if (this.starts.length) {
      bytes.write(section.start(
        this.getFunc(this.starts).idx
      ));
    }
    if (this.elements.length) {
      bytes.write(section.element(
        this.elements.map((elem) => [
          0,
          elem.offset_idx_expr,
          elem.codes.map((name) => this.getFunc(name).idx)
        ])
      ));
    }
    if (this.funcs.length) {
      bytes.write(section.code(
        this.funcs.map(
          (func) => [func.locals, func.body]
        )
      ));
    }
    if (this.datas.length) {
      bytes.write(section.data(
        this.datas.map((data) => [
          0,
          data.offset_idx_expr,
          data.bytes
        ])
      ));
    }
    //!timeEnd 'module build'
    return bytes;
  }
};

// lib/compiler.js
var GlobalContext = class {
  globals = [];
  types = [];
  funcs = [];
  constructor(data) {
    if (data) {
      Object.assign(this, data);
      this.funcs.forEach(function createFunctionContext(x) {
        x.context = new FunctionContext(this, x.context);
      });
    }
  }
  lookup(name, instr2) {
    let index;
    switch (instr2) {
      case "call":
        {
          index = this.funcs.map((x) => x.name).lastIndexOf(name);
        }
        break;
      case "type":
        {
          index = this.types.map((x) => x.name).lastIndexOf(name);
        }
        break;
      default: {
        index = this.globals.map((x) => x.name).lastIndexOf(name);
      }
    }
    if (!~index)
      throw new ReferenceError(`lookup failed at: ${instr2} "${name}"`);
    return uint(index);
  }
};
var FunctionContext = class {
  #global = null;
  locals = [];
  depth = [];
  constructor(global2, data) {
    this.#global = global2;
    if (data)
      Object.assign(this, data);
  }
  lookup(name, instr2) {
    let index;
    switch (instr2) {
      case "br":
      case "br_table":
      case "br_if":
        {
          index = this.depth.lastIndexOf(name);
          if (~index)
            index = this.depth.length - 1 - index;
        }
        break;
      default: {
        index = this.locals.lastIndexOf(name);
      }
    }
    if (!~index)
      return this.#global.lookup(name, instr2);
    return uint(index);
  }
};
function compile(node, moduleData, globalData) {
  const m = new ModuleBuilder(moduleData);
  const g = new GlobalContext(globalData);
  const deferred = [];
  function cast(param, context = g, instr2 = "i32") {
    switch (param.kind) {
      case "number": {
        if (param.value === "inf" || param.value === "+inf") {
          return Infinity;
        } else if (param.value === "-inf") {
          return -Infinity;
        } else if (param.value === "nan" || param.value === "+nan") {
          return NaN;
        } else if (param.value === "-nan") {
          return NaN;
        } else if (instr2?.[0] === "f") {
          return parseFloat(param.value);
        }
      }
      case "hex": {
        let value;
        if (instr2.indexOf("i64") === 0) {
          if (param.value[0] === "-") {
            value = -BigInt(param.value.slice(1));
          } else {
            value = BigInt(param.value);
          }
          return value;
        } else if (instr2[0] === "f") {
          if (param.value.indexOf("nan") >= 0) {
            if (instr2.indexOf("f32") === 0) {
              value = nanbox32(param.value);
            } else {
              value = nanbox64(param.value);
            }
          } else {
            value = hex2float(param.value);
          }
          return value;
        } else {
          return parseInt(param.value);
        }
      }
      case "label":
        return context.lookup(param.value, instr2);
      default:
        return param.value;
    }
  }
  function bytes(instr2, args, expr) {
    if (!(instr2 in INSTR) || typeof INSTR[instr2] !== "function") {
      throw new Error("Unknown instruction: " + instr2);
    }
    return [...INSTR[instr2](args, expr)];
  }
  function evaluate(node2, context = g) {
    const address = { offset: 0, align: 0 };
    const instr2 = node2.instr.value;
    switch (instr2) {
      case "type": {
        return m.getType(node2.name.value);
      }
      case "call_indirect": {
        const args = [evaluate(node2.children.shift(), context), 0];
        const expr = node2.children.flatMap(function evaluateExpr(x) {
          return evaluate(x, context);
        });
        return bytes(instr2, args, expr);
      }
      case "memory.grow": {
        const args = [0];
        const expr = node2.children.flatMap(function evaluateMemory(x) {
          return evaluate(x, context);
        });
        return bytes(instr2, args, expr);
      }
      case "i32.load":
      case "i64.load":
      case "f32.load":
      case "f64.load":
      case "i32.load8_s":
      case "i32.load8_u":
      case "i32.load16_s":
      case "i32.load16_u":
      case "i64.load8_s":
      case "i64.load8_u":
      case "i64.load16_s":
      case "i64.load16_u":
      case "i64.load32_s":
      case "i64.load32_u":
      case "i32.store":
      case "i64.store":
      case "f32.store":
      case "f64.store":
      case "i32.store8":
      case "i32.store16":
      case "i64.store8":
      case "i64.store16":
      case "i64.store32": {
        address.align = ALIGN[instr2];
        for (const p of node2.params) {
          address[p.param.value] = cast(p.value);
        }
        const args = [Math.log2(address.align), address.offset].map((x) => {
          if (typeof x === "number")
            return uint(x);
          else if (typeof x === "bigint")
            return bigint(x);
        });
        const expr = node2.children.flatMap(function evaluateLoadStoreExpr(x) {
          return evaluate(x, context);
        });
        return bytes(instr2, args, expr);
      }
      case "func": {
        const func = {
          name: node2.name?.value ?? g.funcs.length,
          params: [],
          results: []
        };
        g.funcs.push(func);
        for (const c of node2.children) {
          switch (c.instr.value) {
            case "param":
              {
                func.params.push(...c.children.map((x) => x.instr.value));
              }
              break;
            case "result": {
              func.results.push(...c.children.map((x) => x.instr.value));
            }
            case "type":
              break;
          }
        }
        return [func.name, func.params, func.results];
      }
      case "result": {
        return node2.children.flatMap(function evaluateResult(x) {
          return INSTR.type[x.instr.value]();
        });
      }
      case "else":
      case "then": {
        return node2.children.flatMap(function evaluateElseThen(x) {
          return evaluate(x, context);
        });
      }
      case "if": {
        const name = node2.name?.value ?? context.depth.length;
        const results = [];
        const branches = [];
        let cond, thenbody;
        context.depth.push(name);
        for (const c of node2.children) {
          switch (c.instr.value) {
            case "result":
              {
                results.push(evaluate(c, context));
              }
              break;
            case "else":
              branches.push(...INSTR.else());
            case "then":
              {
                thenbody = evaluate(c, context);
                branches.push(thenbody);
              }
              break;
            default: {
              if (cond) {
                if (thenbody) {
                  branches.push(...INSTR.else());
                  branches.push(evaluate(c, context));
                } else {
                  thenbody = evaluate(c, context);
                  branches.push(thenbody);
                }
              } else {
                cond = evaluate(c, context);
              }
            }
          }
        }
        context.depth.pop();
        if (!results.length) {
          results.push(INSTR.type.void());
        }
        return [
          ...INSTR.if(results.flat(), cond),
          ...branches.flat(),
          ...INSTR.end()
        ];
      }
      case "loop":
      case "block": {
        const name = node2.name?.value ?? context.depth.length;
        const results = [];
        const body = [];
        context.depth.push(name);
        for (const c of node2.children) {
          switch (c.instr.value) {
            case "result":
              {
                results.push(evaluate(c, context));
              }
              break;
            default: {
              body.push(evaluate(c, context));
            }
          }
        }
        context.depth.pop();
        if (!results.length) {
          results.push(INSTR.type.void());
        }
        return [
          ...INSTR[instr2](),
          ...results.flat().map(function layoutResults(x) {
            return [...x];
          }),
          ...body.flat(),
          ...INSTR.end()
        ];
      }
      case "br_table": {
        if (node2.name) {
          node2.params.unshift({
            param: {
              value: context.lookup(node2.name.value, instr2)
            }
          });
        }
        const args = node2.params.map((x) => cast(x.param, context, instr2));
        const expr = node2.children.flatMap(function evaluateBrTable(x) {
          return evaluate(x, context);
        });
        return bytes(instr2, [args.length - 1, ...args], expr);
      }
      default: {
        if (node2.name) {
          node2.params.unshift({
            param: {
              value: (instr2.startsWith("global") ? g : context).lookup(node2.name.value, instr2)
            }
          });
        }
        const args = node2.params.map((x) => cast(x.param, context, instr2));
        const expr = node2.children.flatMap(function evaluateNode(x) {
          return evaluate(x, context);
        });
        return bytes(instr2, args, expr);
      }
    }
  }
  function build(node2) {
    switch (node2.instr.value) {
      case "module":
        {
          node2.children.forEach(function buildModule(x) {
            build(x);
          });
        }
        break;
      case "memory":
        {
          const name = node2.name?.value ?? m.memories.length;
          const args = node2.params.map((x) => cast(x.param)).flat();
          if (node2.children?.[0]?.instr.value === "export") {
            const export_name = node2.children[0].params[0].param.value;
            const internal_name = node2.children[0].name?.value ?? name ?? 0;
            m.export("memory", internal_name, export_name);
          }
          m.memory(name, ...args);
        }
        break;
      case "data":
        {
          const expr = node2.children.shift();
          const data = node2.children.shift().data;
          m.data(evaluate(expr), data);
        }
        break;
      case "start":
        {
          m.start(node2.name.value);
        }
        break;
      case "table":
        {
          const args = node2.params.map((x) => cast(x.param));
          args.unshift(args.pop());
          m.table(...args);
        }
        break;
      case "elem":
        {
          const expr = node2.children.shift();
          const refs = node2.children.map((x) => x.ref.value);
          m.elem(evaluate(expr), refs);
        }
        break;
      case "import":
        {
          if (node2.children[0].instr.value === "func") {
            const args = node2.params.map((x) => cast(x.param));
            let params_results = evaluate(node2.children[0]);
            const name = params_results.shift();
            if (node2.children?.[0]?.children?.[0]?.instr.value === "type") {
              const typeName = node2.children?.[0]?.children?.[0]?.name.value;
              const typeIdx = m.getType(typeName);
              const type = m.types[typeIdx];
              params_results = type.split(",").map((x) => x.split(" "));
            }
            m.import("func", name, ...args, ...params_results);
          } else if (node2.children[0].instr.value === "memory") {
            const memory = node2.children[0];
            const args = node2.params.map((x) => cast(x.param));
            const name = memory.instr.name;
            const desc = memory.params.map((x) => cast(x.param));
            m.import("memory", name, ...args, desc);
          }
        }
        break;
      case "global":
        {
          const glob = {
            name: node2.name?.value ?? m.globals.length,
            vartype: "const",
            type: node2.children[0].instr.value
          };
          g.globals.push(glob);
          if (glob.type === "export") {
            const export_name = node2.children.shift().params[0].param.value;
            m.export("global", glob.name, export_name);
            glob.type = node2.children[0].instr.value;
          }
          if (glob.type === "mut") {
            glob.vartype = "var";
            glob.type = node2.children[0].children[0].instr.value;
          }
          const expr = node2.children[1];
          m.global(
            glob.name,
            glob.vartype,
            glob.type,
            evaluate(expr)
          );
        }
        break;
      case "type":
        {
          const type = {
            name: node2.name?.value ?? m.types.length,
            params: [],
            results: []
          };
          g.types.push(type);
          for (const c of node2.children[0].children) {
            switch (c.instr.value) {
              case "param":
                {
                  type.params.push(...c.children.map((x) => x.instr.value));
                }
                break;
              case "result":
                {
                  type.results.push(...c.children.map((x) => x.instr.value));
                }
                break;
            }
          }
          m.type(
            type.name,
            type.params,
            type.results
          );
        }
        break;
      case "export":
        {
          const exp = {
            name: node2.params[0].param.value
          };
          exp.type = node2.children[0].instr.value;
          exp.internal_name = node2.children[0].name.value;
          m.export(
            exp.type,
            exp.internal_name,
            exp.name
          );
        }
        break;
      case "func":
        {
          const func = {
            name: node2.name?.value ?? g.funcs.length,
            context: new FunctionContext(g),
            params: [],
            results: [],
            locals: [],
            body: []
          };
          g.funcs.push(func);
          for (const c of node2.children) {
            switch (c.instr.value) {
              case "export":
                {
                  const export_name = c.params[0].param.value;
                  m.export("func", func.name, export_name);
                }
                break;
              case "local":
                {
                  func.locals.push(...c.children.map((x) => x.instr.value));
                  func.context.locals.push(...c.children.map(() => c.name?.value));
                }
                break;
              case "param":
                {
                  func.params.push(...c.children.map((x) => x.instr.value));
                  func.context.locals.push(...c.children.map(() => c.name?.value));
                }
                break;
              case "result":
                {
                  func.results.push(...c.children.map((x) => x.instr.value));
                }
                break;
              case "type":
                break;
              default: {
                func.body.push(c);
              }
            }
          }
          deferred.push(function deferredFunc() {
            m.func(
              func.name,
              func.params,
              func.results,
              func.locals,
              [...func.body.flatMap(function evaluateFuncBody(x) {
                return evaluate(x, func.context);
              })]
            );
          });
        }
        break;
    }
  }
  build(node);
  deferred.forEach(function buildFunc(fn) {
    fn();
  });
  return { module: m, global: g };
}

// lib/lexer.js
var regexp = new RegExp([
  /(?<comment>;;.*|\(;[^]*?;\))/,
  /"(?<string>(?:\\"|[^"])*?)"/,
  /(?<param>offset|align|shared|funcref)=?/,
  /(?<hex>([+-]?nan:)?[+-]?0x[0-9a-f.p+-_]+)/,
  /(?<number>[+-]?inf|[+-]?nan|[+-]?\d[\d.e_+-]*)/,
  /(?<instr>[a-z][a-z0-9!#$%&'*+\-./:<=>?@\\^_`|~]+)/,
  /\$(?<label>[a-z0-9!#$%&'*+\-./:<=>?@\\^_`|~]+)/,
  /(?<lparen>\()|(?<rparen>\))|(?<nul>[ \t\n]+)|(?<error>.)/
].map((x) => x.toString().slice(1, -1)).join("|"), "gi");
function tokenize(input) {
  let last = {};
  let curr = {};
  const matches = input.matchAll(regexp);
  function next() {
    const match = matches.next();
    if (match.done)
      return { value: { value: null, kind: "eof", index: input.length }, done: true };
    const [kind, value] = Object.entries(match.value.groups).filter((e) => e[1] != null)[0];
    return { value: { value, kind, index: match.value.index }, done: false };
  }
  function advance() {
    last = curr;
    do {
      curr = next().value;
    } while (curr.kind === "nul" || curr.kind === "comment");
    return last;
  }
  function peek(kind, value) {
    if (kind != null) {
      if (value != null) {
        return value === curr.value;
      } else {
        return kind === curr.kind;
      }
    }
    return curr;
  }
  function accept(kind, value) {
    if (kind === curr.kind) {
      if (value != null) {
        if (value === curr.value) {
          return advance();
        }
      } else {
        return advance();
      }
    }
    return null;
  }
  function expect(kind, value) {
    const token = accept(kind, value);
    if (!token) {
      throw new SyntaxError(
        "Unexpected token: " + curr.value + "\n        expected: " + kind + (value ? ' "' + value + '"' : "") + "\n    but received: " + curr.kind + "\n     at position: " + curr.index
      );
    }
    return token;
  }
  const iterator = {
    [Symbol.iterator]() {
      return this;
    },
    next,
    advance,
    peek,
    accept,
    expect,
    start: advance
  };
  return iterator;
}

// lib/parser.js
function parse({ start, peek, accept, expect }) {
  const encoder2 = new TextEncoder("utf-8");
  const HEX = /[0-9a-f]/i;
  const stringchar = {
    t: 9,
    n: 10,
    r: 13,
    '"': 34,
    "'": 39,
    "\\": 92
  };
  function parseDataString() {
    const parsed = [];
    while (1) {
      const str = accept("string");
      if (!str)
        break;
      for (let i = 0, ch, next; i < str.value.length; i++) {
        ch = str.value[i];
        if (ch === "\\") {
          next = str.value[i + 1];
          if (next in stringchar) {
            parsed.push(stringchar[next]);
            i++;
            continue;
          } else if (HEX.test(next)) {
            if (HEX.test(str.value[i + 2])) {
              parsed.push(parseInt(`${next}${str.value[i += 2]}`, 16));
            } else {
              parsed.push(parseInt(next, 16));
              i++;
            }
            continue;
          }
        }
        parsed.push(encoder2.encode(ch));
      }
    }
    return parsed;
  }
  function* params() {
    let param;
    while (1) {
      if (param = accept("number")) {
        param.value = param.value.replace(/_/g, "");
        yield { param };
        continue;
      }
      if (param = accept("hex")) {
        param.value = param.value.replace(/_/g, "");
        yield { param };
        continue;
      }
      if (param = accept("string")) {
        yield { param };
        continue;
      }
      if (param = accept("label")) {
        yield { param };
        continue;
      }
      if (param = accept("param")) {
        let value;
        if (value = accept("number")) {
          yield { param, value };
          continue;
        }
        if (value = accept("hex")) {
          yield { param, value };
          continue;
        } else {
          yield { param };
          continue;
        }
      }
      break;
    }
  }
  function expr() {
    const ref = accept("label");
    if (ref)
      return { ref };
    if (peek("string")) {
      return { data: parseDataString() };
    }
    const sexpr = accept("lparen");
    let instr2;
    if (sexpr) {
      instr2 = expect("instr");
    } else {
      instr2 = accept("instr");
      if (!instr2)
        return;
    }
    const node = {
      instr: instr2,
      name: accept("label"),
      params: [...params()],
      children: []
    };
    if (sexpr) {
      let child;
      while (!peek("eof") && (child = expr())) {
        node.children.push(child);
      }
      node.params.push(...params());
      expect("rparen");
    } else if (instr2.value === "block" || instr2.value === "loop") {
      let child;
      while (!peek("eof") && !peek("instr", "end") && (child = expr())) {
        node.children.push(child);
      }
      expect("instr", "end");
    }
    return node;
  }
  start();
  return expr();
}

// index.js
function make(code, options, context = {}) {
  return compile(parse(tokenize("(module " + code + ")")), context.module, context.global).module.build(options).buffer;
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vaW5kZXguanMiLCAiLi4vLi4vbGliL2NvbnN0LmpzIiwgIi4uLy4uL2xpYi9sZWIxMjguanMiLCAiLi4vLi4vbGliL2JpbmFyeS5qcyIsICIuLi8uLi9saWIvYnVpbGRlci5qcyIsICIuLi8uLi9saWIvY29tcGlsZXIuanMiLCAiLi4vLi4vbGliL2xleGVyLmpzIiwgIi4uLy4uL2xpYi9wYXJzZXIuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBNb2R1bGVCdWlsZGVyIGZyb20gJy4vbGliL2J1aWxkZXIuanMnXG5pbXBvcnQgY29tcGlsZSwgeyBHbG9iYWxDb250ZXh0LCBGdW5jdGlvbkNvbnRleHQgfSBmcm9tICcuL2xpYi9jb21waWxlci5qcydcbmltcG9ydCB7IHRva2VuaXplIH0gZnJvbSAnLi9saWIvbGV4ZXIuanMnXG5pbXBvcnQgcGFyc2UgZnJvbSAnLi9saWIvcGFyc2VyLmpzJ1xuXG5leHBvcnQgeyB0b2tlbml6ZSB9XG5leHBvcnQgeyBwYXJzZSB9XG5leHBvcnQgeyBjb21waWxlIH1cbmV4cG9ydCB7IE1vZHVsZUJ1aWxkZXIsIEdsb2JhbENvbnRleHQsIEZ1bmN0aW9uQ29udGV4dCB9XG5cbi8qKlxuICogQ29tcGlsZXMgYSBXQVQgc291cmNlIHN0cmluZyB0byBhIGJ1ZmZlci5cbiAqXG4gKiBgYGBqc1xuICogaW1wb3J0IGNvbXBpbGUgZnJvbSAnd2F0LWNvbXBpbGVyJ1xuICogY29uc3QgYnVmZmVyID0gY29tcGlsZSgnKGZ1bmMgKGV4cG9ydCBcImFuc3dlclwiKSAocmVzdWx0IGkzMikgKGkzMi5jb25zdCA0MikpJylcbiAqIGNvbnN0IG1vZCA9IG5ldyBXZWJBc3NlbWJseS5Nb2R1bGUoYnVmZmVyKVxuICogY29uc3QgaW5zdGFuY2UgPSBuZXcgV2ViQXNzZW1ibHkuSW5zdGFuY2UobW9kKVxuICogY29uc29sZS5sb2coaW5zdGFuY2UuZXhwb3J0cy5hbnN3ZXIoKSkgLy8gPT4gNDJcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjb2RlIFRoZSBXQVQgY29kZSB0byBjb21waWxlXG4gKiBAcGFyYW0ge09wdGlvbnN9IG9wdGlvbnMgQW4gb3B0aW9ucyBvYmplY3RcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0aW9ucy5tZXRyaWNzIEVuYWJsZSBtZXRyaWNzIHdpdGggY29uc29sZS50aW1lXG4gKiBAcGFyYW0ge0NvbnRleHR9IGNvbnRleHRcbiAqIEBwYXJhbSB7TW9kdWxlQnVpbGRlcn0gY29udGV4dC5tb2R1bGVcbiAqIEBwYXJhbSB7R2xvYmFsQ29udGV4dH0gY29udGV4dC5nbG9iYWxcbiAqIEByZXR1cm5zIHtVaW50OEFycmF5fSBUaGUgYnVmZmVyIHRvIGJlIHBhc3NlZCBvbiB0byBXZWJBc3NlbWJseVxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBtYWtlKGNvZGUsIG9wdGlvbnMsIGNvbnRleHQgPSB7fSkge1xuICByZXR1cm4gY29tcGlsZShwYXJzZSh0b2tlbml6ZSgnKG1vZHVsZSAnK2NvZGUrJyknKSksIGNvbnRleHQubW9kdWxlLCBjb250ZXh0Lmdsb2JhbCkubW9kdWxlLmJ1aWxkKG9wdGlvbnMpLmJ1ZmZlclxufVxuIiwgIi8qXG4gKiBbbW9kaWZpZWRdOiBNb2RpZmljYXRpb25zIGJlbG9uZyBpbiB0aGUgcHVibGljIGRvbWFpbi5cbiAqXG4gKiBPcmlnaW5hbCBzb3VyY2U6IGh0dHBzOi8vZ2l0aHViLmNvbS9qLXMtbi9XZWJCUy9ibG9iL21hc3Rlci9jb21waWxlci9ieXRlQ29kZS5qcyNMMzY5XG4gKi9cblxuaW1wb3J0IHsgd3JhcF9pbnN0ciB9IGZyb20gJy4vYmluYXJ5LmpzJ1xuXG5leHBvcnQgY29uc3QgQllURSA9IHtcbiAgJ3R5cGUuaTMyJzogMHg3ZixcbiAgJ3R5cGUuaTY0JzogMHg3ZSxcbiAgJ3R5cGUuZjMyJzogMHg3ZCxcbiAgJ3R5cGUuZjY0JzogMHg3YyxcbiAgJ3R5cGUudm9pZCc6IDB4NDAsXG4gICd0eXBlLmZ1bmMnOiAweDYwLFxuICAndHlwZS5mdW5jcmVmJzogMHg3MCxcbiAgJ3NlY3Rpb24uY3VzdG9tJzogMCxcbiAgJ3NlY3Rpb24udHlwZSc6IDEsXG4gICdzZWN0aW9uLmltcG9ydCc6IDIsXG4gICdzZWN0aW9uLmZ1bmN0aW9uJzogMyxcbiAgJ3NlY3Rpb24udGFibGUnOiA0LFxuICAnc2VjdGlvbi5tZW1vcnknOiA1LFxuICAnc2VjdGlvbi5nbG9iYWwnOiA2LFxuICAnc2VjdGlvbi5leHBvcnQnOiA3LFxuICAnc2VjdGlvbi5zdGFydCc6IDgsXG4gICdzZWN0aW9uLmVsZW1lbnQnOiA5LFxuICAnc2VjdGlvbi5jb2RlJzogMTAsXG4gICdzZWN0aW9uLmRhdGEnOiAxMSxcbiAgJ2ltcG9ydC5mdW5jJzogMHgwMCxcbiAgJ2ltcG9ydC50YWJsZSc6IDB4MDEsXG4gICdpbXBvcnQubWVtb3J5JzogMHgwMixcbiAgJ2ltcG9ydC5nbG9iYWwnOiAweDAzLFxuICAnZXhwb3J0LmZ1bmN0aW9uJzogMHgwMCxcbiAgJ2V4cG9ydC50YWJsZSc6IDB4MDEsXG4gICdleHBvcnQubWVtb3J5JzogMHgwMixcbiAgJ2V4cG9ydC5nbG9iYWwnOiAweDAzLFxuICAnZ2xvYmFsLmNvbnN0JzogMHgwMCxcbiAgJ2dsb2JhbC52YXInOiAweDAxLFxuICAnZ2xvYmFsLm11dCc6IDB4MDEsXG4gICdsaW1pdHMubWluJzogMHgwMCxcbiAgJ2xpbWl0cy5taW5tYXgnOiAweDAxLFxuICAnbGltaXRzLnNoYXJlZCc6IDB4MDMsXG59XG5cbi8qXG4gIFRoZSBXZWJBc3NlbWJseSBiaW5hcnkgZW5jb2RpbmcgZG9jdW1lbnRhdGlvbiBzcGVjaWZpZXMgYWxsIHRoZSBpbnN0cnVjdGlvbiBieXRlIGNvZGVzLlxuICBTZWUgdGhlIE1WUCBkb2N1bWVudGF0aW9uICh3aGljaCBpcyBubyBsb25nZXIgbWFpbnRhaW5lZCk6XG4gICAgaHR0cHM6Ly93ZWJhc3NlbWJseS5vcmcvZG9jcy9iaW5hcnktZW5jb2RpbmcvXG4gIE9yIHRoZSBub3JtYXRpdmUgcG9zdC1NVlAgZG9jdW1lbnRhdGlvbiAod2hpY2ggaXMgbXVjaCBtb3JlIHByZWNpc2UgYW5kIGNvbXBsZXRlLCBpZiBwZXJoYXBzIGxlc3MgcmVhZGFibGUpOlxuICAgIGh0dHA6Ly93ZWJhc3NlbWJseS5naXRodWIuaW8vc3BlYy9jb3JlL2JpbmFyeS9pbmRleC5odG1sXG5cbiAgVGhpcyBpcyBhIGNvbnNlY3V0aXZlIGxpc3Qgb2YgdGhlIGVudGlyZSByYW5nZSBvZiBpbnN0cnVjdGlvbiBjb2RlcyAod2l0aCAwcyBpbiBwbGFjZSBvZiB1bnVzZWQvcmVzZXJ2ZWQgc3BhY2VzKS5cbiAgVGhlIGNvZGVUYWJsZSBpcyBwb3B1bGF0ZWQgYnkgYXNzaWduaW5nIDB4MDAgdG8gJ3VucmVhY2hhYmxlJywgMHgwMSB0byAnbm9wJywgYW5kIHNvIG9uIChza2lwcGluZyB0aGUgdW51c2VkIHNsb3RzKS5cbiovXG5jb25zdCBvcENvZGVzID0gW1xuICAndW5yZWFjaGFibGUnLCAnbm9wJywgJ2Jsb2NrJywgJ2xvb3AnLCAnaWYnLCAnZWxzZScsICwsLCwsXG5cbiAgJ2VuZCcsICdicicsICdicl9pZicsICdicl90YWJsZScsICdyZXR1cm4nLCAnY2FsbCcsICdjYWxsX2luZGlyZWN0JywgLCwsLCwsLCxcblxuICAnZHJvcCcsICdzZWxlY3QnLCAsLCwsXG5cbiAgJ2xvY2FsLmdldCcsICdsb2NhbC5zZXQnLCAnbG9jYWwudGVlJywgJ2dsb2JhbC5nZXQnLCAnZ2xvYmFsLnNldCcsICwsLFxuXG4gICdpMzIubG9hZCcsICdpNjQubG9hZCcsICdmMzIubG9hZCcsICdmNjQubG9hZCcsXG4gICdpMzIubG9hZDhfcycsICdpMzIubG9hZDhfdScsICdpMzIubG9hZDE2X3MnLCAnaTMyLmxvYWQxNl91JyxcbiAgJ2k2NC5sb2FkOF9zJywgJ2k2NC5sb2FkOF91JywgJ2k2NC5sb2FkMTZfcycsICdpNjQubG9hZDE2X3UnLCAnaTY0LmxvYWQzMl9zJywgJ2k2NC5sb2FkMzJfdScsXG5cbiAgJ2kzMi5zdG9yZScsICdpNjQuc3RvcmUnLCAnZjMyLnN0b3JlJywgJ2Y2NC5zdG9yZScsXG4gICdpMzIuc3RvcmU4JywgJ2kzMi5zdG9yZTE2JywgJ2k2NC5zdG9yZTgnLCAnaTY0LnN0b3JlMTYnLCAnaTY0LnN0b3JlMzInLFxuXG4gICdtZW1vcnkuc2l6ZScsICdtZW1vcnkuZ3JvdycsXG5cbiAgJ2kzMi5jb25zdCcsICdpNjQuY29uc3QnLCAnZjMyLmNvbnN0JywgJ2Y2NC5jb25zdCcsXG4gICdpMzIuZXF6JywgJ2kzMi5lcScsICdpMzIubmUnLCAnaTMyLmx0X3MnLCAnaTMyLmx0X3UnLCAnaTMyLmd0X3MnLCAnaTMyLmd0X3UnLCAnaTMyLmxlX3MnLCAnaTMyLmxlX3UnLCAnaTMyLmdlX3MnLCAnaTMyLmdlX3UnLFxuICAnaTY0LmVxeicsICdpNjQuZXEnLCAnaTY0Lm5lJywgJ2k2NC5sdF9zJywgJ2k2NC5sdF91JywgJ2k2NC5ndF9zJywgJ2k2NC5ndF91JywgJ2k2NC5sZV9zJywgJ2k2NC5sZV91JywgJ2k2NC5nZV9zJywgJ2k2NC5nZV91JyxcbiAgICAgICAgICAgICAnZjMyLmVxJywgJ2YzMi5uZScsICdmMzIubHQnLCAgICAgICAgICAgICAgICdmMzIuZ3QnLCAgICAgICAgICAgICAgICdmMzIubGUnLCAgICAgICAgICAgICAgICdmMzIuZ2UnLFxuICAgICAgICAgICAgICdmNjQuZXEnLCAnZjY0Lm5lJywgJ2Y2NC5sdCcsICAgICAgICAgICAgICAgJ2Y2NC5ndCcsICAgICAgICAgICAgICAgJ2Y2NC5sZScsICAgICAgICAgICAgICAgJ2Y2NC5nZScsXG5cbiAgJ2kzMi5jbHonLCAnaTMyLmN0eicsICdpMzIucG9wY250JywgJ2kzMi5hZGQnLCAnaTMyLnN1YicsICdpMzIubXVsJywgJ2kzMi5kaXZfcycsICdpMzIuZGl2X3UnLCAnaTMyLnJlbV9zJywgJ2kzMi5yZW1fdScsICdpMzIuYW5kJywgJ2kzMi5vcicsICdpMzIueG9yJywgJ2kzMi5zaGwnLCAnaTMyLnNocl9zJywgJ2kzMi5zaHJfdScsICdpMzIucm90bCcsICdpMzIucm90cicsXG4gICdpNjQuY2x6JywgJ2k2NC5jdHonLCAnaTY0LnBvcGNudCcsICdpNjQuYWRkJywgJ2k2NC5zdWInLCAnaTY0Lm11bCcsICdpNjQuZGl2X3MnLCAnaTY0LmRpdl91JywgJ2k2NC5yZW1fcycsICdpNjQucmVtX3UnLCAnaTY0LmFuZCcsICdpNjQub3InLCAnaTY0LnhvcicsICdpNjQuc2hsJywgJ2k2NC5zaHJfcycsICdpNjQuc2hyX3UnLCAnaTY0LnJvdGwnLCAnaTY0LnJvdHInLFxuXG4gICdmMzIuYWJzJywgJ2YzMi5uZWcnLCAnZjMyLmNlaWwnLCAnZjMyLmZsb29yJywgJ2YzMi50cnVuYycsICdmMzIubmVhcmVzdCcsICdmMzIuc3FydCcsICdmMzIuYWRkJywgJ2YzMi5zdWInLCAnZjMyLm11bCcsICdmMzIuZGl2JywgJ2YzMi5taW4nLCAnZjMyLm1heCcsICdmMzIuY29weXNpZ24nLFxuICAnZjY0LmFicycsICdmNjQubmVnJywgJ2Y2NC5jZWlsJywgJ2Y2NC5mbG9vcicsICdmNjQudHJ1bmMnLCAnZjY0Lm5lYXJlc3QnLCAnZjY0LnNxcnQnLCAnZjY0LmFkZCcsICdmNjQuc3ViJywgJ2Y2NC5tdWwnLCAnZjY0LmRpdicsICdmNjQubWluJywgJ2Y2NC5tYXgnLCAnZjY0LmNvcHlzaWduJyxcblxuICAnaTMyLndyYXBfaTY0JyxcblxuICAnaTMyLnRydW5jX2YzMl9zJywgJ2kzMi50cnVuY19mMzJfdScsICdpMzIudHJ1bmNfZjY0X3MnLCAnaTMyLnRydW5jX2Y2NF91JywgJ2k2NC5leHRlbmRfaTMyX3MnLCAnaTY0LmV4dGVuZF9pMzJfdScsXG4gICdpNjQudHJ1bmNfZjMyX3MnLCAnaTY0LnRydW5jX2YzMl91JywgJ2k2NC50cnVuY19mNjRfcycsICdpNjQudHJ1bmNfZjY0X3UnLFxuXG4gICdmMzIuY29udmVydF9pMzJfcycsICdmMzIuY29udmVydF9pMzJfdScsICdmMzIuY29udmVydF9pNjRfcycsICdmMzIuY29udmVydF9pNjRfdScsICdmMzIuZGVtb3RlX2Y2NCcsXG4gICdmNjQuY29udmVydF9pMzJfcycsICdmNjQuY29udmVydF9pMzJfdScsICdmNjQuY29udmVydF9pNjRfcycsICdmNjQuY29udmVydF9pNjRfdScsICdmNjQucHJvbW90ZV9mMzInLFxuXG4gICdpMzIucmVpbnRlcnByZXRfZjMyJywgJ2k2NC5yZWludGVycHJldF9mNjQnLCAnZjMyLnJlaW50ZXJwcmV0X2kzMicsICdmNjQucmVpbnRlcnByZXRfaTY0Jyxcbl1cblxuY29uc3QgYWxpYXMgPSB7XG4gICdnZXRfbG9jYWwnOiAgJ2xvY2FsLmdldCcsICdzZXRfbG9jYWwnOiAgJ2xvY2FsLnNldCcsICd0ZWVfbG9jYWwnOiAnbG9jYWwudGVlJyxcbiAgJ2dldF9nbG9iYWwnOiAnZ2xvYmFsLmdldCcsJ3NldF9nbG9iYWwnOiAnZ2xvYmFsLnNldCcsXG5cbiAgJ2kzMi50cnVuY19zL2YzMic6ICdpMzIudHJ1bmNfZjMyX3MnLCAnaTMyLnRydW5jX3UvZjMyJzogJ2kzMi50cnVuY19mMzJfdScsICdpMzIudHJ1bmNfcy9mNjQnOiAnaTMyLnRydW5jX2Y2NF9zJywgJ2kzMi50cnVuY191L2Y2NCc6ICdpMzIudHJ1bmNfZjY0X3UnLCAnaTY0LmV4dGVuZF9zL2kzMic6ICdpNjQuZXh0ZW5kX2kzMl9zJywgJ2k2NC5leHRlbmRfdS9pMzInOiAnaTY0LmV4dGVuZF9pMzJfdScsXG4gICdpNjQudHJ1bmNfcy9mMzInOiAnaTY0LnRydW5jX2YzMl9zJywgJ2k2NC50cnVuY191L2YzMic6ICdpNjQudHJ1bmNfZjMyX3UnLCAnaTY0LnRydW5jX3MvZjY0JzogJ2k2NC50cnVuY19mNjRfcycsICdpNjQudHJ1bmNfdS9mNjQnOiAnaTY0LnRydW5jX2Y2NF91JyxcblxuICAnZjMyLmNvbnZlcnRfcy9pMzInOiAnZjMyLmNvbnZlcnRfaTMyX3MnLCAnZjMyLmNvbnZlcnRfdS9pMzInOiAnZjMyLmNvbnZlcnRfaTMyX3UnLFxuICAnZjMyLmNvbnZlcnRfcy9pNjQnOiAnZjMyLmNvbnZlcnRfaTY0X3MnLCAnZjMyLmNvbnZlcnRfdS9pNjQnOiAnZjMyLmNvbnZlcnRfaTY0X3UnLCAnZjMyLmRlbW90ZS9mNjQnOiAnZjMyLmRlbW90ZV9mNjQnLFxuXG4gICdmNjQuY29udmVydF9zL2kzMic6ICdmNjQuY29udmVydF9pMzJfcycsICdmNjQuY29udmVydF91L2kzMic6ICdmNjQuY29udmVydF9pMzJfdScsXG4gICdmNjQuY29udmVydF9zL2k2NCc6ICdmNjQuY29udmVydF9pNjRfcycsICdmNjQuY29udmVydF91L2k2NCc6ICdmNjQuY29udmVydF9pNjRfdScsICdmNjQucHJvbW90ZS9mMzInOiAnZjY0LnByb21vdGVfZjMyJyxcbn1cblxuLy8gVXNlIHRoZSBhYm92ZSBvcENvZGVzIGxpc3QgdG8gZmlsbCB0aGUgY29kZVRhYmxlLCBza2lwcGluZyByZXNlcnZlZCBzZWdtZW50cy5cbmZvciAoY29uc3QgW2ksIG9wXSBvZiBvcENvZGVzLmVudHJpZXMoKSkge1xuICBpZiAob3AgIT0gbnVsbCkge1xuICAgIEJZVEVbb3BdID0gaVxuICB9XG59XG5cbkJZVEVbJ2kzMi50cnVuY19zYXRfZjMyX3MnXSA9IFsweGZjLCAweDAwXVxuQllURVsnaTMyLnRydW5jX3NhdF9mMzJfdSddID0gWzB4ZmMsIDB4MDFdXG5CWVRFWydpMzIudHJ1bmNfc2F0X2Y2NF9zJ10gPSBbMHhmYywgMHgwMl1cbkJZVEVbJ2kzMi50cnVuY19zYXRfZjY0X3UnXSA9IFsweGZjLCAweDAzXVxuQllURVsnaTY0LnRydW5jX3NhdF9mMzJfcyddID0gWzB4ZmMsIDB4MDRdXG5CWVRFWydpNjQudHJ1bmNfc2F0X2YzMl91J10gPSBbMHhmYywgMHgwNV1cbkJZVEVbJ2k2NC50cnVuY19zYXRfZjY0X3MnXSA9IFsweGZjLCAweDA2XVxuQllURVsnaTY0LnRydW5jX3NhdF9mNjRfdSddID0gWzB4ZmMsIDB4MDddXG5cbkJZVEVbJ21lbW9yeS5pbml0J10gPSBbMHhmYywgMHgwOF1cblxuQllURVsnZGF0YS5kcm9wJ10gPSBbMHhmYywgMHgwOV1cblxuQllURVsnbWVtb3J5LmNvcHknXSA9IFsweGZjLCAweDBhXVxuQllURVsnbWVtb3J5LmZpbGwnXSA9IFsweGZjLCAweDBiXVxuXG5CWVRFWyd0YWJsZS5pbml0J10gPSBbMHhmYywgMHgwY11cblxuQllURVsnZWxlbS5kcm9wJ10gPSBbMHhmYywgMHgwZF1cblxuQllURVsndGFibGUuY29weSddID0gWzB4ZmMsIDB4MGVdXG5CWVRFWyd0YWJsZS5ncm93J10gPSBbMHhmYywgMHgwZl1cbkJZVEVbJ3RhYmxlLnNpemUnXSA9IFsweGZjLCAweDEwXVxuQllURVsndGFibGUuZmlsbCddID0gWzB4ZmMsIDB4MTFdXG5cbi8vIGFsaWFzIG9sZCBrZXl3b3Jkc1xuZm9yIChjb25zdCBuYW1lIGluIGFsaWFzKSB7XG4gIGNvbnN0IGkgPSBvcENvZGVzLmluZGV4T2YoYWxpYXNbbmFtZV0pXG4gIEJZVEVbbmFtZV0gPSBpXG59XG5cbmV4cG9ydCBjb25zdCBJTlNUUiA9IHt9XG5cbmZvciAoY29uc3Qgb3AgaW4gQllURSkge1xuICBJTlNUUltvcF0gPSB3cmFwX2luc3RyKG9wKVxuICBjb25zdCBbZ3JvdXAsIG1ldGhvZF0gPSBvcC5zcGxpdCgnLicpXG4gIGlmIChtZXRob2QgIT0gbnVsbCkge1xuICAgIEJZVEVbZ3JvdXBdID0gQllURVtncm91cF0gPz8ge31cbiAgICBCWVRFW2dyb3VwXVttZXRob2RdID0gQllURVtvcF1cbiAgICBJTlNUUltncm91cF0gPSBJTlNUUltncm91cF0gPz8ge31cbiAgICBJTlNUUltncm91cF1bbWV0aG9kXSA9IHdyYXBfaW5zdHIob3ApXG4gIH1cbn1cblxuLy8gaHR0cHM6Ly93ZWJhc3NlbWJseS5naXRodWIuaW8vc3BlYy9jb3JlL3RleHQvaW5zdHJ1Y3Rpb25zLmh0bWwjbWVtb3J5LWluc3RydWN0aW9uc1xuZXhwb3J0IGNvbnN0IEFMSUdOID0ge1xuICAnaTMyLmxvYWQnOiA0LFxuICAnaTY0LmxvYWQnOiA4LFxuICAnZjMyLmxvYWQnOiA0LFxuICAnZjY0LmxvYWQnOiA4LFxuXG4gICdpMzIubG9hZDhfcyc6IDEsXG4gICdpMzIubG9hZDhfdSc6IDEsXG4gICdpMzIubG9hZDE2X3MnOiAyLFxuICAnaTMyLmxvYWQxNl91JzogMixcblxuICAnaTY0LmxvYWQ4X3MnOiAxLFxuICAnaTY0LmxvYWQ4X3UnOiAxLFxuICAnaTY0LmxvYWQxNl9zJzogMixcbiAgJ2k2NC5sb2FkMTZfdSc6IDIsXG4gICdpNjQubG9hZDMyX3MnOiA0LFxuICAnaTY0LmxvYWQzMl91JzogNCxcblxuICAnaTMyLnN0b3JlJzogNCxcbiAgJ2k2NC5zdG9yZSc6IDgsXG4gICdmMzIuc3RvcmUnOiA0LFxuICAnZjY0LnN0b3JlJzogOCxcblxuICAnaTMyLnN0b3JlOCc6IDEsXG4gICdpMzIuc3RvcmUxNic6IDIsXG4gICdpNjQuc3RvcmU4JzogMSxcbiAgJ2k2NC5zdG9yZTE2JzogMixcbiAgJ2k2NC5zdG9yZTMyJzogNCxcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24qIGJpZ2ludChuKSB7XG4gIG4gPSB0b19pbnQ2NChuKVxuICB3aGlsZSAodHJ1ZSkge1xuICAgIGNvbnN0IGJ5dGUgPSBOdW1iZXIobiAmIDB4N0ZuKVxuICAgIG4gPj49IDduXG4gICAgaWYgKChuID09PSAwbiAmJiAoYnl0ZSAmIDB4NDApID09PSAwKSB8fCAobiA9PT0gLTFuICYmIChieXRlICYgMHg0MCkgIT09IDApKSB7XG4gICAgICB5aWVsZCBieXRlXG4gICAgICBicmVha1xuICAgIH1cbiAgICB5aWVsZCAoYnl0ZSB8IDB4ODApXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uKiBpbnQgKHZhbHVlKSB7XG4gIGxldCBieXRlID0gMHgwMFxuICBjb25zdCBzaXplID0gTWF0aC5jZWlsKE1hdGgubG9nMihNYXRoLmFicyh2YWx1ZSkpKVxuICBjb25zdCBuZWdhdGl2ZSA9IHZhbHVlIDwgMFxuICBsZXQgbW9yZSA9IHRydWVcblxuICB3aGlsZSAobW9yZSkge1xuICAgIGJ5dGUgPSB2YWx1ZSAmIDEyN1xuICAgIHZhbHVlID0gdmFsdWUgPj4gN1xuXG4gICAgaWYgKG5lZ2F0aXZlKSB7XG4gICAgICB2YWx1ZSA9IHZhbHVlIHwgKC0gKDEgPDwgKHNpemUgLSA3KSkpXG4gICAgfVxuXG4gICAgaWYgKFxuICAgICAgKHZhbHVlID09IDAgJiYgKChieXRlICYgMHg0MCkgPT0gMCkpIHx8XG4gICAgICAodmFsdWUgPT0gLTEgJiYgKChieXRlICYgMHg0MCkgPT0gMHg0MCkpXG4gICAgKSB7XG4gICAgICBtb3JlID0gZmFsc2VcbiAgICB9XG5cbiAgICBlbHNlIHtcbiAgICAgIGJ5dGUgPSBieXRlIHwgMTI4XG4gICAgfVxuXG4gICAgeWllbGQgYnl0ZVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiogdWludCAodmFsdWUsIHBhZCA9IDApIHtcbiAgaWYgKHZhbHVlIDwgMCkgdGhyb3cgbmV3IFR5cGVFcnJvcigndWludCB2YWx1ZSBtdXN0IGJlIHBvc2l0aXZlLCByZWNlaXZlZDogJyArIHZhbHVlKVxuXG4gIGxldCBieXRlID0gMHgwMFxuXG4gIGRvIHtcbiAgICBieXRlID0gdmFsdWUgJiAweDdGXG4gICAgdmFsdWUgPSB2YWx1ZSA+PiAweDA3XG5cbiAgICBpZiAodmFsdWUgIT0gMCB8fCBwYWQgPiAwKSB7XG4gICAgICBieXRlID0gYnl0ZSB8IDB4ODBcbiAgICB9XG5cbiAgICB5aWVsZCBieXRlXG5cbiAgICBwYWQtLVxuICB9IHdoaWxlICh2YWx1ZSAhPSAwIHx8IHBhZCA+IC0xKVxufVxuXG5jb25zdCBieXRlVmlldyA9IG5ldyBEYXRhVmlldyhuZXcgQmlnSW50NjRBcnJheSgxKS5idWZmZXIpXG5cbmV4cG9ydCBmdW5jdGlvbiB0b19pbnQ2NCAodmFsdWUpIHtcbiAgYnl0ZVZpZXcuc2V0QmlnSW50NjQoMCwgdmFsdWUpXG4gIHJldHVybiBieXRlVmlldy5nZXRCaWdJbnQ2NCgwKVxufVxuXG4vLyBmdW5jdGlvbiB0b191aW50NjQgKHZhbHVlKSB7XG4vLyAgIGJ5dGVWaWV3LnNldEJpZ1VpbnQ2NCgwLCB2YWx1ZSlcbi8vICAgcmV0dXJuIGJ5dGVWaWV3LmdldEJpZ1VpbnQ2NCgwKVxuLy8gfVxuXG5leHBvcnQgZnVuY3Rpb24qIGYzMiAodmFsdWUpIHtcbiAgYnl0ZVZpZXcuc2V0RmxvYXQzMigwLCB2YWx1ZSlcbiAgZm9yIChsZXQgaSA9IDQ7IGktLTspXG4gICAgeWllbGQgYnl0ZVZpZXcuZ2V0VWludDgoaSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uKiBmNjQgKHZhbHVlKSB7XG4gIGJ5dGVWaWV3LnNldEZsb2F0NjQoMCwgdmFsdWUpXG4gIGZvciAobGV0IGkgPSA4OyBpLS07KVxuICAgIHlpZWxkIGJ5dGVWaWV3LmdldFVpbnQ4KGkpXG59XG5cbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS94dHVjL3dlYmFzc2VtYmx5anMvYmxvYi9tYXN0ZXIvcGFja2FnZXMvZmxvYXRpbmctcG9pbnQtaGV4LXBhcnNlci9zcmMvaW5kZXguanNcbmV4cG9ydCBmdW5jdGlvbiBoZXgyZmxvYXQgKGlucHV0KSB7XG4gIGlucHV0ID0gaW5wdXQudG9VcHBlckNhc2UoKTtcbiAgY29uc3Qgc3BsaXRJbmRleCA9IGlucHV0LmluZGV4T2YoXCJQXCIpO1xuICBsZXQgbWFudGlzc2EsIGV4cG9uZW50O1xuXG4gIGlmIChzcGxpdEluZGV4ICE9PSAtMSkge1xuICAgIG1hbnRpc3NhID0gaW5wdXQuc3Vic3RyaW5nKDAsIHNwbGl0SW5kZXgpO1xuICAgIGV4cG9uZW50ID0gcGFyc2VJbnQoaW5wdXQuc3Vic3RyaW5nKHNwbGl0SW5kZXggKyAxKSk7XG4gIH0gZWxzZSB7XG4gICAgbWFudGlzc2EgPSBpbnB1dDtcbiAgICBleHBvbmVudCA9IDA7XG4gIH1cblxuICBjb25zdCBkb3RJbmRleCA9IG1hbnRpc3NhLmluZGV4T2YoXCIuXCIpO1xuXG4gIGlmIChkb3RJbmRleCAhPT0gLTEpIHtcbiAgICBsZXQgaW50ZWdlclBhcnQgPSBwYXJzZUludChtYW50aXNzYS5zdWJzdHJpbmcoMCwgZG90SW5kZXgpLCAxNik7XG4gICAgY29uc3Qgc2lnbiA9IE1hdGguc2lnbihpbnRlZ2VyUGFydCk7XG4gICAgaW50ZWdlclBhcnQgPSBzaWduICogaW50ZWdlclBhcnQ7XG4gICAgY29uc3QgZnJhY3Rpb25MZW5ndGggPSBtYW50aXNzYS5sZW5ndGggLSBkb3RJbmRleCAtIDE7XG4gICAgY29uc3QgZnJhY3Rpb25hbFBhcnQgPSBwYXJzZUludChtYW50aXNzYS5zdWJzdHJpbmcoZG90SW5kZXggKyAxKSwgMTYpO1xuICAgIGNvbnN0IGZyYWN0aW9uID1cbiAgICAgIGZyYWN0aW9uTGVuZ3RoID4gMCA/IGZyYWN0aW9uYWxQYXJ0IC8gTWF0aC5wb3coMTYsIGZyYWN0aW9uTGVuZ3RoKSA6IDA7XG4gICAgaWYgKHNpZ24gPT09IDApIHtcbiAgICAgIGlmIChmcmFjdGlvbiA9PT0gMCkge1xuICAgICAgICBtYW50aXNzYSA9IHNpZ247XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoT2JqZWN0LmlzKHNpZ24sIC0wKSkge1xuICAgICAgICAgIG1hbnRpc3NhID0gLWZyYWN0aW9uO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1hbnRpc3NhID0gZnJhY3Rpb247XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbWFudGlzc2EgPSBzaWduICogKGludGVnZXJQYXJ0ICsgZnJhY3Rpb24pO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBtYW50aXNzYSA9IHBhcnNlSW50KG1hbnRpc3NhLCAxNik7XG4gIH1cblxuICByZXR1cm4gbWFudGlzc2EgKiAoc3BsaXRJbmRleCAhPT0gLTEgPyBNYXRoLnBvdygyLCBleHBvbmVudCkgOiAxKTtcbn1cblxuY29uc3QgRjMyX1NJR04gPSAweDgwMDAwMDAwXG5jb25zdCBGMzJfTkFOICA9IDB4N2Y4MDAwMDBcblxuZXhwb3J0IGZ1bmN0aW9uKiBuYW5ib3gzMiAoaW5wdXQpIHtcbiAgbGV0IHZhbHVlID0gcGFyc2VJbnQoaW5wdXQuc3BsaXQoJ25hbjonKVsxXSlcbiAgdmFsdWUgfD0gRjMyX05BTlxuICBpZiAoaW5wdXRbMF0gPT09ICctJykgdmFsdWUgfD0gRjMyX1NJR05cblxuICBieXRlVmlldy5zZXRJbnQzMigwLCB2YWx1ZSlcbiAgZm9yIChsZXQgaSA9IDQ7IGktLTspXG4gICAgeWllbGQgYnl0ZVZpZXcuZ2V0VWludDgoaSlcbn1cblxuY29uc3QgRjY0X1NJR04gPSAweDgwMDAwMDAwMDAwMDAwMDBuXG5jb25zdCBGNjRfTkFOICA9IDB4N2ZmMDAwMDAwMDAwMDAwMG5cblxuZXhwb3J0IGZ1bmN0aW9uKiBuYW5ib3g2NCAoaW5wdXQpIHtcbiAgbGV0IHZhbHVlID0gQmlnSW50KGlucHV0LnNwbGl0KCduYW46JylbMV0pXG4gIHZhbHVlIHw9IEY2NF9OQU5cbiAgaWYgKGlucHV0WzBdID09PSAnLScpIHZhbHVlIHw9IEY2NF9TSUdOXG5cbiAgYnl0ZVZpZXcuc2V0QmlnSW50NjQoMCwgdmFsdWUpXG4gIGZvciAobGV0IGkgPSA4OyBpLS07KVxuICAgIHlpZWxkIGJ5dGVWaWV3LmdldFVpbnQ4KGkpXG59XG4iLCAiLyoqXG4gKiBAcHJpdmF0ZVxuICogW21vZGlmaWVkXTogbW9kaWZpY2F0aW9ucyBiZWxvbmcgaW4gdGhlIHB1YmxpYyBkb21haW4uXG4gKlxuICogT3JpZ2luYWwgc291cmNlOiBodHRwczovL2dpdGh1Yi5jb20vc3VybWEvYmZ3YXNtXG4gKiBPcmlnaW5hbCBsaWNlbnNlOlxuICogQ29weXJpZ2h0IDIwMTkgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuLy8gaHR0cHM6Ly9naXRodWIuY29tL3NhbXRob3IvZmFzdC10ZXh0LWVuY29kaW5nL2Jsb2IvbWFzdGVyL3RleHQuanNcbihmdW5jdGlvbiAobCkge1xuICBmdW5jdGlvbiBtKCkgeyB9IGZ1bmN0aW9uIGsoYSwgYykgeyBhID0gdm9pZCAwID09PSBhID8gXCJ1dGYtOFwiIDogYTsgYyA9IHZvaWQgMCA9PT0gYyA/IHsgZmF0YWw6ICExIH0gOiBjOyBpZiAoLTEgPT09IHIuaW5kZXhPZihhLnRvTG93ZXJDYXNlKCkpKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihcIkZhaWxlZCB0byBjb25zdHJ1Y3QgJ1RleHREZWNvZGVyJzogVGhlIGVuY29kaW5nIGxhYmVsIHByb3ZpZGVkICgnXCIgKyBhICsgXCInKSBpcyBpbnZhbGlkLlwiKTsgaWYgKGMuZmF0YWwpIHRocm93IEVycm9yKFwiRmFpbGVkIHRvIGNvbnN0cnVjdCAnVGV4dERlY29kZXInOiB0aGUgJ2ZhdGFsJyBvcHRpb24gaXMgdW5zdXBwb3J0ZWQuXCIpOyB9IGZ1bmN0aW9uIHQoYSkgeyByZXR1cm4gQnVmZmVyLmZyb20oYS5idWZmZXIsIGEuYnl0ZU9mZnNldCwgYS5ieXRlTGVuZ3RoKS50b1N0cmluZyhcInV0Zi04XCIpIH0gZnVuY3Rpb24gdShhKSB7XG4gICAgdmFyIGMgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFthXSwgeyB0eXBlOiBcInRleHQvcGxhaW47Y2hhcnNldD1VVEYtOFwiIH0pKTtcbiAgICB0cnkgeyB2YXIgZiA9IG5ldyBYTUxIdHRwUmVxdWVzdDsgZi5vcGVuKFwiR0VUXCIsIGMsICExKTsgZi5zZW5kKCk7IHJldHVybiBmLnJlc3BvbnNlVGV4dCB9IGNhdGNoIChlKSB7IHJldHVybiBxKGEpIH0gZmluYWxseSB7IFVSTC5yZXZva2VPYmplY3RVUkwoYykgfVxuICB9IGZ1bmN0aW9uIHEoYSkge1xuICAgIGZvciAodmFyIGMgPSAwLCBmID0gTWF0aC5taW4oNjU1MzYsIGEubGVuZ3RoICsgMSksIGUgPSBuZXcgVWludDE2QXJyYXkoZiksIGggPSBbXSwgZCA9IDA7IDspIHtcbiAgICAgIHZhciBiID0gYyA8IGEubGVuZ3RoOyBpZiAoIWIgfHwgZCA+PSBmIC0gMSkgeyBoLnB1c2goU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBlLnN1YmFycmF5KDAsIGQpKSk7IGlmICghYikgcmV0dXJuIGguam9pbihcIlwiKTsgYSA9IGEuc3ViYXJyYXkoYyk7IGQgPSBjID0gMCB9IGIgPSBhW2MrK107IGlmICgwID09PSAoYiAmIDEyOCkpIGVbZCsrXSA9IGI7IGVsc2UgaWYgKDE5MiA9PT0gKGIgJiAyMjQpKSB7IHZhciBnID0gYVtjKytdICYgNjM7IGVbZCsrXSA9IChiICYgMzEpIDw8IDYgfCBnIH0gZWxzZSBpZiAoMjI0ID09PSAoYiAmIDI0MCkpIHtcbiAgICAgICAgZyA9IGFbYysrXSAmIDYzOyB2YXIgbiA9IGFbYysrXSAmIDYzOyBlW2QrK10gPVxuICAgICAgICAgIChiICYgMzEpIDw8IDEyIHwgZyA8PCA2IHwgblxuICAgICAgfSBlbHNlIGlmICgyNDAgPT09IChiICYgMjQ4KSkgeyBnID0gYVtjKytdICYgNjM7IG4gPSBhW2MrK10gJiA2MzsgdmFyIHYgPSBhW2MrK10gJiA2MzsgYiA9IChiICYgNykgPDwgMTggfCBnIDw8IDEyIHwgbiA8PCA2IHwgdjsgNjU1MzUgPCBiICYmIChiIC09IDY1NTM2LCBlW2QrK10gPSBiID4+PiAxMCAmIDEwMjMgfCA1NTI5NiwgYiA9IDU2MzIwIHwgYiAmIDEwMjMpOyBlW2QrK10gPSBiIH1cbiAgICB9XG4gIH0gaWYgKGwuVGV4dEVuY29kZXIgJiYgbC5UZXh0RGVjb2RlcikgcmV0dXJuICExOyB2YXIgciA9IFtcInV0Zi04XCIsIFwidXRmOFwiLCBcInVuaWNvZGUtMS0xLXV0Zi04XCJdOyBPYmplY3QuZGVmaW5lUHJvcGVydHkobS5wcm90b3R5cGUsIFwiZW5jb2RpbmdcIiwgeyB2YWx1ZTogXCJ1dGYtOFwiIH0pOyBtLnByb3RvdHlwZS5lbmNvZGUgPSBmdW5jdGlvbiAoYSwgYykge1xuICAgIGMgPSB2b2lkIDAgPT09IGMgPyB7IHN0cmVhbTogITEgfSA6IGM7IGlmIChjLnN0cmVhbSkgdGhyb3cgRXJyb3IoXCJGYWlsZWQgdG8gZW5jb2RlOiB0aGUgJ3N0cmVhbScgb3B0aW9uIGlzIHVuc3VwcG9ydGVkLlwiKTsgYyA9IDA7IGZvciAodmFyIGYgPSBhLmxlbmd0aCwgZSA9IDAsIGggPSBNYXRoLm1heCgzMixcbiAgICAgIGYgKyAoZiA+Pj4gMSkgKyA3KSwgZCA9IG5ldyBVaW50OEFycmF5KGggPj4+IDMgPDwgMyk7IGMgPCBmOykge1xuICAgICAgICB2YXIgYiA9IGEuY2hhckNvZGVBdChjKyspOyBpZiAoNTUyOTYgPD0gYiAmJiA1NjMxOSA+PSBiKSB7IGlmIChjIDwgZikgeyB2YXIgZyA9IGEuY2hhckNvZGVBdChjKTsgNTYzMjAgPT09IChnICYgNjQ1MTIpICYmICgrK2MsIGIgPSAoKGIgJiAxMDIzKSA8PCAxMCkgKyAoZyAmIDEwMjMpICsgNjU1MzYpIH0gaWYgKDU1Mjk2IDw9IGIgJiYgNTYzMTkgPj0gYikgY29udGludWUgfSBlICsgNCA+IGQubGVuZ3RoICYmIChoICs9IDgsIGggKj0gMSArIGMgLyBhLmxlbmd0aCAqIDIsIGggPSBoID4+PiAzIDw8IDMsIGcgPSBuZXcgVWludDhBcnJheShoKSwgZy5zZXQoZCksIGQgPSBnKTsgaWYgKDAgPT09IChiICYgNDI5NDk2NzE2OCkpIGRbZSsrXSA9IGI7IGVsc2Uge1xuICAgICAgICAgIGlmICgwID09PSAoYiAmIDQyOTQ5NjUyNDgpKSBkW2UrK10gPSBiID4+PiA2ICYgMzEgfCAxOTI7IGVsc2UgaWYgKDAgPT09IChiICYgNDI5NDkwMTc2MCkpIGRbZSsrXSA9IGIgPj4+IDEyICYgMTUgfCAyMjQsIGRbZSsrXSA9IGIgPj4+IDYgJiA2MyB8IDEyODsgZWxzZSBpZiAoMCA9PT0gKGIgJiA0MjkyODcwMTQ0KSkgZFtlKytdID0gYiA+Pj4gMTggJiA3IHwgMjQwLCBkW2UrK10gPSBiID4+PiAxMiAmXG4gICAgICAgICAgICA2MyB8IDEyOCwgZFtlKytdID0gYiA+Pj4gNiAmIDYzIHwgMTI4OyBlbHNlIGNvbnRpbnVlOyBkW2UrK10gPSBiICYgNjMgfCAxMjhcbiAgICAgICAgfVxuICAgIH0gcmV0dXJuIGQuc2xpY2UgPyBkLnNsaWNlKDAsIGUpIDogZC5zdWJhcnJheSgwLCBlKVxuICB9OyBPYmplY3QuZGVmaW5lUHJvcGVydHkoay5wcm90b3R5cGUsIFwiZW5jb2RpbmdcIiwgeyB2YWx1ZTogXCJ1dGYtOFwiIH0pOyBPYmplY3QuZGVmaW5lUHJvcGVydHkoay5wcm90b3R5cGUsIFwiZmF0YWxcIiwgeyB2YWx1ZTogITEgfSk7IE9iamVjdC5kZWZpbmVQcm9wZXJ0eShrLnByb3RvdHlwZSwgXCJpZ25vcmVCT01cIiwgeyB2YWx1ZTogITEgfSk7IHZhciBwID0gcTsgXCJmdW5jdGlvblwiID09PSB0eXBlb2YgQnVmZmVyICYmIEJ1ZmZlci5mcm9tID8gcCA9IHQgOiBcImZ1bmN0aW9uXCIgPT09IHR5cGVvZiBCbG9iICYmIFwiZnVuY3Rpb25cIiA9PT0gdHlwZW9mIFVSTCAmJiBcImZ1bmN0aW9uXCIgPT09IHR5cGVvZiBVUkwuY3JlYXRlT2JqZWN0VVJMICYmIChwID0gdSk7IGsucHJvdG90eXBlLmRlY29kZSA9IGZ1bmN0aW9uIChhLCBjKSB7XG4gICAgYyA9IHZvaWQgMCA9PT0gYyA/IHsgc3RyZWFtOiAhMSB9IDogYzsgaWYgKGMuc3RyZWFtKSB0aHJvdyBFcnJvcihcIkZhaWxlZCB0byBkZWNvZGU6IHRoZSAnc3RyZWFtJyBvcHRpb24gaXMgdW5zdXBwb3J0ZWQuXCIpO1xuICAgIGEgPSBhIGluc3RhbmNlb2YgVWludDhBcnJheSA/IGEgOiBhLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyID8gbmV3IFVpbnQ4QXJyYXkoYS5idWZmZXIpIDogbmV3IFVpbnQ4QXJyYXkoYSk7IHJldHVybiBwKGEpXG4gIH07IGwuVGV4dEVuY29kZXIgPSBtOyBsLlRleHREZWNvZGVyID0ga1xufSkoXCJ1bmRlZmluZWRcIiAhPT0gdHlwZW9mIHdpbmRvdyA/IHdpbmRvdyA6IFwidW5kZWZpbmVkXCIgIT09IHR5cGVvZiBnbG9iYWwgPyBnbG9iYWwgOiBnbG9iYWxUaGlzKTtcblxuaW1wb3J0IHsgQllURSB9IGZyb20gJy4vY29uc3QuanMnXG5pbXBvcnQgeyBiaWdpbnQsIGYzMiwgZjY0LCBpbnQsIHVpbnQgfSBmcm9tICcuL2xlYjEyOC5qcydcblxuZXhwb3J0IGZ1bmN0aW9uIHdyYXBfaW5zdHIgKGNvZGUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChhcmdzLCBleHBycykge1xuICAgIHJldHVybiBpbnN0cihcbiAgICAgIGNvZGUsXG4gICAgICAgYXJncyAhPSBudWxsICYmICFBcnJheS5pc0FycmF5KGFyZ3MpICA/IFthcmdzXSAgOiBhcmdzLFxuICAgICAgZXhwcnMgIT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheShleHBycykgPyBbZXhwcnNdIDogZXhwcnMsXG4gICAgKVxuICB9XG59XG5cbmNvbnN0IGVuY29kaW5nID0ge1xuICAnZjY0LmNvbnN0JzogZjY0LFxuICAnZjMyLmNvbnN0JzogZjMyLFxufVxuXG5leHBvcnQgZnVuY3Rpb24qIGluc3RyKGNvZGUsIGFyZ3M9W10sIGV4cHJzPVtdKSB7XG4gIGZvciAobGV0IGV4cHIgb2YgZXhwcnMpIHtcbiAgICBzd2l0Y2ggKHR5cGVvZiBleHByKSB7XG4gICAgICBjYXNlICdudW1iZXInOiB5aWVsZCBleHByOyBicmVha1xuICAgICAgZGVmYXVsdDogeWllbGQqIGV4cHI7IGJyZWFrXG4gICAgfVxuICB9XG4gIHlpZWxkKiBBcnJheS5pc0FycmF5KEJZVEVbY29kZV0pID8gQllURVtjb2RlXSA6IFtCWVRFW2NvZGVdXVxuICBmb3IgKGxldCBhcmcgb2YgYXJncykge1xuICAgIHN3aXRjaCAodHlwZW9mIGFyZykge1xuICAgICAgY2FzZSAnYmlnaW50JzpcbiAgICAgICAgeWllbGQqIGJpZ2ludChhcmcpOyBicmVha1xuICAgICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgICAgeWllbGQqIChlbmNvZGluZ1tjb2RlXT8/aW50KShhcmcpOyBicmVha1xuICAgICAgZGVmYXVsdDogeWllbGQqIGFyZztcbiAgICB9XG4gIH1cbn1cblxuY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigndXRmLTgnKVxuZXhwb3J0IGZ1bmN0aW9uIHV0Zjgocykge1xuICByZXR1cm4gWy4uLmVuY29kZXIuZW5jb2RlKHMpXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaGVhZGVyICgpIHtcbiAgcmV0dXJuIFsuLi51dGY4KCdcXDBhc20nKSwxLDAsMCwwXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2VjdGlvbiAodHlwZSwgZGF0YSkge1xuICByZXR1cm4gW0JZVEUuc2VjdGlvblt0eXBlXSwgLi4udWludChkYXRhLmxlbmd0aCksIC4uLmRhdGFdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2ZWN0b3IgKGl0ZW1zKSB7XG4gIHJldHVybiBbLi4udWludChpdGVtcy5sZW5ndGgpLCAuLi5pdGVtcy5mbGF0KCldXG59XG5cbmZ1bmN0aW9uIGxvY2FscyAoaXRlbXMpIHtcbiAgY29uc3Qgb3V0ID0gW11cbiAgbGV0IGN1cnIgPSBbXVxuICBsZXQgcHJldlxuXG4gIGZvciAoY29uc3QgdHlwZSBvZiBpdGVtcykge1xuICAgIGlmICh0eXBlICE9PSBwcmV2ICYmIGN1cnIubGVuZ3RoKSB7XG4gICAgICBvdXQucHVzaChbLi4udWludChjdXJyLmxlbmd0aCksIEJZVEUudHlwZVtjdXJyWzBdXV0pXG4gICAgICBjdXJyID0gW11cbiAgICB9XG4gICAgY3Vyci5wdXNoKHR5cGUpXG4gICAgcHJldiA9IHR5cGVcbiAgfVxuXG4gIGlmIChjdXJyLmxlbmd0aClcbiAgICBvdXQucHVzaChbLi4udWludChjdXJyLmxlbmd0aCksIEJZVEUudHlwZVtjdXJyWzBdXV0pXG5cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiBsaW1pdHMgKG1pbiwgbWF4LCBzaGFyZWQpIHtcbiAgaWYgKHNoYXJlZCAhPSBudWxsKSB7XG4gICAgcmV0dXJuIFtCWVRFLmxpbWl0cy5zaGFyZWQsIC4uLnVpbnQobWluKSwgLi4udWludChtYXgpXVxuICB9IGVsc2UgaWYgKG1heCAhPSBudWxsKSB7XG4gICAgcmV0dXJuIFtCWVRFLmxpbWl0cy5taW5tYXgsIC4uLnVpbnQobWluKSwgLi4udWludChtYXgpXVxuICB9XG4gIGVsc2Uge1xuICAgIHJldHVybiBbQllURS5saW1pdHMubWluLCAuLi51aW50KG1pbildXG4gIH1cbn1cblxuc2VjdGlvbi50eXBlID0gZnVuY3Rpb24gKHR5cGVzKSB7XG4gIHJldHVybiBzZWN0aW9uKCd0eXBlJyxcbiAgICB2ZWN0b3IodHlwZXMubWFwKChbcGFyYW1zLCByZXN1bHRzXSkgPT4gW1xuICAgICAgQllURS50eXBlLmZ1bmMsXG4gICAgICAuLi52ZWN0b3IoICBwYXJhbXMubWFwKHggPT4gQllURS50eXBlW3hdICkpLFxuICAgICAgLi4udmVjdG9yKCByZXN1bHRzLm1hcCh4ID0+IEJZVEUudHlwZVt4XSApKSxcbiAgICBdKSkpXG59XG5cbnNlY3Rpb24uaW1wb3J0ID0gZnVuY3Rpb24gKGltcG9ydGVkKSB7XG4gIHJldHVybiBzZWN0aW9uKCdpbXBvcnQnLFxuICAgIHZlY3RvcihpbXBvcnRlZC5tYXAoKFttb2QsIGZpZWxkLCB0eXBlLCBkZXNjXSkgPT4gW1xuICAgICAgLi4udmVjdG9yKHV0ZjgobW9kKSksXG4gICAgICAuLi52ZWN0b3IodXRmOChmaWVsZCkpLFxuICAgICAgQllURS5pbXBvcnRbdHlwZV0sXG4gICAgICAuLi4oe1xuICAgICAgICAnZnVuYyc6ICgpID0+IGRlc2MubWFwKGlkeCA9PiBbLi4udWludChpZHgpXSksXG4gICAgICAgICdtZW1vcnknOiAoKSA9PiBsaW1pdHMoLi4uZGVzYyksXG4gICAgICAgfVt0eXBlXSgpKVxuICAgIF0pKSlcbn1cblxuc2VjdGlvbi5mdW5jdGlvbiA9IGZ1bmN0aW9uIChmdW5jcykge1xuICByZXR1cm4gc2VjdGlvbignZnVuY3Rpb24nLFxuICAgIHZlY3RvcihmdW5jcy5tYXAoZnVuYyA9PlxuICAgICAgWy4uLnVpbnQoZnVuYyldXG4gICAgKSkpXG59XG5cbnNlY3Rpb24udGFibGUgPSBmdW5jdGlvbiAodGFibGVzKSB7XG4gIHJldHVybiBzZWN0aW9uKCd0YWJsZScsXG4gICAgdmVjdG9yKHRhYmxlcy5tYXAoKFt0eXBlLCBtaW4sIG1heF0pID0+XG4gICAgICBbQllURS50eXBlW3R5cGVdLCAuLi5saW1pdHMobWluLCBtYXgpXVxuICAgICkpKVxufVxuXG5zZWN0aW9uLm1lbW9yeSA9IGZ1bmN0aW9uIChtZW1vcmllcykge1xuICByZXR1cm4gc2VjdGlvbignbWVtb3J5JyxcbiAgICB2ZWN0b3IobWVtb3JpZXMubWFwKChbbWluLCBtYXhdKSA9PlxuICAgICAgbGltaXRzKG1pbiwgbWF4KVxuICAgICkpKVxufVxuXG5zZWN0aW9uLmdsb2JhbCA9IGZ1bmN0aW9uIChnbG9iYWxzKSB7XG4gIHJldHVybiBzZWN0aW9uKCdnbG9iYWwnLFxuICAgIHZlY3RvcihnbG9iYWxzLm1hcCgoW211dCwgdmFsdHlwZSwgZXhwcl0pID0+XG4gICAgICBbQllURS50eXBlW3ZhbHR5cGVdLCBCWVRFLmdsb2JhbFttdXRdLCAuLi5leHByLCBCWVRFLmVuZF1cbiAgICApKSlcbn1cblxuc2VjdGlvbi5leHBvcnQgPSBmdW5jdGlvbiAoZXhwb3J0cykge1xuICByZXR1cm4gc2VjdGlvbignZXhwb3J0JyxcbiAgICB2ZWN0b3IoZXhwb3J0cy5tYXAoKFtuYW1lLCB0eXBlLCBpZHhdKSA9PlxuICAgICAgWy4uLnZlY3Rvcih1dGY4KG5hbWUpKSwgQllURS5leHBvcnRbdHlwZV0sIC4uLnVpbnQoaWR4KV1cbiAgICApKSlcbn1cblxuc2VjdGlvbi5zdGFydCA9IGZ1bmN0aW9uIChmdW5jX2lkeCkge1xuICByZXR1cm4gc2VjdGlvbignc3RhcnQnLCBbLi4udWludChmdW5jX2lkeCldKVxufVxuXG5zZWN0aW9uLmVsZW1lbnQgPSBmdW5jdGlvbiAoZWxlbWVudHMpIHtcbiAgcmV0dXJuIHNlY3Rpb24oJ2VsZW1lbnQnLFxuICAgIHZlY3RvcihlbGVtZW50cy5tYXAoKFt0YWJsZV9pZHgsIG9mZnNldF9pZHhfZXhwciwgZnVuY3NdKSA9PlxuICAgICAgWy4uLnVpbnQodGFibGVfaWR4KSwgLi4ub2Zmc2V0X2lkeF9leHByLCBCWVRFLmVuZCwgLi4udmVjdG9yKGZ1bmNzKV1cbiAgICApKSlcbn1cblxuc2VjdGlvbi5jb2RlID0gZnVuY3Rpb24gKGZ1bmNzKSB7XG4gIHJldHVybiBzZWN0aW9uKCdjb2RlJyxcbiAgICB2ZWN0b3IoZnVuY3MubWFwKChbZnVuY19sb2NhbHMsIGZ1bmNfYm9keV0pID0+XG4gICAgICB2ZWN0b3IoWy4uLnZlY3Rvcihsb2NhbHMoZnVuY19sb2NhbHMpKSwgLi4uZnVuY19ib2R5LCBCWVRFLmVuZF0pXG4gICAgKSkpXG59XG5cbnNlY3Rpb24uZGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gIHJldHVybiBzZWN0aW9uKCdkYXRhJyxcbiAgICB2ZWN0b3IoZGF0YS5tYXAoKFttZW1faWR4LCBvZmZzZXRfaWR4X2V4cHIsIGJ5dGVzXSkgPT5cbiAgICAgIFsuLi51aW50KG1lbV9pZHgpLCAuLi5vZmZzZXRfaWR4X2V4cHIsIEJZVEUuZW5kLCAuLi52ZWN0b3IoYnl0ZXMpXVxuICAgICkpKVxufVxuIiwgImltcG9ydCB7IGhlYWRlciwgc2VjdGlvbiB9IGZyb20gJy4vYmluYXJ5LmpzJ1xuXG5jbGFzcyBCeXRlQXJyYXkgZXh0ZW5kcyBBcnJheSB7XG4gIGxvZyA9IFtdXG5cbiAgd3JpdGUgKGFycmF5LCBhbm5vdGF0aW9uKSB7XG4gICAgdGhpcy5sb2cucHVzaChhcnJheSwgYW5ub3RhdGlvbilcbiAgICB0aGlzLnB1c2goLi4uYXJyYXkpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIGdldCBidWZmZXIgKCkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSh0aGlzKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE1vZHVsZUJ1aWxkZXIge1xuICB0eXBlcyA9IFtdXG4gIGltcG9ydHMgPSBbXVxuICB0YWJsZXMgPSBbXVxuICBtZW1vcmllcyA9IFtdXG4gIGdsb2JhbHMgPSBbXVxuICBleHBvcnRzID0gW11cbiAgc3RhcnRzID0gJydcbiAgZWxlbWVudHMgPSBbXVxuICBjb2RlcyA9IFtdXG4gIGRhdGFzID0gW11cblxuICBjb25zdHJ1Y3RvcihkYXRhKSB7XG4gICAgaWYgKGRhdGEpIE9iamVjdC5hc3NpZ24odGhpcywgZGF0YSlcbiAgfVxuXG4gIGdldCBmdW5jcyAoKSB7IHJldHVybiB0aGlzLmNvZGVzLmZpbHRlcihmdW5jID0+ICFmdW5jLmltcG9ydGVkKSB9XG5cbiAgZW5zdXJlVHlwZSAocGFyYW1zLCByZXN1bHRzKSB7XG4gICAgY29uc3QgdHlwZV9zaWcgPSBbcGFyYW1zLmpvaW4oJyAnKSwgcmVzdWx0cy5qb2luKCcgJyldLmpvaW4oKVxuICAgIGNvbnN0IGlkeCA9IHRoaXMudHlwZXMuaW5kZXhPZih0eXBlX3NpZylcbiAgICBpZiAoaWR4ID49IDApIHJldHVybiBpZHhcbiAgICByZXR1cm4gdGhpcy50eXBlcy5wdXNoKHR5cGVfc2lnKSAtIDFcbiAgfVxuXG4gIGdldEdsb2JhbEluZGV4T2YgKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nbG9iYWxzLmZpbmQoZ2xvYiA9PiBnbG9iLm5hbWUgPT09IG5hbWUpLmlkeFxuICB9XG5cbiAgZ2V0RnVuYyAobmFtZSkge1xuICAgIHJldHVybiB0aGlzLmNvZGVzLmZpbmQoZnVuYyA9PiBmdW5jLm5hbWUgPT09IG5hbWUpXG4gIH1cblxuICBnZXRNZW1vcnkgKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5tZW1vcmllcy5maW5kKG1lbSA9PiBtZW0ubmFtZSA9PT0gbmFtZSlcbiAgfVxuXG4gIGdldFR5cGUgKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy50eXBlc1tuYW1lXVxuICB9XG5cbiAgdHlwZSAobmFtZSwgcGFyYW1zLCByZXN1bHRzKSB7XG4gICAgdGhpcy50eXBlc1tuYW1lXSA9IHRoaXMuZW5zdXJlVHlwZShwYXJhbXMsIHJlc3VsdHMpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIGltcG9ydCAodHlwZSwgbmFtZSwgbW9kLCBmaWVsZCwgcGFyYW1zLCByZXN1bHRzKSB7XG4gICAgaWYgKHR5cGUgPT09ICdmdW5jJykge1xuICAgICAgY29uc3QgZnVuYyA9IHRoaXMuX2Z1bmMobmFtZSwgcGFyYW1zLCByZXN1bHRzLCBbXSwgW10sIGZhbHNlLCB0cnVlKVxuICAgICAgdGhpcy5pbXBvcnRzLnB1c2goeyBtb2QsIGZpZWxkLCB0eXBlLCBkZXNjOiBbZnVuYy50eXBlX2lkeF0gfSlcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdtZW1vcnknKSB7XG4gICAgICB0aGlzLmltcG9ydHMucHVzaCh7IG1vZCwgZmllbGQsIHR5cGUsIGRlc2M6IHBhcmFtcyB9KVxuICAgIH1cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgdGFibGUgKHR5cGUsIG1pbiwgbWF4KSB7XG4gICAgdGhpcy50YWJsZXMucHVzaCh7IHR5cGUsIG1pbiwgbWF4IH0pXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIG1lbW9yeSAobmFtZSwgbWluLCBtYXgpIHtcbiAgICB0aGlzLm1lbW9yaWVzLnB1c2goeyBuYW1lLCBtaW4sIG1heCB9KVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBnbG9iYWwgKG5hbWUsIG11dCwgdmFsdHlwZSwgZXhwcikge1xuICAgIGNvbnN0IGdsb2JhbF9pZHggPSB0aGlzLmdsb2JhbHMubGVuZ3RoXG4gICAgdGhpcy5nbG9iYWxzLnB1c2goeyBpZHg6IGdsb2JhbF9pZHgsIG5hbWUsIHZhbHR5cGUsIG11dCwgZXhwciB9KVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBleHBvcnQgKHR5cGUsIG5hbWUsIGV4cG9ydF9uYW1lKSB7XG4gICAgdGhpcy5leHBvcnRzLnB1c2goeyB0eXBlLCBuYW1lLCBleHBvcnRfbmFtZSB9KVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBzdGFydCAobmFtZSkge1xuICAgIHRoaXMuc3RhcnRzID0gbmFtZVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBlbGVtIChvZmZzZXRfaWR4X2V4cHIsIGNvZGVzKSB7XG4gICAgdGhpcy5lbGVtZW50cy5wdXNoKHsgb2Zmc2V0X2lkeF9leHByLCBjb2RlcyB9KVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBfZnVuYyAobmFtZSwgcGFyYW1zPVtdLCByZXN1bHRzPVtdLCBsb2NhbHM9W10sIGJvZHk9W10sIGV4cG9ydGVkID0gZmFsc2UsIGltcG9ydGVkID0gZmFsc2UpIHtcbiAgICBjb25zdCB0eXBlX2lkeCA9IHRoaXMuZW5zdXJlVHlwZShwYXJhbXMsIHJlc3VsdHMpXG4gICAgY29uc3QgZnVuY19pZHggPSB0aGlzLmNvZGVzLmxlbmd0aFxuICAgIGNvbnN0IGZ1bmMgPSB7IGlkeDogZnVuY19pZHgsIG5hbWUsIHR5cGVfaWR4LCBsb2NhbHMsIGJvZHksIGltcG9ydGVkIH1cbiAgICB0aGlzLmNvZGVzLnB1c2goZnVuYylcbiAgICBpZiAoZXhwb3J0ZWQpIHtcbiAgICAgIHRoaXMuZXhwb3J0KCdmdW5jJywgbmFtZSwgbmFtZSlcbiAgICB9XG4gICAgcmV0dXJuIGZ1bmNcbiAgfVxuXG4gIGZ1bmMgKC4uLmFyZ3MpIHtcbiAgICB0aGlzLl9mdW5jKC4uLmFyZ3MpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIGRhdGEgKG9mZnNldF9pZHhfZXhwciwgYnl0ZXMpIHtcbiAgICB0aGlzLmRhdGFzLnB1c2goeyBvZmZzZXRfaWR4X2V4cHIsIGJ5dGVzIH0pXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIGJ1aWxkICh7IG1ldHJpY3MgPSB0cnVlIH0gPSB7fSkge1xuICAgIC8vIXRpbWUgJ21vZHVsZSBidWlsZCdcblxuICAgIGNvbnN0IGJ5dGVzID0gbmV3IEJ5dGVBcnJheSgpXG5cbiAgICAvLyAtLS0tLS0tLS0tLS1cbiAgICAvL1xuICAgIC8vIGhlYWRlclxuXG4gICAgYnl0ZXMud3JpdGUoaGVhZGVyKCkpXG5cbiAgICAvLyB0eXBlXG5cbiAgICBpZiAodGhpcy50eXBlcy5sZW5ndGgpIHsgYnl0ZXMud3JpdGUoc2VjdGlvbi50eXBlKFxuICAgICAgdGhpcy50eXBlcy5tYXAodHlwZSA9PlxuICAgICAgICB0eXBlLnNwbGl0KCcsJykubWFwKHggPT4geC5zcGxpdCgnICcpLmZpbHRlcihCb29sZWFuKSlcbiAgICAgICkpKSB9XG5cbiAgICAvLyBpbXBvcnRcblxuICAgIGlmICh0aGlzLmltcG9ydHMubGVuZ3RoKSB7IGJ5dGVzLndyaXRlKHNlY3Rpb24uaW1wb3J0KFxuICAgICAgdGhpcy5pbXBvcnRzLm1hcChpbXAgPT5cbiAgICAgICAgWyBpbXAubW9kLCBpbXAuZmllbGQsIGltcC50eXBlLCBpbXAuZGVzYyBdXG4gICAgICApKSkgfVxuXG4gICAgLy8gZnVuY3Rpb25cblxuICAgIGlmICh0aGlzLmZ1bmNzLmxlbmd0aCkgeyBieXRlcy53cml0ZShzZWN0aW9uLmZ1bmN0aW9uKFxuICAgICAgdGhpcy5mdW5jcy5tYXAoZnVuYyA9PlxuICAgICAgICBmdW5jLnR5cGVfaWR4XG4gICAgICApKSkgfVxuXG4gICAgLy8gdGFibGVcblxuICAgIGlmICh0aGlzLmVsZW1lbnRzLmxlbmd0aCkgeyBieXRlcy53cml0ZShzZWN0aW9uLnRhYmxlKFxuICAgICAgdGhpcy50YWJsZXMubWFwKHRhYmxlID0+XG4gICAgICAgIFsgdGFibGUudHlwZSwgdGFibGUubWluLCB0YWJsZS5tYXggXVxuICAgICAgKSkpIH1cblxuICAgIC8vIG1lbW9yeVxuXG4gICAgaWYgKHRoaXMubWVtb3JpZXMubGVuZ3RoKSB7IGJ5dGVzLndyaXRlKHNlY3Rpb24ubWVtb3J5KFxuICAgICAgdGhpcy5tZW1vcmllcy5tYXAobWVtID0+XG4gICAgICAgIFsgbWVtLm1pbiwgbWVtLm1heCBdXG4gICAgICApKSkgfVxuXG4gICAgLy8gZ2xvYmFsXG5cbiAgICBpZiAodGhpcy5nbG9iYWxzLmxlbmd0aCkgeyBieXRlcy53cml0ZShzZWN0aW9uLmdsb2JhbChcbiAgICAgIHRoaXMuZ2xvYmFscy5tYXAoZ2xvYiA9PlxuICAgICAgICBbIGdsb2IubXV0LCBnbG9iLnZhbHR5cGUsIGdsb2IuZXhwciBdXG4gICAgICApKSkgfVxuXG4gICAgLy8gZXhwb3J0XG5cbiAgICBpZiAodGhpcy5leHBvcnRzLmxlbmd0aCkgeyBieXRlcy53cml0ZShzZWN0aW9uLmV4cG9ydChcbiAgICAgIHRoaXMuZXhwb3J0cy5tYXAoZXhwID0+XG4gICAgICAgIGV4cC50eXBlID09PSAnZnVuYycgP1xuICAgICAgICBbIGV4cC5leHBvcnRfbmFtZSwgZXhwLnR5cGUsIHRoaXMuZ2V0RnVuYyhleHAubmFtZSkuaWR4IF0gOlxuICAgICAgICBleHAudHlwZSA9PT0gJ21lbW9yeScgP1xuICAgICAgICBbIGV4cC5leHBvcnRfbmFtZSwgZXhwLnR5cGUsIHRoaXMuZ2V0TWVtb3J5KGV4cC5uYW1lKS5pZHggXSA6XG4gICAgICAgIGV4cC50eXBlID09PSAnZ2xvYmFsJyA/XG4gICAgICAgIFsgZXhwLmV4cG9ydF9uYW1lLCBleHAudHlwZSwgdGhpcy5nZXRHbG9iYWxJbmRleE9mKGV4cC5uYW1lKSBdIDpcbiAgICAgICAgW10gLy8gVE9ETzogZXhjZXB0aW9uXG4gICAgICApKSkgfVxuXG4gICAgLy8gc3RhcnRcblxuICAgIGlmICh0aGlzLnN0YXJ0cy5sZW5ndGgpIHsgYnl0ZXMud3JpdGUoc2VjdGlvbi5zdGFydChcbiAgICAgIHRoaXMuZ2V0RnVuYyh0aGlzLnN0YXJ0cykuaWR4XG4gICAgICApKSB9XG5cbiAgICAvLyBlbGVtZW50XG5cbiAgICBpZiAodGhpcy5lbGVtZW50cy5sZW5ndGgpIHsgYnl0ZXMud3JpdGUoc2VjdGlvbi5lbGVtZW50KFxuICAgICAgdGhpcy5lbGVtZW50cy5tYXAoZWxlbSA9PiBbXG4gICAgICAgIDAsIC8vIHRhYmxlX2lkeCBpcyBhbHdheXMgMCAob25lIHRhYmxlIHBlciBtb2R1bGUgaXMgYWxsb3dlZCBjdXJyZW50bHkpXG4gICAgICAgIGVsZW0ub2Zmc2V0X2lkeF9leHByLFxuICAgICAgICBlbGVtLmNvZGVzLm1hcChuYW1lID0+IHRoaXMuZ2V0RnVuYyhuYW1lKS5pZHgpXG4gICAgICBdKSkpIH1cblxuICAgIC8vIGNvZGVcblxuICAgIGlmICh0aGlzLmZ1bmNzLmxlbmd0aCkgeyBieXRlcy53cml0ZShzZWN0aW9uLmNvZGUoXG4gICAgICB0aGlzLmZ1bmNzLm1hcChmdW5jID0+XG4gICAgICAgIFsgZnVuYy5sb2NhbHMsIGZ1bmMuYm9keSBdXG4gICAgICApKSkgfVxuXG4gICAgLy8gZGF0YVxuXG4gICAgaWYgKHRoaXMuZGF0YXMubGVuZ3RoKSB7IGJ5dGVzLndyaXRlKHNlY3Rpb24uZGF0YShcbiAgICAgIHRoaXMuZGF0YXMubWFwKGRhdGEgPT4gW1xuICAgICAgICAwLCAvLyBtZW1vcnkgaWR4IGlzIGFsd2F5cyAwICg/KVxuICAgICAgICBkYXRhLm9mZnNldF9pZHhfZXhwcixcbiAgICAgICAgZGF0YS5ieXRlcyAvLyB2ZXJiYXRpbSBkYXRhXG4gICAgICBdKSkpIH1cblxuICAgIC8vIGVuZFxuICAgIC8vXG4gICAgLy8gLS0tLS0tLS0tLS0tXG5cbiAgICAvLyF0aW1lRW5kICdtb2R1bGUgYnVpbGQnXG5cbiAgICByZXR1cm4gYnl0ZXNcbiAgfVxufVxuIiwgImltcG9ydCBNb2R1bGVCdWlsZGVyIGZyb20gJy4vYnVpbGRlci5qcydcbmltcG9ydCB7IEFMSUdOLCBJTlNUUiB9IGZyb20gJy4vY29uc3QuanMnXG5pbXBvcnQgeyBiaWdpbnQsIGhleDJmbG9hdCwgbmFuYm94MzIsIG5hbmJveDY0LCB1aW50IH0gZnJvbSAnLi9sZWIxMjguanMnXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnVzZWQtdmFyc1xuY29uc3QgcHJpbnQgPSB4ID0+IGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHgsIG51bGwsIDIpKVxuXG5leHBvcnQgY2xhc3MgR2xvYmFsQ29udGV4dCB7XG4gIGdsb2JhbHMgPSBbXVxuICB0eXBlcyA9IFtdXG4gIGZ1bmNzID0gW11cblxuICBjb25zdHJ1Y3RvcihkYXRhKSB7XG4gICAgaWYgKGRhdGEpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgZGF0YSlcbiAgICAgIHRoaXMuZnVuY3MuZm9yRWFjaChmdW5jdGlvbiBjcmVhdGVGdW5jdGlvbkNvbnRleHQoeCkge1xuICAgICAgICB4LmNvbnRleHQgPSBuZXcgRnVuY3Rpb25Db250ZXh0KHRoaXMsIHguY29udGV4dClcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgbG9va3VwKG5hbWUsIGluc3RyKSB7XG4gICAgbGV0IGluZGV4XG5cbiAgICBzd2l0Y2ggKGluc3RyKSB7XG4gICAgICBjYXNlICdjYWxsJzoge1xuICAgICAgICBpbmRleCA9IHRoaXMuZnVuY3MubWFwKHggPT4geC5uYW1lKS5sYXN0SW5kZXhPZihuYW1lKVxuICAgICAgfVxuICAgICAgICBicmVha1xuXG4gICAgICBjYXNlICd0eXBlJzoge1xuICAgICAgICBpbmRleCA9IHRoaXMudHlwZXMubWFwKHggPT4geC5uYW1lKS5sYXN0SW5kZXhPZihuYW1lKVxuICAgICAgfVxuICAgICAgICBicmVha1xuXG4gICAgICBkZWZhdWx0OiB7XG4gICAgICAgIGluZGV4ID0gdGhpcy5nbG9iYWxzLm1hcCh4ID0+IHgubmFtZSkubGFzdEluZGV4T2YobmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIX5pbmRleCkgdGhyb3cgbmV3IFJlZmVyZW5jZUVycm9yKGBsb29rdXAgZmFpbGVkIGF0OiAke2luc3RyfSBcIiR7bmFtZX1cImApXG5cbiAgICByZXR1cm4gdWludChpbmRleClcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgRnVuY3Rpb25Db250ZXh0IHtcbiAgI2dsb2JhbCA9IG51bGxcbiAgbG9jYWxzID0gW11cbiAgZGVwdGggPSBbXVxuXG4gIGNvbnN0cnVjdG9yKGdsb2JhbCwgZGF0YSkge1xuICAgIHRoaXMuI2dsb2JhbCA9IGdsb2JhbFxuICAgIGlmIChkYXRhKSBPYmplY3QuYXNzaWduKHRoaXMsIGRhdGEpXG4gIH1cblxuICBsb29rdXAobmFtZSwgaW5zdHIpIHtcbiAgICBsZXQgaW5kZXhcblxuICAgIHN3aXRjaCAoaW5zdHIpIHtcbiAgICAgIGNhc2UgJ2JyJzpcbiAgICAgIGNhc2UgJ2JyX3RhYmxlJzpcbiAgICAgIGNhc2UgJ2JyX2lmJzoge1xuICAgICAgICBpbmRleCA9IHRoaXMuZGVwdGgubGFzdEluZGV4T2YobmFtZSlcbiAgICAgICAgaWYgKH5pbmRleCkgaW5kZXggPSB0aGlzLmRlcHRoLmxlbmd0aCAtIDEgLSBpbmRleFxuICAgICAgfVxuICAgICAgICBicmVha1xuXG4gICAgICBkZWZhdWx0OiB7XG4gICAgICAgIGluZGV4ID0gdGhpcy5sb2NhbHMubGFzdEluZGV4T2YobmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIX5pbmRleCkgcmV0dXJuIHRoaXMuI2dsb2JhbC5sb29rdXAobmFtZSwgaW5zdHIpXG5cbiAgICByZXR1cm4gdWludChpbmRleClcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBjb21waWxlKG5vZGUsIG1vZHVsZURhdGEsIGdsb2JhbERhdGEpIHtcbiAgY29uc3QgbSA9IG5ldyBNb2R1bGVCdWlsZGVyKG1vZHVsZURhdGEpXG4gIGNvbnN0IGcgPSBuZXcgR2xvYmFsQ29udGV4dChnbG9iYWxEYXRhKVxuICBjb25zdCBkZWZlcnJlZCA9IFtdXG5cbiAgZnVuY3Rpb24gY2FzdChwYXJhbSwgY29udGV4dCA9IGcsIGluc3RyID0gJ2kzMicpIHtcbiAgICBzd2l0Y2ggKHBhcmFtLmtpbmQpIHtcbiAgICAgIGNhc2UgJ251bWJlcic6IHtcbiAgICAgICAgaWYgKHBhcmFtLnZhbHVlID09PSAnaW5mJyB8fCBwYXJhbS52YWx1ZSA9PT0gJytpbmYnKSB7XG4gICAgICAgICAgcmV0dXJuIEluZmluaXR5XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocGFyYW0udmFsdWUgPT09ICctaW5mJykge1xuICAgICAgICAgIHJldHVybiAtSW5maW5pdHlcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChwYXJhbS52YWx1ZSA9PT0gJ25hbicgfHwgcGFyYW0udmFsdWUgPT09ICcrbmFuJykge1xuICAgICAgICAgIHJldHVybiBOYU5cbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChwYXJhbS52YWx1ZSA9PT0gJy1uYW4nKSB7XG4gICAgICAgICAgcmV0dXJuIC1OYU5cbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpbnN0cj8uWzBdID09PSAnZicpIHtcbiAgICAgICAgICByZXR1cm4gcGFyc2VGbG9hdChwYXJhbS52YWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY2FzZSAnaGV4Jzoge1xuICAgICAgICBsZXQgdmFsdWVcbiAgICAgICAgaWYgKGluc3RyLmluZGV4T2YoJ2k2NCcpID09PSAwKSB7XG4gICAgICAgICAgaWYgKHBhcmFtLnZhbHVlWzBdID09PSAnLScpIHtcbiAgICAgICAgICAgIHZhbHVlID0gLUJpZ0ludChwYXJhbS52YWx1ZS5zbGljZSgxKSlcbiAgICAgICAgICB9XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZSA9IEJpZ0ludChwYXJhbS52YWx1ZSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoaW5zdHJbMF0gPT09ICdmJykge1xuICAgICAgICAgIGlmIChwYXJhbS52YWx1ZS5pbmRleE9mKCduYW4nKSA+PSAwKSB7XG4gICAgICAgICAgICBpZiAoaW5zdHIuaW5kZXhPZignZjMyJykgPT09IDApIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSBuYW5ib3gzMihwYXJhbS52YWx1ZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgeyAvLyBmNjRcbiAgICAgICAgICAgICAgdmFsdWUgPSBuYW5ib3g2NChwYXJhbS52YWx1ZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZSA9IGhleDJmbG9hdChwYXJhbS52YWx1ZSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHBhcnNlSW50KHBhcmFtLnZhbHVlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjYXNlICdsYWJlbCc6IHJldHVybiBjb250ZXh0Lmxvb2t1cChwYXJhbS52YWx1ZSwgaW5zdHIpXG4gICAgICBkZWZhdWx0OiByZXR1cm4gcGFyYW0udmFsdWVcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBieXRlcyhpbnN0ciwgYXJncywgZXhwcikge1xuICAgIGlmICghKGluc3RyIGluIElOU1RSKSB8fCAodHlwZW9mIElOU1RSW2luc3RyXSAhPT0gJ2Z1bmN0aW9uJykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBpbnN0cnVjdGlvbjogJyArIGluc3RyKVxuICAgIH1cbiAgICByZXR1cm4gWy4uLklOU1RSW2luc3RyXShhcmdzLCBleHByKV1cbiAgfVxuXG4gIGZ1bmN0aW9uIGV2YWx1YXRlKG5vZGUsIGNvbnRleHQgPSBnKSB7XG4gICAgY29uc3QgYWRkcmVzcyA9IHsgb2Zmc2V0OiAwLCBhbGlnbjogMCB9XG4gICAgY29uc3QgaW5zdHIgPSBub2RlLmluc3RyLnZhbHVlXG4gICAgc3dpdGNoIChpbnN0cikge1xuICAgICAgY2FzZSAndHlwZSc6IHtcbiAgICAgICAgcmV0dXJuIG0uZ2V0VHlwZShub2RlLm5hbWUudmFsdWUpXG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ2NhbGxfaW5kaXJlY3QnOiB7XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBbZXZhbHVhdGUobm9kZS5jaGlsZHJlbi5zaGlmdCgpLCBjb250ZXh0KSwgMF0gLy8gMCBpcyBpbXBsaWNpdCB0YWJsZSBpbmRleCAwXG4gICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuLmZsYXRNYXAoZnVuY3Rpb24gZXZhbHVhdGVFeHByKHgpIHsgcmV0dXJuIGV2YWx1YXRlKHgsIGNvbnRleHQpIH0pXG4gICAgICAgIHJldHVybiBieXRlcyhpbnN0ciwgYXJncywgZXhwcilcbiAgICAgIH1cblxuICAgICAgY2FzZSAnbWVtb3J5Lmdyb3cnOiB7XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBbMF0gLy8gVE9ETzogdGhpcyBiaXQgaXMgcmVzZXJ2ZWQ/XG4gICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuLmZsYXRNYXAoZnVuY3Rpb24gZXZhbHVhdGVNZW1vcnkoeCkgeyByZXR1cm4gZXZhbHVhdGUoeCwgY29udGV4dCkgfSlcbiAgICAgICAgcmV0dXJuIGJ5dGVzKGluc3RyLCBhcmdzLCBleHByKVxuICAgICAgfVxuXG4gICAgICBjYXNlICdpMzIubG9hZCc6XG4gICAgICBjYXNlICdpNjQubG9hZCc6XG4gICAgICBjYXNlICdmMzIubG9hZCc6XG4gICAgICBjYXNlICdmNjQubG9hZCc6XG5cbiAgICAgIGNhc2UgJ2kzMi5sb2FkOF9zJzpcbiAgICAgIGNhc2UgJ2kzMi5sb2FkOF91JzpcbiAgICAgIGNhc2UgJ2kzMi5sb2FkMTZfcyc6XG4gICAgICBjYXNlICdpMzIubG9hZDE2X3UnOlxuXG4gICAgICBjYXNlICdpNjQubG9hZDhfcyc6XG4gICAgICBjYXNlICdpNjQubG9hZDhfdSc6XG4gICAgICBjYXNlICdpNjQubG9hZDE2X3MnOlxuICAgICAgY2FzZSAnaTY0LmxvYWQxNl91JzpcbiAgICAgIGNhc2UgJ2k2NC5sb2FkMzJfcyc6XG4gICAgICBjYXNlICdpNjQubG9hZDMyX3UnOlxuXG4gICAgICBjYXNlICdpMzIuc3RvcmUnOlxuICAgICAgY2FzZSAnaTY0LnN0b3JlJzpcbiAgICAgIGNhc2UgJ2YzMi5zdG9yZSc6XG4gICAgICBjYXNlICdmNjQuc3RvcmUnOlxuXG4gICAgICBjYXNlICdpMzIuc3RvcmU4JzpcbiAgICAgIGNhc2UgJ2kzMi5zdG9yZTE2JzpcbiAgICAgIGNhc2UgJ2k2NC5zdG9yZTgnOlxuICAgICAgY2FzZSAnaTY0LnN0b3JlMTYnOlxuICAgICAgY2FzZSAnaTY0LnN0b3JlMzInOlxuXG4gICAgICAgIHtcbiAgICAgICAgICBhZGRyZXNzLmFsaWduID0gQUxJR05baW5zdHJdXG4gICAgICAgICAgZm9yIChjb25zdCBwIG9mIG5vZGUucGFyYW1zKSB7XG4gICAgICAgICAgICBhZGRyZXNzW3AucGFyYW0udmFsdWVdID0gY2FzdChwLnZhbHVlKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBhcmdzID0gW01hdGgubG9nMihhZGRyZXNzLmFsaWduKSwgYWRkcmVzcy5vZmZzZXRdLm1hcCh4ID0+IHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgeCA9PT0gJ251bWJlcicpIHJldHVybiB1aW50KHgpXG4gICAgICAgICAgICBlbHNlIGlmICh0eXBlb2YgeCA9PT0gJ2JpZ2ludCcpIHJldHVybiBiaWdpbnQoeClcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuLmZsYXRNYXAoZnVuY3Rpb24gZXZhbHVhdGVMb2FkU3RvcmVFeHByKHgpIHsgcmV0dXJuIGV2YWx1YXRlKHgsIGNvbnRleHQpIH0pXG4gICAgICAgICAgcmV0dXJuIGJ5dGVzKGluc3RyLCBhcmdzLCBleHByKVxuICAgICAgICB9XG5cbiAgICAgIGNhc2UgJ2Z1bmMnOiB7XG4gICAgICAgIGNvbnN0IGZ1bmMgPSB7XG4gICAgICAgICAgbmFtZTogbm9kZS5uYW1lPy52YWx1ZSA/PyBnLmZ1bmNzLmxlbmd0aCxcbiAgICAgICAgICBwYXJhbXM6IFtdLFxuICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICB9XG5cbiAgICAgICAgZy5mdW5jcy5wdXNoKGZ1bmMpXG5cbiAgICAgICAgZm9yIChjb25zdCBjIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgICAgICBzd2l0Y2ggKGMuaW5zdHIudmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgJ3BhcmFtJzoge1xuICAgICAgICAgICAgICBmdW5jLnBhcmFtcy5wdXNoKC4uLmMuY2hpbGRyZW4ubWFwKHggPT4geC5pbnN0ci52YWx1ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrXG5cbiAgICAgICAgICAgIGNhc2UgJ3Jlc3VsdCc6IHtcbiAgICAgICAgICAgICAgZnVuYy5yZXN1bHRzLnB1c2goLi4uYy5jaGlsZHJlbi5tYXAoeCA9PiB4Lmluc3RyLnZhbHVlKSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAndHlwZSc6XG4gICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFtmdW5jLm5hbWUsIGZ1bmMucGFyYW1zLCBmdW5jLnJlc3VsdHNdXG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ3Jlc3VsdCc6IHtcbiAgICAgICAgcmV0dXJuIG5vZGUuY2hpbGRyZW4uZmxhdE1hcChmdW5jdGlvbiBldmFsdWF0ZVJlc3VsdCh4KSB7IHJldHVybiBJTlNUUi50eXBlW3guaW5zdHIudmFsdWVdKCkgfSlcbiAgICAgIH1cblxuICAgICAgY2FzZSAnZWxzZSc6XG4gICAgICBjYXNlICd0aGVuJzoge1xuICAgICAgICByZXR1cm4gbm9kZS5jaGlsZHJlbi5mbGF0TWFwKGZ1bmN0aW9uIGV2YWx1YXRlRWxzZVRoZW4oeCkgeyByZXR1cm4gZXZhbHVhdGUoeCwgY29udGV4dCkgfSlcbiAgICAgIH1cblxuICAgICAgY2FzZSAnaWYnOiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWU/LnZhbHVlID8/IGNvbnRleHQuZGVwdGgubGVuZ3RoXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBbXVxuICAgICAgICBjb25zdCBicmFuY2hlcyA9IFtdXG4gICAgICAgIGxldCBjb25kLCB0aGVuYm9keVxuXG4gICAgICAgIGNvbnRleHQuZGVwdGgucHVzaChuYW1lKVxuXG4gICAgICAgIGZvciAoY29uc3QgYyBvZiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICAgICAgc3dpdGNoIChjLmluc3RyLnZhbHVlKSB7XG4gICAgICAgICAgICBjYXNlICdyZXN1bHQnOiB7XG4gICAgICAgICAgICAgIHJlc3VsdHMucHVzaChldmFsdWF0ZShjLCBjb250ZXh0KSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWtcblxuICAgICAgICAgICAgY2FzZSAnZWxzZSc6XG4gICAgICAgICAgICAgIGJyYW5jaGVzLnB1c2goLi4uSU5TVFIuZWxzZSgpKVxuICAgICAgICAgICAgY2FzZSAndGhlbic6IHtcbiAgICAgICAgICAgICAgdGhlbmJvZHkgPSBldmFsdWF0ZShjLCBjb250ZXh0KVxuICAgICAgICAgICAgICBicmFuY2hlcy5wdXNoKHRoZW5ib2R5KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVha1xuXG4gICAgICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgICAgIC8vIGltcGxpY2l0ICd0aGVuJ1xuICAgICAgICAgICAgICBpZiAoY29uZCkge1xuICAgICAgICAgICAgICAgIC8vIGltcGxpY2l0ICdlbHNlJ1xuICAgICAgICAgICAgICAgIGlmICh0aGVuYm9keSkge1xuICAgICAgICAgICAgICAgICAgYnJhbmNoZXMucHVzaCguLi5JTlNUUi5lbHNlKCkpXG4gICAgICAgICAgICAgICAgICBicmFuY2hlcy5wdXNoKGV2YWx1YXRlKGMsIGNvbnRleHQpKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICB0aGVuYm9keSA9IGV2YWx1YXRlKGMsIGNvbnRleHQpXG4gICAgICAgICAgICAgICAgICBicmFuY2hlcy5wdXNoKHRoZW5ib2R5KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25kID0gZXZhbHVhdGUoYywgY29udGV4dClcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRleHQuZGVwdGgucG9wKClcblxuICAgICAgICBpZiAoIXJlc3VsdHMubGVuZ3RoKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKElOU1RSLnR5cGUudm9pZCgpKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETzogbS5pZihbJ2kzMiddLCBjb25kLCB0aGVuLCBlbHNlKVxuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgIC4uLklOU1RSLmlmKHJlc3VsdHMuZmxhdCgpLCBjb25kKSxcbiAgICAgICAgICAuLi5icmFuY2hlcy5mbGF0KCksXG4gICAgICAgICAgLi4uSU5TVFIuZW5kKClcbiAgICAgICAgXVxuICAgICAgfVxuXG4gICAgICBjYXNlICdsb29wJzpcbiAgICAgIGNhc2UgJ2Jsb2NrJzoge1xuICAgICAgICBjb25zdCBuYW1lID0gbm9kZS5uYW1lPy52YWx1ZSA/PyBjb250ZXh0LmRlcHRoLmxlbmd0aFxuICAgICAgICBjb25zdCByZXN1bHRzID0gW11cbiAgICAgICAgY29uc3QgYm9keSA9IFtdXG5cbiAgICAgICAgY29udGV4dC5kZXB0aC5wdXNoKG5hbWUpXG5cbiAgICAgICAgZm9yIChjb25zdCBjIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgICAgICBzd2l0Y2ggKGMuaW5zdHIudmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgJ3Jlc3VsdCc6IHtcbiAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGV2YWx1YXRlKGMsIGNvbnRleHQpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVha1xuXG4gICAgICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgICAgIGJvZHkucHVzaChldmFsdWF0ZShjLCBjb250ZXh0KSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb250ZXh0LmRlcHRoLnBvcCgpXG5cbiAgICAgICAgaWYgKCFyZXN1bHRzLmxlbmd0aCkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaChJTlNUUi50eXBlLnZvaWQoKSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE86IG0uYmxvY2sobmFtZSwgWydpMzInXSwgYm9keSlcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAuLi5JTlNUUltpbnN0cl0oKSxcbiAgICAgICAgICAuLi5yZXN1bHRzLmZsYXQoKS5tYXAoZnVuY3Rpb24gbGF5b3V0UmVzdWx0cyh4KSB7IHJldHVybiBbLi4ueF0gfSksXG4gICAgICAgICAgLi4uYm9keS5mbGF0KCksXG4gICAgICAgICAgLi4uSU5TVFIuZW5kKClcbiAgICAgICAgXVxuICAgICAgfVxuXG4gICAgICBjYXNlICdicl90YWJsZSc6IHtcbiAgICAgICAgaWYgKG5vZGUubmFtZSkge1xuICAgICAgICAgIG5vZGUucGFyYW1zLnVuc2hpZnQoe1xuICAgICAgICAgICAgcGFyYW06IHtcbiAgICAgICAgICAgICAgdmFsdWU6IGNvbnRleHQubG9va3VwKG5vZGUubmFtZS52YWx1ZSwgaW5zdHIpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhcmdzID0gbm9kZS5wYXJhbXMubWFwKHggPT4gY2FzdCh4LnBhcmFtLCBjb250ZXh0LCBpbnN0cikpXG4gICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuLmZsYXRNYXAoZnVuY3Rpb24gZXZhbHVhdGVCclRhYmxlKHgpIHsgcmV0dXJuIGV2YWx1YXRlKHgsIGNvbnRleHQpIH0pXG4gICAgICAgIHJldHVybiBieXRlcyhpbnN0ciwgW2FyZ3MubGVuZ3RoIC0gMSwgLi4uYXJnc10sIGV4cHIpXG4gICAgICB9XG5cbiAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgaWYgKG5vZGUubmFtZSkge1xuICAgICAgICAgIG5vZGUucGFyYW1zLnVuc2hpZnQoe1xuICAgICAgICAgICAgcGFyYW06IHtcbiAgICAgICAgICAgICAgdmFsdWU6IChpbnN0ci5zdGFydHNXaXRoKCdnbG9iYWwnKSA/IGcgOiBjb250ZXh0KVxuICAgICAgICAgICAgICAgIC5sb29rdXAobm9kZS5uYW1lLnZhbHVlLCBpbnN0cilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBub2RlLnBhcmFtcy5tYXAoeCA9PiBjYXN0KHgucGFyYW0sIGNvbnRleHQsIGluc3RyKSlcbiAgICAgICAgY29uc3QgZXhwciA9IG5vZGUuY2hpbGRyZW4uZmxhdE1hcChmdW5jdGlvbiBldmFsdWF0ZU5vZGUoeCkgeyByZXR1cm4gZXZhbHVhdGUoeCwgY29udGV4dCkgfSlcbiAgICAgICAgcmV0dXJuIGJ5dGVzKGluc3RyLCBhcmdzLCBleHByKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGJ1aWxkKG5vZGUpIHtcbiAgICBzd2l0Y2ggKG5vZGUuaW5zdHIudmFsdWUpIHtcbiAgICAgIGNhc2UgJ21vZHVsZSc6IHtcbiAgICAgICAgbm9kZS5jaGlsZHJlbi5mb3JFYWNoKGZ1bmN0aW9uIGJ1aWxkTW9kdWxlKHgpIHsgYnVpbGQoeCkgfSlcbiAgICAgIH1cbiAgICAgICAgYnJlYWtcblxuICAgICAgY2FzZSAnbWVtb3J5Jzoge1xuICAgICAgICBjb25zdCBuYW1lID0gbm9kZS5uYW1lPy52YWx1ZSA/PyBtLm1lbW9yaWVzLmxlbmd0aFxuICAgICAgICBjb25zdCBhcmdzID0gbm9kZS5wYXJhbXMubWFwKHggPT4gY2FzdCh4LnBhcmFtKSkuZmxhdCgpXG5cbiAgICAgICAgaWYgKG5vZGUuY2hpbGRyZW4/LlswXT8uaW5zdHIudmFsdWUgPT09ICdleHBvcnQnKSB7XG4gICAgICAgICAgY29uc3QgZXhwb3J0X25hbWUgPSBub2RlLmNoaWxkcmVuWzBdLnBhcmFtc1swXS5wYXJhbS52YWx1ZVxuICAgICAgICAgIGNvbnN0IGludGVybmFsX25hbWUgPSBub2RlLmNoaWxkcmVuWzBdLm5hbWU/LnZhbHVlID8/IG5hbWUgPz8gMFxuICAgICAgICAgIG0uZXhwb3J0KCdtZW1vcnknLCBpbnRlcm5hbF9uYW1lLCBleHBvcnRfbmFtZSlcbiAgICAgICAgfVxuXG4gICAgICAgIG0ubWVtb3J5KG5hbWUsIC4uLmFyZ3MpXG4gICAgICB9XG4gICAgICAgIGJyZWFrXG5cbiAgICAgIGNhc2UgJ2RhdGEnOiB7XG4gICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuLnNoaWZ0KClcbiAgICAgICAgY29uc3QgZGF0YSA9IG5vZGUuY2hpbGRyZW4uc2hpZnQoKS5kYXRhXG4gICAgICAgIG0uZGF0YShldmFsdWF0ZShleHByKSwgZGF0YSlcbiAgICAgIH1cbiAgICAgICAgYnJlYWtcblxuICAgICAgY2FzZSAnc3RhcnQnOiB7XG4gICAgICAgIG0uc3RhcnQobm9kZS5uYW1lLnZhbHVlKVxuICAgICAgfVxuICAgICAgICBicmVha1xuXG4gICAgICBjYXNlICd0YWJsZSc6IHtcbiAgICAgICAgY29uc3QgYXJncyA9IG5vZGUucGFyYW1zLm1hcCh4ID0+IGNhc3QoeC5wYXJhbSkpXG4gICAgICAgIGFyZ3MudW5zaGlmdChhcmdzLnBvcCgpKVxuICAgICAgICBtLnRhYmxlKC4uLmFyZ3MpXG4gICAgICB9XG4gICAgICAgIGJyZWFrXG5cbiAgICAgIGNhc2UgJ2VsZW0nOiB7XG4gICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuLnNoaWZ0KClcbiAgICAgICAgY29uc3QgcmVmcyA9IG5vZGUuY2hpbGRyZW4ubWFwKHggPT4geC5yZWYudmFsdWUpXG4gICAgICAgIG0uZWxlbShldmFsdWF0ZShleHByKSwgcmVmcylcbiAgICAgIH1cbiAgICAgICAgYnJlYWtcblxuICAgICAgY2FzZSAnaW1wb3J0Jzoge1xuICAgICAgICBpZiAobm9kZS5jaGlsZHJlblswXS5pbnN0ci52YWx1ZSA9PT0gJ2Z1bmMnKSB7XG4gICAgICAgICAgY29uc3QgYXJncyA9IG5vZGUucGFyYW1zLm1hcCh4ID0+IGNhc3QoeC5wYXJhbSkpXG4gICAgICAgICAgbGV0IHBhcmFtc19yZXN1bHRzID0gZXZhbHVhdGUobm9kZS5jaGlsZHJlblswXSlcbiAgICAgICAgICBjb25zdCBuYW1lID0gcGFyYW1zX3Jlc3VsdHMuc2hpZnQoKVxuICAgICAgICAgIGlmIChub2RlLmNoaWxkcmVuPy5bMF0/LmNoaWxkcmVuPy5bMF0/Lmluc3RyLnZhbHVlID09PSAndHlwZScpIHtcbiAgICAgICAgICAgIGNvbnN0IHR5cGVOYW1lID0gbm9kZS5jaGlsZHJlbj8uWzBdPy5jaGlsZHJlbj8uWzBdPy5uYW1lLnZhbHVlXG4gICAgICAgICAgICBjb25zdCB0eXBlSWR4ID0gbS5nZXRUeXBlKHR5cGVOYW1lKVxuICAgICAgICAgICAgY29uc3QgdHlwZSA9IG0udHlwZXNbdHlwZUlkeF1cbiAgICAgICAgICAgIHBhcmFtc19yZXN1bHRzID0gdHlwZS5zcGxpdCgnLCcpLm1hcCh4ID0+IHguc3BsaXQoJyAnKSlcbiAgICAgICAgICB9XG4gICAgICAgICAgbS5pbXBvcnQoJ2Z1bmMnLCBuYW1lLCAuLi5hcmdzLCAuLi5wYXJhbXNfcmVzdWx0cylcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmNoaWxkcmVuWzBdLmluc3RyLnZhbHVlID09PSAnbWVtb3J5Jykge1xuICAgICAgICAgIGNvbnN0IG1lbW9yeSA9IG5vZGUuY2hpbGRyZW5bMF1cbiAgICAgICAgICBjb25zdCBhcmdzID0gbm9kZS5wYXJhbXMubWFwKHggPT4gY2FzdCh4LnBhcmFtKSlcbiAgICAgICAgICBjb25zdCBuYW1lID0gbWVtb3J5Lmluc3RyLm5hbWVcbiAgICAgICAgICBjb25zdCBkZXNjID0gbWVtb3J5LnBhcmFtcy5tYXAoeCA9PiBjYXN0KHgucGFyYW0pKVxuICAgICAgICAgIG0uaW1wb3J0KCdtZW1vcnknLCBuYW1lLCAuLi5hcmdzLCBkZXNjKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAgIGJyZWFrXG5cbiAgICAgIGNhc2UgJ2dsb2JhbCc6IHtcbiAgICAgICAgY29uc3QgZ2xvYiA9IHtcbiAgICAgICAgICBuYW1lOiBub2RlLm5hbWU/LnZhbHVlID8/IG0uZ2xvYmFscy5sZW5ndGgsXG4gICAgICAgICAgdmFydHlwZTogJ2NvbnN0JyxcbiAgICAgICAgICB0eXBlOiBub2RlLmNoaWxkcmVuWzBdLmluc3RyLnZhbHVlXG4gICAgICAgIH1cblxuICAgICAgICBnLmdsb2JhbHMucHVzaChnbG9iKVxuXG4gICAgICAgIGlmIChnbG9iLnR5cGUgPT09ICdleHBvcnQnKSB7XG4gICAgICAgICAgY29uc3QgZXhwb3J0X25hbWUgPSBub2RlLmNoaWxkcmVuLnNoaWZ0KCkucGFyYW1zWzBdLnBhcmFtLnZhbHVlXG4gICAgICAgICAgbS5leHBvcnQoJ2dsb2JhbCcsIGdsb2IubmFtZSwgZXhwb3J0X25hbWUpXG4gICAgICAgICAgZ2xvYi50eXBlID0gbm9kZS5jaGlsZHJlblswXS5pbnN0ci52YWx1ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGdsb2IudHlwZSA9PT0gJ211dCcpIHtcbiAgICAgICAgICBnbG9iLnZhcnR5cGUgPSAndmFyJ1xuICAgICAgICAgIGdsb2IudHlwZSA9IG5vZGUuY2hpbGRyZW5bMF0uY2hpbGRyZW5bMF0uaW5zdHIudmFsdWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGV4cHIgPSBub2RlLmNoaWxkcmVuWzFdXG5cbiAgICAgICAgbS5nbG9iYWwoXG4gICAgICAgICAgZ2xvYi5uYW1lLFxuICAgICAgICAgIGdsb2IudmFydHlwZSxcbiAgICAgICAgICBnbG9iLnR5cGUsXG4gICAgICAgICAgZXZhbHVhdGUoZXhwcilcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgICBicmVha1xuXG4gICAgICBjYXNlICd0eXBlJzoge1xuICAgICAgICBjb25zdCB0eXBlID0ge1xuICAgICAgICAgIG5hbWU6IG5vZGUubmFtZT8udmFsdWUgPz8gbS50eXBlcy5sZW5ndGgsXG4gICAgICAgICAgcGFyYW1zOiBbXSxcbiAgICAgICAgICByZXN1bHRzOiBbXVxuICAgICAgICB9XG5cbiAgICAgICAgZy50eXBlcy5wdXNoKHR5cGUpXG5cbiAgICAgICAgZm9yIChjb25zdCBjIG9mIG5vZGUuY2hpbGRyZW5bMF0uY2hpbGRyZW4pIHtcbiAgICAgICAgICBzd2l0Y2ggKGMuaW5zdHIudmFsdWUpIHtcbiAgICAgICAgICAgIGNhc2UgJ3BhcmFtJzoge1xuICAgICAgICAgICAgICB0eXBlLnBhcmFtcy5wdXNoKC4uLmMuY2hpbGRyZW4ubWFwKHggPT4geC5pbnN0ci52YWx1ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrXG5cbiAgICAgICAgICAgIGNhc2UgJ3Jlc3VsdCc6IHtcbiAgICAgICAgICAgICAgdHlwZS5yZXN1bHRzLnB1c2goLi4uYy5jaGlsZHJlbi5tYXAoeCA9PiB4Lmluc3RyLnZhbHVlKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBtLnR5cGUoXG4gICAgICAgICAgdHlwZS5uYW1lLFxuICAgICAgICAgIHR5cGUucGFyYW1zLFxuICAgICAgICAgIHR5cGUucmVzdWx0c1xuICAgICAgICApXG4gICAgICB9XG4gICAgICAgIGJyZWFrXG5cbiAgICAgIGNhc2UgJ2V4cG9ydCc6IHtcbiAgICAgICAgY29uc3QgZXhwID0ge1xuICAgICAgICAgIG5hbWU6IG5vZGUucGFyYW1zWzBdLnBhcmFtLnZhbHVlXG4gICAgICAgIH1cbiAgICAgICAgZXhwLnR5cGUgPSBub2RlLmNoaWxkcmVuWzBdLmluc3RyLnZhbHVlXG4gICAgICAgIGV4cC5pbnRlcm5hbF9uYW1lID0gbm9kZS5jaGlsZHJlblswXS5uYW1lLnZhbHVlXG4gICAgICAgIG0uZXhwb3J0KFxuICAgICAgICAgIGV4cC50eXBlLFxuICAgICAgICAgIGV4cC5pbnRlcm5hbF9uYW1lLFxuICAgICAgICAgIGV4cC5uYW1lXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgICAgYnJlYWtcblxuICAgICAgY2FzZSAnZnVuYyc6IHtcbiAgICAgICAgY29uc3QgZnVuYyA9IHtcbiAgICAgICAgICBuYW1lOiBub2RlLm5hbWU/LnZhbHVlID8/IGcuZnVuY3MubGVuZ3RoLFxuICAgICAgICAgIGNvbnRleHQ6IG5ldyBGdW5jdGlvbkNvbnRleHQoZyksXG4gICAgICAgICAgcGFyYW1zOiBbXSxcbiAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICBsb2NhbHM6IFtdLFxuICAgICAgICAgIGJvZHk6IFtdXG4gICAgICAgIH1cblxuICAgICAgICBnLmZ1bmNzLnB1c2goZnVuYylcblxuICAgICAgICBmb3IgKGNvbnN0IGMgb2Ygbm9kZS5jaGlsZHJlbikge1xuICAgICAgICAgIHN3aXRjaCAoYy5pbnN0ci52YWx1ZSkge1xuICAgICAgICAgICAgY2FzZSAnZXhwb3J0Jzoge1xuICAgICAgICAgICAgICBjb25zdCBleHBvcnRfbmFtZSA9IGMucGFyYW1zWzBdLnBhcmFtLnZhbHVlXG4gICAgICAgICAgICAgIG0uZXhwb3J0KCdmdW5jJywgZnVuYy5uYW1lLCBleHBvcnRfbmFtZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWtcblxuICAgICAgICAgICAgY2FzZSAnbG9jYWwnOiB7XG4gICAgICAgICAgICAgIGZ1bmMubG9jYWxzLnB1c2goLi4uYy5jaGlsZHJlbi5tYXAoeCA9PiB4Lmluc3RyLnZhbHVlKSlcbiAgICAgICAgICAgICAgZnVuYy5jb250ZXh0LmxvY2Fscy5wdXNoKC4uLmMuY2hpbGRyZW4ubWFwKCgpID0+IGMubmFtZT8udmFsdWUpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVha1xuXG4gICAgICAgICAgICBjYXNlICdwYXJhbSc6IHtcbiAgICAgICAgICAgICAgZnVuYy5wYXJhbXMucHVzaCguLi5jLmNoaWxkcmVuLm1hcCh4ID0+IHguaW5zdHIudmFsdWUpKVxuICAgICAgICAgICAgICBmdW5jLmNvbnRleHQubG9jYWxzLnB1c2goLi4uYy5jaGlsZHJlbi5tYXAoKCkgPT4gYy5uYW1lPy52YWx1ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrXG5cbiAgICAgICAgICAgIGNhc2UgJ3Jlc3VsdCc6IHtcbiAgICAgICAgICAgICAgZnVuYy5yZXN1bHRzLnB1c2goLi4uYy5jaGlsZHJlbi5tYXAoeCA9PiB4Lmluc3RyLnZhbHVlKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWtcblxuICAgICAgICAgICAgY2FzZSAndHlwZSc6XG4gICAgICAgICAgICAgIC8vIHRoaXMgaXMgb25seSBhIGhpbnQgaW4gdGV4dCBtb2RlLCBub3QgcmVwcmVzZW50ZWQgaW4gYmluYXJ5XG4gICAgICAgICAgICAgIGJyZWFrXG5cbiAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgZnVuYy5ib2R5LnB1c2goYylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuXG4gICAgICAgIC8vIGZ1bmN0aW9uIGJvZGllcyBhcmUgZGVmZXJyZWQgZXZhbHVhdGlvblxuICAgICAgICAvLyBiZWNhdXNlIHdlIG5lZWQgdG8gaGF2ZSBhbGwgdGhlaXIgbmFtZXNcbiAgICAgICAgLy8gaW4gY29udGV4dCBmaXJzdCBiZWNhdXNlIHRoZXkgYXJlIGNhbGxlZFxuICAgICAgICAvLyBmcm9tIHdpdGhpbiBvdGhlciBmdW5jdGlvbnMgc28gd2UgY2FuJ3RcbiAgICAgICAgLy8ga25vdyBpbiBhZHZhbmNlXG4gICAgICAgIGRlZmVycmVkLnB1c2goZnVuY3Rpb24gZGVmZXJyZWRGdW5jKCkge1xuICAgICAgICAgIG0uZnVuYyhcbiAgICAgICAgICAgIGZ1bmMubmFtZSxcbiAgICAgICAgICAgIGZ1bmMucGFyYW1zLFxuICAgICAgICAgICAgZnVuYy5yZXN1bHRzLFxuICAgICAgICAgICAgZnVuYy5sb2NhbHMsXG4gICAgICAgICAgICBbLi4uZnVuYy5ib2R5LmZsYXRNYXAoZnVuY3Rpb24gZXZhbHVhdGVGdW5jQm9keSh4KSB7IHJldHVybiBldmFsdWF0ZSh4LCBmdW5jLmNvbnRleHQpIH0pXVxuICAgICAgICAgIClcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICAgICAgYnJlYWtcblxuICAgIH1cbiAgfVxuXG4gIGJ1aWxkKG5vZGUpXG5cbiAgZGVmZXJyZWQuZm9yRWFjaChmdW5jdGlvbiBidWlsZEZ1bmMoZm4pIHsgZm4oKSB9KVxuXG4gIC8vIGNvbnN0IEdlbmVyYXRvckZ1bmN0aW9uID0gKGZ1bmN0aW9uKigpe3lpZWxkIHVuZGVmaW5lZDt9KS5jb25zdHJ1Y3RvcjtcblxuICAvLyAvLyByZWN1cnNpdmUgZnVuY3Rpb24gdGhhdCB0cmF2ZXJzZXMgYW5kIGV4cGFuZHMgYWxsIGdlbmVyYXRvciBmdW5jdGlvbnMgaW4gdGhlIG9iamVjdFxuICAvLyBmdW5jdGlvbiBleHBhbmQobm9kZSkge1xuICAvLyAgIGlmIChub2RlIGluc3RhbmNlb2YgR2VuZXJhdG9yRnVuY3Rpb24pIHtcbiAgLy8gICAgIHJldHVybiBbLi4ubm9kZV1cbiAgLy8gICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobm9kZSkpIHtcbiAgLy8gICAgIHJldHVybiBub2RlLm1hcChleHBhbmQpXG4gIC8vICAgfSBlbHNlIGlmIChub2RlIGluc3RhbmNlb2YgT2JqZWN0KSB7XG4gIC8vICAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKG5vZGUpLm1hcCgoW2ssIHZdKSA9PiBbaywgZXhwYW5kKHYpXSkpXG4gIC8vICAgfSBlbHNlIHtcbiAgLy8gICAgIHJldHVybiBub2RlXG4gIC8vICAgfVxuICAvLyB9XG5cbiAgLy8gY29uc3QgZ19leHBhbmRlZCA9IGV4cGFuZChnKVxuXG4gIHJldHVybiB7IG1vZHVsZTogbSwgZ2xvYmFsOiBnIH1cbn1cbiIsICJjb25zdCByZWdleHAgPSBuZXcgUmVnRXhwKFtcbiAgLyg/PGNvbW1lbnQ+OzsuKnxcXCg7W15dKj87XFwpKS8sXG4gIC9cIig/PHN0cmluZz4oPzpcXFxcXCJ8W15cIl0pKj8pXCIvLFxuICAvKD88cGFyYW0+b2Zmc2V0fGFsaWdufHNoYXJlZHxmdW5jcmVmKT0/LyxcbiAgLyg/PGhleD4oWystXT9uYW46KT9bKy1dPzB4WzAtOWEtZi5wKy1fXSspLyxcbiAgLyg/PG51bWJlcj5bKy1dP2luZnxbKy1dP25hbnxbKy1dP1xcZFtcXGQuZV8rLV0qKS8sXG4gIC8oPzxpbnN0cj5bYS16XVthLXowLTkhIyQlJicqK1xcLS4vOjw9Pj9AXFxcXF5fYHx+XSspLyxcbiAgL1xcJCg/PGxhYmVsPlthLXowLTkhIyQlJicqK1xcLS4vOjw9Pj9AXFxcXF5fYHx+XSspLyxcbiAgLyg/PGxwYXJlbj5cXCgpfCg/PHJwYXJlbj5cXCkpfCg/PG51bD5bIFxcdFxcbl0rKXwoPzxlcnJvcj4uKS8sXG5dLm1hcCh4ID0+IHgudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkuam9pbignfCcpLCAnZ2knKVxuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5pemUgKGlucHV0KSB7XG4gIGxldCBsYXN0ID0ge31cbiAgbGV0IGN1cnIgPSB7fVxuXG4gIGNvbnN0IG1hdGNoZXMgPSBpbnB1dC5tYXRjaEFsbChyZWdleHApXG5cbiAgZnVuY3Rpb24gbmV4dCAoKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBtYXRjaGVzLm5leHQoKVxuICAgIGlmIChtYXRjaC5kb25lKSByZXR1cm4geyB2YWx1ZTogeyB2YWx1ZTogbnVsbCwga2luZDogJ2VvZicsIGluZGV4OiBpbnB1dC5sZW5ndGggfSwgZG9uZTogdHJ1ZSB9IC8vbWF0Y2hcblxuICAgIGNvbnN0IFtraW5kLCB2YWx1ZV0gPSBPYmplY3QuZW50cmllcyhtYXRjaC52YWx1ZS5ncm91cHMpLmZpbHRlcihlID0+IGVbMV0gIT0gbnVsbClbMF1cbiAgICByZXR1cm4geyB2YWx1ZTogeyB2YWx1ZSwga2luZCwgaW5kZXg6IG1hdGNoLnZhbHVlLmluZGV4IH0sIGRvbmU6IGZhbHNlIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGFkdmFuY2UgKCkge1xuICAgIGxhc3QgPSBjdXJyXG4gICAgZG8ge1xuICAgICAgY3VyciA9IG5leHQoKS52YWx1ZVxuICAgIH0gd2hpbGUgKGN1cnIua2luZCA9PT0gJ251bCcgfHwgY3Vyci5raW5kID09PSAnY29tbWVudCcpXG4gICAgcmV0dXJuIGxhc3RcbiAgfVxuXG4gIGZ1bmN0aW9uIHBlZWsgKGtpbmQsIHZhbHVlKSB7XG4gICAgaWYgKGtpbmQgIT0gbnVsbCkge1xuICAgICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlID09PSBjdXJyLnZhbHVlXG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGtpbmQgPT09IGN1cnIua2luZFxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY3VyclxuICB9XG5cbiAgZnVuY3Rpb24gYWNjZXB0IChraW5kLCB2YWx1ZSkge1xuICAgIGlmIChraW5kID09PSBjdXJyLmtpbmQpIHtcbiAgICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gY3Vyci52YWx1ZSkge1xuICAgICAgICAgIHJldHVybiBhZHZhbmNlKClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIHJldHVybiBhZHZhbmNlKClcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGZ1bmN0aW9uIGV4cGVjdCAoa2luZCwgdmFsdWUpIHtcbiAgICBjb25zdCB0b2tlbiA9IGFjY2VwdChraW5kLCB2YWx1ZSlcbiAgICBpZiAoIXRva2VuKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXG4gICAgICAgICAgJ1VuZXhwZWN0ZWQgdG9rZW46ICcgKyBjdXJyLnZhbHVlXG4gICAgICArICdcXG4gICAgICAgIGV4cGVjdGVkOiAnICsga2luZCArICh2YWx1ZSA/ICcgXCInICsgdmFsdWUgICsgJ1wiJyA6ICcnKVxuICAgICAgKyAnXFxuICAgIGJ1dCByZWNlaXZlZDogJyArIGN1cnIua2luZFxuICAgICAgKyAnXFxuICAgICBhdCBwb3NpdGlvbjogJyArIGN1cnIuaW5kZXgpXG4gICAgfVxuICAgIHJldHVybiB0b2tlblxuICB9XG5cbiAgY29uc3QgaXRlcmF0b3IgPSB7XG4gICAgW1N5bWJvbC5pdGVyYXRvcl0gKCkgeyByZXR1cm4gdGhpcyB9LFxuICAgIG5leHQsXG4gICAgYWR2YW5jZSxcbiAgICBwZWVrLFxuICAgIGFjY2VwdCxcbiAgICBleHBlY3QsXG4gICAgc3RhcnQ6IGFkdmFuY2UsXG4gIH1cblxuICByZXR1cm4gaXRlcmF0b3Jcbn1cblxuZXhwb3J0IGRlZmF1bHQgaW5wdXQgPT4gWy4uLnRva2VuaXplKGlucHV0KV1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBwYXJzZSAoeyBzdGFydCwgcGVlaywgYWNjZXB0LCBleHBlY3QgfSkge1xuICAvLyBmdW5jdGlvbiBlcnJvciAodG9rZW4sIG1lc3NhZ2UpIHtcbiAgLy8gICByZXR1cm4gbmV3IFR5cGVFcnJvcihtZXNzYWdlXG4gIC8vICAgICArICc6ICcgKyB0b2tlbi52YWx1ZVxuICAvLyAgICAgKyAnXFxuICBhdCBwb3NpdGlvbjogJyArIHRva2VuLmluZGV4KVxuICAvLyB9XG4gIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoJ3V0Zi04JylcblxuICBjb25zdCBIRVggPSAvWzAtOWEtZl0vaVxuXG4gIGNvbnN0IHN0cmluZ2NoYXIgPSB7XG4gICAgdDogMHgwOSxcbiAgICBuOiAweDBhLFxuICAgIHI6IDB4MGQsXG4gICAgJ1wiJzogMHgyMixcbiAgICBcIidcIjogMHgyNyxcbiAgICAnXFxcXCc6IDB4NWNcbiAgfVxuXG4gIC8vIFRPRE86IHJlcGxhY2Ugd2l0aCBhIHJlYWwgaW1wbGVtZW50YXRpb25cbiAgZnVuY3Rpb24gcGFyc2VEYXRhU3RyaW5nICgpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBbXVxuICAgIHdoaWxlICgxKSB7XG4gICAgICBjb25zdCBzdHIgPSBhY2NlcHQoJ3N0cmluZycpXG4gICAgICBpZiAoIXN0cikgYnJlYWtcblxuICAgICAgZm9yIChsZXQgaSA9IDAsIGNoLCBuZXh0OyBpIDwgc3RyLnZhbHVlLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNoID0gc3RyLnZhbHVlW2ldXG4gICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICAgICAgbmV4dCA9IHN0ci52YWx1ZVtpICsgMV1cbiAgICAgICAgICBpZiAobmV4dCBpbiBzdHJpbmdjaGFyKSB7XG4gICAgICAgICAgICBwYXJzZWQucHVzaChzdHJpbmdjaGFyW25leHRdKVxuICAgICAgICAgICAgaSsrXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBUT0RPOiBcXHVcbiAgICAgICAgICBlbHNlIGlmIChIRVgudGVzdChuZXh0KSkge1xuICAgICAgICAgICAgaWYgKEhFWC50ZXN0KHN0ci52YWx1ZVtpICsgMl0pKSB7XG4gICAgICAgICAgICAgIHBhcnNlZC5wdXNoKHBhcnNlSW50KGAke25leHR9JHtzdHIudmFsdWVbaSArPSAyXX1gLCAxNikpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBwYXJzZWQucHVzaChwYXJzZUludChuZXh0LCAxNikpXG4gICAgICAgICAgICAgIGkrK1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcGFyc2VkLnB1c2goZW5jb2Rlci5lbmNvZGUoY2gpKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIGZ1bmN0aW9uKiBwYXJhbXMgKCkge1xuICAgIGxldCBwYXJhbVxuICAgIHdoaWxlICgxKSB7XG4gICAgICBpZiAocGFyYW0gPSBhY2NlcHQoJ251bWJlcicpKSB7XG4gICAgICAgIHBhcmFtLnZhbHVlID0gcGFyYW0udmFsdWUucmVwbGFjZSgvXy9nLCAnJylcbiAgICAgICAgeWllbGQgeyBwYXJhbSB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBpZiAocGFyYW0gPSBhY2NlcHQoJ2hleCcpKSB7XG4gICAgICAgIHBhcmFtLnZhbHVlID0gcGFyYW0udmFsdWUucmVwbGFjZSgvXy9nLCAnJylcbiAgICAgICAgeWllbGQgeyBwYXJhbSB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBpZiAocGFyYW0gPSBhY2NlcHQoJ3N0cmluZycpKSB7XG4gICAgICAgIHlpZWxkIHsgcGFyYW0gfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgaWYgKHBhcmFtID0gYWNjZXB0KCdsYWJlbCcpKSB7XG4gICAgICAgIHlpZWxkIHsgcGFyYW0gfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgaWYgKHBhcmFtID0gYWNjZXB0KCdwYXJhbScpKSB7XG4gICAgICAgIGxldCB2YWx1ZVxuICAgICAgICBpZiAodmFsdWUgPSBhY2NlcHQoJ251bWJlcicpKSB7XG4gICAgICAgICAgeWllbGQgeyBwYXJhbSwgdmFsdWUgfVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHZhbHVlID0gYWNjZXB0KCdoZXgnKSkge1xuICAgICAgICAgIHlpZWxkIHsgcGFyYW0sIHZhbHVlIH1cbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIHlpZWxkIHsgcGFyYW0gfVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZXhwciAoKSB7XG4gICAgY29uc3QgcmVmID0gYWNjZXB0KCdsYWJlbCcpXG4gICAgaWYgKHJlZikgcmV0dXJuIHsgcmVmIH1cblxuICAgIGlmIChwZWVrKCdzdHJpbmcnKSkgeyAvLyBUT0RPOiBoYW5kbGUgdXRmLTggc3RyaW5nc1xuICAgICAgcmV0dXJuIHsgZGF0YTogcGFyc2VEYXRhU3RyaW5nKCkgfVxuICAgIH1cblxuICAgIGNvbnN0IHNleHByID0gYWNjZXB0KCdscGFyZW4nKVxuXG4gICAgbGV0IGluc3RyXG4gICAgaWYgKHNleHByKSB7XG4gICAgICBpbnN0ciA9IGV4cGVjdCgnaW5zdHInKVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIGluc3RyID0gYWNjZXB0KCdpbnN0cicpXG4gICAgICBpZiAoIWluc3RyKSByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBub2RlID0ge1xuICAgICAgaW5zdHIsXG4gICAgICBuYW1lOiBhY2NlcHQoJ2xhYmVsJyksXG4gICAgICBwYXJhbXM6IFsuLi5wYXJhbXMoKV0sXG4gICAgICBjaGlsZHJlbjogW11cbiAgICB9XG5cbiAgICBpZiAoc2V4cHIpIHtcbiAgICAgIGxldCBjaGlsZFxuXG4gICAgICB3aGlsZSAoIXBlZWsoJ2VvZicpICYmIChjaGlsZCA9IGV4cHIoKSkpIHtcbiAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKGNoaWxkKVxuICAgICAgfVxuXG4gICAgICBub2RlLnBhcmFtcy5wdXNoKC4uLnBhcmFtcygpKSAvLyBjYW4gaGF2ZSBwYXJhbXMgYWZ0ZXIgY2hpbGRyZW4uLlxuXG4gICAgICBleHBlY3QoJ3JwYXJlbicpXG4gICAgfVxuICAgIGVsc2UgaWYgKGluc3RyLnZhbHVlID09PSAnYmxvY2snIHx8IGluc3RyLnZhbHVlID09PSAnbG9vcCcpIHtcbiAgICAgIGxldCBjaGlsZFxuXG4gICAgICB3aGlsZSAoIXBlZWsoJ2VvZicpICYmICghcGVlaygnaW5zdHInLCdlbmQnKSkgJiYgKGNoaWxkID0gZXhwcigpKSkge1xuICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2goY2hpbGQpXG4gICAgICB9XG5cbiAgICAgIGV4cGVjdCgnaW5zdHInLCdlbmQnKVxuICAgIH1cblxuICAgIHJldHVybiBub2RlXG4gIH1cblxuICBzdGFydCgpXG5cbiAgcmV0dXJuIGV4cHIoKVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7OztBQ1FPLElBQU0sT0FBTztBQUFBLEVBQ2xCLFlBQVk7QUFBQSxFQUNaLFlBQVk7QUFBQSxFQUNaLFlBQVk7QUFBQSxFQUNaLFlBQVk7QUFBQSxFQUNaLGFBQWE7QUFBQSxFQUNiLGFBQWE7QUFBQSxFQUNiLGdCQUFnQjtBQUFBLEVBQ2hCLGtCQUFrQjtBQUFBLEVBQ2xCLGdCQUFnQjtBQUFBLEVBQ2hCLGtCQUFrQjtBQUFBLEVBQ2xCLG9CQUFvQjtBQUFBLEVBQ3BCLGlCQUFpQjtBQUFBLEVBQ2pCLGtCQUFrQjtBQUFBLEVBQ2xCLGtCQUFrQjtBQUFBLEVBQ2xCLGtCQUFrQjtBQUFBLEVBQ2xCLGlCQUFpQjtBQUFBLEVBQ2pCLG1CQUFtQjtBQUFBLEVBQ25CLGdCQUFnQjtBQUFBLEVBQ2hCLGdCQUFnQjtBQUFBLEVBQ2hCLGVBQWU7QUFBQSxFQUNmLGdCQUFnQjtBQUFBLEVBQ2hCLGlCQUFpQjtBQUFBLEVBQ2pCLGlCQUFpQjtBQUFBLEVBQ2pCLG1CQUFtQjtBQUFBLEVBQ25CLGdCQUFnQjtBQUFBLEVBQ2hCLGlCQUFpQjtBQUFBLEVBQ2pCLGlCQUFp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SUFBSTtBQUFHLFFBQUksRUFBRTtBQUFRLFlBQU0sTUFBTSx1REFBdUQ7QUFBRyxRQUFJO0FBQUcsYUFBUyxJQUFJLEVBQUUsUUFBUSxJQUFJLEdBQUcsSUFBSSxLQUFLO0FBQUEsTUFBSTtBQUFBLE1BQzNLLEtBQUssTUFBTSxLQUFLO0FBQUEsSUFBQyxHQUFHLElBQUksSUFBSSxXQUFXLE1BQU0sS0FBSyxDQUFDLEdBQUcsSUFBSSxLQUFJO0FBQzVELFVBQUksSUFBSSxFQUFFLFdBQVcsR0FBRztBQUFHLFVBQUksU0FBUyxLQUFLLFNBQVMsR0FBRztBQUFFLFlBQUksSUFBSSxHQUFHO0FBQUUsY0FBSSxJQUFJLEVBQUUsV0FBVyxDQUFDO0FBQUcscUJBQVcsSUFBSSxXQUFXLEVBQUUsR0FBRyxNQUFNLElBQUksU0FBUyxPQUFPLElBQUksUUFBUTtBQUFBLFFBQU87QUFBRSxZQUFJLFNBQVMsS0FBSyxTQUFTO0FBQUc7QUFBQSxNQUFTO0FBQUUsVUFBSSxJQUFJLEVBQUUsV0FBVyxLQUFLLEdBQUcsS0FBSyxJQUFJLElBQUksRUFBRSxTQUFTLEdBQUcsSUFBSSxNQUFNLEtBQUssR0FBRyxJQUFJLElBQUksV0FBVyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxJQUFJO0FBQUksVUFBSSxPQUFPLElBQUk7QUFBYSxVQUFFLE9BQU87QUFBQSxXQUFRO0FBQ3RYLFlBQUksT0FBTyxJQUFJO0FBQWEsWUFBRSxPQUFPLE1BQU0sSUFBSSxLQUFLO0FBQUEsaUJBQWMsT0FBTyxJQUFJO0FBQWEsWUFBRSxPQUFPLE1BQU0sS0FBSyxLQUFLLEtBQUssRUFBRSxPQUFPLE1BQU0sSUFBSSxLQUFLO0FBQUEsaUJBQWMsT0FBTyxJQUFJO0FBQWEsWUFBRSxPQUFPLE1BQU0sS0FBSyxJQUFJLEtBQUssRUFBRSxPQUFPLE1BQU0sS0FDaE8sS0FBSyxLQUFLLEVBQUUsT0FBTyxNQUFNLElBQUksS0FBSztBQUFBO0FBQVU7QUFBVSxVQUFFLE9BQU8sSUFBSSxLQUFLO0FBQUEsTUFDNUU7QUFBQSxJQUNKO0FBQUUs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QVE7QUFBQSxJQUNqQixXQUNTQSxPQUFNLFVBQVUsV0FBV0EsT0FBTSxVQUFVLFFBQVE7QUFDMUQsVUFBSTtBQUVKLGFBQU8sQ0FBQyxLQUFLLEtBQUssS0FBTSxDQUFDLEtBQUssU0FBUSxLQUFLLE1BQU8sUUFBUSxLQUFLLElBQUk7QUFDakUsYUFBSyxTQUFTLEtBQUssS0FBSztBQUFBLE1BQzFCO0FBRUEsYUFBTyxTQUFRLEtBQUs7QUFBQSxJQUN0QjtBQUVBLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTTtBQUVOLFNBQU8sS0FBSztBQUNkOzs7QVBySGUsU0FBUixLQUFzQixNQUFNLFNBQVMsVUFBVSxDQUFDLEdBQUc7QUFDeEQsU0FBTyxRQUFRLE1BQU0sU0FBUyxhQUFXLE9BQUssR0FBRyxDQUFDLEdBQUcsUUFBUSxRQUFRLFFBQVEsTUFBTSxFQUFFLE9BQU8sTUFBTSxPQUFPLEVBQUU7QUFDN0c7IiwKICAibmFtZXMiOiBbImxvY2FscyIsICJpbnN0ciIsICJnbG9iYWwiLCAibm9kZSIsICJlbmNvZGVyIiwgImluc3RyIl0KfQo=
