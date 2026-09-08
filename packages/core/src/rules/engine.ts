import { RULES, RULE_SET_VERSION } from "./rules";
import type { EvaluationReport, Rule, RuleContext, RuleResult, Severity } from "./types";
import { worst } from "./types";

/**
 * Runs every rule against the context. Rules that need a compiled cabinet are
 * skipped (not reported) when compilation was impossible; the report says so via
 * `compiled: false` so a reviewer never mistakes a partial check for a full one.
 */
export function runRules(rc: RuleContext, rules: Rule[] = RULES): EvaluationReport {
  const results: RuleResult[] = [];
  for (const rule of rules) {
    if (rule.needsCabinet && !rc.cabinet) continue;
    const out = rule.check(rc);
    if (Array.isArray(out)) results.push(...out);
    else results.push(out);
  }
  let verdict: Severity = "PASS";
  for (const r of results) verdict = worst(verdict, r.severity);
  if (!rc.cabinet) verdict = worst(verdict, "UNSUPPORTED");
  const flags = [...new Set(results.flatMap((r) => r.flags ?? []))].sort();
  return {
    ruleSetVersion: RULE_SET_VERSION,
    verdict,
    compiled: rc.cabinet !== null,
    results,
    unsupported: results.filter((r) => r.severity === "UNSUPPORTED"),
    reviewRequired: results.filter((r) => r.severity === "REVIEW_REQUIRED"),
    flags,
  };
}

/** Rules that can be evaluated before compiling; if any is UNSUPPORTED, compilation is skipped. */
export function preCompileRules(rules: Rule[] = RULES): Rule[] {
  return rules.filter((r) => !r.needsCabinet && (r.category === "configuration" || r.category === "purpose" || r.category === "catalog"));
}
