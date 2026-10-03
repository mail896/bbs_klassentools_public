/** Remove only declarations that an identical later selector always overrides.
 * Never merge across media/supports contexts or rewrite shorthand properties.
 * --fix is explicit; normal checks reject newly accumulated override debris.
 */
import postcss from 'postcss';
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../public/style.css', import.meta.url);
const root = postcss.parse(readFileSync(file, 'utf8'));
let removed = 0;
function clean(parent) {
  const later = new Map();
  for (const node of [...(parent.nodes || [])].reverse()) {
    if (node.type === 'atrule') {
      clean(node);
      continue;
    }
    if (node.type !== 'rule') continue;
    const declarations = later.get(node.selector) || new Map();
    later.set(node.selector, declarations);
    for (const declaration of [...node.nodes].reverse()) {
      if (declaration.type !== 'decl') continue;
      const following = declarations.get(declaration.prop);
      if (following && (!declaration.important || following.important)) {
        declaration.remove();
        removed++;
      } else if (!following || declaration.important)
        declarations.set(declaration.prop, declaration);
    }
    if (!node.nodes.length) node.remove();
  }
}
clean(root);
if (process.argv.includes('--fix')) writeFileSync(file, root.toString());
else if (removed) process.exitCode = 1;
console.log(
  `${removed} superseded CSS declarations${process.argv.includes('--fix') ? ' removed' : ''}`,
);
