// 指标平台 M1：稳定序列化与内容哈希。
// - hashString/hashValue：FNV-1a 32bit（etag/等值比较用，非加密强度，旧发布 hash 格式 h<8hex>）；
// - sha256Hex/contentHash：发布修订内容哈希（sha256:<64hex>），verifyRevisionHash 校验两种格式。
// 注：构建链 babel/webpack4 不识别 ??，本文件一律使用 == null 三元。

const isPlainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value);

// 键排序的确定性 JSON（对象键排序，数组保序），保证同内容同哈希
export const stableStringify = (value) => {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

// FNV-1a 32bit，输出 8 位十六进制前缀
export const hashString = (text) => {
  let hash = 0x811c9dc5;
  const input = String(text == null ? '' : text);
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}`;
};

export const hashValue = (value) => hashString(stableStringify(value));

// ---- SHA-256（纯 JS，无依赖）：发布修订内容哈希用（MET-03 / MET-22） ----
// 不 require('crypto')：渲染进程 bundle 与 node 测试使用同一实现、结果一致。
// FNV hashValue 保持不变（等值比较/etag/夹具仍用它），只有发布 hash 改用 contentHash。
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// 字符串 → UTF-8 字节（代理对合并为码点；孤立代理按 U+FFFD，与 TextEncoder/node 一致）
const utf8Bytes = (text) => {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
};

const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

export const sha256Hex = (text) => {
  const bytes = utf8Bytes(String(text == null ? '' : text));
  const bitLength = bytes.length * 8;
  // 填充：0x80 + 0x00… 至 56 mod 64，再追加 64 位大端长度（高 32 位按 2^32 拆分）
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
    (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      const p = offset + t * 4;
      w[t] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map(word => word.toString(16).padStart(8, '0')).join('');
};

// 发布修订内容哈希：sha256:<64位hex>（键排序稳定序列化，同内容同哈希）
export const contentHash = (value) => `sha256:${sha256Hex(stableStringify(value))}`;

// 界面短哈希：去掉 sha256: 前缀再取 12 位，避免前缀占掉可区分字符；旧格式 h<8hex> 无前缀，原样显示
export const shortHashLabel = hash => (hash == null ? '—' : String(hash).replace(/^sha256:/, '').slice(0, 12));

const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LEGACY_HASH_PATTERN = /^h[0-9a-f]{8}$/;

// 发布修订 hash 校验：按修订自身 {spec, resolvedSpec} 重算比对。
// - sha256:… → contentHash 比对，legacy=false；
// - h<8hex>（升级前旧格式）→ 旧 FNV hashValue 比对，legacy=true（相等即 ok）；
// - 其他格式 / 非草案缺 hash → {ok:false, legacy:false}；
// - 草案（status==='draft'）尚无发布 hash，不校验：返回 {ok:true, legacy:false, skipped:true}。
// 已发布与已废弃（由发布而来，hash 保留）都按“已封存”校验。
export const verifyRevisionHash = (revision) => {
  if (revision == null) return {ok: false, legacy: false};
  if (revision.status === 'draft') return {ok: true, legacy: false, skipped: true};
  const hash = revision.hash;
  if (typeof hash !== 'string') return {ok: false, legacy: false};
  const content = {spec: revision.spec, resolvedSpec: revision.resolvedSpec};
  if (CONTENT_HASH_PATTERN.test(hash)) return {ok: contentHash(content) === hash, legacy: false};
  if (LEGACY_HASH_PATTERN.test(hash)) return {ok: hashValue(content) === hash, legacy: true};
  return {ok: false, legacy: false};
};

// 本地 ID 生成：项目内已有 Math.uuid 补丁则复用；测试/纯函数环境降级为计数+随机，
// 不 import src/lib/Math.js 以保持本层零依赖
let fallbackSeq = 0;
export const newMetricId = (prefix) => {
  if (typeof Math.uuid === 'function') return `${prefix}-${Math.uuid()}`;
  fallbackSeq += 1;
  return `${prefix}-local-${fallbackSeq}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
};
