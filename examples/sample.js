/**
 * 示例用的数据生成器。
 *
 * 故意不用「一个巨大的一维数组」这种假数据，而是照着真实接口的样子造：
 * 嵌套对象、对象数组、null、布尔、浮点、带引号和反斜杠的字符串。
 * 这样能顺带说明「高亮器的转义处理」和「JSON 视图的折叠」是否正常。
 */

const CITIES = ['北京', '上海', '深圳', '杭州', '成都'];

function order(userId, k) {
  return {
    id: `${userId}-${k}`,
    amount: (((userId * 7 + k) * 13) % 1000) / 10,
    paid: (userId + k) % 4 !== 0,
    created_at: 1700000000 + userId * 86400 + k * 3600,
    items: [{ sku: `SKU-${(userId * 31 + k * 17) % 9999}`, qty: (k % 3) + 1 }],
  };
}

function user(i) {
  return {
    id: 1000 + i,
    name: `user-${i}`,
    active: i % 3 !== 0,
    score: +(i * 3.14159).toFixed(3),
    tags: [`tag-${i % 7}`, `group-${i % 5}`],
    profile: {
      email: `user-${i}@example.com`,
      // 偶尔给个 null，验证 JSON 视图里 null 的样式
      bio: i % 11 === 0 ? null : `bio for ${i} "quoted" \\ backslash\ttab`,
      address: {
        city: CITIES[i % CITIES.length],
        geo: { lat: +(39.9 + i / 100).toFixed(4), lng: +(116.4 + i / 100).toFixed(4) },
      },
    },
    orders: Array.from({ length: 3 }, (_, k) => order(i, k)),
  };
}

/** 约 20 KB —— 会走「整棵解析」而不是分块 */
export function smallSample() {
  return JSON.stringify(
    {
      code: 0,
      message: 'ok',
      data: { page: 1, total: 40, items: Array.from({ length: 40 }, (_, i) => user(i)) },
    },
    null,
    2
  );
}

/**
 * 造一份指定大小的 JSON（默认 24 MB），用来复现「大文件」场景。
 * 用数组分段拼接，避免几十万次字符串 `+=` 带来的 O(n²) 拷贝。
 *
 * @param {number} megabytes 目标大小
 * @param {{wrap?: boolean}} [options] wrap=true 时套一层 `{"data":{"items":[…]}}`。
 *        注意：这层包裹会让**分块切不开**（顶层只有 3 个 key），退化成整棵解析，
 *        24 MB 大约 2.2 秒；顶层数组才是分块快路径（~100ms）。真实接口两种都有。
 */
export function hugeSample(megabytes = 24, { wrap = false } = {}) {
  const target = megabytes * 1024 * 1024;
  const parts = [];
  let size = 0;
  let i = 0;
  while (size < target) {
    const block = [];
    for (let k = 0; k < 200; k++) block.push(JSON.stringify(user(i++), null, 2));
    const piece = block.join(',\n');
    parts.push(piece);
    size += piece.length + 2;
  }
  const body = parts.join(',\n');
  if (!wrap) return `[\n${body}\n]`;
  return `{\n  "code": 0,\n  "message": "ok",\n  "data": {\n    "total": ${i},\n    "items": [\n${body}\n    ]\n  }\n}`;
}

/** 造一份明显非法的 JSON，用来看错误提示 */
export function brokenSample() {
  return '{\n  "a": 1,\n  "b": [1, 2,,],\n  "c": tru\n}\n';
}
