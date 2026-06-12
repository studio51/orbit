// Studio51 · js-vanilla: ESLint flat config — the "breathing" house style.
//
// Prettier (.prettierrc.json) owns mechanical formatting (quotes, semicolons,
// width, indentation). It *preserves* author blank lines but never *inserts*
// them, so the breathing layout is enforced here instead — the JS twin of the
// Ruby cop `Studio51/EmptyLineBeforeTrailingExpression` in `rubocop-studio51`.
//
// Self-contained on purpose: zero external imports, so a dependency-free
// js-vanilla repo (no package.json) can run it with just `npx eslint .`.
// Canonical copy lives in studio51/standards and is synced by the standards CLI.

// Whether a statement is "setup" — work that prepares state rather than the
// value a function produces. A run of these stays tight (mirrors the Ruby cop
// leaving an `initialize`/constructor's parallel assignments unseparated).
function isSetup(node) {
  if (!node) return false;
  if (node.type === 'VariableDeclaration') return true;

  return node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression';
}

// Studio51 house rules, defined inline so no plugin needs installing.
const studio51 = {
  meta: { name: 'eslint-plugin-studio51', version: '0.1.0' },
  rules: {
    // Let a multi-statement function breathe: an empty line before its final
    // expression — unless that final line and the one above it are both setup
    // (parallel assignments produce no value to separate). A comment line above
    // already counts as breathing room.
    'empty-line-before-trailing-expression': {
      meta: {
        type: 'layout',
        fixable: 'whitespace',
        schema: [],
        messages: {
          breathe: 'Let the function breathe — add an empty line before its final expression.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        function check(block) {
          const stmts = block.body;

          if (stmts.length < 2) return;

          const last = stmts[stmts.length - 1];
          const prev = stmts[stmts.length - 2];

          if (isSetup(last) && isSetup(prev)) return;

          // Separate only when directly adjacent (gap of one line). A gap of 0
          // means they share a line; a gap of 2+ means a blank line — or a
          // comment, which the Ruby cop counts as breathing — already sits there.
          if (last.loc.start.line - prev.loc.end.line !== 1) return;

          const firstToken = sourceCode.getFirstToken(last);

          context.report({
            node: last,
            messageId: 'breathe',
            fix(fixer) {
              return fixer.insertTextBefore(firstToken, '\n');
            },
          });
        }

        function visit(fn) {
          if (fn.body && fn.body.type === 'BlockStatement') check(fn.body);
        }

        return {
          FunctionDeclaration: visit,
          FunctionExpression: visit,
          ArrowFunctionExpression: visit,
        };
      },
    },
  },
};

export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { studio51 },
    rules: {
      'studio51/empty-line-before-trailing-expression': 'error',

      // Blank line between every class member (matches canvas/engine.js).
      'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: false }],

      // Separate declaration groups from the logic around them.
      'padding-line-between-statements': [
        'error',
        // A run of declarations is one group; blank line before whatever follows…
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        // …but consecutive declarations stay together (author's call).
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        // Blank line before a declaration that follows real logic.
        {
          blankLine: 'always',
          prev: ['expression', 'block-like', 'if', 'for', 'while', 'switch'],
          next: ['const', 'let', 'var'],
        },
      ],
    },
  },
  { ignores: ['legacy/', 'docs/', 'node_modules/'] },
];
