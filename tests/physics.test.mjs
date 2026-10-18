// 物理核心回歸測試：直接擷取 index.html 的 PHYSICS BEGIN／END 段落執行，測的就是上線的那份程式。
// 執行：node heat-sim/tests/physics.test.mjs（任何一條失敗 → exit code 1）
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const m = html.match(/\/\* ═══ PHYSICS BEGIN ═══[\s\S]*?\*\/([\s\S]*?)\/\* ═══ PHYSICS END ═══ \*\//);
if (!m) { console.error('找不到 PHYSICS BEGIN／END 標記'); process.exit(1); }
const P = new Function(m[1] + '\nreturn {SPEC_HEAT, MAX_T, POWER, K1, t1At, dAt, sDT, sCapT, P3B, P3T, p3, vT, solidScale, liquidScale, E_OFF, chunkCounts, chunkCount, POWER, CHUNK_CAL, X_RATE, xRatio, xSpeed, X_N, X_SP, X_HOLE, xLattice};')();

let fail = 0, pass = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('✗ ' + msg); } }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ── 頁籤 1：導熱快慢只改趨近速度，不改平衡溫度 ── */
for (let A = 0; A <= 100; A += 20) for (let B = 0; B <= 100; B += 20){
  const Te = (A + B) / 2;
  for (const k of ['慢', '中', '快']){
    const r = P.t1At({A, B, k}, 200);
    ok(near(r.TA, Te, 1e-6) && near(r.TB, Te, 1e-6), `t1 ${A}/${B} ${k}：終溫 ${r.TA.toFixed(3)}/${r.TB.toFixed(3)} 應為 ${Te}`);
    ok(near(r.Te, Te), `t1 ${A}/${B} ${k}：Te 應為兩初溫平均`);
  }
  if (A !== B){
    const d = k => Math.abs(P.t1At({A, B, k}, 2).D);
    ok(d('慢') > d('中') && d('中') > d('快'), `t1 ${A}/${B}：2 分時溫差應為 慢 > 中 > 快`);
  }
}
// 慢速、最大溫差 100 °C 也要在 20 分鐘（播放上限）內收斂到 0.5 °C 以內
ok(Math.abs(P.t1At({A:100, B:0, k:'慢'}, P.MAX_T.t1).D) < 0.5, 't1 慢速 100/0：20 分內應收斂');

/* ── 頁籤 2 雙槽：放熱＝吸熱、平衡溫度照 MS 加權、所有組合同一趨近速率 ── */
const mats = ['水', '甘油', '鐵'], masses = [50, 100, 200, 300];
for (const ma of mats) for (const mb of mats) for (const Ma of masses) for (const Mb of masses){
  const o = {A:{mat:ma, mass:Ma, T0:80}, B:{mat:mb, mass:Mb, T0:20}};
  for (const t of [0.5, 3, 10]){
    const r = P.dAt(o, t);
    const out = r.CA * (o.A.T0 - r.TA), inn = r.CB * (r.TB - o.B.T0);
    ok(near(out, inn, 1e-6), `d ${Ma}g${ma}+${Mb}g${mb} t=${t}：放熱 ${out} 應等於吸熱 ${inn}`);
  }
  const r15 = P.dAt(o, 15);
  ok(Math.abs(r15.TA - r15.TB) <= 0.5, `d ${Ma}g${ma}+${Mb}g${mb}：15 分時溫差應 ≤ 0.5 °C`);
  ok(Math.abs(P.dAt(o, 2).TA - P.dAt(o, 2).TB) > 10, `d ${Ma}g${ma}+${Mb}g${mb}：2 分時不應已平衡`);
}
{
  const ratio = o => P.dAt(o, 4).D / (o.A.T0 - o.B.T0);
  const iw = {A:{mat:'鐵', mass:100, T0:80}, B:{mat:'水', mass:200, T0:20}};
  const ww = {A:{mat:'水', mass:300, T0:80}, B:{mat:'水', mass:300, T0:20}};
  ok(near(ratio(iw), ratio(ww)), 'd：鐵＋水與水＋水的溫差衰減比例應相同（D57 同一趨近速率）');
  // 手算：100 g 鐵 80 °C＋200 g 水 20 °C → (10.7×80＋200×20)／210.7 ＝ 23.047 °C
  ok(near(P.dAt(iw, 100).Te, 4856 / 210.7, 1e-9), `d 手算 1：平衡溫度 ${P.dAt(iw, 100).Te} 應為 23.047`);
  // 手算：100 g 水 80 °C＋200 g 水 20 °C → (8000＋4000)／300 ＝ 40 °C（不是平均 50）
  const w12 = {A:{mat:'水', mass:100, T0:80}, B:{mat:'水', mass:200, T0:20}};
  ok(near(P.dAt(w12, 100).Te, 40, 1e-9), `d 手算 2：平衡溫度 ${P.dAt(w12, 100).Te} 應為 40`);
}

/* ── 頁籤 2 單槽：ΔT＝功率×時間／(MS)，到 100 °C 停 ── */
ok(near(P.sDT(100 * 1, 10), 30), '單槽手算：100 g 水 10 分 → ΔT 30');
ok(near(P.sDT(200 * 1, 10), 15), '單槽手算：200 g 水 10 分 → ΔT 15');
ok(near(P.sDT(100 * 0.58, 10), 3000 / 58), '單槽手算：100 g 甘油 10 分 → ΔT 51.72');
ok(near(P.sCapT(100 * 0.107), 80 * 10.7 / 300), '單槽手算：100 g 鐵 2.853 分到 100 °C');
ok(P.sDT(100 * 0.107, 5) === 80, '單槽：到頂後 ΔT 停在 80，不超過 100 °C');
ok(P.sCapT(100) === P.MAX_T.s, '單槽：100 g 水 10 分內到不了 100 °C，上限就是 10 分');

/* ── 頁籤 3：分段、平台期溫度與粒子速率不變、沸騰佔比 ── */
const at = t => P.p3(t);
ok(at(0).T === -20 && at(0).seg === 0, 'p3：t=0 為 −20 °C 固態');
ok(near(at(0.5).T, 0), 'p3：0.5 分到 0 °C');
ok(at(2.5).seg === 1 && near(at(2.5).T, 0) && near(at(2.5).fl, 0.5), 'p3：2.5 分熔化一半、溫度 0');
ok(near(at(9.5).T, 100), 'p3：9.5 分到 100 °C');
ok(at(23).seg === 3 && near(at(23).T, 100) && near(at(23).fg, 0.5), 'p3：23 分汽化一半、溫度 100');
ok(near(at(P.MAX_T.p).T, 120), 'p3：全程終點 120 °C');
ok(near((P.P3B[4] - P.P3B[3]) / P.P3B[5], 0.73, 0.005), 'p3：沸騰平台約佔全程 73%（D6）');
// 穩定熱源 20 cal/(g·分)：熔化 80 cal/g → 4 分、汽化 540 → 27 分、冰 0.5×20 °C → 0.5 分
ok(near(P.P3B[2] - P.P3B[1], 80 / 20) && near(P.P3B[4] - P.P3B[3], 540 / 20) && near(P.P3B[1], 0.5 * 20 / 20), 'p3：分段長度照潛熱與比熱');
ok(P.vT(at(1).T) === P.vT(at(4).T), 'p3：熔化平台期粒子速率不變');
ok(P.vT(at(12).T) === P.vT(at(30).T), 'p3：沸騰平台期粒子速率不變');
ok(P.vT(at(9.5).T) > P.vT(at(4.5).T), 'p3：液態升溫期粒子速率變快');

/* ── 熱脹冷縮（D56） ── */
ok(near(P.solidScale(-20), 1) && near(P.solidScale(0), 1.08), '膨脹：固態 −20→0 °C 間距放大 8%');
ok(near(P.liquidScale(0), 1) && near(P.liquidScale(100), 1.2), '膨脹：液態 0→100 °C 高度放大 20%');
ok(P.solidScale(at(1).T) === P.solidScale(at(4).T), '膨脹：熔化平台間距不動（C14）');

/* ── 能量塊（D81、C40） ── */
{
  const offs = Object.values(P.E_OFF);
  ok(new Set(offs).size === offs.length, '能量塊：各物質起算量不同，不存在讓所有物質同時歸零的溫度');
  for (const ma of mats) for (const mb of mats) for (const Ma of masses) for (const Mb of masses){
    const [a, b] = P.chunkCounts({mat:ma, mass:Ma, T:0}, {mat:mb, mass:Mb, T:0});
    ok(a >= 1 && b >= 1, `能量塊：${Ma}g${ma}、${Mb}g${mb} 都在 0 °C 時兩邊仍各有塊（${a}/${b}）`);
    // 雙槽整輪：兩邊塊數和不變、熱的一邊只減不增
    const o = {A:{mat:ma, mass:Ma, T0:80}, B:{mat:mb, mass:Mb, T0:20}};
    const cnt = t => { const r = P.dAt(o, t); return P.chunkCounts({mat:ma, mass:Ma, T:r.TA}, {mat:mb, mass:Mb, T:r.TB}); };
    const n0 = cnt(0);
    let prev = n0[0], mono = true, cons = true;
    for (let t = 0.25; t <= 20; t += 0.25){ const n = cnt(t); if (n[0] > prev) mono = false; if (n[0] + n[1] !== n0[0] + n0[1]) cons = false; prev = n[0]; }
    ok(cons, `能量塊：${Ma}g${ma}＋${Mb}g${mb} 傳熱過程兩邊塊數和不變`);
    ok(mono, `能量塊：${Ma}g${ma}＋${Mb}g${mb} 熱的一邊塊數只減不增`);
  }
  // 熱平衡頁預設：100 g 水 80 °C＋100 g 水 20 °C → 10／4 塊，平衡 50 °C 各 7 塊，看得到 3 塊移動
  const w = T => ({mat:'水', mass:100, T});
  const s0 = P.chunkCounts(w(80), w(20)), sE = P.chunkCounts(w(50), w(50));
  ok(s0[0] === 10 && s0[1] === 4 && sE[0] === 7 && sE[1] === 7, `能量塊：熱平衡頁預設 ${s0} → ${sE} 應為 10,4 → 7,7`);
  // 最多的一塊方塊（300 g 水 100 °C）36 塊，1366 寬時方塊 15×3 格放得下
  ok(P.chunkCounts({mat:'水', mass:300, T:100}, {mat:'水', mass:300, T:100})[0] === 36, '能量塊：300 g 水 100 °C 為 36 塊');
}
/* ── 單槽能量塊（D98）：加熱只增不減，多出的塊數對得上火焰送進的熱量 ── */
for (const ma of mats) for (const M of masses){
  const C = M * P.SPEC_HEAT[ma], cap = P.sCapT(C), n = t => P.chunkCount({mat:ma, mass:M, T:20 + P.sDT(C, t)});
  ok(n(0) >= 1, `單槽能量塊：${M}g${ma} 起始 20 °C 至少 1 塊（${n(0)}）`);
  let mono = true;
  for (let t = 0.1; t <= cap + 1e-9; t += 0.1) if (n(t) < n(t - 0.1)) mono = false;
  ok(mono, `單槽能量塊：${M}g${ma} 加熱中塊數只增不減`);
  const added = n(cap) - n(0), heat = P.POWER * cap / P.CHUNK_CAL;
  ok(Math.abs(added - heat) <= 1, `單槽能量塊：${M}g${ma} 多出 ${added} 塊，火焰送進 ${heat.toFixed(2)} 塊的熱量，差距應 ≤ 1`);
}

/* ── 熱脹冷縮（D125、D138）：膨脹量 氣＞液＞固、隨滑桿單調、粒子數不隨滑桿變、孔與方塊同比例 ── */
{
  const R = P.X_RATE;
  ok(R.g > R.l && R.l > R.s && R.s > 0, `熱脹冷縮：最高溫增加率應 氣 ${R.g} ＞ 液 ${R.l} ＞ 固 ${R.s} ＞ 0`);
  for (const ph of ['s', 'l', 'g']){
    ok(P.xRatio(ph, 0) === 0, `熱脹冷縮 ${ph}：低溫時增加率應為 0`);
    ok(near(P.xRatio(ph, 1), R[ph]), `熱脹冷縮 ${ph}：最高溫增加率應為 X_RATE`);
    let mono = true;
    for (let i = 1; i <= 100; i++) if (P.xRatio(ph, i / 100) < P.xRatio(ph, (i - 1) / 100)) mono = false;
    ok(mono, `熱脹冷縮 ${ph}：增加率隨滑桿單調不減`);
  }
  let order = true;
  for (let i = 1; i <= 100; i++){ const lv = i / 100; if (!(P.xRatio('g', lv) > P.xRatio('l', lv) && P.xRatio('l', lv) > P.xRatio('s', lv))) order = false; }
  ok(order, '熱脹冷縮：滑桿任一位置（低溫除外）都應 氣＞液＞固');
  ok(P.xSpeed(0) === P.vT(-20) && P.xSpeed(1) === P.vT(120), '熱脹冷縮：粒子速率範圍應與三態變化頁 −20～120 °C 相同（C53）');
  // 粒子數只由「有沒有挖孔」決定：xLattice 不吃滑桿，升溫只把位置乘同一倍率
  const full = P.xLattice(false), holed = P.xLattice(true);
  ok(full.length === P.X_N * P.X_N, `熱脹冷縮：沒挖孔應 ${P.X_N * P.X_N} 顆（${full.length}）`);
  ok(holed.length === 72, `熱脹冷縮：挖孔後應拿掉中央 9 顆、剩 72 顆（${holed.length}）`);
  // 剩下的粒子連同半徑都在孔外（不壓到孔緣）：距中心 − 粒子半徑 ≥ 孔半徑；位置與孔同乘 k，任何溫度都成立
  const clear = Math.min(...holed.map(q => Math.hypot(q.x, q.y) - 1 / P.X_SP));
  ok(clear >= P.X_HOLE, `熱脹冷縮：最靠近孔的粒子邊緣 ${clear.toFixed(3)} 格應 ≥ 孔半徑 ${P.X_HOLE}`);
  // 孔半徑＝方陣邊長的 1/6，與畫布上方塊的孔（H0／6）同比例
  ok(near(P.X_HOLE / P.X_N, 1 / 6), '熱脹冷縮：孔半徑應為方陣邊長的 1/6，與實體方塊同比例');
}

console.log(`${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
