/* Algebra marks reuse exact calculations. Abstract witnesses stay explicitly labelled. */
(function (global) {
  const V = global.VisualBook, A = global.VisualBookAlgebra, P = V.palette;
  const short = (s, max=32) => { if (typeof s !== 'string' || s.length>max) throw Error('Use a short drawing label'); return s; };
  const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
  const pair = v => { if (!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite)) throw Error('Finite 2D vector required'); return v; };
  const subscript = i => String(i).replace(/\d/g,n=>'₀₁₂₃₄₅₆₇₈₉'[Number(n)]);
  function clippedCurve(board,id,frame,points,options) {
    const a=points[0],b=points[1],xd=frame.x.domain(),yd=frame.y.domain();let low=0,high=1;
    for(let i=0;i<2;i++) {
      const delta=b[i]-a[i],range=i===0?xd:yd;
      if(Math.abs(delta)<1e-14) {if(a[i]<range[0]||a[i]>range[1])return null;}
      else {const ts=[(range[0]-a[i])/delta,(range[1]-a[i])/delta].sort((x,y)=>x-y);low=Math.max(low,ts[0]);high=Math.min(high,ts[1]);}
    }
    if(high<low)return null;
    return board.curve(id,frame,[a.map((x,i)=>x+(b[i]-x)*low),a.map((x,i)=>x+(b[i]-x)*high)],options);
  }
  function fraction(board,id,value,x,y,{size=16,color=P.ink,maxWidth=60}={}) {
    const s=String(value),parts=s.split('/');
    if (!/^-?\d+(?:\/\d+)?$/.test(s)) throw Error('Exact matrix needs rational strings');
    if (parts.some(p=>V.measure(p,size)>maxWidth)) throw Error('Fraction needs more cell space; shorten the example');
    if (parts.length===1) board.text(id,s,x,y+size*.35,{size,color,anchor:'middle',halo:false});
    else {
      board.text(id+'-numerator',parts[0],x,y-3,{size:Math.max(12,size-2),color,anchor:'middle',halo:false});
      board.text(id+'-denominator',parts[1],x,y+size+1,{size:Math.max(12,size-2),color,anchor:'middle',halo:false});
      const w=Math.max(...parts.map(p=>V.measure(p,Math.max(12,size-2))))+6;
      board.line(id+'-bar',x-w/2,y+1,x+w/2,y+1,color,1);
    }
  }
  function operationLabel(op) {
    if (!op || op.kind==='initial') return '原方程组';
    const row='R'+subscript(op.row+1),source='R'+subscript((op.source??0)+1);
    if(op.kind==='swap')return row+' ↔ '+source;
    if(op.kind==='scale')return row+' ← ('+op.factorExact+')'+row;
    return row+' ← '+row+(op.factor<0?' − ':' + ')+String(op.factorExact).replace(/^-/,'')+source;
  }
  function exactMatrix(board,{data,coefficientColumns,operation=null,pivotColumns=[],title=''}={}) {
    if(!Array.isArray(data)||!data.length||data.length>6||!Array.isArray(data[0])||!data[0].length||data[0].length>8||data.some(row=>!Array.isArray(row)||row.length!==data[0].length))throw Error('Exact drawing matrix must be 1..6 by 1..8');
    data=data.map(row=>A.coefficientLiterals(row).values);
    const rows=data.length,cols=data[0].length,n=coefficientColumns??cols;
    if(!Number.isInteger(n)||n<1||n>cols||!Array.isArray(pivotColumns)||pivotColumns.some(j=>!Number.isInteger(j)||j<0||j>=n))throw Error('Invalid coefficient/pivot columns');
    short(title); const top=title?58:36,left=26,right=board.width-26,bottom=board.height-23,cw=(right-left)/cols,rh=(bottom-top)/rows;
    if(cw<30||rh<44)throw Error('Keep exact fractions at least 12px; matrix needs more space');
    if(title)board.text('title',title,18,19,{size:14,halo:false});
    if(operation)board.label('operation',operationLabel(operation),18,title?41:18,{size:13,maxWidth:board.width-36,avoid:false,color:P.blue});
    for(let i=0;i<rows;i++)for(let j=0;j<cols;j++) {
      const focus=operation&&operation.kind!=='initial'&&operation.row===i, source=operation&&operation.kind==='add'&&operation.source===i;
      board.rect(`cell-${i}-${j}`,left+j*cw+2,top+i*rh+2,cw-4,rh-4,focus?P.blue:source?P.orange:P.faint,{opacity:(focus || source) ? .12 : .24,rx:5});
      const zero=String(data[i][j])==='0',pivot=pivotColumns.includes(j)&&i===pivotColumns.indexOf(j);
      fraction(board,`value-${i}-${j}`,data[i][j],left+(j+.5)*cw,top+(i+.5)*rh,{size:16,color:pivot?P.green:zero?P.muted:P.ink,maxWidth:cw-10});
      if(pivot)board.line(`pivot-${i}-${j}`,left+j*cw+9,top+(i+1)*rh-8,left+(j+1)*cw-9,top+(i+1)*rh-8,P.green,2);
    }
    for(const x of [left-8,right+8])board.path('bracket-'+x,[[x+(x<left?5:-5),top],[x,top],[x,bottom],[x+(x<left?5:-5),bottom]],{color:P.muted,width:1.6});
    if(n<cols)board.line('rhs-separator',left+n*cw,top-2,left+n*cw,bottom+2,P.orange,1.2,.8);
    return {data,coefficientColumns:n,operation,pivotColumns,convention:'Exact entries, elementary-operation provenance and an explicit RHS separator. Pivot marks must be supplied for the displayed stage.'};
  }
  function basisFrame(board,{basis=[[1,0],[0,1]],vector=[2,1],progress=1,xDomain=[-3,4],yDomain=[-2,3],gridExtent=3,title='',labels=['b₁','b₂']}={}) {
    pair(vector);short(title);if(!Array.isArray(labels)||labels.length!==2)throw Error('Two basis labels required');labels.forEach(s=>short(s,12));
    const facts=A.changeBasis({sourceBasis:[[1,0],[0,1]],targetBasis:basis,vector});
    if(facts.targetBasis.length!==2||!Number.isInteger(gridExtent)||gridExtent<1||gridExtent>6)throw Error('Basis drawing is 2D; grid extent 1..6');
    if(!Number.isFinite(progress)||progress<0||progress>1)throw Error('Construction progress must be 0..1');
    const b=facts.targetBasis,c=facts.targetCoordinates,u=[b[0][0],b[1][0]],v=[b[0][1],b[1][1]];
    const f=V.plotFrame(board,'axes',{title:title||null,xDomain,yDomain,equalUnits:true,grid:false,footerHeight:31});
    for(let k=-gridExtent;k<=gridExtent;k++) {
      clippedCurve(board,'grid-u-'+k,f,[[-gridExtent*u[0]+k*v[0],-gridExtent*u[1]+k*v[1]],[gridExtent*u[0]+k*v[0],gridExtent*u[1]+k*v[1]]],{color:P.blue,width:1,opacity:.13});
      clippedCurve(board,'grid-v-'+k,f,[[k*u[0]-gridExtent*v[0],k*u[1]-gridExtent*v[1]],[k*u[0]+gridExtent*v[0],k*u[1]+gridExtent*v[1]]],{color:P.violet,width:1,opacity:.13});
    }
    board.vector('basis-u',f,[0,0],u,{color:P.blue,label:labels[0]});board.vector('basis-v',f,[0,0],v,{color:P.violet,label:labels[1]});
    const a=u.map(x=>x*c[0]), first=Math.min(1,progress*2),second=Math.max(0,progress*2-1);
    if(first>0)board.vector('component-u',f,[0,0],a.map(x=>x*first),{color:P.blue});
    if(second>0)board.vector('component-v',f,a,a.map((x,i)=>x+second*c[1]*v[i]),{color:P.violet});
    board.vector('physical-vector',f,[0,0],vector,{color:P.gold,label:'x'});
    const text='坐标 ('+facts.targetCoordinatesExact.join(', ')+')';
    board.label('coordinates',text,board.width/2,board.height-11,{size:14,anchor:'middle',maxWidth:board.width-32,avoid:false});
    return {...facts,constructionProgress:progress,convention:'Two-dimensional column basis. The gold physical vector stays fixed; progress reveals its two basis contributions and does not interpolate through potentially singular bases.'};
  }
  function residueGrid(board,{modulus=5,operation='multiply',title=''}={}) {
    const facts=A.modularTable({modulus,operation});short(title);
    const top=title?53:28,left=30,right=board.width-12,bottom=board.height-35,cw=(right-left)/modulus,rh=(bottom-top)/modulus;
    if(cw<23||rh<23)throw Error('Residue table needs 23px cells and 12px type; use a smaller modulus or wider region');
    if(title)board.text('title',title,14,18,{size:14,halo:false});
    for(let i=0;i<modulus;i++) {
      const unit=facts.units.includes(i),zero=facts.zeroDivisors.includes(i);
      board.text('row-'+i,String(i),left-12,top+(i+.5)*rh+4,{size:12,anchor:'end',color:zero?P.orange:unit?P.blue:P.muted,halo:false});
      board.text('col-'+i,String(i),left+(i+.5)*cw,top-9,{size:12,anchor:'middle',color:zero?P.orange:unit?P.blue:P.muted,halo:false});
      for(let j=0;j<modulus;j++) {
        const value=facts.data[i][j],witness=operation==='multiply'&&i>0&&j>0&&value===0;
        board.rect(`cell-${i}-${j}`,left+j*cw+1,top+i*rh+1,cw-2,rh-2,witness?P.orange:value===0?P.faint:P.blue,{opacity:witness?.25:value===0?.25:.04+.22*value/(modulus-1),rx:3});
        board.text(`value-${i}-${j}`,String(value),left+(j+.5)*cw,top+(i+.5)*rh+4,{size:12,anchor:'middle',color:witness?P.orange:P.ink,halo:false});
      }
    }
    const note=operation==='multiply'?(facts.isField?'非零元素都有乘法逆元':'橙色：两个非零元素相乘得到 0'):'逐行循环，运算后取余';
    board.label('note',note,board.width/2,board.height-11,{size:12,anchor:'middle',maxWidth:board.width-20,avoid:false,color:facts.isField?P.blue:P.orange});
    return facts;
  }
  function jordanChains(board,{input,selectedPower=1,title=''}={}) {
    const facts=A.jordanProfile({input}),n=facts.input.length;short(title);
    if(!Number.isInteger(selectedPower)||selectedPower<0||selectedPower>n)throw Error('Power must be integer 0..dimension');
    const blocks=facts.blockSizes,top=title?48:24,bottom=board.height-35,rh=(bottom-top)/blocks.length,left=48,right=board.width-30;
    if(rh<58||(right-left)/Math.max(...blocks)<42)throw Error('Jordan chains need more space for their basis marks');
    if(title)board.text('title',title,14,18,{size:14,halo:false});
    blocks.forEach((size,row)=>{
      const y=top+(row+.5)*rh,cw=(right-left)/Math.max(...blocks),xs=Array.from({length:size},(_,j)=>left+(j+.5)*cw);
      board.text('block-label-'+row,'J'+subscript(size),14,y+4,{size:13,color:P.muted,halo:false});
      for(let j=0;j<size;j++) {
        const survives=j>=selectedPower;
        board.circle(`node-${row}-${j}`,xs[j],y,15,survives?P.blue:P.faint);
        board.text(`name-${row}-${j}`,'e'+subscript(j+1),xs[j],y+4,{size:12,anchor:'middle',color:survives?P.paper:P.muted,halo:false});
        if(selectedPower>0&&survives) {
          const target=xs[j-selectedPower],arc=Math.min(22,rh*.32);
          board.path(`arrow-${row}-${j}`,[[xs[j],y-18],[xs[j],y-arc],[target,y-arc],[target,y-18]],{color:P.blue,width:1.7});
          board.path(`head-${row}-${j}`,[[target-4,y-24],[target,y-18],[target+4,y-24]],{color:P.blue,width:1.7});
        }
        if(!survives)board.text(`zero-${row}-${j}`,'→ 0',xs[j],y+31,{size:12,anchor:'middle',color:P.muted,halo:false});
      }
    });
    const footer='N'+(selectedPower===1?'':superscript(selectedPower))+'：秩 '+facts.ranks[selectedPower]+'，核维数 '+facts.nullities[selectedPower];
    board.label('summary',footer,board.width/2,board.height-10,{size:13,anchor:'middle',maxWidth:board.width-24,avoid:false});
    return {...facts,selectedPower,selectedRank:facts.ranks[selectedPower],selectedNullity:facts.nullities[selectedPower],convention:'Canonical chain-size illustration inferred from exact nullities. e labels are illustrative Jordan coordinates; this tool has not constructed a Jordan basis for the supplied matrix.'};
  }
  function superscript(n) {return String(n).replace(/\d/g,c=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]);}
  function coefficientStrip(board,{coefficients,title='',color='blue'}={}) {
    if(!Array.isArray(coefficients)||coefficients.length<1||coefficients.length>13||!Object.hasOwn(P,color))throw Error('Use 1..13 exact coefficients and a palette color');short(title);
    const n=coefficients.length,available=board.width-24,columns=Math.min(n,Math.floor(available/54)),rows=Math.ceil(n/columns),top=title?34:12,rh=(board.height-top-8)/rows,cw=available/columns;
    if(columns<1||rh<65)throw Error('Coefficient strip needs at least 54×65px cells');
    if(title)board.text('title',title,12,17,{size:13,halo:false});
    const normalized=A.coefficientLiterals(coefficients);
    normalized.values.forEach((value,i)=>{
      const x=12+(i%columns)*cw,y=top+Math.floor(i/columns)*rh;
      board.rect('cell-'+i,x+2,y+1,cw-4,rh-4,P[color],{opacity:String(value)==='0'?.04:.12,rx:5});
      fraction(board,'value-'+i,value,x+cw/2,y+rh*.36,{size:15,color:String(value)==='0'?P.muted:P[color],maxWidth:cw-10});
      board.text('power-'+i,i===0?'1':i===1?'x':'x'+superscript(i),x+cw/2,y+rh-13,{size:12,anchor:'middle',color:P.muted,halo:false});
    });
    return {coefficients:normalized.values,degree:normalized.degree,convention:'Coefficient identities, lowest power first; this strip does not find roots or establish irreducibility.'};
  }
  function quotientPlane(board,{direction=[1,1],vector=[2,1],progress=1,xDomain=[-3,4],yDomain=[-3,4],coordinateScale=1,coordinateLabel='商空间坐标',title=''}={}) {
    pair(direction);pair(vector);short(title);if(!Number.isFinite(progress)||progress<0||progress>1)throw Error('Coset motion progress 0..1');
    short(coordinateLabel,16);if(!Number.isFinite(coordinateScale)||coordinateScale<=0)throw Error('Positive finite coordinate scale required');
    const length=Math.hypot(...direction);if(length<1e-10)throw Error('Nonzero quotient direction required');
    const u=direction.map(x=>x/length),normal=[-u[1],u[0]],coordinate=dot(vector,normal),representative=normal.map(x=>x*coordinate),current=vector.map((x,i)=>x+(representative[i]-x)*progress);
    const f=V.plotFrame(board,'axes',{title:title||null,xDomain,yDomain,equalUnits:true,grid:false,footerHeight:26});
    const extent=4*Math.max(...xDomain.map(Math.abs),...yDomain.map(Math.abs));
    for(let k=-3;k<=3;k++)clippedCurve(board,'coset-'+k,f,[[normal[0]*k-u[0]*extent,normal[1]*k-u[1]*extent],[normal[0]*k+u[0]*extent,normal[1]*k+u[1]*extent]],{color:k===0?P.violet:P.faint,width:k===0?2:1});
    clippedCurve(board,'selected-coset',f,[[representative[0]-u[0]*extent,representative[1]-u[1]*extent],[representative[0]+u[0]*extent,representative[1]+u[1]*extent]],{color:P.orange,width:2});
    clippedCurve(board,'representative-axis',f,[normal.map(x=>x*-extent),normal.map(x=>x*extent)],{color:P.blue,width:1.5,opacity:.6});
    board.circle('original',f.x(vector[0]),f.y(vector[1]),4,P.muted);
    board.circle('representative',f.x(representative[0]),f.y(representative[1]),5,P.blue);
    board.mark('moving-ring','circle',{cx:f.x(current[0]),cy:f.y(current[1]),r:8,fill:'none',stroke:P.orange,'stroke-width':2});
    if(Math.hypot(current[0]-representative[0],current[1]-representative[1])>1e-8)board.circle('moving-center',f.x(current[0]),f.y(current[1]),4,P.orange);
    board.label('quotient-coordinate',coordinateLabel+' '+V.formatNumber(coordinate*coordinateScale),board.width/2,board.height-10,{size:13,anchor:'middle',maxWidth:board.width-24,avoid:false});
    return {direction,vector,coordinate,displayCoordinate:coordinate*coordinateScale,coordinateScale,coordinateLabel,representative,current,convention:'R²/span(direction); parallel lines are equivalence classes. Orthogonal representatives are a chosen Euclidean model, not intrinsic to every quotient space. Progress moves within one class and leaves its quotient coordinate unchanged.'};
  }
  Object.assign(V.components,{'exact-matrix':exactMatrix,'basis-frame':basisFrame,'residue-grid':residueGrid,'jordan-chains':jordanChains,'coefficient-strip':coefficientStrip,'quotient-plane':quotientPlane});
})(window);
