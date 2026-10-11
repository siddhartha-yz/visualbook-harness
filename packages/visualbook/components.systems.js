/* Reusable small witnesses; inputs and outputs come from the canonical kernels. */
(function(global){
  const V=global.VisualBook,P=V.palette,fmt=V.formatNumber;
  const compute=(operation,input)=>global.VisualBookCalculations.compute(operation,input).result;
  function rotaryPlane(board,{q=[1,0,.8,.6],k=[.8,.6,1,0],m=0,n=2,base=10000,shift=0,pairIndex=0}={}){
    const result=compute("rotary-pairs",{q,k,m,n,base,shift});
    if(!Number.isInteger(pairIndex)||pairIndex<0||pairIndex>=result.pairs.length)throw Error("Choose an actual RoPE pair");
    const pair=result.pairs[pairIndex],radius=Math.max(pair.qNorm,pair.kNorm,.1)*1.3;
    const f=V.plotFrame(board,"plane",{xDomain:[-radius,radius],yDomain:[-radius,radius],equalUnits:true,grid:false,title:"二维对 "+(pairIndex+1),xTicks:3,yTicks:3});
    board.line("ghost-q",f.x(0),f.y(0),f.x(pair.q[0]),f.y(pair.q[1]),P.faint,2);
    board.line("ghost-k",f.x(0),f.y(0),f.x(pair.k[0]),f.y(pair.k[1]),P.faint,2);
    board.vector("q",f,[0,0],pair.rotatedQ,{color:P.blue});
    board.vector("k",f,[0,0],pair.rotatedK,{color:P.orange});
    board.text("q-key","q",board.width-60,25,{color:P.blue,size:13});
    board.text("k-key","k",board.width-30,25,{color:P.orange,size:13});
    return {...result,pairIndex,selected:pair};
  }
  function rooflineTimes(board,{flops=1e12,bytes=3.35e9,computeTFLOPS=989,memoryGBPS=3350,progress=1}={}){
    const result=compute("roofline",{flops,bytes,computeTFLOPS,memoryGBPS});
    if(board.height<200||board.width<160)throw Error("Roofline witness needs 160×200 space");
    const left=18,right=board.width-18,w=right-left;
    const rows=[{label:"计算",ms:result.computeMs,color:P.blue},{label:"搬运",ms:result.transferMs,color:P.orange}];
    rows.forEach((row,i)=>{const y=40+i*78;board.text("label-"+i,row.label,left,y,{size:13,color:P.muted});board.text("time-"+i,fmt(row.ms)+" ms",right,y,{size:14,anchor:"end",color:row.color});board.rect("base-"+i,left,y+14,w,9,P.faint);board.rect("bar-"+i,left,y+14,w*row.ms/result.idealMs,9,row.color,{rx:4});});
    board.text("bound",result.bound==="memory"?"搬运是更慢的一边":"计算是更慢的一边",left,board.height-20,{size:13,color:P.ink});
    return result;
  }
  function cacheBudget(board,{layers=32,batch=1,tokens=2048,queryHeads=32,kvHeads=8,headDim=128,bytesPerElement=2}={}){
    const result=compute("cache-footprint",{layers,batch,tokens,queryHeads,kvHeads,headDim,bytesPerElement});
    if(board.height<220||board.width<180)throw Error("Cache witness needs 180×220 space");
    const x=18,w=board.width-36,ratio=result.totalBytes/result.baselineBytes;
    for(const [i,label]of ["每个 Q 头各存一份","共享 KV 头"].entries()){
      const y=34+i*82,bar=w*(i?ratio:1);
      board.text("label-"+i,label,x,y,{size:13,color:P.muted});
      board.rect("k-"+i,x,y+17,bar/2,20,P.blue,{rx:3});board.rect("v-"+i,x+bar/2,y+17,bar/2,20,P.orange,{rx:3});
      board.text("bytes-"+i,fmt((i?result.totalBytes:result.baselineBytes)/2**20)+" MiB",x,y+60,{size:15});
    }
    board.text("k-key","K",x,board.height-20,{size:13,color:P.blue});board.text("v-key","V",x+30,board.height-20,{size:13,color:P.orange});
    board.text("group",result.queryHeadsPerKV+" Q / KV",board.width-18,board.height-20,{size:13,anchor:"end",color:P.muted});
    return result;
  }
  function collectiveView(board,{input=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]],kind="allreduce",root=0,progress=1}={}){
    const result=compute("collective",{input,kind,root});
    if(result.ranks>4||Math.max(result.inputWidth,result.outputWidth)>8)throw Error("Drawn collective supports 2..4 ranks and at most 8 cells per row; use numeric operation for larger inputs");
    const stacked=board.width<650,boxes=board.layout(2,{kind:stacked?"stack":"columns",gap:stacked?28:70,minColumnWidth:240}),phase=V.clamp(progress,0,1);
    if(stacked&&board.height<380)throw Error("Narrow collective needs at least 380px height");
    if(!stacked&&board.height<220)throw Error("Collective needs 220px height");
    [result.input,result.output].forEach((matrix,j)=>board.region("side-"+j,boxes[j],b=>{
      const names=["各设备原有","操作之后"],x=42,w=b.width-54,cw=w/matrix[0].length,rh=(b.height-48)/matrix.length;
      if(cw<25||rh<29)throw Error("Collective cells need more space or fewer values");
      b.text("title",names[j],12,20,{size:13,color:P.muted});
      matrix.forEach((row,r)=>{const y=42+r*rh;b.text("rank-"+r,"D"+r,12,y+rh*.6,{size:12,color:P.muted});row.forEach((value,c)=>{const colors=[P.blue,P.orange,P.green,P.violet],color=j&&kind==="broadcast"?colors[root]:j&&kind==="alltoall"?colors[Math.floor(c/(result.inputWidth/result.ranks))]:j&&kind!=="allgather"?P.orange:colors[j?Math.floor(c/result.inputWidth):r];b.rect("cell-"+r+"-"+c,x+c*cw,y,cw-3,rh-5,color,{opacity:.14,rx:3});const fitted=V.fitNumber(value,{maxWidth:cw-8,size:14});b.text("value-"+r+"-"+c,fitted.text,x+(c+.5)*cw,y+rh*.6,{size:fitted.size,anchor:"middle",color:P.ink});});});
    }));
    const a=boxes[0],b=boxes[1],from=stacked?[board.width/2,a.y+a.height+6]:[a.x+a.width+10,board.height/2],to=stacked?[board.width/2,b.y-6]:[b.x-10,board.height/2];
    board.line("connection",...from,...to,P.faint,2);board.circle("payload",from[0]+(to[0]-from[0])*phase,from[1]+(to[1]-from[1])*phase,5,P.orange);
    return {...result,displayProgress:phase};
  }
  Object.assign(V.components,{"rotary-plane":rotaryPlane,"roofline-times":rooflineTimes,"cache-budget":cacheBudget,"collective-view":collectiveView});
})(window);
