import path from 'node:path';
import ts from 'typescript';

const layer = (file) =>
  file.startsWith('ui/app/') ? 'browser' : file === 'src/cli.ts' ? 'entry' : file.split('/')[1];

const allowed = {
  shared: ['shared', 'contracts'],
  contracts: ['contracts'],
  core: ['core', 'shared', 'contracts', 'adapters', 'integrations'],
  adapters: ['adapters', 'shared', 'contracts', 'core'],
  integrations: ['integrations', 'shared', 'contracts', 'core'],
  commands: ['commands', 'shared', 'contracts', 'core', 'adapters'],
  mcp: ['mcp', 'shared', 'contracts', 'core'],
  ui: ['ui', 'shared', 'contracts', 'core', 'adapters'],
  workers: ['workers', 'shared', 'contracts', 'core'],
  entry: ['commands', 'mcp', 'shared', 'contracts', 'core'],
  browser: ['browser'],
};

function inspectBrowserBoundary(file, target, issues) {
  const browserLayer = (name) => (name === 'ui/app/app.js' ? 'app' : name.split('/')[2]);
  const levels = { app: 4, pages: 3, features: 2, entities: 1, shared: 0 };
  const from = browserLayer(file),
    to = browserLayer(target);
  if (!(from in levels) || !(to in levels)) {
    issues.push(`Unknown browser layer: ${file} → ${target}`);
    return;
  }
  const slice = (name) => name.split('/')[3]?.replace(/\.js$/, '');
  if (
    levels[to] > levels[from] ||
    (from === to && from !== 'shared' && slice(file) !== slice(target))
  )
    issues.push(`Forbidden browser dependency: ${file} → ${target}`);
}

function importKind(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return 'type';
    if (
      !clause?.name &&
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length &&
      clause.namedBindings.elements.every((item) => item.isTypeOnly)
    )
      return 'type';
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return 'type';
    if (
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length &&
      node.exportClause.elements.every((item) => item.isTypeOnly)
    )
      return 'type';
  }
  return ts.isImportTypeNode(node) ? 'type' : 'runtime';
}

function imports(file, text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    let literal;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      literal = node.moduleSpecifier;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      literal = node.arguments[0];
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      literal = node.argument.literal;
    if (literal && ts.isStringLiteral(literal))
      result.push({ specifier: literal.text, kind: importKind(node) });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

function resolve(file, specifier, modules) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return [target.replace(/\.js$/, '.ts'), target, `${target}/index.ts`].find((candidate) =>
    modules.has(candidate),
  );
}

function cycles(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const result = [];
  function visit(file) {
    if (active.has(file)) {
      result.push([...stack.slice(stack.indexOf(file)), file]);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    active.add(file);
    stack.push(file);
    for (const next of graph.get(file) ?? []) visit(next);
    stack.pop();
    active.delete(file);
  }
  for (const file of graph.keys()) visit(file);
  return result;
}

/** Inspect source imports, including nested paths, re-exports and literal dynamic imports. */
export function inspectArchitecture(modules) {
  const issues = [];
  const graph = new Map([...modules.keys()].map((file) => [file, []]));
  let edges = 0;
  for (const [file, text] of modules) {
    const from = layer(file);
    if (!allowed[from]) issues.push(`Unknown source layer: ${file}`);
    for (const { specifier, kind } of imports(file, text)) {
      if (!specifier.startsWith('.')) {
        if (from === 'browser') issues.push(`Browser module must use local imports: ${file}`);
        continue;
      }
      const target = resolve(file, specifier, modules);
      if (!target) {
        issues.push(`Unresolved import: ${file} → ${specifier}`);
        continue;
      }
      const to = layer(target);
      if (from === 'browser' && to === 'browser') inspectBrowserBoundary(file, target, issues);
      const uiEntry = file === 'src/commands/ui.ts' && to === 'ui';
      if (!uiEntry && !allowed[from]?.includes(to))
        issues.push(`Forbidden dependency: ${file} → ${target}`);
      if (from === 'adapters' && to === 'core' && !/^src\/core\/(configuration|mcp)\//.test(target))
        issues.push(`Client adapter must not call unrelated workflows: ${file} → ${target}`);
      if (from === 'core' && /^src\/shared\/(output|prompt)\.ts$/.test(target))
        issues.push(`Core must not present CLI output or prompts: ${file} → ${target}`);
      edges++;
      if (kind === 'runtime') graph.get(file).push(target);
    }
  }
  for (const cycle of cycles(graph)) issues.push(`Runtime import cycle: ${cycle.join(' → ')}`);
  return { modules: modules.size, edges, issues };
}
