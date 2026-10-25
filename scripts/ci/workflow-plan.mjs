// Reads the pull request gate out of .github/workflows/ci.yml so a local run
// executes the commands the workflow has today, not a second list that drifts.
//
// It evaluates the workflow's own `if:` conditions and `${{ }}` expressions for
// a pull_request event, expands each matrix, and separates the steps a
// developer machine can run from the ones that only make sense on a runner.
// Anything the small evaluator does not understand is an error, never a guess.

import { YAML } from "bun";

const FALSY = new Set([false, 0, "", null, undefined]);

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const space = /^\s+/u.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const string = /^'((?:[^']|'')*)'/u.exec(rest);
    if (string) {
      tokens.push({ type: "value", value: string[1].replaceAll("''", "'") });
      index += string[0].length;
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?/u.exec(rest);
    if (number) {
      tokens.push({ type: "value", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const operator = /^(?:==|!=|&&|\|\||[!(),])/u.exec(rest);
    if (operator) {
      tokens.push({ type: operator[0] });
      index += operator[0].length;
      continue;
    }
    const name = /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*/u.exec(rest);
    if (name) {
      const literals = { true: true, false: false, null: null };
      tokens.push(
        Object.hasOwn(literals, name[0])
          ? { type: "value", value: literals[name[0]] }
          : { type: "name", value: name[0] },
      );
      index += name[0].length;
      continue;
    }
    throw new Error(`Unsupported workflow expression: ${source}`);
  }
  return tokens;
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return value.trim() === "" ? 0 : Number(value);
  return typeof value === "number" ? value : Number.NaN;
}

// GitHub compares loosely: mismatched types are coerced to numbers and strings
// ignore case.
function looselyEqual(left, right) {
  if (typeof left === "string" && typeof right === "string")
    return left.toLowerCase() === right.toLowerCase();
  if (typeof left === typeof right && left !== null && right !== null)
    return left === right;
  if ((left ?? null) === null && (right ?? null) === null) return true;
  return toNumber(left) === toNumber(right);
}

const FUNCTIONS = {
  always: () => true,
  success: () => true,
  fromjson: (value) => JSON.parse(value),
  startswith: (value, prefix) =>
    String(value ?? "")
      .toLowerCase()
      .startsWith(String(prefix ?? "").toLowerCase()),
};

export function evaluateExpression(source, context) {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = (type) => {
    const token = tokens[position];
    if (!token || (type && token.type !== type))
      throw new Error(`Unsupported workflow expression: ${source}`);
    position += 1;
    return token;
  };

  function lookup(path) {
    let value = context;
    for (const key of path.split(".")) {
      if (value === null || typeof value !== "object") return null;
      value = Object.hasOwn(value, key) ? value[key] : null;
    }
    return value ?? null;
  }

  function primary() {
    const token = take();
    if (token.type === "value") return token.value;
    if (token.type === "(") {
      const value = or();
      take(")");
      return value;
    }
    if (token.type === "!") return FALSY.has(primary());
    if (token.type === "name") {
      if (peek()?.type !== "(") return lookup(token.value);
      const implementation = FUNCTIONS[token.value.toLowerCase()];
      if (!implementation)
        throw new Error(
          `Unsupported workflow function ${token.value}() in: ${source}`,
        );
      take("(");
      const args = [];
      while (peek()?.type !== ")") {
        args.push(or());
        if (peek()?.type === ",") take(",");
      }
      take(")");
      return implementation(...args);
    }
    throw new Error(`Unsupported workflow expression: ${source}`);
  }

  function equality() {
    let left = primary();
    while (peek()?.type === "==" || peek()?.type === "!=") {
      const operator = take().type;
      const right = primary();
      left =
        operator === "=="
          ? looselyEqual(left, right)
          : !looselyEqual(left, right);
    }
    return left;
  }

  function and() {
    let left = equality();
    while (peek()?.type === "&&") {
      take();
      const right = equality();
      left = FALSY.has(left) ? left : right;
    }
    return left;
  }

  function or() {
    let left = and();
    while (peek()?.type === "||") {
      take();
      const right = and();
      left = FALSY.has(left) ? right : left;
    }
    return left;
  }

  const value = or();
  if (position !== tokens.length)
    throw new Error(`Unsupported workflow expression: ${source}`);
  return value;
}

function render(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function interpolate(text, context) {
  return String(text).replace(/\$\{\{([\s\S]*?)\}\}/gu, (_, expression) =>
    render(evaluateExpression(expression.trim(), context)),
  );
}

function condition(value, context) {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  const text = String(value).trim();
  const unwrapped = /^\$\{\{([\s\S]*)\}\}$/u.exec(text);
  return !FALSY.has(
    evaluateExpression(unwrapped ? unwrapped[1].trim() : text, context),
  );
}

function matrixInstances(strategy, context) {
  const matrix = strategy?.matrix;
  if (!matrix) return [{}];
  if (typeof matrix !== "object")
    throw new Error("Unsupported workflow matrix.");
  let instances = [{}];
  for (const [key, raw] of Object.entries(matrix)) {
    if (key === "include" || key === "exclude")
      throw new Error("Unsupported workflow matrix: include and exclude.");
    const whole = /^\$\{\{([\s\S]*)\}\}$/u.exec(
      typeof raw === "string" ? raw.trim() : "",
    );
    const values = whole ? evaluateExpression(whole[1].trim(), context) : raw;
    if (!Array.isArray(values) || values.length === 0)
      throw new Error(`Unsupported workflow matrix values for ${key}.`);
    instances = instances.flatMap((instance) =>
      values.map((value) => ({ ...instance, [key]: value })),
    );
  }
  return instances;
}

// Why a step cannot run on a developer machine. Each rule is about what the
// step does, not what it is called, so a renamed step is classified the same.
function runnerOnlyReason(step) {
  if (step.uses) return `runner action (${step.uses.split("@")[0]})`;
  const environment = Object.values(step.env ?? {}).join("\n");
  if (/\bsecrets\./u.test(environment)) return "reads a runner secret";
  if (/\bneeds\./u.test(environment)) return "compares other jobs' results";
  const run = String(step.run ?? "");
  if (/(?:^|[\s;&|(])sudo\s/u.test(run)) return "installs a runner package";
  if (/\bGITHUB_(?:OUTPUT|ENV|PATH|STEP_SUMMARY)\b/u.test(run))
    return "writes runner state";
  if (
    /\bgit\s+(?:-C\s+\S+\s+)?(?:submodule|remote|config|checkout|fetch|reset)\b/u.test(
      run,
    )
  )
    return "rewires the runner's checkout";
  return null;
}

export function pullRequestContext({ baseSha }) {
  return {
    github: {
      event_name: "pull_request",
      base_ref: "development",
      ref: "refs/pull/0/merge",
      event: { pull_request: { draft: false, base: { sha: baseSha } } },
    },
    env: {},
    secrets: {},
    needs: {},
    steps: {},
    inputs: {},
    vars: {},
  };
}

// Returns every step the pull request gate runs, in workflow order, as
// { job, lane, name, run, env } entries, plus the runner-only steps it leaves
// out and why.
export function pullRequestPlan(workflowSource, { baseSha }) {
  const workflow = YAML.parse(workflowSource);
  if (!workflow?.jobs || typeof workflow.jobs !== "object")
    throw new Error("The workflow has no jobs.");
  const base = pullRequestContext({ baseSha });
  const steps = [];
  const skipped = [];
  const jobs = [];

  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (!condition(job.if, base)) continue;
    const instances = matrixInstances(job.strategy, base);
    for (const matrix of instances) {
      const context = {
        ...base,
        matrix,
        strategy: { "job-total": instances.length },
      };
      const label = interpolate(job.name ?? id, context);
      jobs.push({ id, label });
      for (const [index, step] of (job.steps ?? []).entries()) {
        const name = step.name ?? `step ${index + 1}`;
        if (!condition(step.if, context)) continue;
        const reason = runnerOnlyReason(step);
        if (reason) {
          skipped.push({ job: label, lane: id, name, reason });
          continue;
        }
        if (typeof step.run !== "string")
          throw new Error(`Step "${name}" in ${id} has nothing to run.`);
        steps.push({
          job: label,
          lane: id,
          name,
          run: interpolate(step.run, context),
          env: Object.fromEntries(
            Object.entries({ ...workflow.env, ...job.env, ...step.env }).map(
              ([key, value]) => [key, interpolate(value, context)],
            ),
          ),
        });
      }
    }
  }
  if (steps.length === 0)
    throw new Error("The workflow runs no steps for a pull request.");
  return { jobs, steps, skipped };
}

function identity(step) {
  return JSON.stringify([step.run, Object.entries(step.env).sort()]);
}

// A command several jobs repeat (dependency install, the gitlink check) is
// setup: it runs once, first. Everything else stays in its job's lane, in
// workflow order.
export function scheduleSteps(steps) {
  const count = new Map();
  for (const step of steps)
    count.set(identity(step), (count.get(identity(step)) ?? 0) + 1);
  const seen = new Set();
  const setup = [];
  const lanes = new Map();
  for (const step of steps) {
    const key = identity(step);
    if (count.get(key) > 1) {
      if (!seen.has(key)) {
        seen.add(key);
        setup.push({ ...step, job: "setup" });
      }
      continue;
    }
    if (!lanes.has(step.lane)) lanes.set(step.lane, []);
    lanes.get(step.lane).push(step);
  }
  return { setup, lanes: [...lanes.values()] };
}
