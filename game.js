/* 작은 비눗방울의 날 — V7
   Original supplied artwork is loaded unchanged. Webcam frames are processed locally.
   Mouse demo is intentionally absent. Camera is hidden during soap / first game.
*/
const $ = id => document.getElementById(id);
const world = $('world'), video = $('webcam'), canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
const colors = ['#79c3e3', '#f49aaa', '#d0b1ed', '#a5d99c'];
const panels = ['permissionScreen','storyScreen','profileScreen','memoryScreen','colorScreen','messageScreen','poseScreen','photoScreen'];
const random = (a,b) => a + Math.random()*(b-a);
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
let W=innerWidth,H=innerHeight,ratio=1,lastFrame=0,lastDetect=0,lastVideoTime=-1;
let stream=null,handModel=null,visionLib=null,soundContext=null,timeoutId=null,delayed=0;

const state = {
  phase:'permission', camera:false,loadingCamera:false,name:'',age:7,
  selectedColor:colors[0],score:0,total:0,scores:{my:0,reverse:0},correct:0,remaining:20,
  soap:{x:0,y:0,active:0},soapLast:null,soapReady:false,
  balls:[],particles:[],spawnTime:0,lastPop:0,
  hand:{visible:false,x:0,y:0,soapX:0,soapY:0,fingers:[],pinch:false,gap:2,v:false},
  giantStep:0,giantArmed:false,giantReady:true,giantLast:0,vHold:0,
  speed:55,sensitivity:70,pastelTint:14,bubbleDensity:100,sound:true,photoData:''
};

function only(id){for(const name of panels)$(name).hidden = name!==id;}
function phase(name){state.phase=name;scene();}
function scene(){
  const mapping={soap:'soap','soap-vanish':'soap',my:'my',reverse:'reverse',giant:'giant',burst:'burst',pose:'pose'};
  world.dataset.scene=mapping[state.phase]||'illustration';
}
function fit(){
  W=world.clientWidth||innerWidth;H=world.clientHeight||innerHeight;
  ratio=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(W*ratio);canvas.height=Math.round(H*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
}
new ResizeObserver(fit).observe(world);fit();
function delay(ms,fn){const t=++delayed;setTimeout(()=>{if(t===delayed)fn();},ms)}

function audioNote(freq=560,len=.11,volume=.027){
  if(!state.sound)return;
  try{
    soundContext ||= new (window.AudioContext||window.webkitAudioContext)();
    if(soundContext.state==='suspended')soundContext.resume();
    const t=soundContext.currentTime,osc=soundContext.createOscillator(),vol=soundContext.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(freq,t);osc.frequency.exponentialRampToValueAtTime(Math.max(130,freq*.54),t+len);
    vol.gain.setValueAtTime(.0001,t);vol.gain.exponentialRampToValueAtTime(volume,t+.012);
    vol.gain.exponentialRampToValueAtTime(.0001,t+len);
    osc.connect(vol).connect(soundContext.destination);osc.start(t);osc.stop(t+len+.02);
  }catch(error){console.info('소리를 재생하지 못했어요.',error)}
}
// A real local WAV is more audible and reliable than the earlier ultra-quiet, 95 ms oscillator.
// Audio .play() runs DIRECTLY within the trusted click event, avoiding autoplay blocks.
const clickSounds = Array.from({length:5},()=>{
  const sound=new Audio('./assets/button-bloop.wav');
  sound.preload='auto';sound.volume=.85;
  return sound;
});
let nextClickSound=0;
function buttonBloop(force=false){
  if(!force&&!state.sound)return;
  const sound=clickSounds[nextClickSound++ % clickSounds.length];
  try{
    sound.pause();sound.currentTime=0;
    const playback=sound.play();
    if(playback?.catch)playback.catch(()=>audioNote(650,.20,.10));
  }catch(error){audioNote(650,.20,.10)}
}
// Any button click retains the exact prior corner-lift motion and now plays a local bubble-pop.
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  // Even an OFF -> ON press previews the sound so users immediately know it works.
  buttonBloop(button.id==='soundToggle'&&!state.sound);
  button.classList.remove('clicked');void button.offsetWidth;button.classList.add('clicked');
  setTimeout(()=>button.classList.remove('clicked'),190);
},true);
let toastTimer;
function toast(text){clearTimeout(toastTimer);const el=$('toast');el.textContent=text;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),1700)}
// A single full Korean sentence always occupies one complete line. Shrink only if necessary.
function fitSentences(){
  for(const el of document.querySelectorAll('.layer:not([hidden]) .sentence')){
    el.style.fontSize='';
    const parent=el.closest('.paper-box');if(!parent)continue;
    const boxStyle=getComputedStyle(parent);
    const max=parent.clientWidth-parseFloat(boxStyle.paddingLeft)-parseFloat(boxStyle.paddingRight)-4;
    let n=parseFloat(getComputedStyle(el).fontSize);
    // Measure the actual text, not the paragraph's full block width.
    // A full-width block stays the same width even after its font shrinks.
    const range=document.createRange();range.selectNodeContents(el);
    while(range.getBoundingClientRect().width>max && n>11){
      n-=.5;el.style.fontSize=n+'px';
    }
  }
}
function refreshLayout(){requestAnimationFrame(()=>requestAnimationFrame(fitSentences))}
function showMessage(title,lines,label,next){
  phase('message');$('messageTitle').textContent=title;
  $('messageBody').replaceChildren();
  for(const line of (Array.isArray(lines)?lines:[lines])){
    const p=document.createElement('p');p.className='sentence';p.textContent=line;$('messageBody').append(p);
  }
  const continueButton = $('messageContinue');
  continueButton.textContent = label;
  // Presentation build: a missing callback means this is the final visible screen.
  continueButton.onclick = typeof next === 'function' ? next : null;
  continueButton.disabled = typeof next !== 'function';
  only('messageScreen');refreshLayout();
}
function setPlayVisible(show){$('playScreen').hidden=!show;if(!show)hideHUD()}
function hideHUD(){for(const id of ['scoreHud','timerHud','gameHint','activeControls'])$(id).hidden=true}
function stageHUD(name){$('stageName').textContent=name;$('scoreValue').textContent=String(state.score);$('timeValue').textContent=String(Math.ceil(state.remaining));$('scoreHud').hidden=false;$('timerHud').hidden=false}

// Browser restrictions: camera permission must follow a deliberate click.
$('allowCamera').addEventListener('click',startCamera);
async function startCamera(){
  if(state.camera){phase('story');only('storyScreen');refreshLayout();return}
  if(state.loadingCamera)return;
  state.loadingCamera=true;$('allowCamera').disabled=true;
  $('allowCamera').textContent='카메라를 연결하고 있어요...';$('cameraWarning').hidden=true;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('보안 연결(HTTPS 또는 localhost)에서 열어 주세요.');
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}});
    video.srcObject=stream;await video.play();
    const version='0.10.32';
    visionLib=await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/+esm`);
    const fileset=await visionLib.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
    const opt={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.50,minHandPresenceConfidence:.50,minTrackingConfidence:.45};
    try{handModel=await visionLib.HandLandmarker.createFromOptions(fileset,opt)}catch{opt.baseOptions.delegate='CPU';handModel=await visionLib.HandLandmarker.createFromOptions(fileset,opt)}
    state.camera=true;video.classList.add('on');
    phase('story');only('storyScreen');refreshLayout();
  }catch(error){
    console.error(error);
    $('cameraWarning').hidden=false;
    $('cameraWarning').textContent='카메라 연결에 실패했어요. 권한과 인터넷 연결을 확인해 주세요.';
    stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
  }finally{state.loadingCamera=false;$('allowCamera').disabled=false;$('allowCamera').textContent='카메라 허용하기'}
}
$('storyStart').addEventListener('click',()=>{phase('profile');only('profileScreen');refreshLayout()});
$('playerAge').addEventListener('input',e=>e.target.value=e.target.value.replace(/[^0-9]/g,'').slice(0,2));
$('profileForm').addEventListener('submit',e=>{
  e.preventDefault();const name=$('playerName').value.trim(),ageText=$('playerAge').value.trim(),age=Number(ageText);
  if(!name||!ageText){toast('먼저 이름과 나이를 입력해 주세요.');return}
  if(!Number.isInteger(age)||age<1||age>10){toast('나이는 1살부터 10살까지 입력해 주세요.');return}
  state.name=name;state.age=age;
  phase('transition');$('memoryText').textContent=`${playerLabel()}의 어린 시절로 들어가고 있어요...`;
  only('memoryScreen');refreshLayout();delay(2600,startSoap);
});
function playerLabel(){return `${state.age}살 ${state.name}`}

// SOAP: tracking uses complete hand-landmark constellation, no camera pixels, no tracking dot.
function startSoap(){
  phase('soap');setPlayVisible(true);only('');hideHUD();
  $('soap').hidden=false;$('soap').classList.remove('vanish');$('soapMeter').hidden=true;
  state.soap={x:W*.45,y:H*.44,active:0};state.soapLast=null;state.soapReady=false;
  state.balls=[];state.particles=[];moveSoap(state.soap.x,state.soap.y);
  $('soapPercent').textContent='0%';$('soapFill').style.width='0%';
}
function moveSoap(x,y){
  state.soap.x=clamp(x,70,W-70);state.soap.y=clamp(y,115,H*.72);
  $('soap').style.left=state.soap.x+'px';$('soap').style.top=state.soap.y+'px';
}
function tinyFoam(x,y,n=3,pop=false){
  for(let i=0;i<n;i++){
    const t=random(.5,1.3),a=random(0,Math.PI*2),speed=pop?random(30,160):random(10,50);
    state.particles.push({kind:'foam',x:x+random(-16,16),y:y+(pop?0:random(20,40)),vx:Math.cos(a)*speed,vy:pop?Math.sin(a)*speed:random(-55,-10),r:random(2,7),life:t,maxLife:t,rot:0});
  }
}
function moveSoapWithHand(pt,dt){
  if(state.phase!=='soap')return;
  const last={...state.soap};
  // Smoothing based on whole hand keeps fingertip jitter out of the interaction.
  const alpha=clamp(dt*15,.18,.55);
  const x=last.x+(pt.x-last.x)*alpha,y=last.y+(pt.y-last.y)*alpha;
  moveSoap(x,y);
  const moved=dist(last,state.soap);
  if(moved>2.7){
    $('soapMeter').hidden=false;tinyFoam(x,y,4);state.soap.active=Math.min(3,state.soap.active+dt);
  }else state.soap.active=Math.max(0,state.soap.active-dt*.08);
  const percentage=clamp(state.soap.active/3*100,0,100);
  $('soapPercent').textContent=Math.round(percentage)+'%';$('soapFill').style.width=percentage+'%';
  if(state.soap.active>=3)finishSoap();
}
function finishSoap(){
  if(state.phase!=='soap')return;
  phase('soap-vanish');$('soapMeter').hidden=true;$('soap').classList.add('vanish');audioNote(590,.22);
  delay(950,()=>{$('soap').hidden=true;phase('color');only('colorScreen');drawPreview();refreshLayout()});
}

// The exact user's new artwork is the mask for BOTH preview and game bubbles.
const bubbleArt=new Image();bubbleArt.src='./assets/Bubble1.png';
const coloredImages=new Map();
// Only the actual pixels of the user's Bubble.png are recolored.
// The center remains transparent; NO lighter-colored disc or background is painted.
function bubbleSprite(hex){
  const key=hex.toLowerCase();if(coloredImages.has(key))return coloredImages.get(key);
  const c=document.createElement('canvas');c.width=c.height=256;
  const g=c.getContext('2d',{willReadFrequently:true});
  if(bubbleArt.complete&&bubbleArt.naturalWidth){
    g.drawImage(bubbleArt,0,0,256,256);
    const image=g.getImageData(0,0,256,256),p=image.data;
    const rgb=[1,3,5].map((_,i)=>parseInt(hex.slice(1+i*2,3+i*2),16));
    for(let i=0;i<p.length;i+=4){
      if(p[i+3]===0)continue; // preserve the bubble's empty transparent center
      const luminance=p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722;
      // Keep pure-white hand-drawn shine while tinting the gray pencil strokes.
      const pigment=clamp((252-luminance)/35,0,.88);
      for(let k=0;k<3;k++)p[i+k]=Math.round(p[i+k]*(1-pigment)+rgb[k]*pigment);
    }
    g.putImageData(image,0,0);
  }else{
    // Temporary outline while the user's original PNG is loading; no fill.
    g.strokeStyle=hex;g.lineWidth=14;
    g.beginPath();g.arc(128,128,108,0,Math.PI*2);g.stroke();
  }
  coloredImages.set(key,c);return c;
}
bubbleArt.addEventListener('load',()=>{coloredImages.clear();drawPreview()});
const previewCtx=$('bubblePreviewCanvas').getContext('2d');
function drawPreview(){previewCtx.clearRect(0,0,320,320);previewCtx.drawImage(bubbleSprite(state.selectedColor),0,0,320,320)}
function setColor(value){
  state.selectedColor=value;
  for(const chip of document.querySelectorAll('.color-chip[data-color]'))chip.classList.toggle('selected',chip.dataset.color.toLowerCase()===value.toLowerCase());
  $('colorPicker').value=value;drawPreview();
}
for(const chip of document.querySelectorAll('.color-chip[data-color]'))chip.addEventListener('click',()=>{setColor(chip.dataset.color);document.querySelector('.custom-chip').classList.remove('selected')});
$('colorPicker').addEventListener('input',e=>{setColor(e.target.value);document.querySelector('.custom-chip').classList.add('selected')});
$('chooseColor').addEventListener('click',()=>showMessage('내 비눗방울 놀이',[
  `이제 ${playerLabel()}! 네 비눗방울을 터뜨리고 점수를 모아 봐요!`
],'놀이 시작하기 →',()=>startRound('my')));
drawPreview();

// GAME: +5 for first six correct bubbles, +10 after; stop at 80 or 20 seconds.
function spawnBubble(){
  if(state.balls.length>=95)return;
  const my=state.phase==='my',roll=Math.random();
  const kind=my?(roll<.80?'target':'other'):(roll<.53?'special':roll<.79?'forbidden':'other');
  let color=state.selectedColor;
  if(kind==='special')color='#f0ce6f';
  if(kind==='other'){const others=colors.filter(c=>c.toLowerCase()!==state.selectedColor.toLowerCase());color=others[Math.floor(Math.random()*others.length)]}
  const r=random(36,58),x=random(r+7,Math.max(r+8,W-r-8));
  // First round only is slower. Subsequent game retains original movement speed.
  const speed=(my?random(82,128):random(100,166))*(.71+state.speed/95);
  state.balls.push({x,baseX:x,y:-r-random(0,90),r,age:0,seed:random(0,7),speed,kind,color,settled:false});
}
function startRound(mode){
  phase(mode);state.score=0;state.correct=0;state.remaining=20;state.balls=[];state.particles=[];state.spawnTime=.1;state.lastPop=0;
  for(let j=0;j<7;j++){
    spawnBubble();const b=state.balls[state.balls.length-1];if(b){b.y=random(-b.r,H*.39);b.age=random(0,3)}
  }
  $('activeControls').hidden=false;$('gameHint').hidden=false;only('');
  $('gameHint').textContent=mode==='my'?'네 색깔 비눗방울만 터뜨려 주세요!':'네 색깔은 피하고 특별한 별 비눗방울만 터뜨려 주세요!';
  stageHUD(mode==='my'?'내 비눗방울':'반대로 놀이');
}
function bubbleSupport(b){
  let limit=H-b.r-3;
  // Stable stacking: a falling bubble rests on the ground or a previously settled one.
  for(const other of state.balls){
    if(other===b||!other.settled)continue;
    const dx=b.x-other.x,rad=b.r+other.r-1;
    if(Math.abs(dx)>=rad)continue;
    const boundary=other.y-Math.sqrt(Math.max(0,rad*rad-dx*dx));
    if(b.y<=other.y&&boundary<limit)limit=boundary;
  }
  return limit;
}
function updateBubbles(dt){
  for(const b of state.balls){
    if(b.settled)continue;
    b.age+=dt;
    if(state.phase==='my')b.x=clamp(b.baseX+Math.sin(b.age*1.18+b.seed)*12,b.r,W-b.r);
    else b.x=clamp(b.baseX+Math.sin(b.age*1.4+b.seed)*20,b.r,W-b.r);
    const next=b.y+b.speed*dt;
    if(state.phase==='my'){
      const floor=bubbleSupport(b);
      if(next>=floor){b.y=floor;b.settled=true;}
      else b.y=next;
    }else{b.y=next;}
  }
  if(state.phase==='reverse')state.balls=state.balls.filter(b=>b.y<H+b.r+10);
}
function tinyExplosion(x,y,n=23){tinyFoam(x,y,n,true)}
function confettiExplosion(x,y,n=15){
  for(let i=0;i<n;i++){const a=random(0,Math.PI*2),v=random(50,160),life=random(.35,.9);
    state.particles.push({kind:i%3?'paper':'star',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,r:random(3,6),life,maxLife:life,color:colors[i%4],rot:random(0,6)});
  }
}
function popAt(point,now){
  if(!['my','reverse'].includes(state.phase)||now-state.lastPop<160)return;
  for(let i=state.balls.length-1;i>=0;i--){
    const b=state.balls[i];if(dist(point,b)>b.r+8+state.sensitivity*.26)continue;
    state.balls.splice(i,1);state.lastPop=now;
    let points=0;
    if(state.phase==='my'){
      if(b.kind==='target'){state.correct++;points=state.correct<=6?5:10}else points=-5;
    }else if(b.kind==='special')points=10;
    else if(b.kind==='forbidden')points=-10;
    state.score=clamp(state.score+points,0,100);$('scoreValue').textContent=String(state.score);
    // All ordinary pops use tiny soap-style microbubbles, not confetti.
    tinyExplosion(b.x,b.y,23);audioNote(points>=0?720:270,.09);
    if(points>0)toast(`+${points}점!`);else if(points<0)toast(`${points}점`);
    else toast('특별한 비눗방울을 찾아 주세요.');
    if(state.phase==='my'&&state.score>=80)endRound('my');
    return;
  }
}
function endRound(mode){
  if(state.phase!==mode)return;
  state.scores[mode]=state.score;state.total=state.scores.my+state.scores.reverse;
  phase('between');state.balls=[];hideHUD();
  if(mode==='my')showMessage('이제 모든 게 반대예요!',[
    `잘했어요, ${playerLabel()}!`,
    '이번에는 네 색깔 비눗방울을 터뜨리면 안 돼요.',
    '별이 있는 특별한 비눗방울만 터뜨려 주세요.'
  ],'다음 단계 →',null); 
  else showMessage('마지막 단계로 가 볼까요?',[
    `이건 ${playerLabel()}가 터뜨릴 가장 큰 비눗방울이에요.`,
    '손가락으로 다섯 번 크게 키워 주세요.'
  ],'큰 비눗방울 만나기 →',startGiant);
}

// Five distinct pinch-and-open cycles are required to burst the giant bubble.
function giantRadius(){return Math.min(W,H)*(.082+state.giantStep*.074)}
function startGiant(){phase('giant');only('');state.balls=[];state.giantStep=0;state.giantArmed=false;state.giantReady=true;state.giantLast=0;
  $('activeControls').hidden=false;$('scoreHud').hidden=true;$('timerHud').hidden=true;
  $('gameHint').hidden=false;$('gameHint').textContent='비눗방울을 집고 손가락을 벌려 주세요! (0 / 5)';
}
function growGiant(now){
  if(state.phase!=='giant'||now-state.giantLast<330)return;
  state.giantLast=now;state.giantStep++;audioNote(410+state.giantStep*95,.13,.04);
  confettiExplosion(W*.5,H*.43,14);
  $('gameHint').textContent=`비눗방울을 더 크게 키워 주세요! (${state.giantStep} / 5)`;
  if(state.giantStep>=5)burstGiant();
}
function burstGiant(){
  phase('burst');state.giantArmed=false;$('activeControls').hidden=true;$('gameHint').hidden=true;
  const palette=[...colors,'#f2db96','#fbe9f0'];
  for(let i=0;i<220;i++){const a=random(0,Math.PI*2),v=random(80,430),life=random(8,15);
    state.particles.push({kind:i%3?'paper':'star',x:W*.5,y:H*.43,vx:Math.cos(a)*v,vy:Math.sin(a)*v-90,r:random(3,9),life,maxLife:life,color:palette[i%palette.length],rot:random(0,6)});
  }
  audioNote(870,.33,.06);
  delay(1050,()=>showMessage(`${playerLabel()}, 성공했어요!`,[
    '정말 멋진 비눗방울이었어요!', '우리 같이 기념사진을 찍어요.'
  ],'기념사진 찍으러 가기 →',beginPose));
}
function beginPose(){phase('pose');state.vHold=0;only('poseScreen');$('poseTitle').textContent=`${playerLabel()}! 브이를 보여 주세요!`;
  $('poseSub').textContent='손가락으로 브이 포즈를 잠깐 유지해 주세요.';refreshLayout();
}

// MediaPipe provides 21 3D landmarks for the whole hand in every analyzed frame.
function d3(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function raised(l,tip,pip){return d3(l[tip],l[0])>d3(l[pip],l[0])*1.12}
function screenPoint(pt){
  const vw=video.videoWidth||1280,vh=video.videoHeight||720,scale=Math.max(W/vw,H/vh);
  return{x:(W-vw*scale)/2+(1-pt.x)*vw*scale,y:(H-vh*scale)/2+pt.y*vh*scale};
}
function detectHand(now){
  if(!state.camera||!handModel||video.readyState<2||now-lastDetect<55||video.currentTime===lastVideoTime)return;
  lastDetect=now;lastVideoTime=video.currentTime;
  try{
    const landmark=handModel.detectForVideo(video,now).landmarks?.[0];
    if(!landmark){state.hand.visible=false;state.hand.pinch=false;state.hand.v=false;return}
    const palm=Math.max(.001,d3(landmark[5],landmark[17]));
    const gap=d3(landmark[4],landmark[8])/palm;
    const tips=[4,8,12,16,20],handIds=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
    // All 21 landmarks, not one fingertip, contribute to the soap position.
    const center={x:handIds.reduce((v,i)=>v+landmark[i].x,0)/21,y:handIds.reduce((v,i)=>v+landmark[i].y,0)/21};
    const target=screenPoint(landmark[8]),soap=screenPoint(center);
    const i=raised(landmark,8,6),m=raised(landmark,12,10),r=raised(landmark,16,14),p=raised(landmark,20,18);
    const separation=d3(landmark[8],landmark[12])/palm;
    state.hand={visible:true,x:target.x,y:target.y,soapX:soap.x,soapY:soap.y,fingers:tips.map(k=>screenPoint(landmark[k])),pinch:gap<.57,gap,v:i&&m&&!r&&!p&&separation>.33};
  }catch(error){console.warn('손 인식을 잠시 건너뛰었어요.',error)}
}

$('settingsBtn').addEventListener('click',()=>$('settingsDialog').showModal());
$('closeSettings').addEventListener('click',()=>$('settingsDialog').close());
$('finishSettings').addEventListener('click',()=>$('settingsDialog').close());
for(const [input,key,out] of [['speedRange','speed','speedOut'],['sensitivityRange','sensitivity','sensitivityOut'],['pastelTintRange','pastelTint','pastelTintOut'],['bubbleDensityRange','bubbleDensity','bubbleDensityOut']]){
  $(input).addEventListener('input',e=>{state[key]=Number(e.target.value);$(out).textContent=state[key]+'%';
    if(key==='pastelTint')document.documentElement.style.setProperty('--tint-strength',(state[key]/100).toFixed(2));
  });
}
$('soundToggle').addEventListener('click',()=>{state.sound=!state.sound;$('soundToggle').textContent=state.sound?'소리 켜짐 ♪':'소리 꺼짐'});

function update(dt,now){
  if(state.camera)detectHand(now);
  if(state.phase==='soap'&&state.hand.visible){moveSoapWithHand({x:state.hand.soapX,y:state.hand.soapY},dt)}
  if(state.phase==='my'||state.phase==='reverse'){
    state.remaining=Math.max(0,state.remaining-dt);$('timeValue').textContent=String(Math.ceil(state.remaining));
    state.spawnTime-=dt;
    if(state.spawnTime<=0){spawnBubble();state.spawnTime=clamp((.40-state.speed*.0022)*100/state.bubbleDensity,.13,.55)+random(-.02,.04)}
    updateBubbles(dt);
    if(state.hand.visible&&state.hand.pinch)popAt(state.hand,now);
    if(state.remaining<=0)endRound(state.phase);
  }
  if(state.phase==='giant'){
    const hand=state.hand,center={x:W*.5,y:H*.43};
    if(!hand.visible){state.giantArmed=false;state.giantReady=true;}
    else if(!state.giantArmed&&state.giantReady&&hand.pinch&&dist(hand,center)<giantRadius()+120){state.giantArmed=true;state.giantReady=false;}
    else if(state.giantArmed&&hand.gap>1.08){state.giantArmed=false;growGiant(now)}
    else if(!state.giantArmed&&!hand.pinch){state.giantReady=true}
  }
  if(state.phase==='pose'){
    state.vHold=state.hand.visible&&state.hand.v?state.vHold+dt:Math.max(0,state.vHold-dt*1.2);
    if(state.vHold>.83)takePhoto();
  }
  for(let idx=state.particles.length-1;idx>=0;idx--){
    const p=state.particles[idx];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=65*dt;p.vx*=1-.2*dt;p.rot+=.25*dt;
    if((state.phase==='pose'||state.phase==='message')&&p.maxLife>5&&p.life<1){p.life=random(5,9);p.y=random(-80,-10);p.x=random(30,W-30);p.vx=random(-25,25);p.vy=random(25,75)}
    if(p.life<=0)state.particles.splice(idx,1);
  }
}
function drawBubble(b){
  const size=b.r*2.5;ctx.save();ctx.translate(b.x,b.y);
  ctx.drawImage(bubbleSprite(b.color),-size/2,-size/2,size,size);
  if(b.kind==='special'){
    ctx.beginPath();ctx.fillStyle='#ffe078';ctx.strokeStyle='#96743e';ctx.lineWidth=2;
    for(let j=0;j<10;j++){const angle=-Math.PI/2+j*Math.PI/5,r=(j%2?.27:.52)*b.r;
      const x=Math.cos(angle)*r,y=Math.sin(angle)*r;if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  ctx.restore();
}
function drawParticle(p){
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot||0);
  ctx.globalAlpha=clamp(p.life/Math.min(.7,p.maxLife),0,1);
  if(p.kind==='foam'){
    ctx.strokeStyle='#f8fdff';ctx.lineWidth=Math.max(1,p.r*.32);
    ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#81c9ed';ctx.lineWidth=1;ctx.beginPath();ctx.arc(-p.r*.1,0,p.r*.85,3.8,5.6);ctx.stroke();
  }else if(p.kind==='star'){
    ctx.fillStyle=p.color;ctx.beginPath();for(let k=0;k<10;k++){const a=k*Math.PI/5,r=p.r*(k%2?.4:1.2);ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r)}ctx.closePath();ctx.fill();
  }else{ctx.fillStyle=p.color;ctx.fillRect(-p.r,-p.r*.5,p.r*2,p.r)}ctx.restore();
}
function render(){
  ctx.clearRect(0,0,W,H);
  if(['my','reverse'].includes(state.phase)){
    // Settled bubbles first, incoming bubbles above them.
    state.balls.filter(b=>b.settled).forEach(drawBubble);
    state.balls.filter(b=>!b.settled).forEach(drawBubble);
  }
  if(state.phase==='giant'){
    const r=giantRadius();drawBubble({x:W*.5,y:H*.43,r,color:state.selectedColor,kind:'giant'});
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${clamp(r*.25,28,70)}px Gaegu,sans-serif`;
    ctx.fillStyle='#1c669e';ctx.fillText(`${state.giantStep} / 5`,W*.5,H*.43);
  }
  if(['soap','soap-vanish','my','reverse','giant','burst','pose','message'].includes(state.phase))state.particles.forEach(drawParticle);
  // Intentionally NO visible hand tracking cursor, landmarks, or sensor circle.
}
function animation(now){
  const dt=lastFrame?clamp((now-lastFrame)/1000,0,.05):0;lastFrame=now;
  if($('settingsDialog').open){if(state.camera)detectHand(now)}else update(dt,now);
  render();requestAnimationFrame(animation);
}
requestAnimationFrame(animation);

function makePhoto(){
  const c=document.createElement('canvas');c.width=1200;c.height=675;const g=c.getContext('2d');
  if(state.camera&&video.videoWidth&&video.videoHeight){
    const vw=video.videoWidth,vh=video.videoHeight,s=Math.max(1200/vw,675/vh),dw=vw*s,dh=vh*s;
    g.save();g.translate(1200,0);g.scale(-1,1);g.drawImage(video,(1200-dw)/2,(675-dh)/2,dw,dh);g.restore();
    const wash=g.createLinearGradient(0,0,1200,675);wash.addColorStop(0,'#a9d8e7');wash.addColorStop(.5,'#f1c5d1');wash.addColorStop(1,'#cde7d8');
    g.globalAlpha=state.pastelTint/100;g.fillStyle=wash;g.fillRect(0,0,1200,675);g.globalAlpha=1;
  }else{g.fillStyle='#d4edff';g.fillRect(0,0,1200,675)}
  for(let i=0;i<125;i++){
    const x=random(20,1180),y=random(20,560),a=random(0,Math.PI*2),s=random(3,8);
    g.save();g.translate(x,y);g.rotate(a);g.fillStyle=colors[i%colors.length];g.fillRect(-s,-s*.4,s*1.6,s*.9);g.restore();
  }
  g.strokeStyle='#fff8ed';g.lineWidth=15;g.strokeRect(12,12,1176,651);
  g.fillStyle='#f6faffec';g.fillRect(36,568,1128,70);
  g.fillStyle='#1c669e';g.font='bold 37px Gaegu,sans-serif';g.textAlign='left';g.fillText(`${playerLabel()}의 비눗방울 추억 ♡`,51,614);
  g.textAlign='right';g.fillText(`오늘의 점수 ${state.total} / 200`,1149,614);
  return c;
}
function takePhoto(){
  if(state.phase!=='pose')return;phase('photo');
  state.photoData=makePhoto().toDataURL('image/png');$('photoPreview').src=state.photoData;
  $('photoPoints').textContent=`${state.total} / 200`;only('photoScreen');refreshLayout();
}
$('savePhoto').addEventListener('click',()=>{
  if(!state.photoData)return;const link=document.createElement('a');link.href=state.photoData;
  link.download='little-bubble-days-memory.png';document.body.append(link);link.click();link.remove();
});
$('goHome').addEventListener('click',()=>{
  ++delayed;state.particles=[];state.scores={my:0,reverse:0};state.total=0;setPlayVisible(true);startSoap();
});
$('restartAll').addEventListener('click',()=>{
  ++delayed;state.particles=[];state.scores={my:0,reverse:0};state.total=0;
  setPlayVisible(false);$('playerName').value='';$('playerAge').value='';state.name='';state.age=7;
  phase('permission');only('permissionScreen');
  if(state.camera){$('allowCamera').textContent='이어서 시작하기';$('cameraWarning').hidden=true}refreshLayout();
});
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(track=>track.stop())});
