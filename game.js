(() => {
  const $ = (id) => document.getElementById(id);
  const lobby = $('lobbyScreen');
  const gameScreen = $('gameScreen');
  const canvas = $('world');
  const ctx = canvas.getContext('2d');
  const itemsSeed = [
    {x:192,y:151,type:'POWER CELL',icon:'▣',color:'#71f0dc'},
    {x:357,y:398,type:'RELAY FUSE',icon:'⌁',color:'#ffd27d'},
    {x:681,y:192,type:'COIL ASSEMBLY',icon:'◎',color:'#a8c9ff'},
    {x:779,y:443,type:'PARALYSIS DOSE',icon:'⚡',color:'#ff8162',special:true},
    {x:128,y:458,type:'MEDKIT',icon:'+',color:'#ff9680',special:true}
  ];
  const state = {
    room:'', name:'Rookie', player:{x:125,y:275}, alien:{x:780,y:280}, items:[], inventory:[], repaired:0,
    noise:0, alertUntil:0, caught:false, captured:false, stunUntil:0, stunAvailable:false, win:false, keys:{}, lastTime:0,
    rocks:[], brush:[], beacon:{x:815,y:497}, callouts:0, players:{},
    net:{peer:null,isHost:false,connected:false,localId:'',connections:{},lastMove:0,lastSnapshot:0},
    patrolTarget:{x:430,y:300},patrolChangeAt:0
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function paintRooms(){
    $('roomList').innerHTML='<div class="room-directory-note"><span class="pulse"></span><div><b>ROOMS ARE PRIVATE BY CODE</b><small>Create a room above and share its code with your crew. The live directory will come later.</small></div></div>';
  }
  function randomCode(){return Math.random().toString(36).slice(2,6).toUpperCase();}
  function notify(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove('show'),2100)}
  function enterRoom(code){
    state.name=($('callsign').value.trim()||'Rookie').slice(0,16);state.room=code.toUpperCase();state.player={x:125,y:275};state.alien={x:780,y:280};state.patrolTarget={x:430,y:300};state.patrolChangeAt=performance.now()+1300;state.items=itemsSeed.map(x=>({...x}));state.inventory=[];state.repaired=0;state.noise=0;state.alertUntil=0;state.caught=false;state.captured=false;state.stunUntil=0;state.stunAvailable=false;state.win=false;state.callouts=0;state.players={};
    const localId=state.net.localId||'local';state.players[localId]={id:localId,name:state.name,x:state.player.x,y:state.player.y,captured:false,inventory:state.inventory,noise:0};state.net.connected=true;
    lobby.classList.remove('active');gameScreen.classList.add('active');$('copyRoom').textContent=`ROOM ${state.room} · COPY`;renderCrew();updateHud();placeWorld();state.lastTime=0;window.requestAnimationFrame(loop);notify('Crew link open. Share the room code with your friends.');
  }
  function makePeer(role,code){
    const note=$('formNote');
    if(!window.Peer){note.textContent='The connection library did not load. Check internet, then refresh this page.';notify('Could not load the multiplayer connection.');return}
    note.textContent=role==='host'?'Opening a private room…':'Connecting to room…';
    $('createRoom').disabled=true;$('joinRoom').disabled=true;
    const hostId=`signallost-${code.toLowerCase()}`;
    const peer=role==='host'?new Peer(hostId,{debug:1}):new Peer({debug:1});
    state.net.peer=peer;state.net.isHost=role==='host';
    peer.on('error',err=>{
      $('createRoom').disabled=false;$('joinRoom').disabled=false;
      const message=err.type==='unavailable-id'?'That room code is already in use. Create a new room.':err.type==='peer-unavailable'?'Room not found. Check the code and try again.':'Could not connect. Use the same public game link and check that both devices are online.';
      note.textContent=message;notify(message);
      if(state.net.peer===peer){try{peer.destroy()}catch{}state.net.peer=null;state.net.connected=false}
    });
    if(role==='host')peer.on('connection',conn=>attachConnection(conn,true));
    peer.on('open',id=>{
      state.net.localId=id;
      if(role==='host'){
        enterRoom(code);$('createRoom').disabled=false;$('joinRoom').disabled=false;
        $('radioText').textContent='Room is live. Share the code with your crew.';
      }else{
        const conn=peer.connect(hostId,{reliable:true,serialization:'json'});
        conn.on('open',()=>{
          attachConnection(conn,false);enterRoom(code);conn.send({type:'join',name:state.name});
          $('createRoom').disabled=false;$('joinRoom').disabled=false;
          $('radioText').textContent='Crew link established. Stay close and watch each other.';
        });
        conn.on('error',()=>{note.textContent='Connection failed. Ask the host to create a fresh room code.';$('createRoom').disabled=false;$('joinRoom').disabled=false});
      }
    });
  }
  function attachConnection(conn,isHostSide){
    const register=()=>{state.net.connections[conn.peer]=conn;if(!isHostSide)state.net.connections.host=conn};
    if(conn.open)register();else conn.on('open',register);
    conn.on('data',msg=>{
      if(isHostSide){
        if(msg.type==='join'){
          if(Object.keys(state.players).length>=6){conn.send({type:'full'});conn.close();return}
          state.players[conn.peer]={id:conn.peer,name:String(msg.name||'Crew').slice(0,16),x:135+Object.keys(state.players).length*23,y:290,captured:false,inventory:[],noise:0};
          renderCrew();sendSnapshot();notify(`${state.players[conn.peer].name} joined the crew.`);
        }else if(msg.type==='move'&&state.players[conn.peer]){
          const p=state.players[conn.peer];
          if(p.captured)return;
          p.x=clamp(Number(msg.x)||p.x,22,938);p.y=clamp(Number(msg.y)||p.y,22,598);p.noise=Number(msg.noise)||0;
        }else if(msg.type==='action'&&state.players[conn.peer]){
          if(msg.action==='interact')interactFor(conn.peer);
          if(msg.action==='stun')useStunFor(conn.peer);
          if(msg.action==='radio'){state.alertUntil=performance.now()+1800;state.noise=2;}
        }
      }else if(msg.type==='snapshot')applySnapshot(msg);
      else if(msg.type==='captured'){state.captured=true;state.player.x=msg.x;state.player.y=msg.y;state.keys={};notify('You are down! A crewmate must reach you and use the paralysis dose.');}
      else if(msg.type==='rescued'){state.captured=false;state.player.x=msg.x;state.player.y=msg.y;state.keys={};notify('Rescued! Get back to the beacon.');}
      else if(msg.type==='notice')notify(msg.message);
      else if(msg.type==='full'){notify('This room already has 6 crew members.');conn.close()}
    });
    conn.on('close',()=>{delete state.net.connections[conn.peer];if(isHostSide&&state.players[conn.peer]){const left=state.players[conn.peer].name;delete state.players[conn.peer];renderCrew();notify(`${left} left the crew.`)}});
    conn.on('error',()=>notify('Crew connection interrupted.'));
  }
  function sendToHost(message){const conn=state.net.connections.host;if(conn&&conn.open)conn.send(message)}
  function sendSnapshot(){
    if(!state.net.isHost)return;
    const data={type:'snapshot',players:state.players,items:state.items,repaired:state.repaired,stunAvailable:state.stunAvailable,stunUntil:state.stunUntil,alien:state.alien,win:state.win};
    for(const conn of Object.values(state.net.connections))if(conn&&conn.open)conn.send(data);
  }
  function applySnapshot(msg){
    state.players=msg.players||state.players;state.items=msg.items||state.items;state.repaired=msg.repaired||0;state.stunAvailable=!!msg.stunAvailable;state.stunUntil=msg.stunUntil||0;state.alien=msg.alien||state.alien;state.win=!!msg.win;
    const mine=state.players[state.net.localId];if(mine){const wasCaptured=state.captured;state.captured=!!mine.captured;state.inventory=mine.inventory||[];if(state.captured){state.player.x=mine.x;state.player.y=mine.y;state.keys={};if(!wasCaptured)notify('You are down! A crewmate must reach you and use the paralysis dose.')}else if(wasCaptured){state.player.x=mine.x;state.player.y=mine.y;state.keys={};notify('Rescued! Get back to the beacon.')}}
    $('stunButton').disabled=!state.stunAvailable;$('stunText').textContent=state.stunAvailable?'READY · PARALYZE / RESCUE':'NO DOSE · SEARCH THE CRASH';
    renderCrew();updateHud();
  }
  function renderCrew(){
    const list=Object.values(state.players);$('crewCount').textContent=`${list.length} / 06`;
    $('crewList').innerHTML=list.map((p,i)=>`<div class="crew-entry"><i class="crew-dot" style="background:${p.captured?'#ff6048':i?'#f0a27b':'#57f0de'};box-shadow:0 0 8px ${p.captured?'#ff604877':'#57f0de66'}"></i>${escapeHtml(p.name)} <small>${p.captured?'DOWN':p.id===state.net.localId?'YOU':'CREW'}</small></div>`).join('');
    const downed=list.find(p=>p.captured&&p.id!==state.net.localId);const guide=$('rescueGuide');
    if(downed){guide.classList.add('show');guide.innerHTML=`<b>CREWMATE DOWN</b><small>${escapeHtml(downed.name)} needs help.</small><span>GET CLOSE · USE THE DOSE</span>`}
    else{guide.classList.remove('show');guide.innerHTML=''}
  }
  function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function placeWorld(){
    state.rocks=[];state.brush=[];
    let seed=1977;const rnd=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646};
    for(let i=0;i<70;i++){const x=35+rnd()*890,y=30+rnd()*560;if(Math.hypot(x-state.player.x,y-state.player.y)>65&&Math.hypot(x-state.beacon.x,y-state.beacon.y)>70)state.rocks.push({x,y,r:5+rnd()*15});}
    for(let i=0;i<100;i++)state.brush.push({x:10+rnd()*940,y:10+rnd()*600,r:5+rnd()*11,a:.12+rnd()*.25});
  }
  function drawCrewSprite(x,y,color,label,down,t,local){
    ctx.save();ctx.translate(x,y);
    if(down){ctx.rotate(-.32);ctx.globalAlpha=.9;ctx.fillStyle='rgba(0,0,0,.38)';ctx.beginPath();ctx.ellipse(0,8,17,7,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=10;ctx.beginPath();ctx.ellipse(0,0,14,7,0,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#dff7f2';ctx.beginPath();ctx.arc(-8,-1,4,0,Math.PI*2);ctx.fill();ctx.restore();return}
    const bob=Math.sin(t*8+(local?0:1.5))*1.3;
    ctx.fillStyle='rgba(0,0,0,.38)';ctx.beginPath();ctx.ellipse(0,9,15,6,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#263b38';ctx.fillRect(-11,-4-bob,5,13);ctx.fillStyle='#536c61';ctx.fillRect(-12,-7-bob,7,9);
    ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=11;ctx.beginPath();ctx.roundRect(-7,-8-bob,14,18,5);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#d7e4d8';ctx.fillRect(-5,-3-bob,10,3);ctx.fillStyle='#152724';ctx.fillRect(-4,-2-bob,8,2);
    ctx.fillStyle='#d0d8c9';ctx.beginPath();ctx.arc(0,-11-bob,7,0,Math.PI*2);ctx.fill();ctx.fillStyle=local?'#61fae3':'#ffb08d';ctx.beginPath();ctx.ellipse(1,-11-bob,4.3,2.3,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#dce2d0';ctx.fillRect(-6,8-bob,4,5);ctx.fillRect(2,8-bob,4,5);
    ctx.fillStyle=local?'#adfff2':'#ffe0ce';ctx.font='600 10px monospace';ctx.textAlign='center';ctx.shadowColor='#050b09';ctx.shadowBlur=4;ctx.fillText(label,0,-22-bob);ctx.shadowBlur=0;
    ctx.restore();
  }
  function drawWorld(){
    const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
    const t=performance.now()/1000;
    const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#303a32');bg.addColorStop(.38,'#192720');bg.addColorStop(1,'#29342c');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    // A cold moonlit haze moves slowly across the valley.
    ctx.save();ctx.globalCompositeOperation='screen';
    for(let i=0;i<4;i++){const x=((t*12+i*285)%(w+400))-200;const fog=ctx.createRadialGradient(x,100+i*125,12,x,100+i*125,230);fog.addColorStop(0,'rgba(142,195,172,.075)');fog.addColorStop(1,'rgba(142,195,172,0)');ctx.fillStyle=fog;ctx.fillRect(x-235,10+i*95,470,230)}
    ctx.restore();
    ctx.strokeStyle='rgba(172,199,162,.055)';ctx.lineWidth=1;for(let x=0;x<w;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
    // Worn path winding between the crash site and beacon.
    ctx.beginPath();ctx.moveTo(115,273);ctx.bezierCurveTo(330,210,390,495,590,395);ctx.bezierCurveTo(720,330,711,486,817,499);ctx.strokeStyle='rgba(174,155,111,.12)';ctx.lineWidth=72;ctx.stroke();ctx.strokeStyle='rgba(193,177,135,.08)';ctx.lineWidth=2;ctx.setLineDash([8,12]);ctx.stroke();ctx.setLineDash([]);
    for(let i=0;i<state.brush.length;i++){const b=state.brush[i];const sway=Math.sin(t*1.2+i)*1.7;ctx.fillStyle=`rgba(132,164,119,${b.a})`;ctx.beginPath();ctx.ellipse(b.x+sway,b.y,b.r,b.r*.38,-.55,0,Math.PI*2);ctx.fill()}
    // Crash pod and beacon silhouettes.
    ctx.save();ctx.translate(115,273);ctx.rotate(-.35);ctx.fillStyle='#5c6860';ctx.fillRect(-38,-22,78,43);ctx.fillStyle='#89948a';ctx.fillRect(-18,-30,45,16);ctx.fillStyle='#ff653f';ctx.fillRect(-42,-7,9,15);ctx.restore();
    ctx.save();ctx.translate(state.beacon.x,state.beacon.y);ctx.fillStyle='#45564e';ctx.fillRect(-21,-12,42,25);ctx.fillStyle=state.repaired>=3?'#66ffdd':'#ff653f';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=state.repaired>=3?22:8;ctx.fillRect(-7,-40,14,29);ctx.shadowBlur=0;ctx.strokeStyle='#94a99a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-38);ctx.lineTo(0,-65);ctx.lineTo(25,-54);ctx.stroke();ctx.globalAlpha=.25+Math.sin(t*2.6)*.11;ctx.strokeStyle=state.repaired>=3?'#66ffdd':'#ff653f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-24,30+Math.sin(t*2.6)*5,0,Math.PI*2);ctx.stroke();ctx.restore();
    for(const r of state.rocks){ctx.fillStyle='#3d4841';ctx.beginPath();ctx.ellipse(r.x,r.y,r.r,r.r*.72,-.25,0,Math.PI*2);ctx.fill();ctx.fillStyle='rgba(175,194,165,.10)';ctx.beginPath();ctx.ellipse(r.x-r.r*.23,r.y-r.r*.22,r.r*.5,r.r*.22,-.25,0,Math.PI*2);ctx.fill()}
    // Items glow when nearby.
    for(const item of state.items){ctx.save();ctx.translate(item.x,item.y);const bob=Math.sin(t*2+item.x)*2;ctx.translate(0,bob);ctx.rotate(Math.PI/4);ctx.shadowColor=item.color;ctx.shadowBlur=14;ctx.fillStyle='rgba(7,20,22,.95)';ctx.strokeStyle=item.color;ctx.lineWidth=1.5;ctx.fillRect(-9,-9,18,18);ctx.strokeRect(-9,-9,18,18);ctx.rotate(-Math.PI/4);ctx.shadowBlur=0;ctx.fillStyle=item.color;ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(item.icon,0,0);ctx.restore();if(Math.hypot(item.x-state.player.x,item.y-state.player.y)<65){ctx.fillStyle='#e0f1e6';ctx.font='600 10px monospace';ctx.textAlign='center';ctx.fillText(`${item.type} · E`,item.x,item.y-20)}}
    // Sound rings disclose the alien's search behavior.
    if(t*1000<state.alertUntil){for(let i=0;i<3;i++){const p=((t*1.5+i/3)%1);ctx.beginPath();ctx.arc(state.player.x,state.player.y,20+p*94,0,Math.PI*2);ctx.strokeStyle=`rgba(255,102,71,${.28*(1-p)})`;ctx.lineWidth=2;ctx.stroke()}}
    const alien=state.alien;const stunned=state.stunUntil>Date.now();ctx.save();ctx.translate(alien.x,alien.y);ctx.rotate(Math.atan2(state.player.y-alien.y,state.player.x-alien.x)+Math.sin(t*4)*.06);
    // Low, eyeless head with a ribbed back and hooked forelimbs.
    ctx.shadowColor=stunned?'#ffb95e':'#ff5939';ctx.shadowBlur=stunned?20:10;ctx.fillStyle=stunned?'#b79769':'#0b100e';ctx.beginPath();ctx.ellipse(0,0,27,15,0,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle=stunned?'#dec38c':'#68796d';ctx.beginPath();ctx.moveTo(12,-9);ctx.quadraticCurveTo(31,-21,32,-14);ctx.lineTo(25,-2);ctx.lineTo(35,8);ctx.quadraticCurveTo(17,10,11,7);ctx.closePath();ctx.fill();
    ctx.strokeStyle=stunned?'#ffe19f':'#a9b8a7';ctx.lineWidth=2.5;ctx.lineCap='round';for(let i=0;i<4;i++){const x=-15+i*8;const leg=Math.sin(t*8+i)*3;ctx.beginPath();ctx.moveTo(x,-10);ctx.lineTo(x-6,-19-leg);ctx.moveTo(x,10);ctx.lineTo(x+7,18+leg);ctx.stroke()}
    ctx.strokeStyle='#d5e2cd';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(10,-9);ctx.lineTo(20,-15);ctx.moveTo(10,9);ctx.lineTo(20,15);ctx.stroke();ctx.restore();
    // Local player and the rest of the crew share the same map positions.
    for(const member of Object.values(state.players)){
      if(member.id===state.net.localId)continue;
      drawCrewSprite(member.x,member.y,member.captured?'#ff6048':'#f0a27b',member.captured?'DOWN':member.name.slice(0,10),member.captured,t,false);
      if(member.captured){ctx.beginPath();ctx.arc(member.x,member.y,21+Math.sin(t*5)*3,0,Math.PI*2);ctx.strokeStyle=`rgba(255,85,56,${.58+Math.sin(t*5)*.2})`;ctx.lineWidth=2;ctx.stroke()}
    }
    drawCrewSprite(state.player.x,state.player.y,state.captured?'#ff5338':'#51ecd9',state.captured?'DOWN':`${state.name} · YOU`,state.captured,t,true);
    if(state.captured){ctx.fillStyle='rgba(255,82,57,.9)';ctx.fillRect(w/2-140,16,280,30);ctx.textAlign='center';ctx.fillStyle='#140c0a';ctx.font='700 11px monospace';ctx.fillText('YOU ARE DOWN · CREW CAN RESCUE YOU',w/2,35)}
    if(state.win){ctx.fillStyle='rgba(2,8,10,.75)';ctx.fillRect(0,0,w,h);ctx.textAlign='center';ctx.fillStyle='#6dffe4';ctx.font='700 31px monospace';ctx.fillText('DISTRESS SIGNAL SENT',w/2,h/2-10);ctx.fillStyle='#d5e4da';ctx.font='13px monospace';ctx.fillText('The rescue beacon is online. Hold the site until pickup.',w/2,h/2+20)}
  }
  function nearestItem(){let best=null,d=49;for(const item of state.items){const n=Math.hypot(item.x-state.player.x,item.y-state.player.y);if(n<d){best=item;d=n}}return best}
  function interact(){
    if(state.net.connected&&!state.net.isHost){sendToHost({type:'action',action:'interact'});return}
    interactFor(state.net.localId||'local');
  }
  function interactFor(playerId){
    const player=state.players[playerId];if(!player||player.captured){notify('You are waiting for a crew rescue.');return}
    const item=state.items.reduce((best,x)=>Math.hypot(x.x-player.x,x.y-player.y)<(best?Math.hypot(best.x-player.x,best.y-player.y):49)?x:best,null);
    if(item){
      if(player.inventory.length>=3){notify('Packs full. Take supplies back to the beacon.');return}
      state.items=state.items.filter(x=>x!==item);
      if(item.type==='PARALYSIS DOSE'){
        state.stunAvailable=true;
        $('stunButton').disabled=false;
        $('stunText').textContent='READY · PARALYZE / RESCUE';
        notify('Paralysis dose secured. Use it near a downed crewmate.');
      } else if(item.type==='MEDKIT'){
        player.inventory.push({name:item.type,icon:item.icon,color:item.color,special:true});
        notify('Medkit secured. Keep moving.');
      } else {
        player.inventory.push({name:item.type,icon:item.icon,color:item.color});
        notify(`${item.type} secured.`);
      }
      if(playerId===state.net.localId)state.inventory=player.inventory;
      updateHud();renderCrew();sendSnapshot();return;
    }
    if(Math.hypot(state.beacon.x-player.x,state.beacon.y-player.y)<76){
      const components=player.inventory.filter(i=>!i.special);
      if(state.repaired<3){
        if(components.length<1){notify('Need a beacon component. Scavenge nearby.');return}
        const used=components[0];player.inventory.splice(player.inventory.indexOf(used),1);state.repaired++;state.noise=Math.max(state.noise,1);
        if(playerId===state.net.localId)state.inventory=player.inventory;
        if(state.repaired===3){state.win=true;$('objectiveChip').textContent='DISTRESS SIGNAL SENT';$('repairText').textContent='Signal is live. Rescue is inbound.';notify('Beacon online! Rescue is inbound.')}
        else notify(`${used.name} installed. ${3-state.repaired} more component${state.repaired===2?'':'s'} needed.`);
        updateHud();sendSnapshot();return;
      }
    }
    notify('Nothing to interact with here. Move close to an item or the beacon.');
  }
  function updateHud(){
    $('itemCount').textContent=`${state.inventory.length} / 3`;
    $('inventory').innerHTML=state.inventory.length?state.inventory.map(i=>`<span class="item-chip" style="color:${i.color}">${i.icon} ${i.name}</span>`).join(''):'<span class="item-chip empty">EMPTY PACK</span>';
    $('repairFill').style.width=`${Math.min(state.repaired/3*100,100)}%`;
    if(!state.win)$('repairText').textContent=state.repaired?`${state.repaired} / 3 installed · bring parts to beacon`:'Collect 3 components to begin repairs.';
    $('objectiveChip').textContent=state.win?'SIGNAL ACTIVE':`REPAIR ${state.repaired} / 3`;
  }
  function useStun(){
    if(!state.stunAvailable)return;
    if(state.net.connected&&!state.net.isHost){sendToHost({type:'action',action:'stun'});return}
    useStunFor(state.net.localId||'local');
  }
  function useStunFor(actorId){
    if(!state.stunAvailable)return;
    const actor=state.players[actorId];if(!actor)return;
    const tellActor=message=>{if(actorId===state.net.localId)notify(message);else{const conn=state.net.connections[actorId];if(conn&&conn.open)conn.send({type:'notice',message})}};
    if(actor.captured){tellActor('You are down. A standing crewmate must use the dose.');return}
    const downed=Object.values(state.players).filter(p=>p.captured).sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    if(downed&&Math.hypot(downed.x-actor.x,downed.y-actor.y)>110){tellActor(`Get within rescue range of ${downed.name} before using the dose.`);return}
    state.stunAvailable=false;state.stunUntil=Date.now()+15000;$('stunButton').disabled=true;$('stunText').textContent='USED · 15 SECOND WINDOW';
    if(downed){downed.captured=false;downed.x=actor.x+18;downed.y=actor.y+14;const conn=state.net.connections[downed.id];if(conn&&conn.open)conn.send({type:'rescued',x:downed.x,y:downed.y});notify(`${downed.name} rescued! The Listener is paralyzed.`)}else notify('The Listener is paralyzed for 15 seconds.');
    const me=state.players[state.net.localId];if(me)state.captured=!!me.captured;
    renderCrew();sendSnapshot();setTimeout(()=>{if(!state.win)notify('The Listener is moving again.')},15000);
  }
  function callRadio(){
    state.callouts++;state.noise=2;state.alertUntil=performance.now()+1800;
    $('radioText').textContent=['“I found something. I am bringing it to the beacon.”','“Keep the radio down. I can hear it clicking out there.”','“Beacon is almost ready. Meet me at the crash path.”'][state.callouts%3];
    if(state.net.connected&&!state.net.isHost)sendToHost({type:'action',action:'radio'});
    notify('Callout broadcast. The alien heard the radio.');
  }
  function loop(now){if(!gameScreen.classList.contains('active'))return;const dt=Math.min((now-state.lastTime)/1000||0,.04);state.lastTime=now;
    const p=state.player;let dx=0,dy=0;if(!state.captured&&!state.win){if(state.keys.w||state.keys.ArrowUp)dy--;if(state.keys.s||state.keys.ArrowDown)dy++;if(state.keys.a||state.keys.ArrowLeft)dx--;if(state.keys.d||state.keys.ArrowRight)dx++;}
    if(dx||dy){const running=state.keys.Shift;const m=Math.hypot(dx,dy);const speed=running?174:108;p.x=clamp(p.x+dx/m*speed*dt,22,938);p.y=clamp(p.y+dy/m*speed*dt,22,598);if(running){state.noise=Math.max(state.noise,.75);state.alertUntil=Math.max(state.alertUntil,now+220)}}else state.noise=Math.max(0,state.noise-dt*.48);
    const local=state.players[state.net.localId];if(local){local.x=p.x;local.y=p.y;local.noise=state.noise;local.captured=state.captured;local.inventory=state.inventory}
    if(state.net.connected&&!state.net.isHost&&!state.captured&&now-state.net.lastMove>60){sendToHost({type:'move',x:p.x,y:p.y,noise:state.noise});state.net.lastMove=now}
    const a=state.alien;
    if(!state.net.connected||state.net.isHost){
      if(state.stunUntil<Date.now()){
        const crew=Object.values(state.players).filter(x=>!x.captured&&!state.win);
        const audible=crew.filter(x=>x.noise>.2);
        const candidates=audible.length?audible:crew;
        const target=candidates.sort((x,y)=>Math.hypot(x.x-a.x,x.y-a.y)-Math.hypot(y.x-a.x,y.y-a.y))[0];
        if(target){
          const d=Math.hypot(target.x-a.x,target.y-a.y);const alert=now<state.alertUntil||audible.length>0||d<200;
          if(alert){const speed=d<95?82:d<220?68:56;a.x+=(target.x-a.x)/(d||1)*speed*dt;a.y+=(target.y-a.y)/(d||1)*speed*dt}
          else{
            const pd=Math.hypot(state.patrolTarget.x-a.x,state.patrolTarget.y-a.y);
            if(now>state.patrolChangeAt||pd<42){state.patrolTarget={x:42+Math.random()*876,y:35+Math.random()*550};state.patrolChangeAt=now+4200+Math.random()*2400}
            const d0=Math.hypot(state.patrolTarget.x-a.x,state.patrolTarget.y-a.y);
            if(d0>4){a.x+=(state.patrolTarget.x-a.x)/d0*34*dt;a.y+=(state.patrolTarget.y-a.y)/d0*34*dt}
          }
          for(const member of crew){if(!member.captured&&Math.hypot(member.x-a.x,member.y-a.y)<24){member.captured=true;if(member.id===state.net.localId){state.captured=true;state.keys={}}else{const conn=state.net.connections[member.id];if(conn&&conn.open)conn.send({type:'captured',x:member.x,y:member.y})}notify(`${member.name} is down! Reach them and use the paralysis dose.`);renderCrew();sendSnapshot()}}
        }
      }
      if(state.net.isHost&&now-state.net.lastSnapshot>100){sendSnapshot();state.net.lastSnapshot=now}
    }
    const roster=Object.values(state.players);const downedMate=roster.find(x=>x.captured&&x.id!==state.net.localId);const near=Math.min(...roster.map(x=>Math.hypot(x.x-a.x,x.y-a.y)),999);
    if(state.captured){$('alertBanner').textContent='YOU ARE DOWN · WAIT FOR YOUR CREW';$('alertBanner').classList.add('show');$('threatText').textContent='THREAT: RESCUE NEEDED';$('threatText').classList.add('danger')}
    else if(downedMate){$('alertBanner').textContent=`CREWMATE DOWN · ${downedMate.name.toUpperCase()} IS MARKED RED`;$('alertBanner').classList.add('show');$('threatText').textContent='THREAT: CREWMATE DOWN';$('threatText').classList.add('danger')}
    else if(now<state.alertUntil||near<220){$('alertBanner').textContent='THE LISTENER IS SEARCHING';$('alertBanner').classList.add('show');$('threatText').textContent='THREAT: IT HEARD YOU';$('threatText').classList.add('danger')}
    else{$('alertBanner').classList.remove('show');$('threatText').textContent='THREAT: QUIET';$('threatText').classList.remove('danger')}
    drawWorld();window.requestAnimationFrame(loop);
  }
  $('createRoom').addEventListener('click',()=>makePeer('host',randomCode()));
  $('joinRoom').addEventListener('click',()=>{const c=$('roomCode').value.trim().toUpperCase();if(!/^[A-Z0-9]{4}$/.test(c)){ $('formNote').textContent='Enter a 4-character room code.';return}state.name=($('callsign').value.trim()||'Rookie').slice(0,16);makePeer('join',c)});
  $('roomCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4));
  $('copyRoom').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.room);notify(`Room code ${state.room} copied.`)}catch{notify(`Share this room code: ${state.room}`)}});
  $('leaveGame').addEventListener('click',()=>{if(state.net.peer){try{state.net.peer.destroy()}catch{}}state.net={peer:null,isHost:false,connected:false,localId:'',connections:{},lastMove:0,lastSnapshot:0};gameScreen.classList.remove('active');lobby.classList.add('active');paintRooms()});
  $('stunButton').addEventListener('click',useStun);$('radioButton').addEventListener('click',callRadio);
  $('soundToggle').addEventListener('click',()=>notify('Ambient audio is not included in this prototype.'));
  document.querySelectorAll('.touch-controls [data-key]').forEach(button=>{
    const key=button.dataset.key;
    const release=()=>{state.keys[key]=false;button.classList.remove('pressed')};
    button.addEventListener('pointerdown',event=>{event.preventDefault();state.keys[key]=true;button.classList.add('pressed');button.setPointerCapture(event.pointerId)});
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
  });
  $('touchInteract').addEventListener('pointerdown',event=>{event.preventDefault();interact()});
  window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();state.keys[e.key==='Shift'?'Shift':e.key.toLowerCase()]=true;if(e.key==='e'||e.key==='E')interact()});
  window.addEventListener('keyup',e=>{state.keys[e.key==='Shift'?'Shift':e.key.toLowerCase()]=false});
  paintRooms();
})();
