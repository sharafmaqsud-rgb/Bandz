// The compact plain-text summary you can paste into a Claude chat when you want judgement.
// The app itself never calls a model. It holds totals and merchant names, and leaves out
// account numbers, pension provider names and full statement descriptions.
import { inMonth, leftOver, monthGaps, netWorth, savingsRate, summarise } from './analysis.js';
import { bufferStatus, buildInsights, isaStatus } from './insights.js';
import { formatPence as money } from './money.js';

export function monthlySummary(state, ym) {
  const s = summarise(inMonth(state, ym), state.categories);
  const nw = netWorth(state);
  const isa = isaStatus(state, ym);
  const buffer = bufferStatus(state, ym);
  const rate = savingsRate(s);
  const goal = (value, text) => (value === null || value === undefined ? 'not set' : text);
  const lines = [
    `MONTHLY SUMMARY ${ym} (c = calculated, e = estimate)`,
    `Income ${money(s.income)}, spent ${money(s.spend)}, saved ${money(s.saved)}, left over ${money(leftOver(s))} (c)`,
    `Savings rate ${rate === null ? 'n/a' : `${Math.round(rate * 100)}%`}, target ${goal(state.goals.savingsRateTarget, `${Math.round(state.goals.savingsRateTarget * 100)}%`)} (c)`,
    `Net worth ${money(nw.total)}: cash ${money(nw.groups.cash)}, investments ${money(nw.groups.investments)}, pension ${money(nw.groups.pension)}, cards ${money(nw.groups.cards)} (c)`,
    `Cash buffer ${buffer.months === null ? 'n/a' : `${buffer.months.toFixed(1)} months`} of ${money(buffer.essentials)} essentials, target ${goal(buffer.target, `${buffer.target} months`)} (c)`,
    `ISA ${isa.label}: ${money(isa.paid)} of ${money(isa.allowance)}, ${isa.monthsLeft} months left, monthly target ${goal(isa.target, money(isa.target ?? 0))} (c)`,
  ];
  const gaps = monthGaps(state, ym);
  if (gaps.length) lines.push(`Incomplete month: ${gaps.map((g) => `${g.name} ${g.through ? `to ${g.through}` : 'missing'}`).join(', ')}`);
  if (isa.startsLate) lines.push(`ISA total only counts statements from ${isa.startsLate}.`);
  lines.push('', 'SPENDING BY CATEGORY (c)');
  for (const [name, pence] of Object.entries(s.spendByCat).sort((a, b) => b[1] - a[1])) lines.push(`${name} ${money(pence)}`);
  lines.push('', 'RULE-BASED FLAGS');
  for (const insight of buildInsights(state, ym)) {
    const mark = insight.label === 'estimate' ? 'e' : 'c';
    lines.push(`${insight.title} (${mark}): ${insight.detail}`);
    for (const item of insight.items) lines.push(`- ${item}`);
  }
  return lines.join('\n');
}
