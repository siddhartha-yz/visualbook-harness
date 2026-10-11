/* Inspect an actual source anchor and formula accessibility; never rewrite it. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { workspaceRoot } from "./visualbook_workspace.mjs";

export async function inspectReader(file, out, { anchor, width = 375 }) {
  const root = path.resolve(import.meta.dirname, ".."), owner = workspaceRoot(root);
  out = path.resolve(out); file = path.resolve(file);
  if (!/^[a-z][a-z0-9-]*$/.test(anchor ?? "") || ![375,1280,1920].includes(width))
    throw Error("Use one actual source anchor and width 375/1280/1920");
  const work = fs.realpathSync(owner + "/work"), parent = fs.realpathSync(path.dirname(out));
  if (fs.existsSync(out) || parent !== work && !parent.startsWith(work + path.sep))
    throw Error("Use a fresh ignored work/ output");
  fs.mkdirSync(out);
  const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  const report = { status:"running", modelCalls:0, anchor, width, htmlSha256:sha(fs.readFileSync(file)),
    formulas:[], screenshots:[], findings:[],
    scope:"Actual source-anchor PNG and native Home/End formula scrolling at one width. TeX content is recorded, not mathematically certified; no candidate, plan or source rewrite." };
  let browser;
  try {
    const { chromium } = await import(pathToFileURL(root + "/work/visualbook/runtime/node_modules/playwright-core/index.mjs"));
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??chromium.executablePath()});
    report.browserVersion=browser.version();
    const page = await browser.newPage({viewport:{width,height:950}}), requests=[];
    page.on("request", r => {if(/^https?:/.test(r.url())) requests.push(r.url());});
    await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>document.fonts.status==='loaded',{},{timeout:20000,polling:100});
    const source=page.locator(".source-block#"+anchor);
    if(await source.count()!==1) throw Error("Source anchor was not found exactly once");
    await source.scrollIntoViewIfNeeded();
    const box=await source.boundingBox();
    const overview=out+"/source.png";
    if(box.height<=3000) await source.screenshot({path:overview});
    else {await page.screenshot({path:overview});report.contextOnly=true;}
    report.screenshots.push(overview);
    const math=source.locator(".katex-display,.katex:not(.katex-display>.katex)");
    report.totalFormulas=await math.count();
    for(let index=0;index<Math.min(4,report.totalFormulas);index++) {
      const node=math.nth(index);
      const data=await node.evaluate(n=>({tex:n.querySelector("annotation")?.textContent??null,
        client:n.clientWidth,scroll:n.scrollWidth,focusable:n.classList.contains("vh-math-scroll"),
        baseTops:[...n.querySelectorAll(".katex-html>.katex-base,.katex-html>.base")].map(b=>b.getBoundingClientRect().top)}));
      data.index=index;
      const initial=out+`/math-${index}-home.png`;
      if(data.scroll>data.client+2) {
        if(!data.focusable) report.findings.push({index,kind:"long-formula-not-keyboard-accessible"});
        else {
          await node.focus();await page.keyboard.press("Home");
          data.home=await node.evaluate(n=>n.scrollLeft);await node.screenshot({path:initial});report.screenshots.push(initial);
          await page.keyboard.press("End");
          data.end=await node.evaluate(n=>n.scrollLeft);data.maximum=data.scroll-data.client;
          const end=out+`/math-${index}-end.png`;await node.screenshot({path:end});report.screenshots.push(end);
          if(data.end<1 || Math.abs(data.end-data.maximum)>2) report.findings.push({index,kind:"formula-end-not-reachable"});
          await page.keyboard.press("Home");
        }
      } else {await node.screenshot({path:initial});report.screenshots.push(initial);}
      report.formulas.push(data);
    }
    report.sampledFormulas=report.formulas.length;
    if(requests.length)report.findings.push({kind:"external-request",count:requests.length});
    if(report.htmlSha256!==sha(fs.readFileSync(file)))report.findings.push({kind:"candidate-changed-during-inspection"});
    report.status=report.findings.length?"failed":"completed";
  } catch(error){report.status="failed";report.findings.push({kind:"reader-inspection-error",error:String(error)});}
  finally{if(browser)await browser.close();fs.writeFileSync(out+"/report.json",JSON.stringify(report,null,2)+"\n");}
  return report;
}
if(process.argv[1]===import.meta.filename){const [file,out,options]=process.argv.slice(2);
  const report=await inspectReader(file,out,JSON.parse(options));
  console.log(JSON.stringify(report));if(report.status!=="completed")process.exitCode=1;
}
