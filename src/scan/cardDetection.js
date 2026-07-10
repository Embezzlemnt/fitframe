import { clamp, distPt } from "./faceMetrics.js";
import { OPENCV_URL, CREDIT_CARD_WIDTH_MM, CREDIT_CARD_HEIGHT_MM, CARD_ASPECT, CARD_MAX_ROTATION_DEG, CARD_MIN_CONFIDENCE } from "./constants.js";

// The overlay canvas is CSS-mirrored for selfie view, so text drawn normally
// reads backwards on screen. Flip the context around the vertical axis for the
// duration of the draw and mirror the x coordinate.
function drawMirroredText(ctx,text,x,y){
  const W=ctx.canvas.width;
  ctx.save();
  ctx.translate(W,0); ctx.scale(-1,1);
  ctx.fillText(text,W-x,y);
  ctx.restore();
}

// ─── Script loader ────────────────────────────────────────────────────────────
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous";
    s.defer = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

let openCvPromise;
export function loadOpenCv(){
  if (window.cv?.Mat) return Promise.resolve();
  if (openCvPromise) return openCvPromise;
  openCvPromise = loadScript(OPENCV_URL).then(()=>new Promise((resolve,reject)=>{
    const started=performance.now();
    const tick=()=>{
      if (window.cv?.Mat) resolve();
      else if (performance.now()-started>4000) reject(new Error("OpenCV failed to load"));
      else setTimeout(tick,50);
    };
    tick();
  }));
  return openCvPromise;
}

function orderQuad(points){
  const pts=[...points];
  const bySum=[...pts].sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  const byDiff=[...pts].sort((a,b)=>(a.x-a.y)-(b.x-b.y));
  return [bySum[0],byDiff[3],bySum[3],byDiff[0]];
}
function quadAngleDeg(quad){
  const [tl,tr]=quad;
  return Math.abs(Math.atan2(tr.y-tl.y,tr.x-tl.x)*180/Math.PI);
}
export function detectionSimilarity(a,b){
  if (!a||!b) return 0;
  const ac=a.center, bc=b.center;
  const centerDelta=Math.hypot(ac.x-bc.x,ac.y-bc.y);
  const sizeDelta=Math.abs(a.width-b.width)+Math.abs(a.height-b.height);
  const angleDelta=Math.abs(a.angle-b.angle);
  return centerDelta+sizeDelta*.5+angleDelta*3;
}

let blurCanvas;
export function drawCardBlurMask(ctx,video,detection){
  const {quad,center}=detection;
  const inflated=quad.map(p=>({x:center.x+(p.x-center.x)*1.08,y:center.y+(p.y-center.y)*1.08}));
  const xs=inflated.map(p=>p.x),ys=inflated.map(p=>p.y);
  const x0=Math.max(0,Math.min(...xs)),y0=Math.max(0,Math.min(...ys));
  const w=Math.min(ctx.canvas.width,Math.max(...xs))-x0,h=Math.min(ctx.canvas.height,Math.max(...ys))-y0;
  if (w<8||h<8) return;
  blurCanvas=blurCanvas||document.createElement("canvas");
  const bw=Math.max(2,Math.round(w/14)),bh=Math.max(2,Math.round(h/14));
  blurCanvas.width=bw; blurCanvas.height=bh;
  blurCanvas.getContext("2d").drawImage(video,x0,y0,w,h,0,0,bw,bh);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(inflated[0].x,inflated[0].y);
  inflated.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(blurCanvas,0,0,bw,bh,x0,y0,w,h);
  ctx.restore();
}

export function drawDetectedCard(ctx,detection,stablePct){
  const quad=detection.quad;
  ctx.save();
  ctx.lineWidth=3;
  ctx.strokeStyle=detection.confidence>=CARD_MIN_CONFIDENCE?"#4caf7d":"#e5a64a";
  ctx.shadowColor="rgba(76,175,125,.65)";
  ctx.shadowBlur=12;
  ctx.beginPath();
  ctx.moveTo(quad[0].x,quad[0].y);
  quad.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur=0;
  ctx.fillStyle="rgba(76,175,125,.95)";
  quad.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill(); });
  ctx.font="13px 'Geist Mono', monospace";
  ctx.fillStyle="rgba(255,255,255,.9)";
  ctx.textAlign="center";
  drawMirroredText(ctx,stablePct>=1?"SCALE LOCKED":`CARD ${Math.round(stablePct*100)}%`, detection.center.x, detection.center.y);
  ctx.restore();
}

// Placement target for the card-lock phase: a dashed card-proportioned zone
// under the chin, inside the detector's search region, breathing gently until
// the live detection outline takes over on top of it.
export function drawCardTarget(ctx,W,H,tMs,reduceMotion){
  const w=W*.5, h=w*CREDIT_CARD_HEIGHT_MM/CREDIT_CARD_WIDTH_MM;
  const x=(W-w)/2, y=H*.72-h/2, r=w*.045;
  const breathe=reduceMotion?1:.7+.3*Math.sin(tMs/1600);
  ctx.save();
  ctx.strokeStyle=`rgba(242,240,232,${.5*breathe})`;
  ctx.lineWidth=1.5;
  ctx.setLineDash([8,7]);
  ctx.beginPath();
  ctx.roundRect(x,y,w,h,r);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle=`rgba(242,240,232,${.5*breathe})`;
  ctx.font="12px 'Geist Mono', monospace";
  ctx.textAlign="center";
  drawMirroredText(ctx,"card here",W/2,y+h/2+4);
  ctx.restore();
}

export function detectCardOutline(video,W,H,workCanvas){
  const cv=window.cv;
  if (!cv?.Mat) return null;
  workCanvas.width=W; workCanvas.height=H;
  const wctx=workCanvas.getContext("2d",{willReadFrequently:true});
  wctx.drawImage(video,0,0,W,H);

  const roiX=Math.round(W*.08), roiY=Math.round(H*.30), roiW=Math.round(W*.84), roiH=Math.round(H*.68);
  let src,roi,gray,blurred,edges,dilated,contours,hierarchy,kernel;
  try {
    src=cv.imread(workCanvas);
    roi=src.roi(new cv.Rect(roiX,roiY,roiW,roiH));
    gray=new cv.Mat(); blurred=new cv.Mat(); edges=new cv.Mat(); dilated=new cv.Mat();
    contours=new cv.MatVector(); hierarchy=new cv.Mat();
    kernel=cv.Mat.ones(3,3,cv.CV_8U);
    cv.cvtColor(roi,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
    cv.Canny(blurred,edges,45,140);
    cv.dilate(edges,dilated,kernel);
    cv.findContours(dilated,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);

    let best=null;
    for (let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      const area=cv.contourArea(contour);
      if (area<roiW*roiH*.035) { contour.delete(); continue; }
      const peri=cv.arcLength(contour,true);
      const approx=new cv.Mat();
      cv.approxPolyDP(contour,approx,peri*.025,true);
      if (approx.rows===4&&cv.isContourConvex(approx)){
        const raw=[];
        for (let j=0;j<4;j++){
          raw.push({x:approx.intPtr(j,0)[0]+roiX,y:approx.intPtr(j,0)[1]+roiY});
        }
        const quad=orderQuad(raw);
        const top=distPt(quad[0],quad[1]), bottom=distPt(quad[3],quad[2]);
        const left=distPt(quad[0],quad[3]), right=distPt(quad[1],quad[2]);
        const width=(top+bottom)/2, height=(left+right)/2;
        const aspect=width/height;
        const angle=quadAngleDeg(quad);
        const rect=cv.boundingRect(approx);
        const rectangularity=area/(rect.width*rect.height);
        const aspectScore=clamp(1-Math.abs(aspect-CARD_ASPECT)/.42,0,1);
        const angleScore=clamp(1-angle/CARD_MAX_ROTATION_DEG,0,1);
        const fillScore=clamp((rectangularity-.45)/.35,0,1);
        const confidence=aspectScore*.45+angleScore*.3+fillScore*.25;
        const candidate={
          quad,width,height,angle,aspect,confidence,area,rectangularity,
          center:{x:quad.reduce((s,p)=>s+p.x,0)/4,y:quad.reduce((s,p)=>s+p.y,0)/4},
          mmPerPx:CREDIT_CARD_WIDTH_MM/width,
        };
        if (!best||candidate.confidence>best.confidence) best=candidate;
      }
      approx.delete(); contour.delete();
    }
    return best&&best.confidence>=.45?best:null;
  } finally {
    [kernel,hierarchy,contours,dilated,edges,blurred,gray,roi,src].forEach(m=>m?.delete?.());
  }
}
