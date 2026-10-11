/* Small mathematical witnesses for positions, memory and collective semantics. */
(function(global){
  const finite=(v,name)=>{if(!Number.isFinite(v))throw Error(name+" must be finite");return v;};
  const positive=(v,name)=>{finite(v,name);if(v<=0)throw Error(name+" must be positive");return v;};
  const integer=(v,name,max=1e6)=>{positive(v,name);if(!Number.isSafeInteger(v)||v>max)throw Error(name+" must be a bounded positive integer");return v;};
  function rotaryPairs({q,k,m=0,n=1,base=10000,shift=0}={}){
    if(!Array.isArray(q)||!Array.isArray(k)||q.length!==k.length||q.length<2||q.length>16||q.length%2)throw Error("RoPE needs two equal even vectors of length 2..16");
    q.forEach(v=>finite(v,"q"));k.forEach(v=>finite(v,"k"));[m,n,shift].forEach(v=>finite(v,"Position"));
    positive(base,"Frequency base");if(base<=1||base>1e9)throw Error("Frequency base must be in (1,1e9]");
    if(Math.max(Math.abs(m+shift),Math.abs(n+shift))>1e7)throw Error("Position exceeds this numerical witness range");
    const rotate=(v,a)=>[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)];
    const pairs=[];
    for(let i=0;i<q.length/2;i++){
      const frequency=base**(-2*i/q.length),a=q.slice(2*i,2*i+2),b=k.slice(2*i,2*i+2),
        rotatedQ=rotate(a,(m+shift)*frequency),rotatedK=rotate(b,(n+shift)*frequency),relativeK=rotate(b,(n-m)*frequency);
      pairs.push({index:i,frequency,q:a,k:b,rotatedQ,rotatedK,relativeK,dot:rotatedQ[0]*rotatedK[0]+rotatedQ[1]*rotatedK[1],relativeDot:a[0]*relativeK[0]+a[1]*relativeK[1],qNorm:Math.hypot(...a),kNorm:Math.hypot(...b)});
    }
    return {q:[...q],k:[...k],m,n,shift,base,dimension:q.length,pairs,dot:pairs.reduce((s,p)=>s+p.dot,0),relativeDot:pairs.reduce((s,p)=>s+p.relativeDot,0),convention:"Adjacent coordinate pairs; R(m+shift)q dot R(n+shift)k = q dot R(n-m)k. A numerical identity, not a claim of learned semantics or length extrapolation."};
  }
  function roofline({flops,bytes,computeTFLOPS=989,memoryGBPS=3350}={}){
    positive(flops,"FLOPs");positive(bytes,"Bytes");positive(computeTFLOPS,"TFLOP/s");positive(memoryGBPS,"GB/s");
    const intensity=flops/bytes,crossover=computeTFLOPS*1000/memoryGBPS,computeMs=flops/(computeTFLOPS*1e9),transferMs=bytes/(memoryGBPS*1e6),idealMs=Math.max(computeMs,transferMs);
    return {flops,bytes,computeTFLOPS,memoryGBPS,intensity,crossover,computeMs,transferMs,idealMs,idealTFLOPS:flops/idealMs/1e9,bound:computeMs>=transferMs?"compute":"memory",convention:"Decimal GB and TFLOP; max(compute time, transfer time) is an ideal lower bound with overlap and peak rates, not measured runtime. Excludes latency, caches and utilization losses."};
  }
  function cacheFootprint({layers=32,batch=1,tokens=2048,queryHeads=32,kvHeads=8,headDim=128,bytesPerElement=2}={}){
    for(const [name,value]of Object.entries({layers,batch,tokens,queryHeads,kvHeads,headDim}))integer(value,name);
    if(kvHeads>queryHeads||queryHeads%kvHeads)throw Error("KV heads must divide query heads");
    if(![1,2,4,8].includes(bytesPerElement))throw Error("Use 1,2,4,8 bytes per stored element");
    const one=layers*batch*tokens*kvHeads*headDim*bytesPerElement,baselineOne=one*queryHeads/kvHeads;
    if(!Number.isSafeInteger(2*one)||!Number.isSafeInteger(2*baselineOne))throw Error("Cache size exceeds exact integer range");
    return {layers,batch,tokens,queryHeads,kvHeads,headDim,bytesPerElement,keyBytes:one,valueBytes:one,totalBytes:2*one,totalMiB:2*one/2**20,baselineBytes:2*baselineOne,baselineMiB:2*baselineOne/2**20,savingFraction:1-kvHeads/queryHeads,queryHeadsPerKV:queryHeads/kvHeads,bytesPerToken:2*layers*batch*kvHeads*headDim*bytesPerElement,convention:"Dense autoregressive K and V storage only; no weights, activations, allocator overhead, paging, quantization metadata or architectural quality claims. Shared KV groups do not imply shared Q heads."};
  }
  function collective({input,kind="allreduce",root=0}={}){
    if(!Array.isArray(input)||input.length<2||input.length>8||!Array.isArray(input[0])||!input[0].length||input[0].length>32||input.some(r=>!Array.isArray(r)||r.length!==input[0].length||!r.every(Number.isFinite)))throw Error("Collective needs 2..8 equal finite vectors, width 1..32");
    if(!["allreduce","allgather","reduce-scatter","broadcast","alltoall"].includes(kind))throw Error("Unknown collective");
    if(!Number.isInteger(root)||root<0||root>=input.length)throw Error("Invalid broadcast root");
    const ranks=input.length,width=input[0].length,reduced=input[0].map((_,j)=>input.reduce((s,r)=>s+r[j],0));
    if(["reduce-scatter","alltoall"].includes(kind)&&width%ranks)throw Error("Chunked collective vector must split evenly across ranks");
    const output=Array.from({length:ranks},(_,r)=>kind==="allreduce"?[...reduced]:kind==="allgather"?input.flat():kind==="broadcast"?[...input[root]]:kind==="alltoall"?input.flatMap(row=>row.slice(r*width/ranks,(r+1)*width/ranks)):reduced.slice(r*width/ranks,(r+1)*width/ranks));
    return {input:input.map(r=>[...r]),kind,root,ranks,inputWidth:width,outputWidth:output[0].length,reduced,output,convention:"Sum reduction; equal-sized contiguous rank-order chunks. Collective input/output semantics only, not a ring/tree protocol, network traffic simulation or measured bandwidth."};
  }
  function matmulTraffic({m=64,n=11008,k=4096,bytesPerElement=2}={}){
    for(const [name,v]of Object.entries({m,n,k}))integer(v,name);
    if(![1,2,4,8].includes(bytesPerElement))throw Error("Use 1,2,4,8 bytes per element");
    const aElements=m*k,bElements=k*n,cElements=m*n,multiplies=m*n*k,additions=m*n*(k-1),flops=2*multiplies;
    const aBytes=aElements*bytesPerElement,bBytes=bElements*bytesPerElement,cBytes=cElements*bytesPerElement,bytes=aBytes+bBytes+cBytes;
    if(![flops,bytes,multiplies+additions].every(Number.isSafeInteger))throw Error("Matrix budget exceeds exact integer range");
    return {m,n,k,bytesPerElement,aElements,bElements,cElements,aBytes,bBytes,cBytes,bytes,flops,multiplies,additions,exactScalarOps:multiplies+additions,
      intensity:flops/bytes,aMiB:aBytes/2**20,bMiB:bBytes/2**20,cMiB:cBytes/2**20,maxMiB:Math.max(aBytes,bBytes,cBytes)/2**20,
      convention:"A[m,k] B[k,n] -> C[m,n], one read of A/B and one write of C, common element size, no beta*C read or repeated tiles. Conventional 2mnk hardware FLOPs; exact scalar products use mnk multiplications plus mn(k-1) additions. Ideal traffic ledger, not a measured kernel."};
  }
  function decodeAttentionTraffic({batch=1,tokens=2048,queryHeads=32,kvHeads=32,headDim=128,bytesPerElement=2}={}){
    for(const [name,v]of Object.entries({batch,tokens,queryHeads,kvHeads,headDim}))integer(v,name);
    if(kvHeads>queryHeads||queryHeads%kvHeads||![1,2,4,8].includes(bytesPerElement))throw Error("Decode needs dividing KV groups and 1/2/4/8-byte elements");
    const flops=4*batch*tokens*queryHeads*headDim,queryOutputBytes=2*batch*queryHeads*headDim*bytesPerElement,kvBytes=2*batch*tokens*kvHeads*headDim*bytesPerElement,bytes=queryOutputBytes+kvBytes;
    if(![flops,bytes].every(Number.isSafeInteger))throw Error("Decode budget exceeds exact integer range");
    return {batch,tokens,queryHeads,kvHeads,headDim,bytesPerElement,flops,queryOutputBytes,kvBytes,bytes,intensity:flops/bytes,groupSize:queryHeads/kvHeads,
      convention:"One new query per sequence; QK and AV conventional multiply-add FLOPs, once-read dense K/V and Q/output traffic. Shared KV heads are ideally reused across their Q groups. Excludes QKV projections, softmax, scores/intermediates, cache writes, repeated reads, weights, paging and measured performance. Not prefill."};
  }
  const api={rotaryPairs,roofline,cacheFootprint,collective,matmulTraffic,decodeAttentionTraffic};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  global.VisualBookSystems=api;
})(typeof window!=="undefined"?window:globalThis);
