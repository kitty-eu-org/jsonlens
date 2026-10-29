export const SAMPLES = {
  basic: `{
  "name": "Zed",
  "version": 1,
  "engine": "tree-sitter",
  "features": ["fast", "incremental", "error-tolerant"],
  "stable": true,
  "deprecated": null
}
`,
  nested: `{
  "项目": "tree-sitter 前端演示",
  "作者": {
    "name": "何昭昭",
    "city": "杭州"
  },
  "依赖": ["web-tree-sitter", "tree-sitter-json"],
  "配置": {
    "增量解析": true,
    "最大深度": 8,
    "超时": 1.5,
    "嵌套": { "层级": [1, 2, 3, { "深": "再深一点" }] }
  },
  "备注": "支持中文、emoji 🚀 和转义 \\u4f60\\u597d"
}
`,
  broken: `{
  "name": "Zed",
  "version": 1
  "features": ["fast", "incremental",
  "extra": tru
}
`,
};

/** 生成一份「比较大」的 JSON，用来感受解析耗时 */
export function buildBigSample(count = 5000) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: i,
      name: `item-${i}`,
      active: i % 3 === 0,
      score: Math.round(Math.random() * 10000) / 100,
      tags: ['alpha', 'beta', 'gamma'].slice(0, (i % 3) + 1),
      meta: { owner: `user${i % 97}`, nested: { depth: i % 5 } },
    });
  }
  return JSON.stringify({ total: count, items }, null, 2) + '\n';
}
