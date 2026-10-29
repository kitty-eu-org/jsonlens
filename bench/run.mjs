/**
 * 用 Playwright 跑一遍所有 (库 × 数据规模) 组合。
 *
 *   node bench/run.mjs                 # 全部
 *   node bench/run.mjs small mid       # 只跑指定规模
 *   node bench/run.mjs --v=ours        # 只跑指定实现
 *
 * 两个必要的保护：
 *   1. 每个组合独占一个浏览器进程 —— 25 MB 那轮的堆能到几百 MB，
 *      共用进程会让后测的库吃到前面留下来的 GC 压力。
 *   2. 外面套一个墙钟看门狗 —— 递归建 DOM 的库在 25 MB 上会卡在一个
 *      几十秒的同步任务里，页面完全没响应，Playwright 自己的超时回调
 *      根本派发不出去（上一版就是这么挂死的）。看门狗在 Node 侧计时，
 *      到点直接掐掉浏览器进程。
 */
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const EXEC = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const BASE = 'http://localhost:5184/';

const ALL_IMPLS = ['ours', 'jsoneditor', 'jsonformatter', 'textea', 'uiw', 'vuejsonpretty'];
const ALL_DATA = ['small', 'mid', 'big'];

const args = process.argv.slice(2);
const onlyData = args.filter((a) => ALL_DATA.includes(a));
const onlyImpl = args.filter((a) => a.startsWith('--v=')).map((a) => a.slice(4));
const IMPLS = onlyImpl.length ? onlyImpl : ALL_IMPLS;
const DATA = onlyData.length ? onlyData : ALL_DATA;

// 每档重复几次，取中位数。1~2ms 的差距在单次测量里全是噪声，
// 要断言「谁最快」必须靠这个。
const REPEAT = Math.max(
  1,
  Number(args.find((a) => a.startsWith('--r='))?.slice(4)) || 1,
);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// 墙钟上限：超过这个时间还没出结果，就当它做不到
const WALL = { small: 30_000, mid: 45_000, big: 70_000 };
// Playwright 内部超时，比墙钟短一点，让它先正常报错
const SOFT = { small: 20_000, mid: 32_000, big: 55_000 };

const LAUNCH_ARGS = ['--js-flags=--expose-gc', '--enable-precise-memory-info'];

function launch() {
  return chromium.launch({ executablePath: EXEC, args: LAUNCH_ARGS });
}

/** 掐掉浏览器；卡死的进程也要能关掉，所以自己也套一层超时 */
async function kill(browser) {
  if (!browser) return;
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 6000)),
  ]).catch(() => {});
}

async function runOne(impl, data, { warm = false } = {}) {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let crashed = false;
  page.on('crash', () => {
    crashed = true;
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  let watchdogFired = false;
  const watchdog = new Promise((resolve) => {
    setTimeout(() => {
      watchdogFired = true;
      resolve(null);
    }, WALL[data]);
  });

  const work = (async () => {
    await page.goto(`${BASE}?v=${impl}&d=${data}`, {
      waitUntil: 'domcontentloaded',
      timeout: SOFT[data],
    });
    await page.waitForFunction(() => window.__result !== undefined, null, {
      timeout: SOFT[data],
    });
    return await page.evaluate(() => window.__result);
  })();

  let out;
  try {
    out = await Promise.race([work, watchdog]);
    if (out === null && watchdogFired) {
      out = { impl, data, hung: true, err: '卡死：同步任务超过看门狗上限，页面无响应' };
    }
  } catch (e) {
    const msg = String(e.message || e);
    out = {
      impl,
      data,
      timeout: /Timeout|timed out/i.test(msg),
      crashed,
      err: crashed
        ? '页面崩溃（内存耗尽）'
        : watchdogFired
          ? '卡死：同步任务超过看门狗上限，页面无响应'
          : msg.split('\n')[0].slice(0, 120),
      hung: watchdogFired,
    };
  }

  const errs = errors.slice(0, 3);
  await ctx.close().catch(() => {});
  await kill(browser);
  if (warm) return null;
  return { ...out, pageErrors: errs };
}

// ---- 预热：让每个库的模块都转译一遍，避免第一次测到的是编译时间 ----
console.log('预热中…');
for (const impl of IMPLS) await runOne(impl, 'small', { warm: true });

const rows = [];
for (const data of DATA) {
  for (const impl of IMPLS) {
    const runs = [];
    for (let k = 0; k < REPEAT; k++) {
      const one = await runOne(impl, data);
      runs.push(one);
      // 崩了/卡死就别再重试了，那是确定性的，重试只是浪费时间
      if (one.hung || one.crashed || one.err) break;
    }
    // 崩了/卡死的那次最该被记住，不能因为中位数把它平均掉
    const bad = runs.find((r) => r.hung || r.crashed || r.err);
    let r = bad ?? runs[runs.length - 1];
    if (!bad && REPEAT > 1) {
      r = {
        ...r,
        mountMs: median(runs.map((x) => x.mountMs)),
        paintMs: median(runs.map((x) => x.paintMs)),
        parseMs: median(runs.map((x) => x.parseMs)),
        renderMs: median(runs.map((x) => x.renderMs)),
        heapMB: median(runs.map((x) => x.heapMB)),
        maxLongTask: median(runs.map((x) => x.maxLongTask)),
        totalBlocking: median(runs.map((x) => x.totalBlocking)),
        samples: runs.map((x) => `${x.mountMs}/${x.paintMs}`),
      };
    }
    rows.push(r);
    const tag = r.hung
      ? '卡死'
      : r.crashed
        ? '崩溃'
        : r.err
          ? '报错'
          : `${r.mountMs}ms (解析 ${r.parseMs} / 渲染 ${r.renderMs})`;
    const spread = r.samples ? `  [${r.samples.join(' ')}]` : '';
    console.log(
      `${data.padEnd(5)} ${impl.padEnd(14)} ${String(tag).padEnd(34)} dom=${r.domNodes ?? '-'}${spread}`,
    );
  }
}

fs.writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(rows, null, 2));

// ---- 打印汇总表 ----
for (const data of DATA) {
  const sub = rows.filter((r) => r.data === data);
  console.log(`\n### ${data}`);
  console.log(
    'impl | mount | 解析 | 渲染 | paint | dom | heapMB | maxLong | 阻塞 | 状态',
  );
  for (const r of sub) {
    const st = r.hung
      ? '⏱ 卡死'
      : r.crashed
        ? '💥 崩溃'
        : r.err
          ? `✗ ${r.err}`
          : '✓';
    const c = (v, w = 5) => String(v ?? '-').padStart(w);
    console.log(
      `${String(r.impl).padEnd(14)} | ${c(r.mountMs, 5)} | ${c(r.parseMs, 4)} | ${c(r.renderMs, 4)} | ${c(r.paintMs, 5)} | ${c(r.domNodes, 6)} | ${c(r.heapMB, 6)} | ${c(r.maxLongTask, 7)} | ${c(r.totalBlocking, 6)} | ${st}`,
    );
  }
}
