// Conservative lexical findings, not mathematical proof or silent source repair.
export function bareSpacingCommands(value) {
  const chars=value.split('');
  // Literal words in text/operator labels are intentional, not TeX commands.
  const text=/\\(?:text|texttt|textrm|textsf|mathrm|operatorname|mbox)\s*\{/g;
  for (const match of value.matchAll(text)) {
    let depth=1, end=match.index+match[0].length;
    for (;end<value.length&&depth;end++) {
      if(value[end]==='\\'){end++;continue;}
      if(value[end]==='{')depth++;
      if(value[end]==='}')depth--;
    }
    for(let i=match.index;i<end;i++)chars[i]=' ';
  }
  const masked=chars.join(''),findings=[];
  for(const m of masked.matchAll(/(?:^|[,;])\s*(qquad|quad)\b/gm)) {
    const offset=m.index+m[0].lastIndexOf(m[1]);
    findings.push({offset,command:m[1],excerpt:value.slice(Math.max(0,offset-24),offset+32)});
  }
  return findings;
}

export function mathNotationFindings(tree) {
  const findings=[];
  function visit(node) {
    if(node.type==='math'||node.type==='inlineMath') for(const issue of bareSpacingCommands(node.value)) findings.push({
      ...issue,line:node.position?.start?.line??null,type:node.type,
      problem:'possible-missing-tex-backslash',
    });
    for(const child of node.children??[])visit(child);
  }
  visit(tree);return findings;
}
